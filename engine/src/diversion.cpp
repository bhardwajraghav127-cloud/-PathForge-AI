// Diversion engine implementation.
#include "pathforge/diversion.hpp"

#include "pathforge/dijkstra.hpp"
#include "pathforge/objectives.hpp"
#include "pathforge/position.hpp"

namespace pathforge {
namespace {

using nlohmann::json;

struct Config {
  std::int64_t thresholdS = 600;
  std::int64_t cooldownSimS = 300;
  std::int64_t materialChangeS = 300;
  std::int64_t savingBucketS = 60;
};

bool parseConfig(const json& j, Config& c, std::string& err) {
  c.thresholdS = j.value("thresholdS", 600LL);
  c.cooldownSimS = j.value("cooldownSimS", 300LL);
  c.materialChangeS = j.value("materialChangeS", 300LL);
  c.savingBucketS = j.value("savingBucketS", 60LL);
  if (c.thresholdS < 0 || c.cooldownSimS < 0 || c.materialChangeS < 0) {
    err = "thresholdS/cooldownSimS/materialChangeS must be >= 0";
    return false;
  }
  if (c.savingBucketS <= 0) {
    err = "savingBucketS must be > 0";
    return false;
  }
  return true;
}

std::string joinArcs(const std::vector<std::string>& ids) {
  std::string s;
  for (const auto& id : ids) {
    s += id;
    s += '|';
  }
  return s;
}

std::string bucketOf(std::int64_t savingS, std::int64_t bucket) {
  return std::to_string(savingS / bucket);
}

}  // namespace

DivOutcome runDiversion(const Graph& g, const json& payload) {
  DivOutcome o;
  // ---- required inputs ----
  for (const char* k : {"plan", "position", "simTimeS"}) {
    if (!payload.contains(k)) {
      o.errorCode = "SCHEMA_VIOLATION";
      o.errorDetail = std::string("payload.") + k + " is required";
      return o;
    }
  }
  std::int64_t simTimeS = payload.at("simTimeS").get<std::int64_t>();
  if (simTimeS < 0) {
    o.errorCode = "SCHEMA_VIOLATION";
    o.errorDetail = "simTimeS must be >= 0";
    return o;
  }
  std::int64_t overlayVersion = payload.value("overlayVersion", 0LL);
  Config cfg;
  {
    std::string err;
    json cj = payload.value("config", json::object());
    if (!cj.is_object()) {
      o.errorCode = "SCHEMA_VIOLATION";
      o.errorDetail = "config must be an object";
      return o;
    }
    if (!parseConfig(cj, cfg, err)) {
      o.errorCode = "SCHEMA_VIOLATION";
      o.errorDetail = err;
      return o;
    }
  }
  std::string action = payload.value("action", "evaluate");
  if (action != "evaluate" && action != "accept" && action != "reject") {
    o.errorCode = "SCHEMA_VIOLATION";
    o.errorDetail = "action must be evaluate, accept or reject";
    return o;
  }
  // ---- position ----
  const json& pj = payload.at("position");
  if (!pj.is_object() || !pj.contains("arc") || !pj.contains("fractionPermille")) {
    o.errorCode = "INVALID_POSITION";
    o.errorDetail = "position requires {arc, fractionPermille}";
    return o;
  }
  ResolvedSource pos = resolveArcSource(g, pj.at("arc").get<std::string>(),
                                        pj.at("fractionPermille").get<int>());
  if (!pos.errorCode.empty()) {
    o.errorCode = pos.errorCode;
    o.errorDetail = pos.errorDetail;
    return o;
  }
  // ---- current plan ----
  const json& plan = payload.at("plan");
  if (!plan.is_object() || !plan.contains("arcs") || !plan.at("arcs").is_array()) {
    o.errorCode = "SCHEMA_VIOLATION";
    o.errorDetail = "plan.arcs array is required";
    return o;
  }
  std::vector<std::string> planArcs;
  for (const auto& a : plan.at("arcs")) planArcs.push_back(a.get<std::string>());
  if (!pos.midArc && !planArcs.empty()) {
    // Vertex position must match the plan start (same convention, no teleport).
    int first = -1;
    for (int i = 0; i < g.arcCount(); ++i) {
      if (g.arc(i).id == planArcs[0]) {
        first = i;
        break;
      }
    }
    if (first < 0 || g.arc(first).from != pos.vertexIdx) {
      o.errorCode = "STALE_PLAN";
      o.errorDetail = "plan does not start at the vehicle position";
      return o;
    }
  }
  ResolvedObjective ro;
  ro.model = CostModel::Fastest;
  ro.description = "FASTEST: minimize total effective seconds under overlay";
  std::string ec, ed;
  PlanEval cur = evaluatePlan(g, planArcs, pos, &ro, ec, ed);
  if (!ec.empty()) {
    o.errorCode = ec;  // UNKNOWN_ROAD from unknown arc ids
    o.errorDetail = ed;
    return o;
  }
  if (!cur.valid) {
    // Position/plan mismatch or empty plan => stale choice, not a decision.
    o.errorCode = "STALE_PLAN";
    o.errorDetail = cur.reason.empty() ? "plan does not match position" : cur.reason;
    return o;
  }

  // ---- accept mode: pure validation gate ----
  if (action == "accept") {
    if (!payload.contains("expectedVersion") || !payload.contains("expectedPosition") ||
        !payload.contains("candidate")) {
      o.errorCode = "SCHEMA_VIOLATION";
      o.errorDetail = "accept requires expectedVersion, expectedPosition and candidate";
      return o;
    }
    if (payload.at("expectedVersion").get<std::int64_t>() != overlayVersion) {
      o.errorCode = "STALE_PLAN";
      o.errorDetail = "overlay version changed since recommendation";
      return o;
    }
    const json& ep = payload.at("expectedPosition");
    if (!ep.is_object() || ep.value("arc", std::string()) != pj.at("arc").get<std::string>() ||
        ep.value("fractionPermille", -1) != pj.at("fractionPermille").get<int>()) {
      o.errorCode = "STALE_PLAN";
      o.errorDetail = "vehicle moved since recommendation";
      return o;
    }
    const json& cand = payload.at("candidate");
    if (!cand.is_object() || !cand.contains("arcs") || !cand.at("arcs").is_array()) {
      o.errorCode = "SCHEMA_VIOLATION";
      o.errorDetail = "candidate.arcs array is required";
      return o;
    }
    std::vector<std::string> candArcs;
    for (const auto& a : cand.at("arcs")) candArcs.push_back(a.get<std::string>());
    ResolvedSource csrc = pos;
    if (cand.contains("source") && cand.at("source").is_string()) {
      int svi = g.vertexIndex(cand.at("source").get<std::string>());
      if (svi < 0) {
        o.errorCode = "UNKNOWN_VERTEX";
        o.errorDetail = "unknown candidate source";
        return o;
      }
      csrc = resolveVertexSource(svi);
    }
    PlanEval cev = evaluatePlan(g, candArcs, csrc, &ro, ec, ed);
    if (!ec.empty()) {
      o.errorCode = ec;
      o.errorDetail = ed;
      return o;
    }
    if (!cev.valid || cev.blocked) {
      o.errorCode = "STALE_PLAN";
      o.errorDetail = "candidate no longer traversable";
      return o;
    }
    o.ok = true;
    json arcs = json::array();
    for (const auto& l : cev.arcs)
      arcs.push_back(
          {{"arcId", l.arcId}, {"roadId", l.roadId}, {"from", l.from}, {"to", l.to}});
    o.result = {{"accepted", true}, {"plan", {{"arcs", arcs}, {"vertices", cev.vertices}}}};
    return o;
  }

  // ---- best FASTEST candidate from the same position (shared convention) ----
  // Reuse the scalar core with the same initial-cost rule as route.find.
  Remainder rem;
  std::int64_t scalarInit = 0;
  if (pos.midArc) {
    rem = remainderFor(g, pos.arcIdx, pos);
    scalarInit = rem.timeS;
  }
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto costFn = [&](int ai) { return g.cost(ai).timeS; };
  // Destination: INTENDED end of the current plan (head of its last arc),
  // not the traversable prefix end when the plan is blocked.
  int dstIdx = -1;
  if (!planArcs.empty()) {
    for (int i = 0; i < g.arcCount(); ++i) {
      if (g.arc(i).id == planArcs.back()) {
        dstIdx = g.arc(i).to;
        break;
      }
    }
  }
  RouteResult cand;
  bool candFound = false;
  if (dstIdx >= 0 && pos.vertexIdx == dstIdx) {
    // Already at the intended destination: the remaining plan IS the candidate.
    cand.found = true;
    cand.objectiveDescription = ro.description;
    cand.vertices = cur.vertices;
    cand.arcs = cur.arcs;
    cand.timeS = cur.timeS;
    cand.distanceM = cur.distanceM;
    cand.baselineTimeS = cur.baselineTimeS;
    cand.delayS = cur.delayS;
    cand.tollInr = cur.tollInr;
    cand.objectiveCost = cur.objectiveCost;
    candFound = true;
  } else if (dstIdx >= 0) {
    std::vector<int> parent =
        dijkstraScalar(g, pos.vertexIdx, costFn, dist, hops, st, nullptr, 20000, scalarInit);
    cand = buildRoute(g, pos.vertexIdx, dstIdx, CostModel::Fastest, parent, dist, st, ro.description);
    candFound = cand.found;
    if (pos.midArc && candFound) cand = joinRemainder(g, pos, rem, cand);
  }

  // ---- assessment ----
  bool curBlocked = cur.blocked;
  std::string decision, reason;
  std::int64_t savingS = 0;
  bool haveSaving = false;
  json candJson = nullptr;
  std::vector<std::string> candArcIds;
  if (candFound) {
    candJson = routeToJson(cand);
    for (const auto& l : cand.arcs) candArcIds.push_back(l.arcId);
  }
  if (curBlocked && candFound) {
    decision = "REROUTE_REQUIRED";
    reason = "BLOCKED_CURRENT_PLAN";
  } else if (curBlocked) {
    decision = "NO_ROUTE_AVAILABLE";
    reason = "BLOCKED_NO_ALTERNATIVE";
  } else if (!candFound) {
    decision = "STAY";
    reason = "NO_ALTERNATIVE";
  } else if (joinArcs(candArcIds) == joinArcs(planArcs)) {
    decision = "STAY";
    reason = "CURRENT_IS_BEST";
  } else {
    savingS = cur.timeS - cand.timeS;
    haveSaving = true;
    if (savingS >= cfg.thresholdS) {  // threshold met (>=, tested at equality)
      decision = "RECOMMEND_DIVERSION";
      reason = "THRESHOLD_MET";
    } else {
      decision = "STAY";
      reason = "BELOW_THRESHOLD";
    }
  }

  // ---- notification policy (pure; TS persists `policy`) ----
  json pin = payload.value("policy", json::object());
  std::string lastSig = pin.value("lastSignature", "");
  std::string dismissedSig = pin.value("dismissedSignature", "");
  std::int64_t lastNotify = pin.value("lastNotifySimS", -1000000000LL);
  bool hasLastSaving = pin.contains("lastSavingS") && !pin.at("lastSavingS").is_null();
  std::int64_t lastSaving = hasLastSaving ? pin.at("lastSavingS").get<std::int64_t>() : 0;

  std::string signature;
  if (decision == "NO_ROUTE_AVAILABLE") {
    signature = "noroute:" + cur.blockedAtArc + "|v" + std::to_string(overlayVersion);
  } else if (candFound && decision != "STAY") {
    signature = joinArcs(candArcIds) + "|s" + bucketOf(haveSaving ? savingS : 0, cfg.savingBucketS);
    if (curBlocked) signature += "|B";
  }

  bool notify = false;
  std::string notifyReason;
  if (decision == "RECOMMEND_DIVERSION" || decision == "REROUTE_REQUIRED" ||
      decision == "NO_ROUTE_AVAILABLE") {
    bool duplicate = !signature.empty() && (signature == lastSig || signature == dismissedSig);
    bool inCooldown = (simTimeS - lastNotify) < cfg.cooldownSimS;
    bool material = haveSaving && hasLastSaving && (savingS - lastSaving) >= cfg.materialChangeS;
    bool newlyBlocked = curBlocked && decision != "STAY";
    // A dismissal suppresses only its own signature; a newly blocked route
    // always re-alerts (different signature), and material savings bypass.
    if (signature == dismissedSig && !newlyBlocked && !material) {
      notify = false;
      notifyReason = "DISMISSED";
    } else if (duplicate && !material && !newlyBlocked) {
      notify = false;
      notifyReason = "DUPLICATE_SUPPRESSED";
    } else if (inCooldown && !material && !newlyBlocked) {
      notify = false;
      notifyReason = "COOLDOWN";
    } else {
      notify = true;
      notifyReason = newlyBlocked ? "BLOCKED_ALERT" : (material ? "MATERIAL_CHANGE" : "ACTIONABLE");
    }
  }

  json policy = pin;
  policy["lastTrafficVersion"] = overlayVersion;
  if (action == "reject") {
    // Reject the currently assessed candidate (or current signature context).
    policy["dismissedSignature"] = signature.empty() ? lastSig : signature;
  }
  if (haveSaving) {
    policy["lastSavingS"] = savingS;
  } else {
    policy["lastSavingS"] = nullptr;
  }
  if (notify) {
    policy["lastSignature"] = signature;
    policy["lastNotifySimS"] = simTimeS;
  }

  o.ok = true;
  o.result = {{"decision", decision},
              {"reason", reason},
              {"currentEtaS", curBlocked ? json(nullptr) : json(cur.timeS)},
              {"candidateEtaS", candFound ? json(cand.timeS) : json(nullptr)},
              {"savingS", haveSaving && !curBlocked ? json(savingS) : json(nullptr)},
              {"distanceDeltaM", candFound ? json(cand.distanceM - cur.distanceM) : json(nullptr)},
              {"tollDeltaInr", candFound ? json(cand.tollInr - cur.tollInr) : json(nullptr)},
              {"candidate", candJson},
              {"notify", notify},
              {"notificationReason", notifyReason},
              {"policy", policy},
              {"config", {{"thresholdS", cfg.thresholdS},
                          {"cooldownSimS", cfg.cooldownSimS},
                          {"materialChangeS", cfg.materialChangeS},
                          {"savingBucketS", cfg.savingBucketS}}}};
  return o;
}

}  // namespace pathforge
