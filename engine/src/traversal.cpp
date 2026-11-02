// BFS + iterative DFS with capped traces.
#include "pathforge/traversal.hpp"

#include <deque>

namespace pathforge {
namespace {

struct Tracer {
  std::vector<TraceEvent> events;
  std::int64_t maxEvents;
  bool truncated = false;
  bool emit(TraceEvent e) {
    if (static_cast<std::int64_t>(events.size()) >= maxEvents) {
      truncated = true;
      return false;
    }
    e.step = static_cast<std::int64_t>(events.size());
    events.push_back(e);
    return true;
  }
};

}  // namespace

TraversalResult bfs(const Graph& g, int srcIdx, std::int64_t maxEvents) {
  TraversalResult r;
  const int n = g.vertexCount();
  r.parent.assign(static_cast<std::size_t>(n), -1);
  r.dist.assign(static_cast<std::size_t>(n), -1);
  Tracer t{ {}, maxEvents < 1 ? 1 : maxEvents, false };
  std::deque<int> q;
  q.push_back(srcIdx);
  r.parent[static_cast<std::size_t>(srcIdx)] = srcIdx;
  r.dist[static_cast<std::size_t>(srcIdx)] = 0;
  while (!q.empty()) {
    int u = q.front();
    q.pop_front();
    r.order.push_back(g.vertex(u).id);
    if (!t.emit({0, "visit", g.vertex(u).id, "", r.dist[static_cast<std::size_t>(u)], ""})) break;
    for (int ai : g.outgoing(u)) {
      int v = g.arc(ai).to;
      if (r.parent[static_cast<std::size_t>(v)] != -1) continue;
      r.parent[static_cast<std::size_t>(v)] = u;
      r.dist[static_cast<std::size_t>(v)] = r.dist[static_cast<std::size_t>(u)] + 1;
      if (!t.emit({0, "discover", g.vertex(v).id, g.arc(ai).id, r.dist[static_cast<std::size_t>(v)], ""}))
        break;
      q.push_back(v);
    }
    if (t.truncated) break;
  }
  r.trace = t.events;
  r.truncated = t.truncated;
  return r;
}

TraversalResult dfs(const Graph& g, int srcIdx, std::int64_t maxEvents) {
  TraversalResult r;
  const int n = g.vertexCount();
  r.parent.assign(static_cast<std::size_t>(n), -1);
  r.dist.assign(static_cast<std::size_t>(n), -1);
  Tracer t{ {}, maxEvents < 1 ? 1 : maxEvents, false };
  std::vector<int> stack;
  stack.push_back(srcIdx);
  r.parent[static_cast<std::size_t>(srcIdx)] = srcIdx;
  while (!stack.empty()) {
    int u = stack.back();
    stack.pop_back();
    if (r.dist[static_cast<std::size_t>(u)] != -1) continue;  // seen
    r.dist[static_cast<std::size_t>(u)] = 1;
    r.order.push_back(g.vertex(u).id);
    if (!t.emit({0, "visit", g.vertex(u).id, "", -1, ""})) break;
    // Push in reverse canonical order so pop order is canonical.
    const std::vector<int>& out = g.outgoing(u);
    for (std::size_t i = out.size(); i-- > 0;) {
      int v = g.arc(out[i]).to;
      if (r.parent[static_cast<std::size_t>(v)] != -1) continue;
      r.parent[static_cast<std::size_t>(v)] = u;
      if (!t.emit({0, "discover", g.vertex(v).id, g.arc(out[i]).id, -1, ""})) break;
      stack.push_back(v);
    }
    if (t.truncated) break;
  }
  r.trace = t.events;
  r.truncated = t.truncated;
  return r;
}

}  // namespace pathforge
