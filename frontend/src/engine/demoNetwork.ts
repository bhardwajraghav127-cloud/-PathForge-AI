// Demo network shared by the M1 shell (mirrors contract fixture route-find-001).
export const DEMO_NETWORK = {
  schemaVersion: 1,
  vertices: [
    { id: 's', lat: 0, lon: 0 },
    { id: 'a', lat: 0, lon: 1 },
    { id: 'b', lat: 1, lon: 0 },
    { id: 't', lat: 1, lon: 1 },
  ],
  roads: [
    { id: 'r1', from: 's', to: 'a', oneWay: true, distanceM: 1000, baselineTimeS: 10 },
    { id: 'r2', from: 's', to: 'b', oneWay: true, distanceM: 1000, baselineTimeS: 10 },
    { id: 'r3', from: 'a', to: 't', oneWay: true, distanceM: 1000, baselineTimeS: 10 },
    { id: 'r4', from: 'b', to: 't', oneWay: true, distanceM: 1000, baselineTimeS: 10 },
  ],
};
