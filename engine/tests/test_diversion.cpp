// Diversion policy tests: every mandatory case from spec section 7.
// Small two-corridor network; all expectations computed, never prerecorded.
#include <gtest/gtest.h>

#include <fstream>
#include <sstream>

#include <nlohmann/json.hpp>

#include "pathforge/engine.hpp"

using nlohmann::json;
using namespace pathforge;

namespace {
// Feeder geometry: the vehicle rides feed:f toward junction x, where the
// plan continues on direct:f but a quicker branch exists. Mid-feed positions
// give the engine a genuine reroute choice (no U-turn needed).
json net() {
  return {{"schemaVersion", 1},
          {"vertices",
           {{{"id", "s"}}, {{"id", "x"}}, {{"id", "m"}}, {{"id", "t"}}}},
          {"roads",
           {{{"id", "feed"},
             {"from", "s"},
             {"to", "x"},
             {"oneWay", true},
             {"distanceM", 1000},
             {"baselineTimeS", 50}},
            {{"id", "direct"},
             {"from", "x"},
             {"to", "t"},
             {"oneWay", true},
             {"distanceM", 1000},
             {"baselineTimeS", 100}},
            {{"id", "x-m"},
             {"from", "x"},
             {"to", "m"},
             {"oneWay", true},
             {"distanceM", 1000},
             {"baselineTimeS", 40}},
            {{"id", "m-t"},
             {"from", "m"},
             {"to", "t"},
             {"oneWay", true},
             {"distanceM", 1000},
             {"baselineTimeS", 40}}}}};
}

json baseReq() {
  // Active plan feed+direct: 25 + 100 = 125s. Best from same position:
  // 25 + 80 (via m) = 105s. Savings 20 < 600 => STAY/BELOW_THRESHOLD.
  return {{"apiVersion", 1},
          {"requestId", "d-0"},
          {"command", "diversion.evaluate"},
          {"payload",
           {{"network", net()},
            {"overlay", {{"version", 1}}},
            {"plan", {{"arcs", {"feed:f", "direct:f"}}, {"source", "s"}}},
            {"position", {{"arc", "feed:f"}, {"fractionPermille", 500}}},
            {"simTimeS", 1000}}}};
}

json div(const json& req) { return json::parse(execute(req.dump())); }
}  // namespace

TEST(Diversion, MarginalStay) {
  json res = div(baseReq());
  ASSERT_TRUE(res.at("ok").get<bool>());
  EXPECT_EQ(res.at("result").at("decision").get<std::string>(), "STAY");
  EXPECT_EQ(res.at("result").at("reason").get<std::string>(), "BELOW_THRESHOLD");
  EXPECT_EQ(res.at("result").at("savingS").get<std::int64_t>(), 20);
  EXPECT_FALSE(res.at("result").at("notify").get<bool>());
}

TEST(Diversion, MajorRecommendsAndThresholdEquality) {
  // Feeder + parallel slow/quick: current 25+145=170, alternative 25+105=130,
  // savings exactly 40. Threshold 40 => RECOMMEND; 41 => STAY.
  json n{{"schemaVersion", 1},
         {"vertices", {{{"id", "s"}}, {{"id", "x"}}, {{"id", "t"}}}},
         {"roads",
          {{{"id", "feed"},
            {"from", "s"},
            {"to", "x"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 50}},
           {{"id", "slow"},
            {"from", "x"},
            {"to", "t"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 145}},
           {{"id", "quick"},
            {"from", "x"},
            {"to", "t"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 105}}}}};
  auto mk = [&](std::int64_t threshold) {
    return json{{"apiVersion", 1},
                {"requestId", "d-1"},
                {"command", "diversion.evaluate"},
                {"payload",
                 {{"network", n},
                  {"overlay", {{"version", 1}}},
                  {"plan", {{"arcs", {"feed:f", "slow:f"}}, {"source", "s"}}},
                  {"position", {{"arc", "feed:f"}, {"fractionPermille", 500}}},
                  {"simTimeS", 100},
                  {"config", {{"thresholdS", threshold}}}}}};
  };
  json at = div(mk(40));  // savings = 145-105 = 40 >= 40
  ASSERT_TRUE(at.at("ok").get<bool>());
  EXPECT_EQ(at.at("result").at("decision").get<std::string>(), "RECOMMEND_DIVERSION");
  EXPECT_EQ(at.at("result").at("savingS").get<std::int64_t>(), 40);
  EXPECT_TRUE(at.at("result").at("notify").get<bool>());
  json below = div(mk(41));  // 40 < 41: one second above
  EXPECT_EQ(below.at("result").at("decision").get<std::string>(), "STAY");
  EXPECT_FALSE(below.at("result").at("notify").get<bool>());
}

