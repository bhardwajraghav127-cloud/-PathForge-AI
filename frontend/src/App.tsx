import { useEffect, useMemo, useState } from 'react';
import { EngineClient, EngineError } from './engine/EngineClient';
import { DEMO_NETWORK } from './engine/demoNetwork';

export default function App() {
  const client = useMemo(() => new EngineClient(), []);
  const [status, setStatus] = useState(client.status);
  const [info, setInfo] = useState('');
  const [route, setRoute] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    client.onStatus = setStatus;
    client
      .call('engine.info', {}, { channel: 'boot' })
      .then((o) => {
        if (!o.stale) setInfo(JSON.stringify(o.result));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [client]);

  async function find(objective: string) {
    setError('');
    setRoute('');
    try {
      const o = await client.call(
        'route.find',
        {
          network: DEMO_NETWORK,
          overlay: { version: 1 },
          source: 's',
          target: 't',
          objective,
          algorithm: 'DIJKSTRA',
        },
        { channel: 'route' },
      );
      if (!o.stale) setRoute(JSON.stringify(o.result));
    } catch (e) {
      setError(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <p role="note" style={{ background: '#fff3cd', padding: 8, borderRadius: 6 }}>
        SIMULATED DATA — NOT LIVE GPS OR TRAFFIC. All roads, times and incidents are synthetic.
      </p>
      <h1>PathForge AI (M1 shell)</h1>
      <p data-testid="engine-status">Engine status: {status}</p>
      <p data-testid="engine-info">{info ? `engine.info: ${info}` : 'loading engine…'}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => void find('FASTEST')}>Find Best Route (FASTEST)</button>
        <button onClick={() => void find('SHORTEST')}>Find (SHORTEST)</button>
        <button onClick={() => client.restart()}>Restart worker</button>
      </div>
      {route && <pre data-testid="route-result">{route}</pre>}
      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      <p id="PATHFORGE_SMOKE">PATHFORGE_SMOKE_READY</p>
    </div>
  );
}
