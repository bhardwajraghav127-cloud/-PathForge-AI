// RealMap (R1): MapLibre GL with a FULLY LOCAL style — background plus
// pipeline-generated GeoJSON sources. Zero tile servers, zero keys, works
// offline. An optional CARTO raster basemap can be toggled explicitly
// (requires network, fails gracefully back to local-only).
import { useEffect, useRef, useState } from 'react';
import {
  Map as MLMap, NavigationControl, ScaleControl, config,
  type ErrorEvent, type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Point MapLibre at its worker through Vite's asset pipeline so the file is
// emitted into dist (offline-safe, same-origin, no CDN).
config.WORKER_URL = workerUrl;

export interface RealMapProps {
  testid?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  mapOut?: React.MutableRefObject<MLMap | null>;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  children?: React.ReactNode;
}

const CARTO_URL = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

function localStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'pathforge-local',
    glyphs: undefined,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e8ede9' } },
    ],
  };
}

export default function RealMap(props: RealMapProps) {
  const { testid = 'realmap', initialCenter = [77.2, 28.6], initialZoom = 11 } = props;
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [onlineBase, setOnlineBase] = useState(false);
  const [onlineFailed, setOnlineFailed] = useState(false);
  const clickRef = useRef(props.onMapClick);
  clickRef.current = props.onMapClick;

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    let map: MLMap;
    try {
      map = new MLMap({
        container: el,
        style: localStyle(),
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: {
          compact: true,
          customAttribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        },
      });
    } catch {
      setStatus('error');
      return;
    }
    mapRef.current = map;
    if (props.mapOut) props.mapOut.current = map;
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new ScaleControl({}), 'bottom-left');
    map.on('load', () => setStatus('ready'));
    // Failure = style never loads (WebGL/context). Benign map 'error'
    // events must not trip this, so use a load deadline instead.
    const deadline = window.setTimeout(() => {
      if (!mapRef.current?.isStyleLoaded()) setStatus('error');
    }, 15000);
    map.on('click', (e) => clickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    const ro = new ResizeObserver(() => map?.resize());
    ro.observe(el);
    return () => {
      window.clearTimeout(deadline);
      ro.disconnect();
      map?.remove();
      mapRef.current = null;
      if (props.mapOut) props.mapOut.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional online basemap: explicit toggle only, reverts on any tile error.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    if (!onlineBase) {
      if (map.getLayer('carto-base')) map.removeLayer('carto-base');
      if (map.getSource('carto')) map.removeSource('carto');
      return;
    }
    setOnlineFailed(false);
    try {
      map.addSource('carto', {
        type: 'raster',
        tiles: [CARTO_URL],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
        maxzoom: 19,
      });
      const first = map.getStyle().layers?.[0]?.id;
      map.addLayer({ id: 'carto-base', type: 'raster', source: 'carto' }, first);
    } catch {
      setOnlineFailed(true);
      setOnlineBase(false);
    }
    const onErr = (e: ErrorEvent) => {
      if (String(e.error?.message ?? e).includes('carto') || !navigator.onLine) {
        setOnlineFailed(true);
        setOnlineBase(false);
      }
    };
    map.on('error', onErr);
    return () => {
      map.off('error', onErr);
    };
  }, [onlineBase, status]);

  return (
    <div className="pf-realone" data-testid={testid} style={{ position: 'relative', height: '100%' }}>
      <div ref={divRef} data-testid={`${testid}-canvas`}
        aria-label="Real road map. Arrow keys pan, plus and minus zoom."
        style={{ position: 'absolute', inset: 0 }} />
      {status === 'loading' && (
        <p className="pf-meta" data-testid={`${testid}-loading`}
          style={{ position: 'absolute', top: 8, left: 8 }}>Loading map…</p>
      )}
      {status === 'error' && (
        <div className="pf-alert error" role="alert" data-testid={`${testid}-error`}
          style={{ position: 'absolute', top: 8, left: 8, right: 8 }}>
          Map failed to start (WebGL unavailable?). Simulation mode is unaffected.
        </div>
      )}
      {props.children}
      <div className="pf-row" style={{ position: 'absolute', bottom: 28, left: 8 }}>
        <label className="pf-check" style={{ background: 'var(--pf-paper)', padding: '2px 8px', borderRadius: 6 }}>
          <input type="checkbox" checked={onlineBase}
            onChange={(e) => setOnlineBase(e.target.checked)}
            data-testid={`${testid}-onlinebase`} />
          Online basemap (CARTO, needs network)
        </label>
      </div>
      {onlineFailed && (
        <p className="pf-meta" role="status" data-testid={`${testid}-offline-note`}
          style={{ position: 'absolute', bottom: 64, left: 8, background: 'var(--pf-paper)', padding: '2px 8px' }}>
          Online basemap unreachable — showing local road data.
        </p>
      )}
    </div>
  );
}
