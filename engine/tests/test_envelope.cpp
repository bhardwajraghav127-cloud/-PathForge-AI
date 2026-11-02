// Envelope + ABI tests (no pre-recorded answers: assertions computed inline).
#include <cstring>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include "pathforge/engine.hpp"

#include <string>

extern "C" {
char* pf_execute(const char* request_json);
void pf_free(char* response);
}

using nlohmann::json;
using namespace pathforge;

namespace {
json baseNet() {
  return {{"schemaVersion", 1},
          {"vertices",
           {{{"id", "s"}, {"lat", 0.0}, {"lon", 0.0}},
            {{"id", "t"}, {"lat", 0.0}, {"lon", 1.0}}}},
          {"roads",
           {{{"id", "r1"},
             {"from", "s"},
             {"to", "t"},
             {"oneWay", true},
             {"distanceM", 1000},
             {"baselineTimeS", 60},
             {"tollInr", 0}}}}};
}
}  // namespace

TEST(Envelope, InfoOk) {
  json req = {{"apiVersion", 1},
              {"requestId", "r-1"},
              {"command", "engine.info"},
              {"payload", json::object()}};
  json res = json::parse(execute(req.dump()));
  EXPECT_TRUE(res.at("ok").get<bool>());
  EXPECT_EQ(res.at("result").at("engine").get<std::string>(), "pathforge");
  EXPECT_EQ(res.at("requestId").get<std::string>(), "r-1");
}

TEST(Envelope, BadVersion) {
  json req = {{"apiVersion", 99},
              {"requestId", "r-2"},
              {"command", "engine.info"},
              {"payload", json::object()}};
  json res = json::parse(execute(req.dump()));
  EXPECT_FALSE(res.at("ok").get<bool>());
  EXPECT_EQ(res.at("error").at("code").get<std::string>(), "UNSUPPORTED_API_VERSION");
}

TEST(Envelope, RouteFindAndUnreachable) {
  json req = {{"apiVersion", 1},
              {"requestId", "r-3"},
              {"command", "route.find"},
              {"payload",
               {{"network", baseNet()},
                {"source", "s"},
                {"target", "t"},
                {"objective", "FASTEST"},
                {"algorithm", "DIJKSTRA"}}}};
  json res = json::parse(execute(req.dump()));
  ASSERT_TRUE(res.at("ok").get<bool>());
  EXPECT_TRUE(res.at("result").at("found").get<bool>());
  EXPECT_EQ(res.at("result").at("timeS").get<std::int64_t>(), 60);
  EXPECT_EQ(res.at("result").at("arcs")[0].at("arcId").get<std::string>(), "r1:f");

  json bad = req;
  bad["requestId"] = "r-4";
  bad["payload"]["target"] = "nowhere";
  json res2 = json::parse(execute(bad.dump()));
  EXPECT_FALSE(res2.at("ok").get<bool>());
  EXPECT_EQ(res2.at("error").at("code").get<std::string>(), "UNKNOWN_VERTEX");
}

TEST(Envelope, InvalidJsonAndNullAbi) {
  json res = json::parse(execute("{not json"));
  EXPECT_FALSE(res.at("ok").get<bool>());
  EXPECT_EQ(res.at("error").at("code").get<std::string>(), "INVALID_JSON");
  // ABI ownership: non-null freed exactly once; null in -> null out.
  const char* nullReq = nullptr;
  EXPECT_TRUE(pf_execute(nullReq) == nullptr);
  char* p = pf_execute("{\"apiVersion\":1,\"requestId\":\"x\",\"command\":\"engine.info\",\"payload\":{}}");
  ASSERT_NE(p, nullptr);
  EXPECT_GT(std::strlen(p), 0u);
  pf_free(p);
}
