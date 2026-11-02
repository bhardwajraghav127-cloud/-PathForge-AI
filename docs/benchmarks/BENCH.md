# PathForge AI micro-benchmarks (M11)

- date: 2026-11-02T13:30:24Z
- machine: arm64 27.0.1
- compiler: Apple clang version 21.0.0 (clang-2100.3.34.2)
- flags: -O3 -DNDEBUG (native-release preset)
- commit: 2cb0f90
- seed: 42
- graphs: seeded grids 10x10 / 32x32 / 70x70 (100/1024/4900 nodes)
- reps: 20 / 10 / 5; columns: median_ms, p95_ms, visited_or_edges, heap_ops

```
algo,nodes,edges,median_ms,p95_ms,visited_or_edges,heap_ops
dijkstra,100,360,0.009,0.027,100,113
astar,100,360,0.017,0.024,96,125
prim,100,360,0.015,0.035,99,155
kruskal,100,360,0.025,0.036,99,0
dijkstra,1024,3968,0.173,0.188,1024,1144
astar,1024,3968,0.285,0.373,1019,1260
prim,1024,3968,0.165,0.204,1023,1668
kruskal,1024,3968,0.295,0.360,1023,0
dijkstra,4900,19320,1.448,1.523,4900,5402
astar,4900,19320,2.075,2.100,4838,5778
prim,4900,19320,0.869,1.052,4899,8101
kruskal,4900,19320,2.036,2.136,4899,0
```
