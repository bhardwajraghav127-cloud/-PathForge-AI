# PathForge AI micro-benchmarks (M11)

- date: 2026-11-02T20:44:55Z
- machine: arm64 27.0.1
- compiler: Apple clang version 21.0.0 (clang-2100.3.34.2)
- flags: -O3 -DNDEBUG (native-release preset)
- commit: a640d38
- seed: 42
- graphs: seeded grids 10x10 / 32x32 / 70x70 (100/1024/4900 nodes)
- reps: 20 / 10 / 5; columns: median_ms, p95_ms, visited_or_edges, heap_ops

```
algo,nodes,edges,median_ms,p95_ms,visited_or_edges,heap_ops
dijkstra,100,360,0.007,0.026,100,113
astar,100,360,0.016,0.028,96,125
prim,100,360,0.013,0.033,99,155
kruskal,100,360,0.020,0.030,99,0
dijkstra,1024,3968,0.172,0.176,1024,1144
astar,1024,3968,0.296,0.349,1019,1260
prim,1024,3968,0.158,0.214,1023,1668
kruskal,1024,3968,0.269,0.355,1023,0
dijkstra,4900,19320,1.560,1.635,4900,5402
astar,4900,19320,2.145,2.188,4838,5778
prim,4900,19320,0.882,1.093,4899,8101
kruskal,4900,19320,1.963,2.114,4899,0
```
