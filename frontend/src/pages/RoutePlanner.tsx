import MapView from '../components/MapView';
import RoutePanel from '../components/RoutePanel';
import TrafficPanel from '../components/TrafficPanel';
import { useRoute } from '../store';

export default function RoutePlanner() {
  const facts = useRoute((s) => s.facts);
  const alternatives = useRoute((s) => s.alternatives);
  const selectedAlt = useRoute((s) => s.selectedAlt);
  const planner = useRoute((s) => s.planner);
  const setPlanner = useRoute((s) => s.setPlanner);
  const displayed = selectedAlt
    ? (alternatives.find((a) => a.altId === selectedAlt) ?? facts)
    : facts;
  const arcIds = displayed?.found ? displayed.arcs.map((a) => a.arcId) : [];
  const altIds = alternatives
    .filter((a) => a.found && a.altId !== selectedAlt)
    .flatMap((a) => a.arcs.map((x) => x.arcId));
  return (
    <div>
      <div className="pf-workspace">
        <div className="pf-map-wrap">
          <MapView routeArcIds={arcIds} altArcIds={altIds}
            originId={planner.source} destId={planner.target}
            onSetOrigin={(id) => setPlanner({ source: id })}
            onSetDestination={(id) => setPlanner({ target: id })}
            statsExtra={displayed?.found ? `${displayed.arcs.length} arcs` : undefined} />
        </div>
        <div className="pf-panel" style={{ padding: 0, border: 0 }}>
          <RoutePanel />
          <TrafficPanel />
        </div>
      </div>
    </div>
  );
}
