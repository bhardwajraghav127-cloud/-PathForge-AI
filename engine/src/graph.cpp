// Graph build + validation + effective costs.
#include "pathforge/graph.hpp"

#include <algorithm>
#include <limits>
#include <map>
#include <set>

namespace pathforge {
namespace {

bool inLatLon(double lat, double lon) {
  return lat >= -90.0 && lat <= 90.0 && lon >= -180.0 && lon <= 180.0;
}

// round-half-up(baseline * 1000 / factor), __int128 intermediate (no overflow).
std::int64_t scaledTime(std::int64_t baseline, int factorPermille) {
  if (factorPermille <= 0) return kInf64;
  __int128 num = static_cast<__int128>(baseline) * 1000;
  __int128 q = (num + factorPermille / 2) / factorPermille;
  if (q > static_cast<__int128>(kInf64)) return kInf64;
  return static_cast<std::int64_t>(q);
}

}  // namespace

std::vector<ValidationIssue> Graph::validate(const Network& net) {
  std::vector<ValidationIssue> out;
  std::set<std::string> vids;
  for (const auto& v : net.vertices) {
    if (v.id.empty() || v.id.size() > 128) {
      out.push_back({"BAD_ID", "vertex id must be 1..128 chars"});
      continue;
    }
    if (!vids.insert(v.id).second) out.push_back({"DUPLICATE_ID", "duplicate vertex: " + v.id});
    if (!inLatLon(v.lat, v.lon)) out.push_back({"BAD_COORDS", "vertex out of range: " + v.id});
  }
  std::set<std::string> rids;
  for (const auto& r : net.roads) {
    if (r.id.empty() || r.id.size() > 128) {
      out.push_back({"BAD_ID", "road id must be 1..128 chars"});
      continue;
    }
    if (!rids.insert(r.id).second) out.push_back({"DUPLICATE_ID", "duplicate road: " + r.id});
    if (vids.find(r.from) == vids.end())
      out.push_back({"UNKNOWN_VERTEX", "road " + r.id + " unknown from: " + r.from});
    if (vids.find(r.to) == vids.end())
      out.push_back({"UNKNOWN_VERTEX", "road " + r.id + " unknown to: " + r.to});
    if (r.distanceM < 0 || r.distanceM > 1000000000LL)
      out.push_back({"BAD_RANGE", "road " + r.id + " distanceM out of range"});
    if (r.baselineTimeS < 0 || r.baselineTimeS > 1000000000LL)
      out.push_back({"BAD_RANGE", "road " + r.id + " baselineTimeS out of range"});
    if (r.tollInr < 0 || r.tollInr > 1000000000LL)
      out.push_back({"BAD_RANGE", "road " + r.id + " tollInr out of range"});
  }
  if (net.vertices.size() > 1000000) out.push_back({"LIMIT_EXCEEDED", "too many vertices"});
  if (net.roads.size() > 2000000) out.push_back({"LIMIT_EXCEEDED", "too many roads"});
  return out;
}

std::pair<Graph, std::vector<ValidationIssue>> Graph::build(const Network& net, const Overlay& ov) {
  Graph g;
  std::vector<ValidationIssue> issues = validate(net);
  // Hard errors block the build; warnings (none defined at M1) would not.
  for (const auto& i : issues) {
    if (i.code != "DISCONNECTED_GRAPH") return {g, issues};
  }
  if (!issues.empty()) return {g, issues};

  g.vertices_ = net.vertices;
  g.vertexIds_.reserve(net.vertices.size());
  for (const auto& v : net.vertices) g.vertexIds_.push_back(v.id);
  g.roads_ = net.roads;

  std::map<std::string, int> vid;
  for (std::size_t i = 0; i < net.vertices.size(); ++i)
    vid[net.vertices[i].id] = static_cast<int>(i);

  std::map<std::string, int> factor;
  for (const auto& f : ov.factors) factor[f.first] = f.second;
  std::set<std::string> closed(ov.closures.begin(), ov.closures.end());

  // Expand arcs in road-input order, then canonicalize by arc-ID sort.
  struct Raw {
    Arc arc;
    EffectiveCost c;
  };
  std::vector<Raw> raws;
  raws.reserve(net.roads.size() * 2);
  for (std::size_t ri = 0; ri < net.roads.size(); ++ri) {
    const Road& r = net.roads[ri];
    bool shut = closed.count(r.id) > 0 || !r.available;
    int permille = 1000;
    auto fit = factor.find(r.id);
    if (fit != factor.end()) {
      if (fit->second < 1 || fit->second > 1000) {
        return {Graph{}, {{{"BAD_RANGE", "factor for road " + r.id + " must be 1..1000"}}}};
      }
      permille = fit->second;
    }
    EffectiveCost ec;
    ec.usable = !shut;
    ec.distanceM = r.distanceM;
    ec.tollInr = r.tollInr;
    ec.baselineTimeS = r.baselineTimeS;
    ec.timeS = shut ? kInf64 : scaledTime(r.baselineTimeS, permille);
    int a = vid[r.from];
    int b = vid[r.to];
    Arc fwd;
    fwd.id = r.id + ":f";
    fwd.roadId = r.id;
    fwd.from = a;
    fwd.to = b;
    fwd.roadIdx = ri;
    fwd.forward = true;
    raws.push_back({fwd, ec});
    if (!r.oneWay) {
      Arc rev = fwd;
      rev.id = r.id + ":r";
      rev.from = b;
      rev.to = a;
      rev.forward = false;
      raws.push_back({rev, ec});
    }
  }
  std::sort(raws.begin(), raws.end(),
            [](const Raw& x, const Raw& y) { return x.arc.id < y.arc.id; });
  g.arcs_.reserve(raws.size());
  g.costs_.reserve(raws.size());
  g.factors_.reserve(raws.size());
  for (auto& r : raws) {
    g.arcs_.push_back(r.arc);
    g.costs_.push_back(r.c);
  }
  // Factors recorded per road for congestion classification (default 1000).
  std::map<std::string, int> fmap;
  for (const auto& f : ov.factors) fmap[f.first] = f.second;
  for (const auto& a : g.arcs_) {
    auto it = fmap.find(a.roadId);
    g.factors_.push_back(it == fmap.end() ? 1000 : it->second);
  }
  g.adj_.assign(g.vertices_.size(), {});
  for (std::size_t i = 0; i < g.arcs_.size(); ++i) {
    if (!g.costs_[i].usable) continue;  // closed arcs excluded from adjacency
    g.adj_[static_cast<std::size_t>(g.arcs_[i].from)].push_back(static_cast<int>(i));
  }
  return {g, {}};
}

int Graph::vertexCount() const { return static_cast<int>(vertices_.size()); }
int Graph::arcCount() const { return static_cast<int>(arcs_.size()); }

int Graph::vertexIndex(const std::string& id) const {
  for (std::size_t i = 0; i < vertexIds_.size(); ++i)
    if (vertexIds_[i] == id) return static_cast<int>(i);
  return -1;
}

const Vertex& Graph::vertex(int idx) const { return vertices_.at(static_cast<std::size_t>(idx)); }
const Arc& Graph::arc(int arcIdx) const { return arcs_.at(static_cast<std::size_t>(arcIdx)); }

const std::vector<int>& Graph::outgoing(int vertexIdx) const {
  return adj_.at(static_cast<std::size_t>(vertexIdx));
}

EffectiveCost Graph::cost(int arcIdx) const { return costs_.at(static_cast<std::size_t>(arcIdx)); }

int Graph::factorPermille(int arcIdx) const {
  return factors_.at(static_cast<std::size_t>(arcIdx));
}
const Road& Graph::roadOf(int arcIdx) const {
  return roads_.at(arcs_.at(static_cast<std::size_t>(arcIdx)).roadIdx);
}

}  // namespace pathforge
