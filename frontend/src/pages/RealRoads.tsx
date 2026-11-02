// Real Roads page (R2): genuine OSM road geometry + places on a local
// MapLibre style. Routing arrives in R3; this phase proves the data renders.
import { useMemo, useState } from 'react';
import RealMap from '../realmap/RealMap';
import SourceBadge from '../realmap/SourceBadge';
import { REAL_BOUNDS, REAL_CENTER, realLabels, realRoadsGeo } from '../realmap/realData';
import { REAL_META } from '../realmap/realMeta';

export default function RealRoads() {
  const [panelHidden, setPanelHidden] = useState(false);
  const roads = useMemo(() => realRoadsGeo(), []);
  const labels = useMemo(() => realLabels(), []);
  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap pf-map-tall">
          <RealMap testid="realmap" initialCenter={REAL_CENTER} initialZoom={13}
            fitBounds={REAL_BOUNDS} roads={roads} labels={labels} />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Real roads mode">
            <h2>Real Roads</h2>
            <p data-testid="real-coverage">
              {REAL_META.coverage}
            </p>
            <p className="pf-meta">
              Click-to-route and engine navigation arrive in R3; Simulation
              Network mode (every existing page) is unchanged.
            </p>
          </section>
          <SourceBadge meta={REAL_META} />
        </div>
      </div>
    </div>
  );
}
