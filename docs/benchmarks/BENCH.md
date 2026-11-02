# PathForge AI micro-benchmarks (M11)

- date: 2026-11-02T15:08:29Z
- machine: arm64 27.0.1
- compiler: Apple clang version 21.0.0 (clang-2100.3.34.2)
- flags: -O3 -DNDEBUG (native-release preset)
- commit: a93d664
- seed: 42
- graphs: seeded grids 10x10 / 32x32 / 70x70 (100/1024/4900 nodes)
- reps: 20 / 10 / 5; columns: median_ms, p95_ms, visited_or_edges, heap_ops

```
algo,nodes,edges,median_ms,p95_ms,visited_or_edges,heap_ops
dijkstra,100,360,0.007,0.024,100,113
astar,100,360,0.016,0.025,96,125
prim,100,360,0.013,0.033,99,155
kruskal,100,360,0.021,0.032,99,0
dijkstra,1024,3968,0.160,0.173,1024,1144
astar,1024,3968,0.276,0.331,1019,1260
prim,1024,3968,0.155,0.186,1023,1668
kruskal,1024,3968,0.288,0.344,1023,0
dijkstra,4900,19320,1.465,1.505,4900,5402
astar,4900,19320,1.995,2.079,4838,5778
prim,4900,19320,0.851,1.027,4899,8101
kruskal,4900,19320,1.871,2.000,4899,0
```
