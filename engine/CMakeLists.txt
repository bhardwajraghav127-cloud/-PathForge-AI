cmake_minimum_required(VERSION 3.20)
project(pathforge_engine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# Strict warnings (native). WASM uses same sources via emcc (see scripts/build-wasm.sh).
set(PF_WARN_FLAGS -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror)

include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(nlohmann_json)

add_library(pathforge_lib
  src/graph.cpp
  src/dijkstra.cpp
  src/objectives.cpp
  src/traversal.cpp
  src/astar.cpp
  src/lab.cpp
  src/position.cpp
  src/yen.cpp
  src/diversion.cpp
  src/prim.cpp
  src/kruskal.cpp
  src/multistop.cpp
  src/engine.cpp
  src/bindings/abi.cpp
)
target_include_directories(pathforge_lib PUBLIC include)
target_link_libraries(pathforge_lib PUBLIC nlohmann_json::nlohmann_json)
target_compile_options(pathforge_lib PRIVATE ${PF_WARN_FLAGS})

add_executable(pf_contract_runner src/contract_runner.cpp)
target_link_libraries(pf_contract_runner PRIVATE pathforge_lib)

add_executable(pf_bench bench/bench.cpp)
target_link_libraries(pf_bench PRIVATE pathforge_lib)
target_compile_options(pf_bench PRIVATE ${PF_WARN_FLAGS})

# Tests
option(PF_BUILD_TESTS "Build GoogleTest suite" ON)
if(PF_BUILD_TESTS)
  FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
  )
  set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(googletest)
  enable_testing()
  add_executable(pf_tests
    tests/test_dijkstra.cpp
    tests/test_validate.cpp
    tests/test_envelope.cpp
    tests/test_objectives.cpp
    tests/test_traversal.cpp
    tests/test_astar.cpp
    tests/test_lab.cpp
    tests/test_position.cpp
    tests/test_yen.cpp
    tests/test_incidents.cpp
    tests/test_dataset.cpp
    tests/test_diversion.cpp
    tests/test_mst.cpp
    tests/test_algorithms.cpp
  )
  target_compile_definitions(pf_tests PRIVATE "PF_DATASET_DIR=\"${CMAKE_SOURCE_DIR}/../datasets\"")
  target_link_libraries(pf_tests PRIVATE pathforge_lib GTest::gtest_main)
  target_compile_options(pf_tests PRIVATE ${PF_WARN_FLAGS})
  include(GoogleTest)
  gtest_discover_tests(pf_tests)
endif()