TEST(Diversion, DuplicateCooldownDismissalMaterial) {
  json n{{"schemaVersion", 1},
         {"vertices", {{{"id", "s"}}, {{"id", "x"}}, {{"id", "t"}}}},
         {"roads",
          {{{"id", "feed"},
            {"from", "s"},
            {"to", "x"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 50}},
           {{"id", "slow"},
            {"from", "x"},
            {"to", "t"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 145}},
           {{"id", "quick"},
            {"from", "x"},
            {"to", "t"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 105}}}}};
  auto req = [&](std::int64_t sim, json policy, std::int64_t thresh = 40) {
    return json{{"apiVersion", 1},
                {"requestId", "d-2"},
                {"command", "diversion.evaluate"},
                {"payload",
                 {{"network", n},
                  {"overlay", {{"version", 1}}},
                  {"plan", {{"arcs", {"feed:f", "slow:f"}}, {"source", "s"}}},
                  {"position", {{"arc", "feed:f"}, {"fractionPermille", 500}}},
                  {"simTimeS", sim},
                  {"config", {{"thresholdS", thresh}, {"cooldownSimS", 300}}},
                  {"policy", policy}}}};
  };
  json first = div(req(100, json::object()));
  ASSERT_TRUE(first.at("result").at("notify").get<bool>());
  json pol1 = first.at("result").at("policy");
  // Duplicate within cooldown, same signature: suppressed.
  json dup = div(req(200, pol1));
  EXPECT_FALSE(dup.at("result").at("notify").get<bool>());
  EXPECT_EQ(dup.at("result").at("notificationReason").get<std::string>(), "DUPLICATE_SUPPRESSED");
  // Same signature after cooldown: still suppressed (duplicate, not new info).
  json later = div(req(500, pol1));
  EXPECT_FALSE(later.at("result").at("notify").get<bool>());
  EXPECT_EQ(later.at("result").at("notificationReason").get<std::string>(),
            "DUPLICATE_SUPPRESSED");
  // Changed situation (new overlay, new savings bucket) after cooldown:
  // notified. A further change inside the new cooldown: COOLDOWN.
  auto reqV = [&](std::int64_t sim, json policy, int version, int slowFactor) {
    json q = req(sim, policy);
    q["payload"]["overlay"] =
        json{{"version", version}, {"factors", {{"slow", slowFactor}}}};
    return q;
  };
  json chg = div(reqV(500, pol1, 2, 500));
  EXPECT_TRUE(chg.at("result").at("notify").get<bool>());
  json chgPol = chg.at("result").at("policy");
  json chg2 = div(reqV(550, chgPol, 3, 250));
  EXPECT_FALSE(chg2.at("result").at("notify").get<bool>());
  EXPECT_EQ(chg2.at("result").at("notificationReason").get<std::string>(), "COOLDOWN");
  // Reject then re-evaluate: dismissed.
  json rejReq = req(500, pol1);
  rejReq["payload"]["action"] = "reject";
  json rej = div(rejReq);
  ASSERT_TRUE(rej.at("ok").get<bool>());
  json polR = rej.at("result").at("policy");
  EXPECT_FALSE(polR.at("dismissedSignature").get<std::string>().empty());
  json afterReject = div(req(900, polR));
  EXPECT_FALSE(afterReject.at("result").at("notify").get<bool>());
  EXPECT_EQ(afterReject.at("result").at("notificationReason").get<std::string>(), "DISMISSED");
}

