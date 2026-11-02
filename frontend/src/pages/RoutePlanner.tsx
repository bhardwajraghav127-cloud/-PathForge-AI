import MapView from '../components/MapView';
import RoutePanel from '../components/RoutePanel';
import { useRoute } from '../store';

export default function RoutePlanner() {
  const facts = useRoute((s) => s.facts);
  const arcIds = facts?.found ? facts.arcs.map((a) => a.arcId) : [];
  return (
    <div className="pf-workspace">
      <div className="pf-map-wrap">
        <MapView routeArcIds={arcIds} />
      </div>
      <RoutePanel />
    </div>
  );
}
