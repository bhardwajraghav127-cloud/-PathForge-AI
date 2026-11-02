// Stable C ABI over the engine.
// Ownership: pf_execute returns a malloc'd NUL-terminated UTF-8 buffer the
// caller must release exactly once via pf_free (even on failures). The input
// buffer is borrowed for the call only. Null input returns null. Requests
// larger than kMaxRequestBytes are rejected with a LIMIT_EXCEEDED envelope.
// All C++ exceptions are contained and become INTERNAL_ERROR envelopes.
#include <cstdlib>
#include <cstring>
#include <string>

#include "pathforge/engine.hpp"
#include "pathforge/types.hpp"

extern "C" {

char* pf_execute(const char* request_json) {
  if (request_json == nullptr) return nullptr;
  std::size_t len = std::strlen(request_json);
  std::string out;
  if (len > static_cast<std::size_t>(pathforge::kMaxRequestBytes)) {
    out =
        "{\"apiVersion\":1,\"requestId\":\"unknown\",\"ok\":false,\"error\":{"
        "\"code\":\"LIMIT_EXCEEDED\",\"message\":\"request exceeds max bytes\",\"details\":{}}}";
  } else {
    try {
      out = pathforge::execute(std::string(request_json, len));
    } catch (...) {
      out =
          "{\"apiVersion\":1,\"requestId\":\"unknown\",\"ok\":false,\"error\":{"
          "\"code\":\"INTERNAL_ERROR\",\"message\":\"unhandled error\",\"details\":{}}}";
    }
  }
  void* mem = std::malloc(out.size() + 1);
  if (mem == nullptr) return nullptr;
  std::memcpy(mem, out.c_str(), out.size() + 1);
  return static_cast<char*>(mem);
}

void pf_free(char* response) { std::free(response); }

}  // extern "C"