TEST(Diversion, CurrentBestAndNoAlternative) {
  // Current plan IS the best: feeder + single onward road.
  json n{{"schemaVersion", 1},
         {"vertices", {{{"id", "s"}}, {{"id", "m"}}, {{"id", "t"}}}},
         {"roads",
          {{{"id", "feed"},
            {"from", "s"},
            {"to", "m"},
            {"oneWay", true},
            {"distanceM", 100},
            {"baselineTimeS", 50}},
           {{"id", "only"},
            {"from", "m"},
            {"to", "t"},
            {"oneWay", true},
            {"distanceM", 100},
            {"baselineTimeS", 50}}}}};
  json r{{"apiVersion", 1},
         {"requestId", "d-3"},
         {"command", "diversion.evaluate"},
         {"payload",
          {{"network", n},
           {"overlay", {{"version", 1}}},
           {"plan", {{"arcs", {"feed:f", "only:f"}}, {"source", "s"}}},
           {"position", {{"arc", "feed:f"}, {"fractionPermille", 0}}},
           {"simTimeS", 10}}}};
  json res = div(r);
  EXPECT_EQ(res.at("result").at("decision").get<std::string>(), "STAY");
  EXPECT_EQ(res.at("result").at("reason").get<std::string>(), "CURRENT_IS_BEST");
  // Block the onward road ahead: NO_ROUTE_AVAILABLE, null saving, notified.
  json r2 = r;
  r2["requestId"] = "d-4";
  r2["payload"]["overlay"] = {{"version", 2}, {"closures", {"only"}}};
  json res2 = div(r2);
  EXPECT_EQ(res2.at("result").at("decision").get<std::string>(), "NO_ROUTE_AVAILABLE");
  EXPECT_TRUE(res2.at("result").at("savingS").is_null());
  EXPECT_TRUE(res2.at("result").at("notify").get<bool>());
}

TEST(Diversion, ClosureAheadReroutes) {
  // Plan s-m-t with the vehicle on s-m; m-t closes ahead => reroute via m-t2.
  // Occupied-arc closure instead crawls (covered in Position tests).
  json n{{"schemaVersion", 1},
         {"vertices", {{{"id", "s"}}, {{"id", "m"}}, {{"id", "t"}}}},
         {"roads",
          {{{"id", "s-m"},
            {"from", "s"},
            {"to", "m"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 40}},
           {{"id", "m-t"},
            {"from", "m"},
            {"to", "t"},
            {"oneWay", true},
            {"distanceM", 1000},
            {"baselineTimeS", 40}},
           {{"id", "m-t2"},
            {"from", "m"},
            {"to", "t"},
            {"oneWay", true},
            {"distanceM", 1500},
            {"baselineTimeS", 90}}}}};
  json r{{"apiVersion", 1},
         {"requestId", "d-5"},
         {"command", "diversion.evaluate"},
         {"payload",
          {{"network", n},
           {"overlay", {{"version", 2}, {"closures", {"m-t"}}}},
           {"plan", {{"arcs", {"s-m:f", "m-t:f"}}, {"source", "s"}}},
           {"position", {{"arc", "s-m:f"}, {"fractionPermille", 100}}},
           {"simTimeS", 500}}}};
  json res = div(r);
  ASSERT_TRUE(res.at("ok").get<bool>());
  EXPECT_EQ(res.at("result").at("decision").get<std::string>(), "REROUTE_REQUIRED");
  EXPECT_TRUE(res.at("result").at("notify").get<bool>());
  // Reroute bypasses cooldown as a blocked-route alert.
  json pol = res.at("result").at("policy");
  r["payload"]["policy"] = pol;
  r["requestId"] = "d-6";
  json dup = div(r);
  EXPECT_TRUE(dup.at("result").at("notify").get<bool>());
  EXPECT_EQ(dup.at("result").at("notificationReason").get<std::string>(), "BLOCKED_ALERT");
}

