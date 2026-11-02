// Graph build + validation + effective costs.
#include "pathforge/graph.hpp"

#include <algorithm>
#include <limits>
#include <map>
#include <set>
#include <utility>

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

  std::map<std::string, int> roadFactor;
  for (const auto& f : ov.factors) roadFactor[f.first] = f.second;
  std::set<std::string> roadClosed(ov.closures.begin(), ov.closures.end());

  // Incident references must be valid; ids stable and unique.
  {
    std::set<std::string> seen;
    std::set<std::string> roadIds;
    for (const auto& r : net.roads) roadIds.insert(r.id);
    for (const auto& in : ov.incidents) {
      if (in.id.empty() || !seen.insert(in.id).second)
        return {Graph{}, {{{"DUPLICATE_ID", "duplicate incident id: " + in.id}}}};
      if (roadIds.find(in.road) == roadIds.end())
        return {Graph{},
                {{{"UNKNOWN_ROAD", "incident " + in.id + " unknown road: " + in.road}}}};
    }
  }

  auto dirApplies = [](IncidentDir d, bool fwd) {
    return d == IncidentDir::Both || (d == IncidentDir::Forward) == fwd;
  };

  // Expand arcs in road-input order, then canonicalize by arc-ID sort.
  struct Raw {
    Arc arc;
    EffectiveCost c;
    std::vector<std::string> incidentIds;
  };
  std::vector<Raw> raws;
  raws.reserve(net.roads.size() * 2);
  for (std::size_t ri = 0; ri < net.roads.size(); ++ri) {
    const Road& r = net.roads[ri];
    int basePermille = 1000;
    auto fit = roadFactor.find(r.id);
    if (fit != roadFactor.end()) {
      if (fit->second < 1 || fit->second > 1000) {
        return {Graph{}, {{{"BAD_RANGE", "factor for road " + r.id + " must be 1..1000"}}}};
      }
      basePermille = fit->second;
    }
    bool roadShut = roadClosed.count(r.id) > 0 || !r.available;
    // Per direction: min factor, summed delays, closure wins.
    for (int pass = 0; pass < (r.oneWay ? 1 : 2); ++pass) {
      bool fwd = (pass == 0);
      int permille = basePermille;
      std::int64_t delay = 0;
      bool shut = roadShut;
      std::vector<std::string> ids;
      for (const auto& in : ov.incidents) {
        if (in.road != r.id || !dirApplies(in.dir, fwd)) continue;
        ids.push_back(in.id);
        if (in.kind == IncidentKind::Closure) {
          shut = true;
        } else {
          int kf = incidentFactorPermille(in.kind);
          if (kf < permille) permille = kf;
          delay += incidentDelayS(in.kind);
        }
      }
      EffectiveCost ec;
      ec.usable = !shut;
      ec.distanceM = r.distanceM;
      ec.tollInr = r.tollInr;
      ec.baselineTimeS = r.baselineTimeS;
      ec.factorPermille = permille;
      ec.delayS = shut ? 0 : delay;
      if (shut) {
        ec.timeS = kInf64;
      } else {
        std::int64_t scaled = scaledTime(r.baselineTimeS, permille);
        __int128 t = static_cast<__int128>(scaled) + delay;
        ec.timeS = t > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(t);
      }
      Arc a;
      a.id = r.id + (fwd ? ":f" : ":r");
      a.roadId = r.id;
      a.from = vid[r.from];
      a.to = vid[r.to];
      if (!fwd) std::swap(a.from, a.to);
      a.roadIdx = ri;
      a.forward = fwd;
      raws.push_back({a, ec, ids});
    }
  }
  std::sort(raws.begin(), raws.end(),
            [](const Raw& x, const Raw& y) { return x.arc.id < y.arc.id; });
  g.arcs_.reserve(raws.size());
  g.costs_.reserve(raws.size());
  g.arcIncidentIds_.reserve(raws.size());
  for (auto& r : raws) {
    g.arcs_.push_back(r.arc);
    g.costs_.push_back(r.c);
    g.arcIncidentIds_.push_back(r.incidentIds);
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
  return costs_.at(static_cast<std::size_t>(arcIdx)).factorPermille;
}
const Road& Graph::roadOf(int arcIdx) const {
  return roads_.at(arcs_.at(static_cast<std::size_t>(arcIdx)).roadIdx);
}
const std::vector<std::string>& Graph::arcIncidents(int arcIdx) const {
  return arcIncidentIds_.at(static_cast<std::size_t>(arcIdx));
}

Graph Graph::subgraph(const std::set<std::string>& bannedArcs,
                       const std::set<std::string>& bannedVertexIds) const {
  Graph s = *this;  // indices stable; adjacency rebuilt below
  s.adj_.assign(s.vertices_.size(), {});
  for (std::size_t i = 0; i < s.arcs_.size(); ++i) {
    if (!s.costs_[i].usable) continue;
    if (bannedArcs.count(s.arcs_[i].id) > 0) continue;
    if (bannedVertexIds.count(s.vertexIds_[static_cast<std::size_t>(s.arcs_[i].from)]) > 0)
      continue;
    if (bannedVertexIds.count(s.vertexIds_[static_cast<std::size_t>(s.arcs_[i].to)]) > 0) continue;
    s.adj_[static_cast<std::size_t>(s.arcs_[i].from)].push_back(static_cast<int>(i));
  }
  return s;
}

}  // namespace pathforge
