// Mid-arc source positions and explicit plan evaluation.
// Purpose: no-U-turn rerouting from the vehicle's current position plus the
//   shared plan-costing used by route.find, route.evaluate (and later the
//   diversion engine and journey simulator). ONE convention everywhere:
//   the occupied arc is finished; routing starts at its head with the
//   remainder as the initial cost; the remainder is never double-counted.
// Rules (spec sections 6-8):
//   fractionPermille=1000 -> arrival at head (plain vertex source).
//   fractionPermille=0    -> full arc (remainder = whole arc).
//   remainder = ceil(full * (1000-f) / 1000), overflow-safe via __int128.
//   Toll is incurred once on entry: remainder toll is always 0.
//   Occupied-but-closed arc: crawl remainder at 100 permille (10% of baseline
//     speed), flag occupyingClosedArc; suffix routing cannot re-enter it
//     (closures are excluded from adjacency).
// Viva Q&A:
//   Q: Why no U-turn? A: the vehicle cannot reverse mid-arc; physics + safety.
//   Q: Who owns the remainder? A: the engine, exactly once, in every command.
//   Q: Crawl speed? A: 100 permille of baseline = 10x time, remainder only.
#pragma once

#include <string>
#include <vector>

#include "pathforge/graph.hpp"
#include "pathforge/objectives.hpp"

namespace pathforge {

// Parsed source: either a vertex or an occupied arc + fraction.
struct ResolvedSource {
  bool midArc = false;
  int vertexIdx = -1;     // plain vertex source, or head when midArc
  int tailIdx = -1;       // midArc only
  int arcIdx = -1;        // midArc only
  int fraction = 0;       // midArc only, 0..1000
  bool occupyingClosedArc = false;
  std::string errorCode;  // INVALID_POSITION / UNKNOWN_ROAD / ...
  std::string errorDetail;
};

// Resolve a vertex source. Never fails except for internal misuse.
ResolvedSource resolveVertexSource(int vertexIdx);

// Resolve an occupied-arc source against graph g.
ResolvedSource resolveArcSource(const Graph& g, const std::string& arcId, int fraction);

// Remainder of one arc's scalar cost (time/distance style).
std::int64_t remainderCost(std::int64_t full, int fraction);

// Remainder of an occupied arc under the resolved objective model.
// Sets occupyingClosedArc + crawl time when the arc is closed.
struct Remainder {
  std::int64_t timeS = 0;
  std::int64_t distanceM = 0;
  bool crawl = false;
};
Remainder remainderFor(const Graph& g, int arcIdx, const ResolvedSource& src);

// Explicit remaining-arc plan evaluation with one shared convention.
struct PlanEval {
  bool valid = false;
  std::string reason;  // "" when valid; else DISCONTINUOUS / EMPTY_PLAN
  bool blocked = false;
  std::string blockedAtArc;
  std::size_t blockedAtIndex = 0;
  bool occupyingClosedArc = false;
  std::vector<RouteLeg> arcs;  // traversable prefix (incl. occupied remainder)
  std::vector<std::string> vertices;
  std::int64_t distanceM = 0;
  std::int64_t timeS = 0;
  std::int64_t baselineTimeS = 0;
  std::int64_t delayS = 0;
  std::int64_t tollInr = 0;
  std::int64_t objectiveCost = 0;
  bool hasObjectiveTuple = false;
  TollLabel objectiveTuple;
};

// Scalar remainder under an objective (per-arc fixed-point/penalty rules).
std::int64_t scalarRemainderCost(const Graph& g, int arcIdx, const Remainder& rem,
                                 const ResolvedObjective& ro);

// Evaluate arcIds from src (src.midArc requires arcIds[0]==src.arcId).
// Unknown arc ids are reported via errorCode (caller maps to UNKNOWN_ROAD).
// When ro is non-null, objectiveCost (or tuple) is accumulated with the same
// per-arc rules route.find uses; barred arcs (avoidSevere) FAIL the plan as
// blocked at that index.
PlanEval evaluatePlan(const Graph& g, const std::vector<std::string>& arcIds,
                      const ResolvedSource& src, const ResolvedObjective* ro,
                      std::string& errorCode, std::string& errorDetail);

}  // namespace pathforge
