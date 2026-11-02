// Why This Route? drawer (V5). Everything numeric comes from the engine
// (route.evaluate per arc under the live overlay) or the dataset; sums are
// checked against the engine route totals and the match is shown, not
// assumed. No trace data exists for route.find — the drawer says so and
// links to the Algorithm Lab instead of inventing step counts.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { engineClient } from '../engine/client';
import { ROADS, formatMetres, formatSeconds, formatInr, networkPayload, vertexName } from '../data/dataset';
import { useTraffic } from '../traffic';
import { DemoEvalSchema } from '../demo/scenario';

export interface ExplainArc {
  arcId: string;
  from: string;
  to: string;
}

export interface ExplainAlt {
  label: string;
  timeS: number;
  distanceM: number;
  tollInr: number;
  arcs: string[];
}

interface ExplainDrawerProps {
  open: boolean;
  onClose: () => void;
  testid: string;
  source: string;
  target: string;
  objective: string;
  algorithm: string | null;
  arcs: ExplainArc[];
  vertices: string[];
  totals: { timeS: number; distanceM: number; tollInr: number };
  alternatives: ExplainAlt[];
}

interface EdgeRow {
  arcId: string;
  from: string;
  to: string;
  roadName: string;
  distanceM: number;
  baselineS: number;
  effectiveS: number | null;
  toll: number;
  closed: boolean;
  congested: boolean;
}

function roadOf(arcId: string): string {
  return arcId.split(':')[0] ?? arcId;
}

