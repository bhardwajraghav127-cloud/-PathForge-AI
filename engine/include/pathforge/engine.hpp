// Engine command dispatcher.
// Purpose: parse the request envelope, validate it, run engine.info /
//   network.validate / route.find (M1 subset), and format the response
//   envelope. All other commands return a documented M1 error until M2+.
// Envelope: {apiVersion, requestId, command, payload{network, overlay, ...}}.
// Success: {apiVersion, requestId, ok:true, result, stats}. Failure:
//   {apiVersion, requestId, ok:false, error:{code, message, details}}.
// Viva Q&A:
//   Q: Why is the engine stateless? A: every request carries its snapshot; no
//     cross-request mutable state => WASM-safe and deterministic.
//   Q: What makes a route request invalid vs unreachable? A: schema problems
//     are errors; a valid but disconnected query returns found:false.
//   Q: Which fields are volatile? A: elapsedUs timing + build label; masked in parity tests.
#pragma once

#include <string>

#include "pathforge/types.hpp"

namespace pathforge {

// Executes one envelope request; never throws (all errors become envelopes).
std::string execute(const std::string& requestJson);

}  // namespace pathforge
