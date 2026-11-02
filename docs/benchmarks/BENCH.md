# PathForge AI micro-benchmarks (M11)

- date: 2026-11-02T12:31:45Z
- machine: arm64 27.0.1
- compiler: Apple clang version 21.0.0 (clang-2100.3.34.2)
- flags: -O3 -DNDEBUG (native-release preset)
- commit: 612a1af
- seed: 42
- graphs: seeded grids 10x10 / 32x32 / 70x70 (100/1024/4900 nodes)
- reps: 20 / 10 / 5; columns: median_ms, p95_ms, visited_or_edges, heap_ops

```
algo,nodes,edges,median_ms,p95_ms,visited_or_edges,heap_ops
dijkstra,100,360,0.008,0.027,100,113
astar,100,360,0.019,0.025,96,125
prim,100,360,0.015,0.038,99,155
kruskal,100,360,0.024,0.037,99,0
dijkstra,1024,3968,0.174,0.196,1024,1144
astar,1024,3968,0.295,0.343,1019,1260
prim,1024,3968,0.169,0.227,1023,1668
kruskal,1024,3968,0.255,0.351,1023,0
dijkstra,4900,19320,1.514,1.558,4900,5402
astar,4900,19320,2.050,2.118,4838,5778
prim,4900,19320,0.877,1.062,4899,8101
kruskal,4900,19320,1.948,2.033,4899,0
```
