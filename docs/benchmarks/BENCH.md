# PathForge AI micro-benchmarks (M11)

- date: 2026-11-02T12:56:15Z
- machine: arm64 27.0.1
- compiler: Apple clang version 21.0.0 (clang-2100.3.34.2)
- flags: -O3 -DNDEBUG (native-release preset)
- commit: de9a3a2
- seed: 42
- graphs: seeded grids 10x10 / 32x32 / 70x70 (100/1024/4900 nodes)
- reps: 20 / 10 / 5; columns: median_ms, p95_ms, visited_or_edges, heap_ops

```
algo,nodes,edges,median_ms,p95_ms,visited_or_edges,heap_ops
dijkstra,100,360,0.007,0.024,100,113
astar,100,360,0.018,0.027,96,125
prim,100,360,0.014,0.041,99,155
kruskal,100,360,0.024,0.034,99,0
dijkstra,1024,3968,0.178,0.197,1024,1144
astar,1024,3968,0.298,0.359,1019,1260
prim,1024,3968,0.163,0.208,1023,1668
kruskal,1024,3968,0.317,0.404,1023,0
dijkstra,4900,19320,1.619,1.659,4900,5402
astar,4900,19320,2.173,2.205,4838,5778
prim,4900,19320,0.897,1.089,4899,8101
kruskal,4900,19320,2.082,2.239,4899,0
```
