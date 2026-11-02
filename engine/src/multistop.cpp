// Held-Karp exact + NN/2-opt heuristic over the directed closure.
#include "pathforge/multistop.hpp"

#include <algorithm>
#include <limits>
#include <set>

#include "pathforge/dijkstra.hpp"
#include "pathforge/objectives.hpp"

namespace pathforge {
namespace {

struct Closure {
  int n = 0;
  std::vector<std::vector<std::int64_t>> cost;  // n x n, kInf when unreachable
  std::vector<std::vector<std::vector<int>>> parents;  // arc chains per pair
  std::vector<std::vector<std::vector<std::int64_t>>> dists;
  std::vector<std::vector<std::vector<int>>> hops;
};

bool buildClosure(const Graph& g, const std::vector<int>& stops, Closure& c) {
  const int n = static_cast<int>(stops.size());
  c.n = n;
  c.cost.assign(static_cast<std::size_t>(n),
                std::vector<std::int64_t>(static_cast<std::size_t>(n), kInf64));
  c.parents.assign(static_cast<std::size_t>(n), std::vector<std::vector<int>>(static_cast<std::size_t>(n)));
  c.dists.assign(static_cast<std::size_t>(n),
                 std::vector<std::vector<std::int64_t>>(static_cast<std::size_t>(n)));
  c.hops.assign(static_cast<std::size_t>(n), std::vector<std::vector<int>>(static_cast<std::size_t>(n)));
  for (int i = 0; i < n; ++i) {
    std::vector<std::int64_t> dist;
    std::vector<int> hops;
    DijkstraStats st;
    int srcStop = stops[static_cast<std::size_t>(i)];
    std::vector<int> parent = dijkstra(g, srcStop, CostModel::Fastest, dist, hops, st);
    for (int j = 0; j < n; ++j) {
      int dstStop = stops[static_cast<std::size_t>(j)];
      std::int64_t d = dist[static_cast<std::size_t>(dstStop)];
      c.cost[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)] = d;
      if (d >= kInf64) continue;
      // Reconstruct arc chain i -> j.
      std::vector<int> chain;
      for (int cur = dstStop; cur != srcStop;
           cur = g.arc(parent[static_cast<std::size_t>(cur)]).from)
        chain.push_back(parent[static_cast<std::size_t>(cur)]);
      std::reverse(chain.begin(), chain.end());
      c.parents[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)] = chain;
      c.dists[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)] = dist;
      c.hops[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)] = hops;
    }
  }
  return true;
}

std::vector<std::string> stopIdOrder(const Graph& g, const std::vector<int>& stops,
                                     const std::vector<int>& perm) {
  std::vector<std::string> out;
  for (int p : perm) out.push_back(g.vertex(stops[static_cast<std::size_t>(p)]).id);
  return out;
}

}  // namespace

