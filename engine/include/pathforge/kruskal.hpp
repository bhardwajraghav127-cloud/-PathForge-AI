// Kruskal's MST with indexed Union-Find (path compression + union by rank).
// Purpose: independent MST oracle for Prim (equal total weight) + lab traces.
// Invariants: edges sorted by (weightM, roadId); DSU indexed by vertex idx.
// Pseudocode: sort edges; for each: if find(u)!=find(v): take, union.
// Complexity: O(E log E) sort + near-O(1) DSU ops.
// Viva Q&A:
//   Q: Why union by rank? A: keeps trees shallow; with path compression the
//     amortized cost is effectively constant (inverse Ackermann).
//   Q: Parallel roads? A: distinct edges; the lighter wins unless it cycles.
#pragma once

#include <cstdint>
#include <vector>

#include "pathforge/graph.hpp"
#include "pathforge/mst.hpp"

namespace pathforge {

struct Dsu {
  explicit Dsu(int n) : parent(static_cast<std::size_t>(n), 0), rank(static_cast<std::size_t>(n), 0) {
    for (int i = 0; i < n; ++i) parent[static_cast<std::size_t>(i)] = i;
  }
  int find(int x) {
    int root = x;
    while (parent[static_cast<std::size_t>(root)] != root)
      root = parent[static_cast<std::size_t>(root)];
    while (parent[static_cast<std::size_t>(x)] != root) {
      int nxt = parent[static_cast<std::size_t>(x)];
      parent[static_cast<std::size_t>(x)] = root;
      x = nxt;
    }
    return root;
  }
  bool unite(int a, int b) {
    a = find(a);
    b = find(b);
    if (a == b) return false;
    if (rank[static_cast<std::size_t>(a)] < rank[static_cast<std::size_t>(b)]) {
      int t = a;
      a = b;
      b = t;
    }
    parent[static_cast<std::size_t>(b)] = a;
    if (rank[static_cast<std::size_t>(a)] == rank[static_cast<std::size_t>(b)])
      rank[static_cast<std::size_t>(a)]++;
    return true;
  }

 private:
  std::vector<int> parent;
  std::vector<int> rank;
};

MstResult kruskalMst(const Graph& g, std::int64_t maxEvents = 20000);

}  // namespace pathforge
