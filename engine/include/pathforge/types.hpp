// PathForge core types.
// Purpose: shared value types for the network model, overlay, and route output.
// Invariants: integer metres/seconds/INR (int64); traffic factors in permille;
//   arc IDs are "<roadId>:f" / "<roadId>:r"; adjacency order is canonical arc-ID order.
// Complexity: plain data holders (O(1)).
// Viva Q&A:
//   Q: Why int64 instead of double for times? A: determinism + exact tie-breaks, no FP noise.
//   Q: What is permille? A: 1000 = 100%; 400 = 40% of baseline speed.
//   Q: Why arc IDs not vertex IDs for identity? A: parallel roads need distinct identity.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace pathforge {

inline constexpr std::int64_t kInf64 = static_cast<std::int64_t>(4000000000000000000LL);
inline constexpr int kMaxRequestBytes = 4 * 1024 * 1024;
inline constexpr int kApiVersion = 1;

enum class CostModel { Fastest, Shortest, LowestToll, AvoidCongestion, Balanced };

// Lexicographic (tollInr, timeS, distanceM) label for LOWEST_TOLL.
struct TollLabel {
  std::int64_t toll = 0;
  std::int64_t time = 0;
  std::int64_t dist = 0;
};

// Capped algorithm trace event for lab.run (produced by C++, replayed by UI).
struct TraceEvent {
  std::int64_t step = 0;
  std::string type;    // "visit" | "discover" | "relax" | "select" | "done"
  std::string vertex;  // vertex id (when applicable)
  std::string arc;     // arc id (when applicable)
  std::int64_t dist = -1;
  std::string note;
};

struct Vertex {
  std::string id;
  std::string name;
  double lat = 0.0;
  double lon = 0.0;
};

struct Road {
  std::string id;
  std::string from;
  std::string to;
  bool oneWay = false;
  std::int64_t distanceM = 0;
  std::int64_t baselineTimeS = 0;
  int refSpeedKph = 0;
  std::int64_t tollInr = 0;
  std::string name;
  bool available = true;
};

struct Network {
  int schemaVersion = 1;
  std::vector<Vertex> vertices;
  std::vector<Road> roads;
};

enum class IncidentDir { Both, Forward, Reverse };
enum class IncidentKind { Jam, Accident, Construction, Partial, Closure };

// Stable-ID incident: directional effect on one road.
struct Incident {
  std::string id;
  std::string road;
  IncidentDir dir = IncidentDir::Both;
  IncidentKind kind = IncidentKind::Jam;
};

// Kind effects: factor permille + additive delay seconds.
inline int incidentFactorPermille(IncidentKind k) {
  switch (k) {
    case IncidentKind::Jam: return 400;
    case IncidentKind::Accident: return 200;
    case IncidentKind::Construction: return 600;
    case IncidentKind::Partial: return 500;
    case IncidentKind::Closure: return 0;
  }
  return 1000;
}
inline std::int64_t incidentDelayS(IncidentKind k) {
  return k == IncidentKind::Accident ? 600 : 0;
}

// Overlay: whole-road closures + whole-road factors + directional incidents.
// closures[] entries are road IDs (BOTH directions); directional control uses
// incidents. Multiple effects on one arc: minimum factor, summed delays,
// closure wins.
struct Overlay {
  std::int64_t version = 0;
  std::vector<std::string> closures;  // road IDs closed in BOTH directions
  std::vector<std::pair<std::string, int>> factors;  // roadId -> permille 1..1000
  std::vector<Incident> incidents;
};

struct Arc {
  std::string id;      // "<roadId>:f" or "<roadId>:r"
  std::string roadId;
  int from = -1;       // vertex index
  int to = -1;         // vertex index
  std::size_t roadIdx = 0;
  bool forward = true;
};

struct RouteLeg {
  std::string arcId;
  std::string roadId;
  std::string from;
  std::string to;
};

struct RouteResult {
  bool found = false;
  std::string reason;  // e.g. "UNREACHABLE" when !found
  bool hasObjectiveTuple = false;  // true for LOWEST_TOLL
  TollLabel objectiveTuple;        // (toll, time, distance) when structured
  // Mid-arc source remainder (exactly-once convention; also present when the
  // suffix is unreachable so callers can show where the vehicle is).
  bool hasPartialLeadingArc = false;
  RouteLeg partialLeg;
  std::int64_t partialTimeS = 0;
  std::int64_t partialDistanceM = 0;
  bool partialCrawl = false;
  std::vector<RouteLeg> arcs;
  std::vector<std::string> vertices;
  std::int64_t distanceM = 0;
  std::int64_t timeS = 0;
  std::int64_t baselineTimeS = 0;
  std::int64_t delayS = 0;
  std::int64_t tollInr = 0;
  std::int64_t objectiveCost = 0;
  std::string objectiveDescription;
  // M1: no partialLeadingArc (mid-arc routing arrives M2); field reserved.
};

struct EngineStats {
  std::int64_t visitedVertices = 0;
  std::int64_t relaxedEdges = 0;
  std::int64_t heapOps = 0;
};

struct DijkstraStats {
  std::int64_t visitedVertices = 0;
  std::int64_t relaxedEdges = 0;
  std::int64_t heapOps = 0;
  bool traceTruncated = false;
};

}  // namespace pathforge