MultistopResult multistop(const Graph& g, const std::vector<int>& stopIdx, int startPos,
                          int endPos, int exactUpTo, bool allowHeuristic) {
  MultistopResult r;
  const int n = static_cast<int>(stopIdx.size());
  if (n == 0) {
    r.error = "SCHEMA_VIOLATION";
    r.errorDetail = "at least one stop is required";
    return r;
  }
  if (n > 64) {
    r.error = "LIMIT_EXCEEDED";
    r.errorDetail = "at most 64 stops";
    return r;
  }
  {
    std::set<int> seen;
    for (int s : stopIdx) {
      if (!seen.insert(s).second) {
        r.error = "SCHEMA_VIOLATION";
        r.errorDetail = "duplicate stops are not allowed";
        return r;
      }
    }
  }
  if (startPos < 0 || startPos >= n || (endPos != -1 && (endPos < 0 || endPos >= n))) {
    r.error = "SCHEMA_VIOLATION";
    r.errorDetail = "start/end must index into stops";
    return r;
  }
  if (exactUpTo > 12) {
    r.error = "SCHEMA_VIOLATION";
    r.errorDetail = "exactUpTo caps at 12 (explicit opt-in above 10)";
    return r;
  }
  if (exactUpTo < 1) {
    r.error = "SCHEMA_VIOLATION";
    r.errorDetail = "exactUpTo must be >= 1";
    return r;
  }
  if (endPos != -1 && endPos == startPos && n > 1) {
    r.error = "SCHEMA_VIOLATION";
    r.errorDetail = "tours (end == start) are not supported; request a path";
    return r;
  }
  Closure c;
  buildClosure(g, stopIdx, c);
  for (int i = 0; i < n; ++i) {
    if (c.cost[static_cast<std::size_t>(i)][static_cast<std::size_t>(i)] != 0) {
      r.error = "INTERNAL_ERROR";
      r.errorDetail = "closure diagonal must be zero";
      return r;
    }
  }

  std::vector<int> perm;  // positions in visit order, starts at startPos
  if (n <= std::min(exactUpTo, 12)) {
    // Held-Karp over subsets containing startPos.
    const int N = 1 << n;
    const std::int64_t kInf = kInf64;
    std::vector<std::vector<std::int64_t>> dp(static_cast<std::size_t>(N),
                                              std::vector<std::int64_t>(static_cast<std::size_t>(n), kInf));
    std::vector<std::vector<int>> par(static_cast<std::size_t>(N),
                                      std::vector<int>(static_cast<std::size_t>(n), -1));
    dp[static_cast<std::size_t>(1 << startPos)][static_cast<std::size_t>(startPos)] = 0;
    for (int mask = 0; mask < N; ++mask) {
      if ((mask & (1 << startPos)) == 0) continue;
      for (int last = 0; last < n; ++last) {
        if ((mask & (1 << last)) == 0) continue;
        std::int64_t cur = dp[static_cast<std::size_t>(mask)][static_cast<std::size_t>(last)];
        if (cur >= kInf) continue;
        for (int nxt = 0; nxt < n; ++nxt) {
          if ((mask & (1 << nxt)) != 0) continue;
          std::int64_t w = c.cost[static_cast<std::size_t>(last)][static_cast<std::size_t>(nxt)];
          if (w >= kInf) continue;
          __int128 nc = static_cast<__int128>(cur) + w;
          std::int64_t nv = nc > static_cast<__int128>(kInf) ? kInf : static_cast<std::int64_t>(nc);
          int nm = mask | (1 << nxt);
          std::int64_t& cell = dp[static_cast<std::size_t>(nm)][static_cast<std::size_t>(nxt)];
          if (nv < cell) {
            cell = nv;
            par[static_cast<std::size_t>(nm)][static_cast<std::size_t>(nxt)] = last;
          }
        }
      }
    }
    int full = N - 1;
    int bestLast = -1;
    std::int64_t best = kInf;
    // Candidate ends: fixed endPos, else any last. Ties -> lex smallest sequence.
    std::vector<int> candLast;
    if (endPos != -1) {
      candLast.push_back(endPos);
    } else {
      for (int l = 0; l < n; ++l) candLast.push_back(l);
    }
    std::vector<int> bestPerm;
    for (int last : candLast) {
      std::int64_t v = dp[static_cast<std::size_t>(full)][static_cast<std::size_t>(last)];
      if (v >= kInf) continue;
      // Reconstruct.
      std::vector<int> p;
      int m = full;
      int cur = last;
      while (cur != -1) {
        p.push_back(cur);
        int pr = par[static_cast<std::size_t>(m)][static_cast<std::size_t>(cur)];
        m &= ~(1 << cur);
        cur = pr;
      }
      std::reverse(p.begin(), p.end());
      if (v < best || (v == best && stopIdOrder(g, stopIdx, p) < stopIdOrder(g, stopIdx, bestPerm))) {
        best = v;
        bestLast = last;
        bestPerm = p;
      }
    }
    if (bestLast == -1) {
      r.reason = "UNREACHABLE";
      return r;  // ok=false: some pair disconnected
    }
    perm = bestPerm;
    r.optimal = true;
    r.method = "held-karp";
    (void)best;
  } else {
    if (!allowHeuristic) {
      r.error = "LIMIT_EXCEEDED";
      r.errorDetail = "exact search capped at 12 stops; enable the heuristic";
      return r;
    }
    // Nearest neighbor from start (ties: smallest stop id), then 2-opt.
    std::vector<char> used(static_cast<std::size_t>(n), 0);
    perm.push_back(startPos);
    used[static_cast<std::size_t>(startPos)] = 1;
    auto stopName = [&](int p) { return g.vertex(stopIdx[static_cast<std::size_t>(p)]).id; };
    while (static_cast<int>(perm.size()) < n) {
      if (endPos != -1 && static_cast<int>(perm.size()) == n - 1) {
        perm.push_back(endPos);  // fixed end forced last (even if costly)
        break;
      }
      int last = perm.back();
      int bestN = -1;
      std::int64_t bestC = kInf64;
      for (int q = 0; q < n; ++q) {
        if (used[static_cast<std::size_t>(q)]) continue;
        if (q == endPos && static_cast<int>(perm.size()) < n - 1) continue;  // save end for last
        std::int64_t w = c.cost[static_cast<std::size_t>(last)][static_cast<std::size_t>(q)];
        if (w >= kInf64) continue;
        if (bestN == -1 || w < bestC || (w == bestC && stopName(q) < stopName(bestN))) {
          bestN = q;
          bestC = w;
        }
      }
      if (bestN == -1) {
        r.reason = "UNREACHABLE";
        return r;
      }
      perm.push_back(bestN);
      used[static_cast<std::size_t>(bestN)] = 1;
    }
    auto tourCost = [&](const std::vector<int>& p) {
      __int128 t = 0;
      for (std::size_t i = 1; i < p.size(); ++i)
        t += c.cost[static_cast<std::size_t>(p[i - 1])][static_cast<std::size_t>(p[i])];
      return t > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(t);
    };
    // First-improvement 2-opt in canonical (i,j) order; start/end pinned.
    for (int iter = 0; iter < 1000; ++iter) {
      bool improved = false;
      for (int i = 1; i < n - 1 && !improved; ++i) {
        for (int j = i + 1; j < n && !improved; ++j) {
          if (endPos != -1 && (j == n - 1)) continue;  // keep fixed end last
          std::vector<int> q = perm;
          std::reverse(q.begin() + i, q.begin() + j + 1);
          if (tourCost(q) < tourCost(perm)) {
            perm = q;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    r.optimal = false;
    r.method = "nn-2opt";
  }

  r.ok = true;
  r.order = stopIdOrder(g, stopIdx, perm);
  for (std::size_t i = 1; i < perm.size(); ++i) {
    int a = perm[i - 1];
    int b = perm[i];
    // Construct the leg route from the stored closure arc chain.
    RouteResult lr;
    lr.found = true;
    lr.objectiveDescription = "multistop leg (FASTEST)";
    lr.vertices.push_back(g.vertex(stopIdx[static_cast<std::size_t>(a)]).id);
    for (int ai : c.parents[static_cast<std::size_t>(a)][static_cast<std::size_t>(b)]) {
      const Arc& arc = g.arc(ai);
      EffectiveCost ec = g.cost(ai);
      lr.arcs.push_back({arc.id, arc.roadId, g.vertex(arc.from).id, g.vertex(arc.to).id});
      lr.vertices.push_back(g.vertex(arc.to).id);
      lr.distanceM += ec.distanceM;
      lr.timeS += ec.timeS;
      lr.baselineTimeS += ec.baselineTimeS;
      lr.tollInr += ec.tollInr;
    }
    lr.delayS = lr.timeS - lr.baselineTimeS;
    lr.objectiveCost = lr.timeS;
    r.legs.push_back({g.vertex(stopIdx[static_cast<std::size_t>(a)]).id,
                      g.vertex(stopIdx[static_cast<std::size_t>(b)]).id, lr});
    r.totalTimeS += lr.timeS;
    r.totalDistanceM += lr.distanceM;
    r.totalTollInr += lr.tollInr;
  }
  return r;
}

}  // namespace pathforge
