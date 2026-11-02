// Envelope dispatcher implementation (M1 subset).
#include "pathforge/engine.hpp"

#include <chrono>
#include <exception>
#include <map>
#include <set>
#include <stdexcept>

#include <nlohmann/json.hpp>

#include "pathforge/astar.hpp"
#include "pathforge/dijkstra.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/lab.hpp"
#include "pathforge/objectives.hpp"
#include "pathforge/position.hpp"
#include "pathforge/traversal.hpp"
#include "pathforge/yen.hpp"

namespace pathforge {
namespace {

using nlohmann::json;

#ifdef PF_BUILD_WASM
constexpr const char* kBuild = "wasm";
#else
constexpr const char* kBuild = "native";
#endif

json errEnv(int api, const std::string& rid, const std::string& code, const std::string& msg,
            const json& details = json::object()) {
  return json{{"apiVersion", api},
              {"requestId", rid},
              {"ok", false},
              {"error", {{"code", code}, {"message", msg}, {"details", details}}}};
}

json okEnv(int api, const std::string& rid, const json& result, const json& stats,
             const std::vector<std::string>& warnings = {}) {
  json env{{"apiVersion", api},
           {"requestId", rid},
           {"ok", true},
           {"result", result},
           {"stats", stats}};
  if (!warnings.empty()) env["warnings"] = warnings;
  return env;
}

json traceToJson(const std::vector<TraceEvent>& trace) {
  json arr = json::array();
  for (const auto& e : trace)
    arr.push_back({{"step", e.step},
                   {"type", e.type},
                   {"vertex", e.vertex},
                   {"arc", e.arc},
                   {"dist", e.dist},
                   {"note", e.note}});
  return arr;
}

Network parseNetwork(const json& j) {
  Network net;
  if (j.contains("schemaVersion")) net.schemaVersion = j.at("schemaVersion").get<int>();
  for (const auto& v : j.at("vertices")) {
    Vertex vx;
    vx.id = v.at("id").get<std::string>();
    vx.name = v.value("name", vx.id);
    vx.lat = v.value("lat", 0.0);
    vx.lon = v.value("lon", 0.0);
    net.vertices.push_back(vx);
  }
  for (const auto& r : j.at("roads")) {
    Road rd;
    rd.id = r.at("id").get<std::string>();
    rd.from = r.at("from").get<std::string>();
    rd.to = r.at("to").get<std::string>();
    rd.oneWay = r.value("oneWay", false);
    rd.distanceM = r.value("distanceM", 0LL);
    rd.baselineTimeS = r.value("baselineTimeS", 0LL);
    rd.refSpeedKph = r.value("refSpeedKph", 0);
    rd.tollInr = r.value("tollInr", 0LL);
    rd.name = r.value("name", rd.id);
    rd.available = r.value("available", true);
    net.roads.push_back(rd);
  }
  return net;
}

IncidentKind parseIncidentKind(const std::string& k) {
  if (k == "jam") return IncidentKind::Jam;
  if (k == "accident") return IncidentKind::Accident;
  if (k == "construction") return IncidentKind::Construction;
  if (k == "partial") return IncidentKind::Partial;
  if (k == "closure") return IncidentKind::Closure;
  throw std::invalid_argument("unknown incident kind: " + k);
}

IncidentDir parseIncidentDir(const std::string& d) {
  if (d == "both") return IncidentDir::Both;
  if (d == "forward") return IncidentDir::Forward;
  if (d == "reverse") return IncidentDir::Reverse;
  throw std::invalid_argument("unknown incident dir: " + d);
}

Overlay parseOverlay(const json& j) {
  Overlay ov;
  if (j.is_null() || !j.is_object()) return ov;
  ov.version = j.value("version", 0LL);
  if (j.contains("closures"))
    for (const auto& c : j.at("closures")) ov.closures.push_back(c.get<std::string>());
  if (j.contains("factors")) {
    for (auto it = j.at("factors").begin(); it != j.at("factors").end(); ++it)
      ov.factors.emplace_back(it.key(), it.value().get<int>());
  }
  if (j.contains("incidents")) {
    for (const auto& in : j.at("incidents")) {
      Incident ic;
      ic.id = in.at("id").get<std::string>();
      ic.road = in.at("road").get<std::string>();
      ic.dir = parseIncidentDir(in.value("dir", "both"));
      ic.kind = parseIncidentKind(in.at("kind").get<std::string>());
      ov.incidents.push_back(ic);
    }
  }
  return ov;
}

json routeToJson(const RouteResult& r) {
  json arcs = json::array();
  for (const auto& l : r.arcs)
    arcs.push_back(
        {{"arcId", l.arcId}, {"roadId", l.roadId}, {"from", l.from}, {"to", l.to}});
  json cost = r.objectiveCost;
  if (r.hasObjectiveTuple)
    cost = {{"tollInr", r.objectiveTuple.toll},
            {"timeS", r.objectiveTuple.time},
            {"distanceM", r.objectiveTuple.dist}};
  json out{{"found", r.found},
             {"reason", r.reason},
             {"arcs", arcs},
             {"vertices", r.vertices},
             {"distanceM", r.distanceM},
             {"timeS", r.timeS},
             {"baselineTimeS", r.baselineTimeS},
             {"delayS", r.delayS},
             {"tollInr", r.tollInr},
             {"objectiveCost", cost},
             {"objectiveDescription", r.objectiveDescription}};
  if (r.hasPartialLeadingArc) {
    out["partialLeadingArc"] = {
        {"arcId", r.partialLeg.arcId},
        {"roadId", r.partialLeg.roadId},
        {"from", r.partialLeg.from},
        {"to", r.partialLeg.to},
        {"remainingTimeS", r.partialTimeS},
        {"remainingDistanceM", r.partialDistanceM},
        {"occupyingClosedArc", r.partialCrawl}};
  }
  return out;
}

// One shared route solver used by route.find and scenario.compare so the two
// commands can never diverge (same convention, same tie-breaks, same errors).
RouteResult joinRemainder(const Graph& g, const ResolvedSource& rsrc, const Remainder& rem,
                          const RouteResult& suffix);

struct SolveOut {
  RouteResult route;
  DijkstraStats stats;
  std::vector<std::string> warnings;
  ResolvedObjective ro;
  std::string errorCode;  // "" on success (route may still be found:false)
  std::string errorDetail;
};

SolveOut solveRoute(const Graph& g, const json& payload) {
  SolveOut out;
  std::string algo = payload.value("algorithm", "DIJKSTRA");
  if (algo != "DIJKSTRA" && algo != "A_STAR") {
    out.errorCode = "SCHEMA_VIOLATION";
    out.errorDetail = "algorithm must be DIJKSTRA or A_STAR (got " + algo + ")";
    return out;
  }
  if (!payload.contains("target") || !payload.at("target").is_string()) {
    out.errorCode = "SCHEMA_VIOLATION";
    out.errorDetail = "payload.target is required";
    return out;
  }
  std::string dst = payload.at("target").get<std::string>();
  ResolvedSource rsrc;
  {
    const json& sj = payload.at("source");
    if (sj.is_string()) {
      std::string src = sj.get<std::string>();
      int si0 = g.vertexIndex(src);
      if (si0 < 0) {
        out.errorCode = "UNKNOWN_VERTEX";
        out.errorDetail = "unknown source: " + src;
        return out;
      }
      rsrc = resolveVertexSource(si0);
    } else if (sj.is_object()) {
      if (!sj.contains("arc") || !sj.at("arc").is_string() || !sj.contains("fractionPermille") ||
          !sj.at("fractionPermille").is_number_integer()) {
        out.errorCode = "INVALID_POSITION";
        out.errorDetail = "source object requires {arc: string, fractionPermille: 0..1000}";
        return out;
      }
      rsrc = resolveArcSource(g, sj.at("arc").get<std::string>(),
                              sj.at("fractionPermille").get<int>());
      if (!rsrc.errorCode.empty()) {
        out.errorCode = rsrc.errorCode;
        out.errorDetail = rsrc.errorDetail;
        return out;
      }
    } else {
      out.errorCode = "SCHEMA_VIOLATION";
      out.errorDetail = "source must be a vertex id or {arc, fractionPermille}";
      return out;
    }
  }
  std::string objName = payload.at("objective").get<std::string>();
  BalancedParams bp;
  if (payload.contains("objectiveParams")) {
    const json& op = payload.at("objectiveParams");
    if (!op.is_object()) {
      out.errorCode = "SCHEMA_VIOLATION";
      out.errorDetail = "objectiveParams must be an object";
      return out;
    }
    bp.wTime = op.value("wTime", 0LL);
    bp.wDist = op.value("wDist", 0LL);
    bp.wToll = op.value("wToll", 0LL);
    bp.avoidSevere = op.value("avoidSevere", false);
  }
  ResolvedObjective ro = resolveObjective(g, objName, bp);
  if (!ro.error.empty()) {
    out.errorCode = "SCHEMA_VIOLATION";
    out.errorDetail = ro.error;
    return out;
  }
  out.ro = ro;
  int si = rsrc.vertexIdx;
  int di = g.vertexIndex(dst);
  if (di < 0) {
    out.errorCode = "UNKNOWN_VERTEX";
    out.errorDetail = "unknown target: " + dst;
    return out;
  }
  auto costFn = [&](int ai) -> std::int64_t {
    if (ro.model == CostModel::AvoidCongestion && ro.params.avoidSevere &&
        classify(g.factorPermille(ai)) == CongestionClass::Severe)
      return kInf64;
    return scalarArcCost(g, ai, ro, g.factorPermille(ai));
  };
  RouteResult r;
  Remainder rem;
  std::int64_t scalarInit = 0;
  TollLabel tollInit{0, 0, 0};
  if (rsrc.midArc) {
    rem = remainderFor(g, rsrc.arcIdx, rsrc);
    scalarInit = scalarRemainderCost(g, rsrc.arcIdx, rem, ro);
    tollInit = {0, rem.timeS, rem.distanceM};
  }
  auto runScalar = [&](std::int64_t init) {
    std::vector<std::int64_t> dist;
    std::vector<int> hops;
    std::vector<int> parent = dijkstraScalar(g, si, costFn, dist, hops, out.stats, nullptr, 20000, init);
    return buildRoute(g, si, di, ro.model, parent, dist, out.stats, ro.description);
  };
  if (!rsrc.midArc && si == di) {
    r.found = true;
    r.vertices = {g.vertex(si).id};
    r.objectiveDescription = ro.description;
  } else if (rsrc.midArc && g.vertex(si).id == dst) {
    const Arc& a = g.arc(rsrc.arcIdx);
    EffectiveCost c = g.cost(rsrc.arcIdx);
    r.found = true;
    r.objectiveDescription = ro.description;
    r.arcs.push_back({a.id, a.roadId, g.vertex(a.from).id, g.vertex(a.to).id});
    r.vertices = {g.vertex(a.from).id, g.vertex(a.to).id};
    r.timeS = rem.timeS;
    r.distanceM = rem.distanceM;
    r.baselineTimeS = remainderCost(c.baselineTimeS, rsrc.fraction);
    r.delayS = r.timeS - r.baselineTimeS;
    r.tollInr = 0;
    r.partialLeg = r.arcs[0];
    r.hasPartialLeadingArc = true;
    r.partialTimeS = rem.timeS;
    r.partialDistanceM = rem.distanceM;
    r.partialCrawl = rem.crawl;
    if (ro.model == CostModel::LowestToll) {
      r.hasObjectiveTuple = true;
      r.objectiveTuple = tollInit;
      r.objectiveCost = 0;
    } else {
      r.objectiveCost = scalarInit;
    }
  } else if (algo == "A_STAR" &&
             (ro.model == CostModel::Fastest || ro.model == CostModel::Shortest)) {
    AStarOutcome a = astar(g, si, di, ro.model, 20000, rsrc.midArc ? scalarInit : 0);
    if (!a.ok) {
      out.errorCode = "HEURISTIC_INADMISSIBLE";
      out.errorDetail = a.detail;
      return out;
    }
    out.stats = a.stats;
    RouteResult suffix = buildRoute(g, si, di, ro.model, a.parent, a.dist, out.stats, ro.description);
    r = rsrc.midArc ? joinRemainder(g, rsrc, rem, suffix) : suffix;
    if (a.heuristicZero) out.warnings.push_back("HEURISTIC_ZERO");
  } else if (algo == "A_STAR") {
    out.warnings.push_back("HEURISTIC_ZERO");
    if (ro.model == CostModel::LowestToll) {
      std::vector<TollLabel> dist;
      std::vector<int> hops;
      std::vector<int> parent =
          dijkstraToll(g, si, dist, hops, out.stats, rsrc.midArc ? tollInit : TollLabel{0, 0, 0});
      RouteResult suffix = buildRouteToll(g, si, di, parent, dist, out.stats,
                                          ro.description + " [A* with h=0: Dijkstra-equivalent]");
      r = rsrc.midArc ? joinRemainder(g, rsrc, rem, suffix) : suffix;
    } else {
      RouteResult suffix = runScalar(rsrc.midArc ? scalarInit : 0);
      suffix.objectiveDescription = ro.description + " [A* with h=0: Dijkstra-equivalent]";
      r = rsrc.midArc ? joinRemainder(g, rsrc, rem, suffix) : suffix;
    }
  } else if (ro.model == CostModel::LowestToll) {
    std::vector<TollLabel> dist;
    std::vector<int> hops;
    std::vector<int> parent =
        dijkstraToll(g, si, dist, hops, out.stats, rsrc.midArc ? tollInit : TollLabel{0, 0, 0});
    RouteResult suffix = buildRouteToll(g, si, di, parent, dist, out.stats, ro.description);
    r = rsrc.midArc ? joinRemainder(g, rsrc, rem, suffix) : suffix;
  } else {
    RouteResult suffix;
    if ((ro.model == CostModel::Fastest || ro.model == CostModel::Shortest) && !rsrc.midArc) {
      std::vector<std::int64_t> dist;
      std::vector<int> hops;
      std::vector<int> parent = dijkstra(g, si, ro.model, dist, hops, out.stats);
      suffix = buildRoute(g, si, di, ro.model, parent, dist, out.stats, ro.description);
    } else {
      suffix = runScalar(rsrc.midArc ? scalarInit : 0);
    }
    r = rsrc.midArc ? joinRemainder(g, rsrc, rem, suffix) : suffix;
  }
  out.route = r;
  return out;
}

// Prepend the occupied-arc remainder to a head->dst suffix result (or to an
// unreachable suffix). Objective costs already include the remainder because
// the suffix search started from the initial cost; only raw totals and the
// leading leg are joined here.
RouteResult joinRemainder(const Graph& g, const ResolvedSource& rsrc, const Remainder& rem,
                          const RouteResult& suffix) {
  RouteResult r;
  r.objectiveDescription = suffix.objectiveDescription;
  const Arc& a = g.arc(rsrc.arcIdx);
  r.partialLeg = {a.id, a.roadId, g.vertex(a.from).id, g.vertex(a.to).id};
  r.hasPartialLeadingArc = true;
  r.partialTimeS = rem.timeS;
  r.partialDistanceM = rem.distanceM;
  r.partialCrawl = rem.crawl;
  r.found = suffix.found;
  r.reason = suffix.reason;
  r.hasObjectiveTuple = suffix.hasObjectiveTuple;
  r.objectiveTuple = suffix.objectiveTuple;
  r.objectiveCost = suffix.objectiveCost;
  r.arcs.reserve(suffix.arcs.size() + 1);
  r.arcs.push_back(r.partialLeg);
  r.arcs.insert(r.arcs.end(), suffix.arcs.begin(), suffix.arcs.end());
  r.vertices.reserve(suffix.vertices.size() + 1);
  r.vertices.push_back(g.vertex(a.from).id);
  r.vertices.insert(r.vertices.end(), suffix.vertices.begin(), suffix.vertices.end());
  EffectiveCost c = g.cost(rsrc.arcIdx);
  std::int64_t baseRem = remainderCost(c.baselineTimeS, rsrc.fraction);
  r.timeS = rem.timeS + suffix.timeS;
  r.distanceM = rem.distanceM + suffix.distanceM;
  r.baselineTimeS = baseRem + suffix.baselineTimeS;
  r.delayS = r.timeS - r.baselineTimeS;
  r.tollInr = suffix.tollInr;  // toll incurred once on entry
  return r;
}

std::string dispatch(const json& req, std::int64_t elapsedUs) {
  int api = req.value("apiVersion", 0);
  std::string rid = req.value("requestId", std::string("unknown"));
  std::string cmd = req.value("command", std::string(""));
  json payload = req.value("payload", json::object());

  if (api != kApiVersion)
    return errEnv(api == 0 ? kApiVersion : api, rid, "UNSUPPORTED_API_VERSION",
                  "apiVersion must be 1")
        .dump();

  if (cmd == "engine.info") {
    json stats = {{"elapsedUs", elapsedUs}};
    return okEnv(kApiVersion, rid,
                 {{"engine", "pathforge"},
                  {"version", "0.1.0"},
                  {"apiVersion", kApiVersion},
                  {"build", kBuild},
                  {"commands",
                   {"engine.info", "network.validate", "route.find", "lab.run", "route.evaluate"}}},
                 stats)
        .dump();
  }

  if (cmd == "network.validate") {
    if (!payload.contains("network"))
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", "payload.network is required").dump();
    Network net = parseNetwork(payload.at("network"));
    auto issues = Graph::validate(net);
    json arr = json::array();
    for (const auto& i : issues) arr.push_back({{"code", i.code}, {"message", i.message}});
    json stats = {{"elapsedUs", elapsedUs}};
    return okEnv(kApiVersion, rid, {{"valid", issues.empty()}, {"issues", arr}}, stats).dump();
  }

  if (cmd == "route.find") {
    for (const char* k : {"network", "source", "target", "objective"}) {
      if (!payload.contains(k))
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      std::string("payload.") + k + " is required")
            .dump();
    }
    std::string algo = payload.value("algorithm", "DIJKSTRA");
    if (algo != "DIJKSTRA" && algo != "A_STAR")
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                    "algorithm must be DIJKSTRA or A_STAR (got " + algo + ")")
          .dump();
    Network net = parseNetwork(payload.at("network"));
    Overlay ov = payload.contains("overlay") ? parseOverlay(payload.at("overlay")) : Overlay{};
    auto built = Graph::build(net, ov);
    if (!built.second.empty()) {
      const auto& is = built.second;
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", is.front().message,
                    {{"issues", [&] {
                        json a = json::array();
                        for (const auto& i : is)
                          a.push_back({{"code", i.code}, {"message", i.message}});
                        return a;
                      }()}})
          .dump();
    }
    const Graph& g = built.first;
    SolveOut so = solveRoute(g, payload);
    if (!so.errorCode.empty())
      return errEnv(kApiVersion, rid, so.errorCode, so.errorDetail).dump();
    json stats = {{"elapsedUs", elapsedUs},
                  {"visitedVertices", so.stats.visitedVertices},
                  {"relaxedEdges", so.stats.relaxedEdges},
                  {"heapOps", so.stats.heapOps}};
    json result = routeToJson(so.route);
    if (so.ro.model == CostModel::Balanced) {
      result["objectiveWeights"] = {{"wTime", so.ro.normWTime},
                                    {"wDist", so.ro.normWDist},
                                    {"wToll", so.ro.normWToll}};
      result["objectiveScales"] = {{"sTime", so.ro.scales.sTime},
                                   {"sDist", so.ro.scales.sDist},
                                   {"sToll", so.ro.scales.sToll}};
    }
    return okEnv(kApiVersion, rid, result, stats, so.warnings).dump();
  }

  if (cmd == "lab.run") {
    for (const char* k : {"network", "algorithm", "source"}) {
      if (!payload.contains(k))
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      std::string("payload.") + k + " is required")
            .dump();
    }
    Network net = parseNetwork(payload.at("network"));
    Overlay ov = payload.contains("overlay") ? parseOverlay(payload.at("overlay")) : Overlay{};
    auto built = Graph::build(net, ov);
    if (!built.second.empty()) {
      const auto& is = built.second;
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", is.front().message).dump();
    }
    const Graph& g = built.first;
    std::string lalg = payload.at("algorithm").get<std::string>();
    std::string objName = payload.value("objective", "FASTEST");
    BalancedParams bp;
    if (payload.contains("objectiveParams")) {
      const json& op = payload.at("objectiveParams");
      bp.wTime = op.value("wTime", 0LL);
      bp.wDist = op.value("wDist", 0LL);
      bp.wToll = op.value("wToll", 0LL);
      bp.avoidSevere = op.value("avoidSevere", false);
    }
    ResolvedObjective ro = resolveObjective(g, objName, bp);
    if (!ro.error.empty() && lalg != "BFS" && lalg != "DFS")
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", ro.error).dump();
    std::string src = payload.at("source").get<std::string>();
    int si = g.vertexIndex(src);
    if (si < 0) return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX", "unknown source: " + src).dump();
    int di = -1;
    if (payload.contains("target")) {
      std::string dst = payload.at("target").get<std::string>();
      di = g.vertexIndex(dst);
      if (di < 0)
        return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX", "unknown target: " + dst).dump();
    }
    std::int64_t maxEvents = payload.value("maxEvents", 20000LL);
    LabOutcome lo = runLab(g, lalg, si, di, ro, maxEvents);
    if (!lo.ok) {
      std::string code = lo.errorCode.empty() ? "INTERNAL_ERROR" : lo.errorCode;
      return errEnv(kApiVersion, rid, code, lo.errorDetail).dump();
    }
    json result{{"algorithm", lo.algorithm}, {"trace", traceToJson(lo.trace)}};
    if (!lo.order.empty()) result["order"] = lo.order;
    if (lo.hasRoute) result["route"] = routeToJson(lo.route);
    if (lo.heuristicZero || lo.truncated) {
      std::vector<std::string> w;
      if (lo.heuristicZero) w.push_back("HEURISTIC_ZERO");
      if (lo.truncated) w.push_back("TRACE_TRUNCATED");
      result["warningsEmitted"] = w;
    }
    json stats = {{"elapsedUs", elapsedUs},
                  {"visitedVertices", lo.stats.visitedVertices},
                  {"relaxedEdges", lo.stats.relaxedEdges},
                  {"heapOps", lo.stats.heapOps},
                  {"expandedVertices", lo.expandedVertices}};
    std::vector<std::string> warnings;
    if (lo.heuristicZero) warnings.push_back("HEURISTIC_ZERO");
    if (lo.truncated) warnings.push_back("TRACE_TRUNCATED");
    return okEnv(kApiVersion, rid, result, stats, warnings).dump();
  }

  if (cmd == "route.evaluate") {
    for (const char* k : {"network", "plan"}) {
      if (!payload.contains(k))
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      std::string("payload.") + k + " is required")
            .dump();
    }
    Network net = parseNetwork(payload.at("network"));
    Overlay ov = payload.contains("overlay") ? parseOverlay(payload.at("overlay")) : Overlay{};
    auto built = Graph::build(net, ov);
    if (!built.second.empty())
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", built.second.front().message).dump();
    const Graph& g = built.first;
    const json& plan = payload.at("plan");
    if (!plan.is_object() || !plan.contains("arcs") || !plan.at("arcs").is_array())
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", "plan.arcs array is required").dump();
    std::vector<std::string> arcIds;
    for (const auto& a : plan.at("arcs")) arcIds.push_back(a.get<std::string>());
    // Optional plan source: vertex id or {arc, fractionPermille}.
    ResolvedSource rsrc;
    bool hasSrc = plan.contains("source");
    if (hasSrc) {
      const json& sj = plan.at("source");
      if (sj.is_string()) {
        int si0 = g.vertexIndex(sj.get<std::string>());
        if (si0 < 0)
          return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX",
                        "unknown plan source: " + sj.get<std::string>())
              .dump();
        rsrc = resolveVertexSource(si0);
      } else if (sj.is_object()) {
        rsrc = resolveArcSource(g, sj.value("arc", std::string("")),
                                sj.value("fractionPermille", -1));
        if (!rsrc.errorCode.empty())
          return errEnv(kApiVersion, rid, rsrc.errorCode, rsrc.errorDetail).dump();
      } else {
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", "plan.source must be a vertex id or "
                                                            "{arc, fractionPermille}")
            .dump();
      }
    } else if (!arcIds.empty()) {
      // Default: plan starts at its first arc's tail.
      int ai0 = -1;
      for (int i = 0; i < g.arcCount(); ++i) {
        if (g.arc(i).id == arcIds[0]) {
          ai0 = i;
          break;
        }
      }
      if (ai0 < 0)
        return errEnv(kApiVersion, rid, "UNKNOWN_ROAD", "unknown arc in plan: " + arcIds[0])
            .dump();
      rsrc = resolveVertexSource(g.arc(ai0).from);
    }
    std::string objName = payload.value("objective", "FASTEST");
    BalancedParams bp;
    if (payload.contains("objectiveParams")) {
      const json& op = payload.at("objectiveParams");
      bp.wTime = op.value("wTime", 0LL);
      bp.wDist = op.value("wDist", 0LL);
      bp.wToll = op.value("wToll", 0LL);
      bp.avoidSevere = op.value("avoidSevere", false);
    }
    ResolvedObjective ro = resolveObjective(g, objName, bp);
    if (!ro.error.empty()) return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", ro.error).dump();
    std::string ec, ed;
    PlanEval ev = evaluatePlan(g, arcIds, rsrc, &ro, ec, ed);
    if (!ec.empty()) return errEnv(kApiVersion, rid, ec, ed).dump();
    json arcs = json::array();
    for (const auto& l : ev.arcs)
      arcs.push_back(
          {{"arcId", l.arcId}, {"roadId", l.roadId}, {"from", l.from}, {"to", l.to}});
    json cost = ev.objectiveCost;
    if (ev.hasObjectiveTuple)
      cost = {{"tollInr", ev.objectiveTuple.toll},
              {"timeS", ev.objectiveTuple.time},
              {"distanceM", ev.objectiveTuple.dist}};
    json result{{"valid", ev.valid},
                {"reason", ev.reason},
                {"blocked", ev.blocked},
                {"blockedAtArc", ev.blockedAtArc},
                {"blockedAtIndex", ev.blockedAtIndex},
                {"occupyingClosedArc", ev.occupyingClosedArc},
                {"arcs", arcs},
                {"vertices", ev.vertices},
                {"distanceM", ev.distanceM},
                {"timeS", ev.timeS},
                {"baselineTimeS", ev.baselineTimeS},
                {"delayS", ev.delayS},
                {"tollInr", ev.tollInr},
                {"objectiveCost", cost},
                {"objectiveDescription", ro.description}};
    json stats = {{"elapsedUs", elapsedUs}};
    return okEnv(kApiVersion, rid, result, stats).dump();
  }

  if (cmd == "route.alternatives") {
    for (const char* k : {"network", "source", "target", "objective"}) {
      if (!payload.contains(k))
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      std::string("payload.") + k + " is required")
            .dump();
    }
    Network net = parseNetwork(payload.at("network"));
    Overlay ov = payload.contains("overlay") ? parseOverlay(payload.at("overlay")) : Overlay{};
    auto built = Graph::build(net, ov);
    if (!built.second.empty())
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", built.second.front().message).dump();
    const Graph& g = built.first;
    if (!payload.at("source").is_string())
      return errEnv(kApiVersion, rid, "INVALID_POSITION",
                    "route.alternatives sources are vertices in M3 (mid-arc arrives with rerouting)")
          .dump();
    std::string src = payload.at("source").get<std::string>();
    std::string dst = payload.at("target").get<std::string>();
    int si = g.vertexIndex(src);
    int di = g.vertexIndex(dst);
    if (si < 0) return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX", "unknown source: " + src).dump();
    if (di < 0) return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX", "unknown target: " + dst).dump();
    std::string objName = payload.at("objective").get<std::string>();
    BalancedParams bp;
    if (payload.contains("objectiveParams")) {
      const json& op = payload.at("objectiveParams");
      bp.wTime = op.value("wTime", 0LL);
      bp.wDist = op.value("wDist", 0LL);
      bp.wToll = op.value("wToll", 0LL);
      bp.avoidSevere = op.value("avoidSevere", false);
    }
    ResolvedObjective ro = resolveObjective(g, objName, bp);
    if (!ro.error.empty()) return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", ro.error).dump();
    int K = payload.value("maxCandidates", 10);
    if (K < 1) return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", "maxCandidates must be >= 1").dump();
    if (K > 20)
      return errEnv(kApiVersion, rid, "LIMIT_EXCEEDED", "maxCandidates capped at 20").dump();
    int maxAlt = payload.value("maxAlternatives", 3);
    if (maxAlt < 0) maxAlt = 0;
    if (maxAlt > 3) maxAlt = 3;  // documented clamp: 0..3 distinct paths
    auto toRoute = [&](const YenPath& p) {
      RouteResult r;
      r.found = true;
      r.objectiveDescription = ro.description;
      r.vertices.push_back(g.vertex(si).id);
      for (int ai : p.arcIdx) {
        const Arc& a = g.arc(ai);
        EffectiveCost c = g.cost(ai);
        r.arcs.push_back({a.id, a.roadId, g.vertex(a.from).id, g.vertex(a.to).id});
        r.vertices.push_back(g.vertex(a.to).id);
        r.distanceM += c.distanceM;
        r.timeS += c.timeS;
        r.baselineTimeS += c.baselineTimeS;
        r.tollInr += c.tollInr;
      }
      r.delayS = r.timeS - r.baselineTimeS;
      if (ro.model == CostModel::LowestToll) {
        r.hasObjectiveTuple = true;
        r.objectiveTuple = p.tollCost;
        r.objectiveCost = p.tollCost.toll;
      } else {
        r.objectiveCost = p.scalarCost;
      }
      return r;
    };
    // avoidSevere bars arcs before the search (same rule as route.find).
    Graph gEff = g;
    if (ro.model == CostModel::AvoidCongestion && ro.params.avoidSevere) {
      std::set<std::string> severe;
      for (int i = 0; i < g.arcCount(); ++i) {
        if (g.cost(i).usable && classify(g.factorPermille(i)) == CongestionClass::Severe)
          severe.insert(g.arc(i).id);
      }
      gEff = g.subgraph(severe, {});
    }
    auto costFn = [&](int ai) -> std::int64_t {
      return scalarArcCost(gEff, ai, ro, gEff.factorPermille(ai));
    };
    DijkstraStats st;
    std::vector<YenPath> cands = (ro.model == CostModel::LowestToll)
                                     ? yenKShortestToll(gEff, si, di, K, st)
                                     : yenKShortest(gEff, si, di, costFn, K, st);
    json best;
    json alts = json::array();
    int returned = 0;
    if (!cands.empty()) {
      best = routeToJson(toRoute(cands[0]));
      for (std::size_t i = 1; i < cands.size() && returned < maxAlt; ++i) {
        bool ok = sharedArcFraction(gEff, cands[i], cands[0]) < 0.8;
        if (ok) {
          if (ro.model == CostModel::LowestToll) {
            const TollLabel& b = cands[0].tollCost;
            const TollLabel& c = cands[i].tollCost;
            __int128 tollOk = static_cast<__int128>(c.toll) * 10 - static_cast<__int128>(b.toll) * 11;
            __int128 timeOk = static_cast<__int128>(c.time) * 10 - static_cast<__int128>(b.time) * 16;
            ok = tollOk <= 0 && timeOk <= 0;
          } else {
            __int128 lhs = static_cast<__int128>(cands[i].scalarCost) * 10;
            __int128 rhs = static_cast<__int128>(cands[0].scalarCost) * 16;
            ok = lhs <= rhs;
          }
        }
        if (ok) {
          alts.push_back(routeToJson(toRoute(cands[i])));
          returned++;
        }
      }
    } else {
      RouteResult r;
      r.found = false;
      r.reason = "UNREACHABLE";
      r.objectiveDescription = ro.description;
      best = routeToJson(r);
    }
    json result{{"best", best},
                {"alternatives", alts},
                {"searched", {{"candidates", static_cast<int>(cands.size())},
                              {"returned", returned}}},
                {"diversity",
                 {{"maxSharedFraction", 0.8},
                  {"maxCostRatio", 1.6},
                  {"tollPolicy", "toll<=1.1x best toll AND time<=1.6x best time"}}}};
    json stats = {{"elapsedUs", elapsedUs},
                  {"visitedVertices", st.visitedVertices},
                  {"relaxedEdges", st.relaxedEdges},
                  {"heapOps", st.heapOps}};
    return okEnv(kApiVersion, rid, result, stats).dump();
  }

  if (cmd == "route.compare") {
    for (const char* k : {"network", "plans"}) {
      if (!payload.contains(k))
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      std::string("payload.") + k + " is required")
            .dump();
    }
    Network net = parseNetwork(payload.at("network"));
    Overlay ov = payload.contains("overlay") ? parseOverlay(payload.at("overlay")) : Overlay{};
    auto built = Graph::build(net, ov);
    if (!built.second.empty())
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", built.second.front().message).dump();
    const Graph& g = built.first;
    std::string objName = payload.value("objective", "FASTEST");
    BalancedParams bp;
    if (payload.contains("objectiveParams")) {
      const json& op = payload.at("objectiveParams");
      bp.wTime = op.value("wTime", 0LL);
      bp.wDist = op.value("wDist", 0LL);
      bp.wToll = op.value("wToll", 0LL);
      bp.avoidSevere = op.value("avoidSevere", false);
    }
    ResolvedObjective ro = resolveObjective(g, objName, bp);
    if (!ro.error.empty()) return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", ro.error).dump();
    json out = json::array();
    std::vector<PlanEval> evals;
    for (const auto& p : payload.at("plans")) {
      std::vector<std::string> arcIds;
      for (const auto& a : p.at("arcs")) arcIds.push_back(a.get<std::string>());
      ResolvedSource rsrc;
      if (p.contains("source") && p.at("source").is_string()) {
        int si0 = g.vertexIndex(p.at("source").get<std::string>());
        if (si0 < 0)
          return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX", "unknown plan source").dump();
        rsrc = resolveVertexSource(si0);
      } else if (!arcIds.empty()) {
        int ai0 = -1;
        for (int i = 0; i < g.arcCount(); ++i) {
          if (g.arc(i).id == arcIds[0]) {
            ai0 = i;
            break;
          }
        }
        if (ai0 < 0)
          return errEnv(kApiVersion, rid, "UNKNOWN_ROAD", "unknown arc in plan").dump();
        rsrc = resolveVertexSource(g.arc(ai0).from);
      }
      std::string ec, ed;
      PlanEval ev = evaluatePlan(g, arcIds, rsrc, &ro, ec, ed);
      if (!ec.empty()) return errEnv(kApiVersion, rid, ec, ed).dump();
      evals.push_back(ev);
      std::set<std::string> inc;
      for (const auto& l : ev.arcs) {
        for (int i = 0; i < g.arcCount(); ++i) {
          if (g.arc(i).id == l.arcId) {
            for (const auto& id : g.arcIncidents(i)) inc.insert(id);
            break;
          }
        }
      }
      json cost = ev.objectiveCost;
      if (ev.hasObjectiveTuple)
        cost = {{"tollInr", ev.objectiveTuple.toll},
                {"timeS", ev.objectiveTuple.time},
                {"distanceM", ev.objectiveTuple.dist}};
      json arcs = json::array();
      for (const auto& l : ev.arcs)
        arcs.push_back(
            {{"arcId", l.arcId}, {"roadId", l.roadId}, {"from", l.from}, {"to", l.to}});
      out.push_back({{"id", p.value("id", "")},
                     {"valid", ev.valid},
                     {"reason", ev.reason},
                     {"blocked", ev.blocked},
                     {"blockedAtArc", ev.blockedAtArc},
                     {"arcs", arcs},
                     {"vertices", ev.vertices},
                     {"distanceM", ev.distanceM},
                     {"timeS", ev.timeS},
                     {"baselineTimeS", ev.baselineTimeS},
                     {"delayS", ev.delayS},
                     {"tollInr", ev.tollInr},
                     {"objectiveCost", cost},
                     {"incidentIds", inc}});
    }
    // Deltas vs plans[0] (computed facts only) + shared/unique arc sets.
    json deltas = json::array();
    std::map<std::string, int> arcUse;
    for (const auto& ev : evals) {
      std::set<std::string> seen;
      for (const auto& l : ev.arcs) seen.insert(l.arcId);
      for (const auto& id : seen) arcUse[id]++;
    }
    json shared = json::array();
    for (const auto& kv : arcUse) {
      if (kv.second >= 2) shared.push_back(kv.first);
    }
    for (std::size_t i = 0; i < evals.size(); ++i) {
      json unique = json::array();
      {
        std::set<std::string> seen;
        for (const auto& l : evals[i].arcs) seen.insert(l.arcId);
        for (const auto& id : seen) {
          if (arcUse[id] < 2) unique.push_back(id);
        }
      }
      json d{{"uniqueArcs", unique}};
      if (i > 0 && evals[0].valid && !evals[0].blocked && evals[i].valid && !evals[i].blocked) {
        d["timeDeltaS"] = evals[i].timeS - evals[0].timeS;
        d["distanceDeltaM"] = evals[i].distanceM - evals[0].distanceM;
        d["tollDeltaInr"] = evals[i].tollInr - evals[0].tollInr;
      }
      deltas.push_back(d);
    }
    json result{{"comparisons", out}, {"sharedArcs", shared}, {"deltas", deltas}};
    json stats = {{"elapsedUs", elapsedUs}};
    return okEnv(kApiVersion, rid, result, stats).dump();
  }

  if (cmd == "scenario.compare") {
    for (const char* k : {"network", "query", "scenarios"}) {
      if (!payload.contains(k))
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      std::string("payload.") + k + " is required")
            .dump();
    }
    if (payload.at("scenarios").size() > 8)
      return errEnv(kApiVersion, rid, "LIMIT_EXCEEDED", "at most 8 scenarios").dump();
    Network net = parseNetwork(payload.at("network"));
    const json& query = payload.at("query");
    for (const char* k : {"source", "target", "objective"}) {
      if (!query.contains(k))
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      std::string("query.") + k + " is required")
            .dump();
    }
    json results = json::array();
    json baseRoute;
    bool haveBase = false;
    for (const auto& s : payload.at("scenarios")) {
      Overlay ov = parseOverlay(s.value("overlay", json::object()));
      auto built = Graph::build(net, ov);
      if (!built.second.empty())
        return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                      "scenario " + s.value("id", "?") + ": " + built.second.front().message)
            .dump();
      SolveOut so = solveRoute(built.first, query);
      if (!so.errorCode.empty())
        return errEnv(kApiVersion, rid, so.errorCode,
                      "scenario " + s.value("id", "?") + ": " + so.errorDetail)
            .dump();
      json rj = routeToJson(so.route);
      json entry{{"scenarioId", s.value("id", "")},
                 {"overlayVersion", ov.version},
                 {"route", rj}};
      if (haveBase && baseRoute.at("found").get<bool>() && rj.at("found").get<bool>()) {
        entry["deltasVsFirst"] = {{"timeDeltaS", rj.at("timeS").get<std::int64_t>() -
                                                     baseRoute.at("timeS").get<std::int64_t>()},
                                  {"distanceDeltaM",
                                   rj.at("distanceM").get<std::int64_t>() -
                                       baseRoute.at("distanceM").get<std::int64_t>()},
                                  {"tollDeltaInr", rj.at("tollInr").get<std::int64_t>() -
                                                       baseRoute.at("tollInr").get<std::int64_t>()}};
      }
      if (!haveBase) {
        baseRoute = rj;
        haveBase = true;
      }
      results.push_back(entry);
    }
    json result{{"results", results}};
    json stats = {{"elapsedUs", elapsedUs}};
    return okEnv(kApiVersion, rid, result, stats).dump();
  }

  return errEnv(kApiVersion, rid, "INTERNAL_ERROR",
                "command " + cmd + " not implemented yet (arrives in M4)")
      .dump();
}

}  // namespace

