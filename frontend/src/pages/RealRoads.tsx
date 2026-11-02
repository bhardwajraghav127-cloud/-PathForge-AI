// Real Roads page shell (R1). Map + provenance now; routing, demo and
// fleet arrive on phases R3–R5. No dead controls: only working UI ships.
import { useState } from 'react';
import RealMap from '../realmap/RealMap';
import SourceBadge, { PENDING_META } from '../realmap/SourceBadge';

export default function RealRoads() {
  const [panelHidden, setPanelHidden] = useState(false);
  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap pf-map-tall">
          <RealMap testid="realmap" />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Real roads mode">
            <h2>Real Roads (preview)</h2>
            <p>
              Genuine OpenStreetMap road geometry with C++/WASM routing lands
              here in phases R2–R3. The map above is already fully local:
              no tile servers, no keys, works offline.
            </p>
            <p className="pf-meta">
              Simulation Network mode (every existing page) is unchanged.
            </p>
          </section>
          <SourceBadge meta={PENDING_META} />
        </div>
      </div>
    </div>
  );
}
