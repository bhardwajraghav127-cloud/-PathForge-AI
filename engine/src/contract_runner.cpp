// Native contract-runner: reads one envelope request file, prints the response.
// Used by scripts/test-contract.sh for native<->WASM parity (M1).
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "pathforge/engine.hpp"

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: pf_contract_runner <request.json>\n";
    return 2;
  }
  std::ifstream in(argv[1]);
  if (!in) {
    std::cerr << "cannot open " << argv[1] << "\n";
    return 2;
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  std::cout << pathforge::execute(ss.str());
  return 0;
}
