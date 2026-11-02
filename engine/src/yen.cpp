// Yen's algorithm (scalar + lexicographic-toll variants).
#include "pathforge/yen.hpp"

#include <algorithm>
#include <queue>
#include <set>

#include "pathforge/dijkstra.hpp"
#include "pathforge/objectives.hpp"

namespace pathforge {
namespace {

std::string arcSeqKey(const Graph& g, const std::vector<int>& arcs) {
  std::string k;
  for (int ai : arcs) {
    k += g.arc(ai).id;
    k += '|';
  }
  return k;
}

struct Cand {
  std::int64_t cost = 0;
  std::size_t hops = 0;
  std::string key;
  YenPath path;
};
bool candGreater(const Cand& a, const Cand& b) {
  if (a.cost != b.cost) return a.cost > b.cost;
  if (a.hops != b.hops) return a.hops > b.hops;
  return a.key > b.key;
}

std::int64_t pathScalar(const std::vector<int>& arcs,
                        const std::function<std::int64_t(int)>& arcCost) {
  __int128 t = 0;
  for (int ai : arcs) t += arcCost(ai);
  if (t > static_cast<__int128>(kInf64)) return kInf64;
  return static_cast<std::int64_t>(t);
}

}  // namespace

std::vector<YenPath> yenKShortest(const Graph& g, int srcIdx, int dstIdx,
                                  const std::function<std::int64_t(int)>& arcCost, int K,
                                  DijkstraStats& stats) {
  std::vector<YenPath> accepted;
  if (K <= 0) return accepted;
  // First path: plain scalar Dijkstra.
  {
    std::vector<std::int64_t> dist;
    std::vector<int> hops;
    std::vector<int> parent = dijkstraScalar(g, srcIdx, arcCost, dist, hops, stats);
    if (dist[static_cast<std::size_t>(dstIdx)] >= kInf64) return accepted;
    std::vector<int> chain;
    for (int cur = dstIdx; cur != srcIdx; cur = g.arc(parent[static_cast<std::size_t>(cur)]).from)
      chain.push_back(parent[static_cast<std::size_t>(cur)]);
    std::reverse(chain.begin(), chain.end());
    YenPath p;
    p.arcIdx = chain;
    p.scalarCost = dist[static_cast<std::size_t>(dstIdx)];
    accepted.push_back(p);
  }
  std::set<std::string> seen;
  seen.insert(arcSeqKey(g, accepted[0].arcIdx));
  std::priority_queue<Cand, std::vector<Cand>, decltype(&candGreater)> heap(&candGreater);
  for (int k = 1; k < K; ++k) {
    const YenPath& prev = accepted.back();
    for (std::size_t i = 0; i < prev.arcIdx.size(); ++i) {
      // Spur node = prevVerts[i]; root = prev.arcs[0..i-1].
      int spur = -1;
      {
        int cur = srcIdx;
        for (std::size_t j = 0; j < i; ++j) cur = g.arc(prev.arcIdx[j]).to;
        spur = cur;
      }
      std::set<std::string> bannedArcs;
      std::set<std::string> bannedVerts;
      for (std::size_t j = 0; j < i; ++j)
        bannedVerts.insert(g.vertex(g.arc(prev.arcIdx[j]).from).id);
      for (const auto& p : accepted) {
        if (p.arcIdx.size() <= i) continue;
        bool sameRoot = true;
        for (std::size_t j = 0; j < i; ++j) {
          if (p.arcIdx[j] != prev.arcIdx[j]) {
            sameRoot = false;
            break;
          }
        }
        if (sameRoot) bannedArcs.insert(g.arc(p.arcIdx[i]).id);
      }
      Graph sub = g.subgraph(bannedArcs, bannedVerts);
      std::vector<std::int64_t> dist;
      std::vector<int> hops;
      // Cost on the subgraph uses ORIGINAL arc indices (stable).
      std::vector<int> parent = dijkstraScalar(sub, spur, arcCost, dist, hops, stats);
      if (dist[static_cast<std::size_t>(dstIdx)] >= kInf64) continue;
      std::vector<int> spurChain;
      for (int cur = dstIdx; cur != spur; cur = sub.arc(parent[static_cast<std::size_t>(cur)]).from)
        spurChain.push_back(parent[static_cast<std::size_t>(cur)]);
      std::reverse(spurChain.begin(), spurChain.end());
      YenPath cand;
      cand.arcIdx.assign(prev.arcIdx.begin(), prev.arcIdx.begin() + static_cast<std::ptrdiff_t>(i));
      cand.arcIdx.insert(cand.arcIdx.end(), spurChain.begin(), spurChain.end());
      std::string key = arcSeqKey(g, cand.arcIdx);
      if (seen.count(key) > 0) continue;
      seen.insert(key);
      cand.scalarCost = pathScalar(cand.arcIdx, arcCost);
      heap.push({cand.scalarCost, cand.arcIdx.size(), key, cand});
    }
    if (heap.empty()) break;
    accepted.push_back(heap.top().path);
    heap.pop();
  }
  return accepted;
}

std::vector<YenPath> yenKShortestToll(const Graph& g, int srcIdx, int dstIdx, int K,
                                      DijkstraStats& stats) {
  std::vector<YenPath> accepted;
  if (K <= 0) return accepted;
  {
    std::vector<TollLabel> dist;
    std::vector<int> hops;
    std::vector<int> parent = dijkstraToll(g, srcIdx, dist, hops, stats);
    const TollLabel kInf{kInf64, kInf64, kInf64};
    if (dist[static_cast<std::size_t>(dstIdx)] == kInf) return accepted;
    std::vector<int> chain;
    for (int cur = dstIdx; cur != srcIdx; cur = g.arc(parent[static_cast<std::size_t>(cur)]).from)
      chain.push_back(parent[static_cast<std::size_t>(cur)]);
    std::reverse(chain.begin(), chain.end());
    YenPath p;
    p.arcIdx = chain;
    TollLabel t{0, 0, 0};
    for (int ai : chain) t = t + tollArcLabel(g, ai);
    p.tollCost = t;
    p.scalarCost = t.toll;
    accepted.push_back(p);
  }
  std::set<std::string> seen;
  seen.insert(arcSeqKey(g, accepted[0].arcIdx));
  // Min-heap by (toll, time, dist, key).
  struct TCand {
    TollLabel label;
    std::string key;
    YenPath path;
  };
  struct TCmp {
    bool operator()(const TCand& a, const TCand& b) const {
      if (a.label == b.label) return a.key > b.key;
      return b.label < a.label;
    }
  };
  std::priority_queue<TCand, std::vector<TCand>, TCmp> heap;
  const TollLabel kInf{kInf64, kInf64, kInf64};
  for (int k = 1; k < K; ++k) {
    const YenPath& prev = accepted.back();
    for (std::size_t i = 0; i < prev.arcIdx.size(); ++i) {
      int spur = srcIdx;
      for (std::size_t j = 0; j < i; ++j) spur = g.arc(prev.arcIdx[j]).to;
      std::set<std::string> bannedArcs;
      std::set<std::string> bannedVerts;
      for (std::size_t j = 0; j < i; ++j)
        bannedVerts.insert(g.vertex(g.arc(prev.arcIdx[j]).from).id);
      for (const auto& p : accepted) {
        if (p.arcIdx.size() <= i) continue;
        bool sameRoot = true;
        for (std::size_t j = 0; j < i; ++j) {
          if (p.arcIdx[j] != prev.arcIdx[j]) {
            sameRoot = false;
            break;
          }
        }
        if (sameRoot) bannedArcs.insert(g.arc(p.arcIdx[i]).id);
      }
      Graph sub = g.subgraph(bannedArcs, bannedVerts);
      std::vector<TollLabel> dist;
      std::vector<int> hops;
      std::vector<int> parent = dijkstraToll(sub, spur, dist, hops, stats);
      if (dist[static_cast<std::size_t>(dstIdx)] == kInf) continue;
      std::vector<int> spurChain;
      for (int cur = dstIdx; cur != spur; cur = sub.arc(parent[static_cast<std::size_t>(cur)]).from)
        spurChain.push_back(parent[static_cast<std::size_t>(cur)]);
      std::reverse(spurChain.begin(), spurChain.end());
      YenPath cand;
      cand.arcIdx.assign(prev.arcIdx.begin(), prev.arcIdx.begin() + static_cast<std::ptrdiff_t>(i));
      cand.arcIdx.insert(cand.arcIdx.end(), spurChain.begin(), spurChain.end());
      std::string key = arcSeqKey(g, cand.arcIdx);
      if (seen.count(key) > 0) continue;
      seen.insert(key);
      TollLabel t{0, 0, 0};
      for (int ai : cand.arcIdx) t = t + tollArcLabel(g, ai);
      cand.tollCost = t;
      cand.scalarCost = t.toll;
      heap.push({t, key, cand});
    }
    if (heap.empty()) break;
    accepted.push_back(heap.top().path);
    heap.pop();
  }
  return accepted;
}

double sharedArcFraction(const Graph& g, const YenPath& cand, const YenPath& accepted) {
  std::set<std::string> acc;
  for (int ai : accepted.arcIdx) acc.insert(g.arc(ai).id);
  __int128 shared = 0, total = 0;
  for (int ai : cand.arcIdx) {
    EffectiveCost c = g.cost(ai);
    total += c.distanceM;
    if (acc.count(g.arc(ai).id) > 0) shared += c.distanceM;
  }
  if (total == 0) return 0.0;
  return static_cast<double>(shared) / static_cast<double>(total);
}

}  // namespace pathforge
