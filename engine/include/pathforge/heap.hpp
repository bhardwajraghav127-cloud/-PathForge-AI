// Indexed binary min-heap with decrease-key.
// Purpose: deterministic O(log n) priority queue for Dijkstra/Prim/A*.
// Invariants: pos_[v] = heap index or -1; heap ordered by (key, vertexIdx).
//   Smaller vertexIdx wins ties => deterministic extraction order.
// Pseudocode: push/update sift-up; pop sift-down; position map kept in sync.
// Complexity: push/pop/update O(log n); contains O(1).
// Viva Q&A:
//   Q: Why indexed instead of std::priority_queue? A: decrease-key without stale entries.
//   Q: How are ties deterministic? A: (key, vertexIdx) comparison, no pointer ordering.
//   Q: Cost of position map? A: O(n) memory, O(1) lookup.
#pragma once

#include <cstdint>
#include <vector>

namespace pathforge {

class IndexedMinHeap {
 public:
  explicit IndexedMinHeap(int n) : pos_(static_cast<std::size_t>(n), -1), key_(static_cast<std::size_t>(n), 0) {}

  bool empty() const { return heap_.empty(); }
  bool contains(int v) const { return pos_[static_cast<std::size_t>(v)] != -1; }

  void push(int v, std::int64_t key) {
    if (contains(v)) {
      if (key < key_[static_cast<std::size_t>(v)]) update(v, key);
      return;
    }
    key_[static_cast<std::size_t>(v)] = key;
    pos_[static_cast<std::size_t>(v)] = static_cast<int>(heap_.size());
    heap_.push_back(v);
    siftUp(heap_.size() - 1);
  }

  void update(int v, std::int64_t key) {
    key_[static_cast<std::size_t>(v)] = key;
    siftUp(static_cast<std::size_t>(pos_[static_cast<std::size_t>(v)]));
  }

  int pop() {
    int top = heap_[0];
    pos_[static_cast<std::size_t>(top)] = -1;
    int last = heap_.back();
    heap_.pop_back();
    if (!heap_.empty()) {
      heap_[0] = last;
      pos_[static_cast<std::size_t>(last)] = 0;
      siftDown(0);
    }
    return top;
  }

 private:
  bool less(int a, int b) const {
    if (key_[static_cast<std::size_t>(a)] != key_[static_cast<std::size_t>(b)])
      return key_[static_cast<std::size_t>(a)] < key_[static_cast<std::size_t>(b)];
    return a < b;
  }
  void swapAt(std::size_t i, std::size_t j) {
    int vi = heap_[i];
    int vj = heap_[j];
    heap_[i] = vj;
    heap_[j] = vi;
    pos_[static_cast<std::size_t>(vi)] = static_cast<int>(j);
    pos_[static_cast<std::size_t>(vj)] = static_cast<int>(i);
  }
  void siftUp(std::size_t i) {
    while (i > 0) {
      std::size_t p = (i - 1) / 2;
      if (!less(heap_[i], heap_[p])) break;
      swapAt(i, p);
      i = p;
    }
  }
  void siftDown(std::size_t i) {
    for (;;) {
      std::size_t l = 2 * i + 1;
      std::size_t r = 2 * i + 2;
      std::size_t m = i;
      if (l < heap_.size() && less(heap_[l], heap_[m])) m = l;
      if (r < heap_.size() && less(heap_[r], heap_[m])) m = r;
      if (m == i) break;
      swapAt(i, m);
      i = m;
    }
  }

  std::vector<int> heap_;
  std::vector<int> pos_;
  std::vector<std::int64_t> key_;
};

}  // namespace pathforge
