import { Link } from 'react-router-dom';
import { useNetwork } from '../store';

export function Dashboard() {
  const { vertexCount, roadCount } = useNetwork();
  return (
    <div>
      <h2>Dashboard</h2>
      <p data-testid="network-counts">
        Network: {vertexCount} vertices · {roadCount} roads (north-india-sim-v1)
      </p>
      <p>
        <Link to="/route">Plan a route</Link> on the simulated North India network with the real C++ engine.
      </p>
    </div>
  );
}

export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div>
      <h2>{title}</h2>
      <p data-testid="placeholder">Arrives in {milestone}. The engine commands it needs are already verified.</p>
    </div>
  );
}
