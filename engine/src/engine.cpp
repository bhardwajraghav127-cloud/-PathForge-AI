// Envelope dispatcher implementation (M1 subset).
#include "pathforge/engine.hpp"

#include <chrono>
#include <exception>

#include <nlohmann/json.hpp>

#include "pathforge/dijkstra.hpp"
#include "pathforge/graph.hpp"

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

json okEnv(int api, const std::string& rid, const json& result, const json& stats) {
  return json{
      {"apiVersion", api}, {"requestId", rid}, {"ok", true}, {"result", result}, {"stats", stats}};
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
  return ov;
}

json routeToJson(const RouteResult& r) {
  json arcs = json::array();
  for (const auto& l : r.arcs)
    arcs.push_back(
        {{"arcId", l.arcId}, {"roadId", l.roadId}, {"from", l.from}, {"to", l.to}});
  return {{"found", r.found},
          {"reason", r.reason},
          {"arcs", arcs},
          {"vertices", r.vertices},
          {"distanceM", r.distanceM},
          {"timeS", r.timeS},
          {"baselineTimeS", r.baselineTimeS},
          {"delayS", r.delayS},
          {"tollInr", r.tollInr},
          {"objectiveCost", r.objectiveCost},
          {"objectiveDescription", r.objectiveDescription}};
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
                  {"commands", {"engine.info", "network.validate", "route.find"}}},
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
    if (algo != "DIJKSTRA")
      return errEnv(kApiVersion, rid, "INTERNAL_ERROR",
                    "algorithm " + algo + " not implemented in M1 build (arrives M2)")
          .dump();
    std::string objName = payload.at("objective").get<std::string>();
    CostModel model;
    std::string objDesc;
    if (objName == "FASTEST") {
      model = CostModel::Fastest;
      objDesc = "FASTEST: minimize total effective seconds under overlay";
    } else if (objName == "SHORTEST") {
      model = CostModel::Shortest;
      objDesc = "SHORTEST: minimize total metres";
    } else {
      return errEnv(kApiVersion, rid, "SCHEMA_VIOLATION",
                    "objective must be FASTEST or SHORTEST in M1 (more arrive M2)")
          .dump();
    }
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
    std::string src = payload.at("source").get<std::string>();
    std::string dst = payload.at("target").get<std::string>();
    int si = g.vertexIndex(src);
    int di = g.vertexIndex(dst);
    if (si < 0) return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX", "unknown source: " + src).dump();
    if (di < 0) return errEnv(kApiVersion, rid, "UNKNOWN_VERTEX", "unknown target: " + dst).dump();
    RouteResult r;
    DijkstraStats st;
    if (si == di) {
      r.found = true;
      r.vertices = {src};
      r.objectiveDescription = objDesc;
    } else {
      std::vector<std::int64_t> dist;
      std::vector<int> hops;
      std::vector<int> parent = dijkstra(g, si, model, dist, hops, st);
      r = buildRoute(g, si, di, model, parent, dist, st, objDesc);
    }
    json stats = {{"elapsedUs", elapsedUs},
                  {"visitedVertices", st.visitedVertices},
                  {"relaxedEdges", st.relaxedEdges},
                  {"heapOps", st.heapOps}};
    return okEnv(kApiVersion, rid, routeToJson(r), stats).dump();
  }

  return errEnv(kApiVersion, rid, "INTERNAL_ERROR",
                "command " + cmd + " not implemented in M1 build")
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
  } catch (const std::exception& e) {
    return errEnv(kApiVersion, rid, "INTERNAL_ERROR", e.what()).dump();
  } catch (...) {
    return errEnv(kApiVersion, rid, "INTERNAL_ERROR", "unknown error").dump();
  }
}

}  // namespace pathforge