TEST(Diversion, StaleAcceptAndVersion) {
  json r = baseReq();
  r["payload"]["action"] = "accept";
  r["payload"]["expectedVersion"] = 99;  // wrong version
  r["payload"]["expectedPosition"] = {{"arc", "direct:f"}, {"fractionPermille", 500}};
  r["payload"]["candidate"] = {{"arcs", {"direct:f"}}};
  json res = div(r);
  EXPECT_FALSE(res.at("ok").get<bool>());
  EXPECT_EQ(res.at("error").at("code").get<std::string>(), "STALE_PLAN");
  // Correct version + matching position + traversable candidate: accepted.
  json r2 = baseReq();
  r2["payload"]["action"] = "accept";
  r2["payload"]["expectedVersion"] = 1;
  r2["payload"]["expectedPosition"] = {{"arc", "feed:f"}, {"fractionPermille", 500}};
  r2["payload"]["candidate"] = {{"arcs", {"feed:f", "direct:f"}}};
  json res2 = div(r2);
  ASSERT_TRUE(res2.at("ok").get<bool>());
  EXPECT_TRUE(res2.at("result").at("accepted").get<bool>());
  // Moved vehicle: stale.
  json r3 = r2;
  r3["payload"]["expectedPosition"] = {{"arc", "direct:f"}, {"fractionPermille", 100}};
  json res3 = div(r3);
  EXPECT_EQ(res3.at("error").at("code").get<std::string>(), "STALE_PLAN");
}

TEST(Diversion, DeterministicRepeats) {
  json a = div(baseReq());
  json b = div(baseReq());
  EXPECT_EQ(a.at("result").dump(), b.at("result").dump());
}

TEST(Diversion, DatasetMarginalStaysMajorRecommends) {
  // End-to-end on the real dataset with the shipped presets.
  std::string ds = std::string(PF_DATASET_DIR) + "/sample-networks/north-india-sim-v1.json";
  auto loadNet = [&]() {
    std::ifstream in(ds);
    std::ostringstream ss;
    ss << in.rdbuf();
    json j = json::parse(ss.str());
    json roads = json::array();
    for (const auto& r : j.at("roads"))
      roads.push_back({{"id", r.at("id")},
                       {"from", r.at("from")},
                       {"to", r.at("to")},
                       {"oneWay", r.at("oneWay")},
                       {"distanceM", r.at("distanceM")},
                       {"baselineTimeS", r.at("baselineTimeS")}});
    json verts = json::array();
    for (const auto& v : j.at("vertices"))
      verts.push_back(
          {{"id", v.at("id")}, {"lat", v.at("lat")}, {"lon", v.at("lon")}});
    return json{{"schemaVersion", 1}, {"vertices", verts}, {"roads", roads}};
  };
  auto loadOv = [&](const std::string& id) {
    std::ifstream in(std::string(PF_DATASET_DIR) + "/traffic-scenarios/" + id + ".json");
    std::ostringstream ss;
    ss << in.rdbuf();
    return json::parse(ss.str()).at("overlay");
  };
  json network = loadNet();
  // Baseline fastest plan (computed, not prerecorded).
  json fr{{"apiVersion", 1},
          {"requestId", "e2e-0"},
          {"command", "route.find"},
          {"payload",
           {{"network", network},
            {"source", "chandigarh"},
            {"target", "delhi"},
            {"objective", "FASTEST"},
            {"algorithm", "DIJKSTRA"}}}};
  json fres = div(fr);
  ASSERT_TRUE(fres.at("ok").get<bool>());
  json arcs = json::array();
  for (const auto& a : fres.at("result").at("arcs")) arcs.push_back(a.at("arcId"));
  auto divert = [&](const json& overlay) {
    return div(json{{"apiVersion", 1},
                    {"requestId", "e2e-1"},
                    {"command", "diversion.evaluate"},
                    {"payload",
                     {{"network", network},
                      {"overlay", overlay},
                      {"plan", {{"arcs", arcs}, {"source", "chandigarh"}}},
                      {"position",
                       {{"arc", arcs[0].get<std::string>()}, {"fractionPermille", 100}}},
                      {"simTimeS", 3600},
                      {"config", {{"thresholdS", 600}}}}}});
  };
  json marginal = divert(loadOv("marginal-delay-v1"));
  EXPECT_EQ(marginal.at("result").at("decision").get<std::string>(), "STAY");
  json major = divert(loadOv("major-delay-v1"));
  EXPECT_EQ(major.at("result").at("decision").get<std::string>(), "RECOMMEND_DIVERSION");
  EXPECT_TRUE(major.at("result").at("notify").get<bool>());
  EXPECT_GE(major.at("result").at("savingS").get<std::int64_t>(), 1800);
}
