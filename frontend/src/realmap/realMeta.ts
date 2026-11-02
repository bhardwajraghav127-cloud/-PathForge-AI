// Real Delhi metadata (R2) — mirrors docs/REAL_DELHI_PROVENANCE.md.
import type { SourceMeta } from './SourceBadge';

export const REAL_META: SourceMeta = {
  origin: 'OpenStreetMap © contributors (ODbL) via BBBike NewDelhi extract, 2026-11-01',
  coverage: 'New Delhi demo bbox 28.60–28.65 N, 77.20–77.25 E · 7,052 vertices · 9,423 directed roads · 596 km',
  offline: 'Fully local: graph + geometry + gazetteer bundled, no network needed',
  freshness: 'Extract 2026-11-01 · built 2026-11-03 · pipeline scripts/osm_build_graph.py',
};
