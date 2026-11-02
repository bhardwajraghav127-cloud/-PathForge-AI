// Prim's MST with genuine indexed binary heap (decrease-key).
// Purpose: minimum-distance network backbone on the undirected projection
//   (each road = one undirected edge weighted by distanceM; parallel roads
//   stay distinct by road id; one-way roads included as undirected links).
//   Start vertex: lexicographically smallest id (documented, deterministic).
// Invariants: cut property with min-heap extraction; ties broken by
//   (weight, roadId, vertexIdx) => identical output every run.
// Pseudocode: key[]=INF, inMST; heap{(0,start)}; pop u; for undirected
//   edges (u,v,w): if !inMST[v] and w<key[v]: key=parent update (decrease-key).
// Complexity: O(E log V) with indexed heap (R05 genuine use beyond Dijkstra).
// Viva Q&A:
//   Q: Why undirected? A: MST is defined on undirected graphs; directed
//     one-ways are projected (documented) for backbone planning, never routing.
//   Q: Disconnected graph? A: forest + forest:true, per-component MST.
//   Q: Prim vs Kruskal agreement? A: equal total weight (tested oracle).
#pragma once

#include <cstdint>

#include "pathforge/graph.hpp"
#include "pathforge/mst.hpp"

namespace pathforge {

MstResult primMst(const Graph& g, std::int64_t maxEvents = 20000);

}  // namespace pathforge