std::string execute(const std::string& requestJson) {
  auto t0 = std::chrono::steady_clock::now();
  std::string rid = "unknown";
  try {
    json req = json::parse(requestJson);
    if (!req.is_object()) return errEnv(kApiVersion, rid, "INVALID_JSON", "request must be an object").dump();
    if (req.contains("requestId") && req.at("requestId").is_string())
      rid = req.at("requestId").get<std::string>();
    if (!req.contains("command") || !req.at("command").is_string())
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", "command is required").dump();
    auto t1 = std::chrono::steady_clock::now();
    std::int64_t setupUs =
        std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    // dispatch() re-stamps completion time below via elapsedUs recompute.
    std::string out = dispatch(req, setupUs);
    return out;
  } catch (const json::parse_error& e) {
    return errEnv(kApiVersion, rid, "INVALID_JSON", e.what()).dump();
  } catch (const json::type_error& e) {
    return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", e.what()).dump();
  } catch (const json::out_of_range& e) {
    return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", e.what()).dump();
  } catch (const std::invalid_argument& e) {
    return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION", e.what()).dump();
  } catch (const std::exception& e) {
    return errEnv(kApiVersion, rid, "INTERNAL_ERROR", e.what()).dump();
  } catch (...) {
    return errEnv(kApiVersion, rid, "INTERNAL_ERROR", "unknown error").dump();
  }
}

}  // namespace pathforge
