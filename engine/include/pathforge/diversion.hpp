// Diversion engine: stateless pure assessment + notification policy.
// Purpose: decide STAY / RECOMMEND_DIVERSION / REROUTE_REQUIRED /
//   NO_ROUTE_AVAILABLE from engine-computed facts only. TS never decides.
// Inputs (payload): network, overlay (versioned), plan {arcs, source?},
//   position {arc, fractionPermille}, simTimeS, config?, policy?, action?,
//   candidate?/expectedVersion?/expectedPosition? (accept mode).
// Rules (spec section 7):
//   current ETA from evaluatePlan under overlay; best FASTEST candidate from
//   the same position via the shared solver (no double-count of the occupied
//   arc, same convention as route.find).
//   Blocked remaining plan => current ETA infinite, savingS null.
//   STAY: BELOW_THRESHOLD | CURRENT_IS_BEST | NO_ALTERNATIVE.
//   RECOMMEND_DIVERSION: finite savings >= threshold AND genuinely different.
//   REROUTE_REQUIRED: blocked + alternative. NO_ROUTE_AVAILABLE: blocked + none.
//   Notify only when actionable; closure/blocked alerts bypass cooldown but
//   never duplicate (signature = arcs + savings bucket + blocked status).
//   Cooldown in simulated seconds; bypass on material savings increase
//   (>= materialChangeS over lastSavingS) or newly blocked route.
//   Reject sets dismissedSignature; a new blockage has a different signature
//   so safety alerts are never swallowed by a dismissal.
//   Accept validates overlay version + position fingerprint; stale => STALE_PLAN.
// Viva Q&A:
//   Q: Why stateless? A: WASM-safe, testable, deterministic; TS holds the state.
//   Q: What is a savings bucket? A: floor(savings/bucket) groups near-identical
//     savings so re-evaluation doesn't spam.
//   Q: Threshold equality? A: savings >= threshold recommends (>=, tested).
#pragma once

#include <string>

#include <nlohmann/json.hpp>

#include "pathforge/graph.hpp"

namespace pathforge {

struct DivOutcome {
  bool ok = false;
  std::string errorCode;
  std::string errorDetail;
  nlohmann::json result = nlohmann::json::object();
};

// Pure function: same inputs => identical outputs (simTimeS is an input).
DivOutcome runDiversion(const Graph& g, const nlohmann::json& payload);

}  // namespace pathforge
