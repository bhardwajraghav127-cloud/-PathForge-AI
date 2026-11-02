// RealMap (R1): MapLibre GL with a FULLY LOCAL style — background plus
// pipeline-generated GeoJSON sources. Zero tile servers, zero keys, works
// offline. An optional CARTO raster basemap can be toggled explicitly
// (requires network, fails gracefully back to local-only).
import { useEffect, useRef, useState } from 'react';
import {
  Map as MLMap, Marker, NavigationControl, ScaleControl, config,
  type ErrorEvent, type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection as GeoFC } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';

// Point MapLibre at its worker through Vite's asset pipeline so the file is
// emitted into dist (offline-safe, same-origin, no CDN).
config.WORKER_URL = workerUrl;

export interface LineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { class: string; name: string };
}
export interface PointFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { name: string };
}
export interface FeatureSet {
  type: 'FeatureCollection';
  features: (LineFeature | PointFeature)[];
}

export interface MapLabel {
  lng: number;
  lat: number;
  text: string;
  kind: 'place' | 'road';
}

export interface RealMapProps {
  testid?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  fitBounds?: [[number, number], [number, number]];
  roads?: FeatureSet | null;
  labels?: MapLabel[] | null;
  mapOut?: React.MutableRefObject<MLMap | null>;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  children?: React.ReactNode;
}

const CARTO_URL = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

function localStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'pathforge-local',
    // No glyphs URL: labels render as local HTML markers (offline-safe).
    // This keeps every byte of the style + data same-origin.
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
    map.on('load', () => {
      setStatus('ready');
      if (props.fitBounds) {
        map.fitBounds(props.fitBounds, { padding: 24, animate: false });
      }
    });
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

  // Local road + place layers from pipeline GeoJSON (no network involved).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !props.roads) return;
    const addRoads = () => {
      if (map.getSource('roads')) return;
      map.addSource('roads', { type: 'geojson', data: props.roads as unknown as GeoFC });
      map.addLayer({
        id: 'roads-casing', type: 'line', source: 'roads',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 7],
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'roads-fill', type: 'line', source: 'roads',
        paint: {
          'line-color': [
            'match', ['get', 'class'],
            'motorway', '#e8a13d', 'trunk', '#eab54d', 'primary', '#f2cf5b',
            'secondary', '#f5dd7e', '#cfd6d2',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 4.5],
        },
      });
    };
    if (map.isStyleLoaded()) addRoads();
    else map.once('load', addRoads);
  }, [status, props.roads]);

  // HTML marker labels (places + major roads): fully local, no font server.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !props.labels) return;
    const markers: { marker: Marker; el: HTMLElement; minZoom: number }[] = [];
    for (const l of props.labels) {
      const el = document.createElement('div');
      el.className = `pf-maplabel${l.kind === 'place' ? ' place' : ''}`;
      el.textContent = l.text;
      el.setAttribute('aria-hidden', 'true');
      const marker = new Marker({ element: el, anchor: 'center' })
        .setLngLat([l.lng, l.lat])
        .addTo(map);
      markers.push({ marker, el, minZoom: l.kind === 'place' ? 11.5 : 14 });
    }
    const update = () => {
      const z = map.getZoom();
      for (const m of markers) m.el.style.display = z >= m.minZoom ? '' : 'none';
    };
    update();
    map.on('zoom', update);
    return () => {
      map.off('zoom', update);
      for (const m of markers) m.marker.remove();
    };
  }, [status, props.labels]);

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