export default function ExplainDrawer(p: ExplainDrawerProps) {
  const overlayOf = useTraffic((s) => s.overlay);
  const closures = useTraffic((s) => s.closures);
  const incidents = useTraffic((s) => s.incidents);
  const factors = useTraffic((s) => s.factors);
  const [rows, setRows] = useState<EdgeRow[] | null>(null);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (!p.open) {
      setRows(null);
      setError('');
      return;
    }
    const my = ++seq.current;
    const overlay = overlayOf();
    const badRoads = new Set([...closures, ...incidents.map((i) => i.road)]);
    (async () => {
      try {
        const out: EdgeRow[] = [];
        for (const a of p.arcs) {
          const roadId = roadOf(a.arcId);
          const road = ROADS.find((r) => r.id === roadId);
          const o = await engineClient.call('route.evaluate', {
            network: networkPayload(), overlay, objective: p.objective,
            plan: { arcs: [a.arcId], source: a.from },
          }, { channel: 'explain' });
          if (my !== seq.current) return;
          if (o.stale) return;
          const ev = DemoEvalSchema.parse(o.result);
          out.push({
            arcId: a.arcId, from: a.from, to: a.to,
            roadName: road?.name ?? roadId,
            distanceM: road?.distanceM ?? ev.distanceM,
            baselineS: road?.baselineTimeS ?? 0,
            effectiveS: ev.valid && !ev.blocked ? ev.timeS : null,
            toll: road?.tollInr ?? 0,
            closed: closures.includes(roadId) || (ev.valid && ev.blocked),
            congested: (badRoads.has(roadId) || (factors[roadId] ?? 1000) < 1000) && !closures.includes(roadId),
          });
        }
        if (my !== seq.current) return;
        setRows(out);
      } catch (e) {
        if (my !== seq.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  if (!p.open) return null;
  const sumTime = rows?.reduce((x, r) => x + (r.effectiveS ?? 0), 0) ?? null;
  const sumDist = rows?.reduce((x, r) => x + r.distanceM, 0) ?? null;
  const sumToll = rows?.reduce((x, r) => x + r.toll, 0) ?? null;
  const blocked = rows?.some((r) => r.effectiveS === null) ?? false;
  const timeMatch = sumTime !== null && !blocked && sumTime === p.totals.timeS;
  const distMatch = sumDist !== null && sumDist === p.totals.distanceM;

  return (
    <div className="pf-dialog-back" data-testid={`${p.testid}-dialog`} onClick={p.onClose}>
      <div className="pf-dialog pf-dialog-wide" role="dialog" aria-modal="true" aria-label="Why this route"
        data-testid={`${p.testid}-drawer`} onClick={(e) => e.stopPropagation()}>
        <h2>Why this route?</h2>
        <p data-testid={`${p.testid}-header`}>
          {vertexName(p.source)} → {vertexName(p.target)} · {p.objective}
          {p.algorithm ? <> · {p.algorithm}</> : null} · {p.arcs.length} segments
        </p>
        <p className="pf-meta" data-testid={`${p.testid}-vertices`}>
          {p.vertices.map(vertexName).join(' → ')}
        </p>
        {error && <div className="pf-alert error" role="alert">{error}</div>}
        {!rows && !error && <p className="pf-meta">Evaluating each directed edge with the C++ engine…</p>}
        {rows && (
          <table data-testid={`${p.testid}-edges`}>
            <caption>Per-edge costs under overlay v{overlayOf().version} (engine-evaluated)</caption>
            <thead>
              <tr>
                <th scope="col">Edge</th><th scope="col">Road</th><th scope="col">Dist</th>
                <th scope="col">Base</th><th scope="col">Effective</th><th scope="col">Toll</th><th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.arcId} data-testid={`${p.testid}-edge-${r.arcId}`}
                  data-seconds={r.effectiveS ?? -1} data-metres={r.distanceM}>
                  <th scope="row">{vertexName(r.from)} → {vertexName(r.to)}</th>
                  <td>{r.roadName} ({roadOf(r.arcId)})</td>
                  <td>{formatMetres(r.distanceM)}</td>
                  <td>{formatSeconds(r.baselineS)}</td>
                  <td>{r.effectiveS === null ? 'blocked' : formatSeconds(r.effectiveS)}</td>
                  <td>{formatInr(r.toll)}</td>
                  <td>{r.closed ? 'closed' : r.congested ? 'congested' : 'open'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid={`${p.testid}-sums`}
                data-sum-seconds={sumTime ?? -1} data-total-seconds={p.totals.timeS}
                data-sum-metres={sumDist ?? -1} data-total-metres={p.totals.distanceM}>
                <th scope="row" colSpan={2}>Sums vs engine route total</th>
                <td>{sumDist === null ? '—' : formatMetres(sumDist)}</td>
                <td>—</td>
                <td>{sumTime === null ? '—' : blocked ? 'route blocked' : formatSeconds(sumTime)}</td>
                <td>{sumToll === null ? '—' : formatInr(sumToll)}</td>
                <td data-testid={`${p.testid}-match`}>
                  {timeMatch && distMatch ? 'match ✓' : blocked ? 'blocked segment' : 'MISMATCH'}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        {p.alternatives.length > 0 && (
          <div>
            <h3>Engine alternatives (Yen K-shortest)</h3>
            <ul data-testid={`${p.testid}-alts`}>
              {p.alternatives.map((a, i) => (
                <li key={i}>
                  {a.label}: {formatSeconds(a.timeS)} ({a.timeS >= p.totals.timeS ? '+' : ''}
                  {formatSeconds(a.timeS - p.totals.timeS)}) · {formatMetres(a.distanceM)} ·{' '}
                  {formatInr(a.tollInr)} · {a.arcs.length} segments
                </li>
              ))}
            </ul>
          </div>
        )}
        <h3>How the engine chose</h3>
        <ul>
          <li>Dijkstra over directed road arcs with nonnegative weights (effective seconds for {p.objective});
            optimal for the modeled weights, not a prediction of real traffic.</li>
          <li>A* uses the same weights plus an admissible straight-line heuristic when a heuristic is available.</li>
          <li>Alternatives come from Yen K-shortest-paths over the same engine weights.</li>
          <li>Per-route search traces are not recorded by route.find; explore live traces in{' '}
            <Link to="/lab" onClick={p.onClose}>Algorithm Lab</Link> (BFS/DFS/Dijkstra/A*/MST).</li>
        </ul>
        <div className="pf-row">
          <button className="pf-btn" onClick={p.onClose} data-testid={`${p.testid}-close`}>Close</button>
        </div>
      </div>
    </div>
  );
}
