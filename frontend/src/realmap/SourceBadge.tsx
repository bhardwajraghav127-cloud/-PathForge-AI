// Map Source badge (R1): honest data provenance for Real Roads mode.
// Wired to real pipeline metadata in R2; until then it states coverage TBD.
export interface SourceMeta {
  origin: string;
  coverage: string;
  offline: string;
  freshness: string;
}

export const PENDING_META: SourceMeta = {
  origin: 'OpenStreetMap extract (pending R2 import)',
  coverage: 'Coverage TBD — Simulation Network remains fully available',
  offline: 'Local style: yes · Road data: pending',
  freshness: 'Not yet imported',
};

export default function SourceBadge({ meta, testid = 'source-badge' }: { meta: SourceMeta; testid?: string }) {
  return (
    <section className="pf-card" aria-label="Map source and offline status" data-testid={testid}>
      <h2>Map Source &amp; Offline Status</h2>
      <dl className="pf-facts">
        <dt>Data origin</dt><dd data-testid={`${testid}-origin`}>{meta.origin}</dd>
        <dt>Coverage</dt><dd data-testid={`${testid}-coverage`}>{meta.coverage}</dd>
        <dt>Offline</dt><dd data-testid={`${testid}-offline`}>{meta.offline}</dd>
        <dt>Freshness</dt><dd data-testid={`${testid}-freshness`}>{meta.freshness}</dd>
      </dl>
    </section>
  );
}
