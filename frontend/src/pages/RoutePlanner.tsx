import MapView from '../components/MapView';
import RoutePanel from '../components/RoutePanel';
import TrafficPanel from '../components/TrafficPanel';
import { useRoute } from '../store';

export default function RoutePlanner() {
  const facts = useRoute((s) => s.facts);
  const alternatives = useRoute((s) => s.alternatives);
  const selectedAlt = useRoute((s) => s.selectedAlt);
  const displayed = selectedAlt
    ? (alternatives.find((a) => a.altId === selectedAlt) ?? facts)
    : facts;
  const arcIds = displayed?.found ? displayed.arcs.map((a) => a.arcId) : [];
  return (
    <div>
      <div className="pf-workspace">
        <div className="pf-map-wrap">
          <MapView routeArcIds={arcIds} />
        </div>
        <div className="pf-panel" style={{ padding: 0, border: 0 }}>
          <RoutePanel />
          <TrafficPanel />
        </div>
      </div>
    </div>
  );
}
