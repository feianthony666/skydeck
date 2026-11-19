import L from 'leaflet';
import {
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AIRPORT_CATALOG, type RegionPreset} from '../data/aviationCatalog';
import {apiFetchJson, DEFAULT_CF_WORKER_URL} from '../services/directAviationClient';
import {
  buildFr24AircraftSvg,
  getDbFlagMeta,
  getEmergencySquawkMeta,
  resolveFr24ModelClass,
} from './aircraftIcons';
import type {
  AirfieldSurfaceData,
  AirportDisruption,
  AirportMarker,
  AirportWeather,
  FlightDetail,
  HazardCategory,
  LiveFlight,
  RadarSettings,
  RainViewerMeta,
  SigmetHazard,
} from '../types/aviation';
import {Button} from './ui/button';
import {Popover, PopoverContent, PopoverTrigger} from './ui/popover';
import {Separator} from './ui/separator';

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  planeSize: 20,
  basemapStyle: 'auto',
  flightPathMode: 'all',
  locateMeEnabled: false,
  timeDisplayMode: 'airport',
  showPlaneLabels: false,
  showMetarDots: true,
  showSigmets: true,
  showTurbHazards: true,
  showIceHazards: true,
  showAdvisoryHazards: true,
  showRadar: false,
  radarOpacity: 0.5,
  showGroundTraffic: true,
  showDrRings: true,
  preferNoWorkerMode: false,
  apiBaseUrl: '',
  cfWorkerUrl: DEFAULT_CF_WORKER_URL,
};

const BASEMAP_LABEL: Record<RadarSettings['basemapStyle'], string> = {
  auto: 'Auto Map',
  light: 'Light Map',
  dark: 'Dark Map',
  osm: 'OSM Street',
  satellite: 'Satellite',
};

export const RadarSettingsPopover: React.FC<{
  settings: RadarSettings;
  onUpdateSettings: (patch: Partial<RadarSettings>) => void;
  onResetSettings: () => void;
}> = ({settings, onUpdateSettings, onResetSettings}) => (
  <Popover>
    <PopoverTrigger
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-secondary px-3.5 text-xs font-medium text-secondary-foreground hover:bg-accent transition-all cursor-pointer whitespace-nowrap shrink-0"
      aria-label="Open radar settings"
    >
      <SlidersHorizontal className="w-3.5 h-3.5" />
      Settings
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="center"
      className="w-[min(340px,calc(100vw-24px))] rounded-2xl p-4 space-y-4 max-h-[75vh] overflow-y-auto shadow-xl"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Radar & Overlay Settings</h3>
          <p className="text-[11px] text-muted-foreground">Customize aircraft scale, times & layers</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onResetSettings}>
          <RotateCcw className="w-3 h-3" />
          Reset
        </Button>
      </div>

      <Separator />

      {/* Airplane Size Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">Airplane Icon Size</span>
          <span className="font-mono font-semibold text-primary tabular-nums">{settings.planeSize} px</span>
        </div>
        <input
          type="range"
          min={14}
          max={34}
          step={2}
          value={settings.planeSize}
          onChange={(e) => onUpdateSettings({planeSize: Number(e.target.value)})}
          aria-label="Airplane icon size"
          className="w-full accent-[#13233a] dark:accent-sky-400 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>Compact (14px)</span>
          <span>Standard (20px)</span>
          <span>Large (34px)</span>
        </div>
      </div>

      {/* Flight Path Mode */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-foreground">Flown Route Paths (FOV Only)</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['all', 'selected', 'off'] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={settings.flightPathMode === mode ? 'default' : 'outline'}
              onClick={() => onUpdateSettings({flightPathMode: mode})}
            >
              {mode === 'all' ? 'All Planes' : mode === 'selected' ? 'Selected' : 'Off'}
            </Button>
          ))}
        </div>
      </div>

      {/* Schedule Time Synchronization */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-foreground">Airport Board Timezone</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              {id: 'airport', label: 'Airport'},
              {id: 'local', label: 'My Local'},
              {id: 'utc', label: 'UTC'},
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              variant={settings.timeDisplayMode === opt.id ? 'default' : 'outline'}
              onClick={() => onUpdateSettings({timeDisplayMode: opt.id})}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Map Basemap */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-foreground">Map Basemap</div>
        <div className="flex flex-wrap gap-1.5">
          {(['auto', 'light', 'dark', 'osm', 'satellite'] as const).map((style) => (
            <Button
              key={style}
              size="sm"
              variant={settings.basemapStyle === style ? 'default' : 'outline'}
              onClick={() => onUpdateSettings({basemapStyle: style})}
            >
              {BASEMAP_LABEL[style]}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Map Overlay & Locate Toggles */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-foreground">Map Overlays &amp; Hazards</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              {key: 'locateMeEnabled', label: 'Locate Me'},
              {key: 'showPlaneLabels', label: 'Plane Labels'},
              {key: 'showMetarDots', label: 'METAR Colors'},
              {key: 'showSigmets', label: 'WX Hazards'},
              {key: 'showTurbHazards', label: 'Turbulence'},
              {key: 'showIceHazards', label: 'Icing Zones'},
              {key: 'showAdvisoryHazards', label: 'Advisories/TFR'},
              {key: 'showGroundTraffic', label: 'Ground Traffic'},
              {key: 'showDrRings', label: 'DR Rings'},
              {key: 'showRadar', label: 'Precip Radar'},
            ] as const
          ).map((item) => {
            const active = Boolean(settings[item.key]);
            return (
              <Button
                key={item.key}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => onUpdateSettings({[item.key]: !active})}
                className="justify-start"
              >
                {item.label}
              </Button>
            );
          })}
        </div>
      </div>

      {settings.showRadar && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Radar Opacity</span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {Math.round(settings.radarOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.2}
            max={0.9}
            step={0.05}
            value={settings.radarOpacity}
            onChange={(e) => onUpdateSettings({radarOpacity: Number(e.target.value)})}
            aria-label="Precipitation radar opacity"
            className="w-full accent-[#13233a] dark:accent-sky-400 cursor-pointer"
          />
        </div>
      )}

      <Separator />

      {/* Restricted-WiFi / No-Worker Direct CORS Mode */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-foreground">Strict Wi-Fi / No-Worker Mode</div>
            <div className="text-[10.5px] text-muted-foreground leading-tight">
              Bypass .workers.dev relays using direct ADS-B, OpenSky &amp; live snapshots
            </div>
          </div>
          <Button
            size="sm"
            variant={settings.preferNoWorkerMode ? 'default' : 'outline'}
            onClick={() => onUpdateSettings({preferNoWorkerMode: !settings.preferNoWorkerMode})}
          >
            {settings.preferNoWorkerMode ? 'Enabled' : 'Off'}
          </Button>
        </div>
      </div>

      {/* Collapsed Advanced Proxy / Worker Configuration */}
      <details className="rounded-lg border border-border bg-secondary/35 px-2.5 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-foreground select-none">
          Advanced Proxy &amp; Worker Settings
        </summary>
        <div className="mt-2.5 space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-foreground">Cloudflare Worker URL</span>
              <span className="text-[10px] text-muted-foreground font-mono">Optional</span>
            </div>
            <input
              type="url"
              value={settings.cfWorkerUrl ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                onUpdateSettings({cfWorkerUrl: val});
                try {
                  const clean = val.trim().replace(/\/+$/, '');
                  if (clean) window.localStorage.setItem('skydeck-cf-worker', clean);
                  else window.localStorage.removeItem('skydeck-cf-worker');
                } catch {
                  // ignore
                }
              }}
              placeholder={DEFAULT_CF_WORKER_URL}
              aria-label="Cloudflare Worker CORS proxy URL"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-foreground">Custom Backend Relay</span>
              <span className="text-[10px] text-muted-foreground font-mono">Node / Netlify</span>
            </div>
            <input
              type="url"
              value={settings.apiBaseUrl ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                onUpdateSettings({apiBaseUrl: val});
                try {
                  const clean = val.trim().replace(/\/+$/, '');
                  if (clean) window.localStorage.setItem('skydeck-api-base', clean);
                  else window.localStorage.removeItem('skydeck-api-base');
                } catch {
                  // ignore storage errors
                }
              }}
              placeholder="Optional https://your-site.netlify.app"
              aria-label="Custom SkyDeck API relay URL"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </details>
    </PopoverContent>
  </Popover>
);

interface RadarMapProps {
  flights: LiveFlight[];
  selectedFlight: LiveFlight | null;
  selectedDetail: FlightDetail | null;
  selectedAirportIcao?: string | null;
  mapAirports?: AirportMarker[];
  airports: AirportWeather[];
  sigmets: SigmetHazard[];
  disruptions?: AirportDisruption[];
  rainviewer: RainViewerMeta | null;
  activeRegion: RegionPreset;
  theme: 'dark' | 'light';
  loading?: boolean;
  plannedRoute?: {originLat: number; originLon: number; destLat: number; destLon: number} | null;
  userLocation?: {lat: number; lon: number; label?: string} | null;
  flyToLocation?: {lat: number; lon: number; zoom?: number; seq: number} | null;
  followSelected?: boolean;
  isolateSelected?: boolean;
  isMobilePortrait?: boolean;
  onUserDragBreakFollow?: () => void;
  settings: RadarSettings;
  onSelectFlight: (flight: LiveFlight) => void;
  onSelectAirport: (airport: {icao: string; iata: string; name: string}) => void;
  onBoundsChange: (
    bounds: {lamin: number; lomin: number; lamax: number; lomax: number},
    zoom: number,
  ) => void;
}

const FLT_CAT_COLOR: Record<string, string> = {
  VFR: '#16A34A',
  MVFR: '#0284C7',
  IFR: '#DC2626',
  LIFR: '#C026D3',
  UNK: '#64748B',
};

// GeoFS inline NAV map altitude gradient stops (applied strictly to flight paths only)
const GEOFS_ALT_STOPS: Array<{altFt: number; rgb: [number, number, number]}> = [
  {altFt: 0, rgb: [250, 204, 21]},      // #FACC15 Yellow
  {altFt: 10000, rgb: [34, 197, 94]},   // #22C55E Green
  {altFt: 25000, rgb: [37, 99, 235]},   // #2563EB Blue
  {altFt: 30000, rgb: [124, 92, 191]},  // #7C5CBF Grayish-Purple
  {altFt: 40000, rgb: [190, 24, 93]},   // #BE185D Purple-Red
  {altFt: 50000, rgb: [244, 114, 182]}, // #F472B6 Pink
];

function geofsAltitudeColor(altitudeFt: number): string {
  const alt = Math.max(0, altitudeFt);
  if (alt >= GEOFS_ALT_STOPS[GEOFS_ALT_STOPS.length - 1].altFt) {
    const [r, g, b] = GEOFS_ALT_STOPS[GEOFS_ALT_STOPS.length - 1].rgb;
    return `rgb(${r},${g},${b})`;
  }
  for (let i = 0; i < GEOFS_ALT_STOPS.length - 1; i++) {
    const a = GEOFS_ALT_STOPS[i];
    const b = GEOFS_ALT_STOPS[i + 1];
    if (alt >= a.altFt && alt <= b.altFt) {
      const t = (alt - a.altFt) / (b.altFt - a.altFt);
      const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t);
      const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t);
      const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return '#FACC15';
}

type TrailPt = {lat: number; lon: number; altFt: number};

/**
 * Flightdeck-inspired path sanitizer:
 * 1) Filters outlier transponder/squawk teleports (>0.32 deg jump) & acute jitter spikes.
 * 2) Pins live aircraft coordinates [flight.lat, flight.lon] as the exact trail endpoint.
 * 3) Applies 2-pass Chaikin corner-cutting smoothing for fluid taxi & enroute turns.
 * 4) Clips segments strictly inside mapBounds so zero geometry renders outside the FOV.
 */
function sanitizeAndSmoothTrail(
  rawPoints: TrailPt[],
  flight: LiveFlight,
  mapBounds?: L.LatLngBounds,
): TrailPt[][] {
  const filtered: TrailPt[] = [];
  for (const pt of rawPoints) {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
    const prev = filtered[filtered.length - 1];
    if (prev) {
      const dist = Math.hypot(pt.lat - prev.lat, pt.lon - prev.lon);
      if (dist < 0.0002 || dist > 0.32) continue;
    }
    filtered.push(pt);
  }

  // Always sync trail tip directly to live aircraft position
  const liveTip: TrailPt = {lat: flight.lat, lon: flight.lon, altFt: flight.altitudeFt};
  const lastFiltered = filtered[filtered.length - 1];
  if (
    !lastFiltered ||
    Math.hypot(liveTip.lat - lastFiltered.lat, liveTip.lon - lastFiltered.lon) < 0.32
  ) {
    if (
      !lastFiltered ||
      Math.hypot(liveTip.lat - lastFiltered.lat, liveTip.lon - lastFiltered.lon) > 0.00005
    ) {
      filtered.push(liveTip);
    } else {
      filtered[filtered.length - 1] = liveTip;
    }
  }

  if (filtered.length < 2) return [];

  // Remove acute micro-spike reversals (>140 deg reversal over tiny span)
  const despiked: TrailPt[] = [filtered[0]];
  for (let i = 1; i < filtered.length - 1; i++) {
    const a = despiked[despiked.length - 1];
    const b = filtered[i];
    const c = filtered[i + 1];
    const v1x = b.lon - a.lon;
    const v1y = b.lat - a.lat;
    const v2x = c.lon - b.lon;
    const v2y = c.lat - b.lat;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    if (m1 > 0 && m2 > 0 && m1 < 0.04 && m2 < 0.04) {
      const cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
      if (cos < -0.78) continue;
    }
    despiked.push(b);
  }
  despiked.push(filtered[filtered.length - 1]);
  if (despiked.length < 2) return [];

  // Clip strictly to viewport bounds (split into continuous in-FOV polylines)
  const chains: TrailPt[][] = [];
  if (!mapBounds) {
    chains.push(despiked);
  } else {
    let current: TrailPt[] = [];
    for (const pt of despiked) {
      if (mapBounds.contains([pt.lat, pt.lon])) {
        current.push(pt);
      } else if (current.length > 0) {
        if (current.length >= 2) chains.push(current);
        current = [];
      }
    }
    if (current.length >= 2) chains.push(current);
  }

  // Chaikin curve smoothing (2 passes, endpoints pinned)
  return chains.map((pts) => {
    let curr = pts;
    for (let pass = 0; pass < 2; pass++) {
      if (curr.length < 3) break;
      const next: TrailPt[] = [curr[0]];
      for (let i = 0; i < curr.length - 1; i++) {
        const p0 = curr[i];
        const p1 = curr[i + 1];
        next.push({
          lat: 0.75 * p0.lat + 0.25 * p1.lat,
          lon: 0.75 * p0.lon + 0.25 * p1.lon,
          altFt: 0.75 * p0.altFt + 0.25 * p1.altFt,
        });
        next.push({
          lat: 0.25 * p0.lat + 0.75 * p1.lat,
          lon: 0.25 * p0.lon + 0.75 * p1.lon,
          altFt: 0.25 * p0.altFt + 0.75 * p1.altFt,
        });
      }
      next.push(curr[curr.length - 1]);
      curr = next;
    }
    return curr;
  });
}

function drawAltitudeGradientPath(
  layer: L.LayerGroup,
  renderer: L.Canvas,
  points: TrailPt[],
  weight: number,
  opacity: number,
) {
  if (points.length < 2) return;
  let segCoords: Array<[number, number]> = [[points[0].lat, points[0].lon]];
  let currentBand = Math.round(points[0].altFt / 1800);
  let currentColor = geofsAltitudeColor(points[0].altFt);

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const avgAlt = (points[i - 1].altFt + pt.altFt) * 0.5;
    const band = Math.round(avgAlt / 1800);
    if (band !== currentBand && segCoords.length >= 2) {
      L.polyline(segCoords, {
        renderer,
        color: currentColor,
        weight,
        opacity,
        smoothFactor: 1.2,
        interactive: false,
      }).addTo(layer);
      segCoords = [segCoords[segCoords.length - 1]];
      currentBand = band;
      currentColor = geofsAltitudeColor(avgAlt);
    }
    segCoords.push([pt.lat, pt.lon]);
  }

  if (segCoords.length >= 2) {
    L.polyline(segCoords, {
      renderer,
      color: currentColor,
      weight,
      opacity,
      smoothFactor: 1.2,
      interactive: false,
    }).addTo(layer);
  }
}

// Cached offscreen Canvas2D sprite stamps for zero-lag 60fps rendering of 2,500+ FR24 aircraft
const planeSpriteCache = new Map<string, HTMLImageElement>();
let onSpriteLoadedRedraw: (() => void) | null = null;

function getPlaneSprite(
  modelClass: ReturnType<typeof resolveFr24ModelClass>,
  size: number,
  fill: string,
  stroke: string,
): HTMLImageElement | null {
  const bucketSize = Math.round(size / 2) * 2;
  const key = `${modelClass}|${bucketSize}|${fill}|${stroke}`;
  const existing = planeSpriteCache.get(key);
  if (existing) {
    return existing.complete && existing.naturalWidth > 0 ? existing : null;
  }
  const rawSvg = buildFr24AircraftSvg(modelClass, bucketSize * 2, fill, stroke);
  const svg = rawSvg.includes('xmlns=')
    ? rawSvg
    : rawSvg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  const img = new Image();
  img.onload = () => {
    onSpriteLoadedRedraw?.();
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  planeSpriteCache.set(key, img);
  return img.complete && img.naturalWidth > 0 ? img : null;
}

interface PooledFlightState {
  flight: LiveFlight;
  renderLat: number;
  renderLon: number;
  renderTrack: number;
  fromLat: number;
  fromLon: number;
  fromTrack: number;
  targetLat: number;
  targetLon: number;
  targetTrack: number;
  blendStartMs: number;
  blendDurationMs: number;
  lastUpdateMs: number;
}

interface CanvasHitTarget {
  x: number;
  y: number;
  r: number;
  flight: LiveFlight;
}

function makeAirportIcon(
  codeLabel: string,
  catColor: string,
  isSelected: boolean,
  showMetarDot: boolean,
  tier: 1 | 2 | 3 = 1,
): L.DivIcon {
  const dotBg = showMetarDot ? catColor : '#13233a';
  const dotSize = isSelected ? 14 : tier === 1 ? 11 : tier === 2 ? 9 : 7;
  const pinHtml = `<div style="width:${dotSize}px;height:${dotSize}px;border-radius:9999px;background:${
    isSelected ? '#F59E0B' : dotBg
  };border:2px solid #ffffff;box-shadow:0 1px 4px rgba(19,35,58,0.45);flex-shrink:0;"></div>`;

  const fontSize = tier === 3 ? 9 : 10;
  const labelHtml = `<span style="margin-left:4px;padding:1px ${tier === 3 ? 5 : 6}px;border-radius:9999px;font-family:'JetBrains Mono',monospace;font-size:${fontSize}px;font-weight:${
    tier === 1 ? 700 : 600
  };letter-spacing:0.02em;white-space:nowrap;background:${
    isSelected ? '#13233a' : 'rgba(242,247,254,0.95)'
  };color:${isSelected ? '#ffffff' : '#13233a'};border:1px solid ${
    isSelected ? '#F59E0B' : 'rgba(19,35,58,0.28)'
  };box-shadow:0 1px 3px rgba(19,35,58,0.18);">${codeLabel}</span>`;

  return L.divIcon({
    className: 'skydeck-airport-label',
    iconSize: [72, 20],
    iconAnchor: [dotSize / 2, 10],
    html: `<div style="display:inline-flex;align-items:center;cursor:pointer;">${pinHtml}${labelHtml}</div>`,
  });
}

function computeBearingDeg(p1: [number, number], p2: [number, number]): number {
  const toRad = Math.PI / 180;
  const lat1 = p1[0] * toRad;
  const lat2 = p2[0] * toRad;
  const dLon = (p2[1] - p1[1]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function deriveRunwayEndLabels(ref: string | undefined, bearingDeg: number): [string, string] {
  if (ref && ref.includes('/')) {
    const parts = ref.split('/').map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) {
      const m = parts[0].match(/^(\d{1,2})/);
      if (m) {
        const expectedBearing = (parseInt(m[1], 10) % 36) * 10;
        const diff = Math.abs((((bearingDeg - expectedBearing) + 540) % 360) - 180);
        // If OSM way was drawn opposite to the first runway number's landing direction, swap threshold ends!
        if (diff > 90) return [parts[1], parts[0]];
      }
      return [parts[0], parts[1]];
    }
  }
  const num = Math.max(1, Math.min(36, Math.round(bearingDeg / 10) || 36));
  const opp = num > 18 ? num - 18 : num + 18;
  return [String(num).padStart(2, '0'), String(opp).padStart(2, '0')];
}

function offsetLatLonMeters(
  lat: number,
  lon: number,
  bearingDeg: number,
  metersForward: number,
  metersRight: number,
): [number, number] {
  const b = (bearingDeg * Math.PI) / 180;
  const northM = Math.cos(b) * metersForward - Math.sin(b) * metersRight;
  const eastM = Math.sin(b) * metersForward + Math.cos(b) * metersRight;
  const dLat = northM / 111320;
  const dLon = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

function metersPerPixelAtLatZoom(lat: number, zoom: number): number {
  const cosLat = Math.max(0.18, Math.cos((lat * Math.PI) / 180));
  return (156543.03392 * cosLat) / Math.pow(2, zoom);
}

function pxFromMeters(meters: number, mPerPx: number, minPx: number, maxPx: number): number {
  return Math.max(minPx, Math.min(maxPx, meters / Math.max(0.05, mPerPx)));
}

function classifySigmetCategory(sig: SigmetHazard): HazardCategory {
  if (sig.category) return sig.category;
  const text = `${sig.hazard} ${sig.rawText}`.toUpperCase();
  if (/TURB|LLWS|MTW|CAT/.test(text)) return 'turbulence';
  if (/ICE|ICG|FZLVL|FZL|MIX|CLR/.test(text)) return 'icing';
  return 'advisory';
}

export const RadarMap: React.FC<RadarMapProps> = ({
  flights,
  selectedFlight,
  selectedDetail,
  selectedAirportIcao,
  mapAirports = [],
  airports,
  sigmets,
  disruptions = [],
  rainviewer,
  activeRegion,
  theme,
  loading = false,
  plannedRoute,
  userLocation,
  flyToLocation,
  followSelected = false,
  isolateSelected = false,
  isMobilePortrait = false,
  onUserDragBreakFollow,
  settings,
  onSelectFlight,
  onSelectAirport,
  onBoundsChange,
}) => {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const baseLayersRef = useRef<L.TileLayer[]>([]);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const surfaceLayerRef = useRef<L.LayerGroup | null>(null);
  const allPathsLayerRef = useRef<L.LayerGroup | null>(null);
  const flightsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const flightPoolRef = useRef<Map<string, PooledFlightState>>(new Map());
  const hitTargetsRef = useRef<CanvasHitTarget[]>([]);
  const hoverTooltipRef = useRef<HTMLDivElement | null>(null);
  const hoveredFlightIdRef = useRef<string | null>(null);
  const needsCanvasRedrawRef = useRef(true);
  const isMapZoomingRef = useRef(false);
  const drLayerRef = useRef<L.LayerGroup | null>(null);
  const sigmetLayerRef = useRef<L.LayerGroup | null>(null);
  const airportLayerRef = useRef<L.LayerGroup | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const clientTrailMapRef = useRef<Map<string, TrailPt[]>>(new Map());

  const [radarFrameIdx, setRadarFrameIdx] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [viewportTick, setViewportTick] = useState(0);
  const [mapZoom, setMapZoom] = useState(activeRegion.zoom);
  const [surfaceList, setSurfaceList] = useState<AirfieldSurfaceData[]>([]);
  const surfaceMemCacheRef = useRef<Map<string, {ts: number; data: AirfieldSurfaceData}>>(new Map());
  const lastSurfaceBatchKeyRef = useRef<string>('');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const isDarkRef = useRef(theme === 'dark');
  isDarkRef.current = theme === 'dark';

  const onBoundsRef = useRef(onBoundsChange);
  onBoundsRef.current = onBoundsChange;

  const onSelectRef = useRef(onSelectFlight);
  onSelectRef.current = onSelectFlight;

  const onSelectAirportRef = useRef(onSelectAirport);
  onSelectAirportRef.current = onSelectAirport;

  const followSelectedRef = useRef(followSelected);
  followSelectedRef.current = followSelected;

  const selectedFlightIdRef = useRef<string | null>(selectedFlight?.id ?? null);
  selectedFlightIdRef.current = selectedFlight?.id ?? null;

  const onUserDragBreakFollowRef = useRef(onUserDragBreakFollow);
  onUserDragBreakFollowRef.current = onUserDragBreakFollow;

  const isDark = theme === 'dark';

  // Accumulate client-side live breadcrumbs (rejecting outlier position teleports)
  useEffect(() => {
    const map = clientTrailMapRef.current;
    for (const f of flights) {
      const key = f.icao24 || f.id;
      const existing = map.get(key) ?? [];
      const incoming: TrailPt[] = (f.trail ?? []).map((t) => ({
        lat: t.lat,
        lon: t.lon,
        altFt: t.altFt,
      }));

      const merged = existing.length >= incoming.length ? [...existing] : [...incoming];
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({lat: f.lat, lon: f.lon, altFt: f.altitudeFt});
      } else {
        const dist = Math.hypot(f.lat - last.lat, f.lon - last.lon);
        if (dist > 0.0005 && dist < 0.32) {
          merged.push({lat: f.lat, lon: f.lon, altFt: f.altitudeFt});
        }
      }
      if (merged.length > 120) merged.splice(0, merged.length - 120);
      map.set(key, merged);
    }
  }, [flights]);

  useEffect(() => {
    const el = mapDivRef.current;
    if (!el) return;

    const canvasRenderer = L.canvas({padding: 0.25});
    canvasRendererRef.current = canvasRenderer;

    const map = L.map(el, {
      center: activeRegion.center,
      zoom: activeRegion.zoom,
      minZoom: 2,
      maxZoom: 20,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 65,
      zoomAnimation: true,
      fadeAnimation: true,
      zoomControl: false,
      preferCanvas: true,
    });

    // Subtle top-right zoom controls that don't clash with the Left Sidebar or Bottom Dock
    L.control.zoom({position: 'topright'}).addTo(map);

    const surfaceLayer = L.layerGroup().addTo(map);
    const sigmetLayer = L.layerGroup().addTo(map);
    const allPathsLayer = L.layerGroup().addTo(map);
    const drLayer = L.layerGroup().addTo(map);
    const airportLayer = L.layerGroup().addTo(map);
    const trailLayer = L.layerGroup().addTo(map);
    const userLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    surfaceLayerRef.current = surfaceLayer;
    sigmetLayerRef.current = sigmetLayer;
    allPathsLayerRef.current = allPathsLayer;
    drLayerRef.current = drLayer;
    airportLayerRef.current = airportLayer;
    trailLayerRef.current = trailLayer;
    userLayerRef.current = userLayer;

    // Dedicated HiDPI Canvas2D aircraft overlay above vector/runway layers and clickable with zero DOM node overhead
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '610';
    el.appendChild(canvas);
    flightsCanvasRef.current = canvas;

    onSpriteLoadedRedraw = () => {
      needsCanvasRedrawRef.current = true;
    };

    const existingPool = flightPoolRef.current;

    const pickHitFlight = (clientX: number, clientY: number): LiveFlight | null => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const targets = hitTargetsRef.current;
      // Search top-down (emergency / selected / airborne rendered last)
      let best: LiveFlight | null = null;
      let bestDist = Infinity;
      for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        const d = Math.hypot(t.x - x, t.y - y);
        if (d <= t.r && d < bestDist) {
          bestDist = d;
          best = t.flight;
        }
      }
      return best;
    };

    map.on('click', (ev) => {
      const targetEl = ev.originalEvent.target as HTMLElement | null;
      if (targetEl?.closest('.skydeck-airport-label')) return;
      const hit = pickHitFlight(ev.originalEvent.clientX, ev.originalEvent.clientY);
      if (hit) {
        onSelectRef.current(hit);
      }
    });

    map.on('mousemove', (ev) => {
      const tipEl = hoverTooltipRef.current;
      const targetEl = ev.originalEvent.target as HTMLElement | null;
      if (targetEl?.closest('.skydeck-airport-label')) {
        el.style.cursor = 'pointer';
        if (tipEl) tipEl.style.opacity = '0';
        hoveredFlightIdRef.current = null;
        return;
      }
      const hit = pickHitFlight(ev.originalEvent.clientX, ev.originalEvent.clientY);
      if (hit) {
        el.style.cursor = 'pointer';
        hoveredFlightIdRef.current = hit.id;
        if (tipEl) {
          const rect = el.getBoundingClientRect();
          const px = Math.min(rect.width - 210, Math.max(8, ev.originalEvent.clientX - rect.left + 14));
          const py = Math.min(rect.height - 40, Math.max(8, ev.originalEvent.clientY - rect.top - 14));
          const em = getEmergencySquawkMeta(hit.squawk);
          const db = getDbFlagMeta(hit);
          tipEl.textContent = `${em ? `[${em.shortLabel}] ` : ''}${db ? `[${db.shortLabel}] ` : ''}${
            hit.callsign
          } · ${hit.aircraftType}${
            hit.origin && hit.destination ? ` · ${hit.origin}→${hit.destination}` : ''
          } · ${hit.onGround ? 'GND' : `FL${Math.round(hit.altitudeFt / 100)}`}${
            hit.squawk ? ` · SQK ${hit.squawk}` : ''
          }`;
          tipEl.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
          tipEl.style.opacity = '1';
        }
      } else {
        el.style.cursor = '';
        if (hoveredFlightIdRef.current) {
          hoveredFlightIdRef.current = null;
          if (tipEl) tipEl.style.opacity = '0';
        }
      }
    });

    map.on('mouseout', () => {
      if (hoverTooltipRef.current) hoverTooltipRef.current.style.opacity = '0';
      hoveredFlightIdRef.current = null;
    });

    map.on('move', () => {
      needsCanvasRedrawRef.current = true;
    });
    map.on('zoom', () => {
      needsCanvasRedrawRef.current = true;
    });
    map.on('zoomstart', () => {
      isMapZoomingRef.current = true;
    });
    map.on('zoomend', () => {
      isMapZoomingRef.current = false;
      needsCanvasRedrawRef.current = true;
      setMapZoom(map.getZoom());
    });
    map.on('dragstart', () => {
      onUserDragBreakFollowRef.current?.();
    });

    let moveTimer: number | undefined;
    map.on('moveend', () => {
      const z = map.getZoom();
      setMapZoom(z);
      needsCanvasRedrawRef.current = true;
      setViewportTick((t) => t + 1);
      clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => {
        const b = map.getBounds();
        onBoundsRef.current(
          {
            lamin: Math.max(-85, b.getSouth()),
            lomin: Math.max(-180, b.getWest()),
            lamax: Math.min(85, b.getNorth()),
            lomax: Math.min(180, b.getEast()),
          },
          z,
        );
      }, 240);
    });

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      needsCanvasRedrawRef.current = true;
      setViewportTick((t) => t + 1);
    });
    ro.observe(el);

    return () => {
      clearTimeout(moveTimer);
      ro.disconnect();
      onSpriteLoadedRedraw = null;
      existingPool.clear();
      canvas.remove();
      flightsCanvasRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView(activeRegion.center, activeRegion.zoom, {animate: true});
    setMapZoom(activeRegion.zoom);
  }, [activeRegion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToLocation) return;
    const z = flyToLocation.zoom ?? 8;
    map.setView([flyToLocation.lat, flyToLocation.lon], z, {animate: true});
    setMapZoom(z);
  }, [flyToLocation]);

  useEffect(() => {
    const layer = userLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!settings.locateMeEnabled || !userLocation) return;

    L.circle([userLocation.lat, userLocation.lon], {
      radius: 18000,
      color: '#0284C7',
      weight: 1.25,
      opacity: 0.5,
      fillColor: '#38BDF8',
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(layer);

    const marker = L.circleMarker([userLocation.lat, userLocation.lon], {
      radius: 6,
      color: '#FFFFFF',
      weight: 2,
      fillColor: '#0284C7',
      fillOpacity: 1,
    });
    marker.bindTooltip(
      userLocation.label ? `Your Location · ${userLocation.label}` : 'Your Location',
      {direction: 'top', offset: [0, -8]},
    );
    marker.addTo(layer);
  }, [userLocation, settings.locateMeEnabled]);

  // Verified zero-API-key real basemap tiles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of baseLayersRef.current) {
      map.removeLayer(layer);
    }
    baseLayersRef.current = [];

    const layers: L.TileLayer[] = [];
    const effectiveStyle =
      settings.basemapStyle === 'auto'
        ? theme === 'light'
          ? 'light'
          : 'dark'
        : settings.basemapStyle;

    const tileOpts = {
      keepBuffer: 6,
      updateWhenIdle: false,
      updateWhenZooming: true,
      crossOrigin: true,
    };

    const effectiveBg = effectiveStyle === 'light' || effectiveStyle === 'osm' ? '#dce6f2' : '#0b111c';
    map.getContainer().style.backgroundColor = effectiveBg;

    if (effectiveStyle === 'satellite') {
      layers.push(
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            ...tileOpts,
            attribution: 'Tiles &copy; Esri',
            maxNativeZoom: 17,
            maxZoom: 20,
          },
        ),
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          {
            ...tileOpts,
            maxNativeZoom: 15,
            maxZoom: 20,
            opacity: 0.85,
          },
        ),
      );
    } else if (effectiveStyle === 'osm') {
      layers.push(
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          ...tileOpts,
          attribution: '&copy; OpenStreetMap contributors',
          maxNativeZoom: 18,
          maxZoom: 20,
        }),
      );
    } else if (effectiveStyle === 'light') {
      layers.push(
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          {
            ...tileOpts,
            attribution: 'Tiles &copy; Esri',
            maxNativeZoom: 16,
            maxZoom: 20,
          },
        ),
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          {
            ...tileOpts,
            maxNativeZoom: 15,
            maxZoom: 20,
          },
        ),
      );
    } else {
      layers.push(
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          {
            ...tileOpts,
            attribution: 'Tiles &copy; Esri',
            maxNativeZoom: 16,
            maxZoom: 20,
          },
        ),
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          {
            ...tileOpts,
            maxNativeZoom: 15,
            maxZoom: 20,
          },
        ),
      );
    }

    for (const l of layers) {
      l.on('tileerror', (ev: L.TileErrorEvent) => {
        if (ev.tile) ev.tile.style.display = 'none';
      });
      l.addTo(map);
      l.bringToBack();
    }
    if (layers.length > 1) {
      layers[0].bringToBack();
    }
    baseLayersRef.current = layers;
  }, [theme, settings.basemapStyle]);

  useEffect(() => {
    if (rainviewer && rainviewer.frames.length > 0) {
      setRadarFrameIdx(rainviewer.frames.length - 1);
    }
  }, [rainviewer]);

  useEffect(() => {
    if (!radarPlaying || !rainviewer || rainviewer.frames.length < 2) return;
    const id = window.setInterval(() => {
      setRadarFrameIdx((prev) => (prev + 1) % rainviewer.frames.length);
    }, 900);
    return () => clearInterval(id);
  }, [radarPlaying, rainviewer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (radarLayerRef.current) {
      map.removeLayer(radarLayerRef.current);
      radarLayerRef.current = null;
    }
    if (!settings.showRadar || !rainviewer || rainviewer.frames.length === 0) return;
    const frame = rainviewer.frames[radarFrameIdx] ?? rainviewer.frames[rainviewer.frames.length - 1];
    if (!frame) return;
    const tileUrl = `${rainviewer.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
    const radarLayer = L.tileLayer(tileUrl, {
      opacity: settings.radarOpacity,
      maxNativeZoom: 7,
      maxZoom: 20,
      attribution: 'Radar: RainViewer',
    });
    radarLayer.addTo(map);
    radarLayerRef.current = radarLayer;
  }, [settings.showRadar, settings.radarOpacity, rainviewer, radarFrameIdx]);

  useEffect(() => {
    const layer = sigmetLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!settings.showSigmets) return;

    for (const sig of sigmets) {
      const cat = classifySigmetCategory(sig);
      if (cat === 'turbulence' && !settings.showTurbHazards) continue;
      if (cat === 'icing' && !settings.showIceHazards) continue;
      if (cat === 'advisory' && !settings.showAdvisoryHazards) continue;

      const color =
        cat === 'turbulence' ? '#F59E0B' : cat === 'icing' ? '#0EA5E9' : '#EF4444';
      const poly = L.polygon(sig.coords, {
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: cat === 'icing' ? 0.14 : 0.11,
        dashArray: cat === 'turbulence' ? '5 4' : cat === 'icing' ? '2 4' : '6 3',
      });
      poly.bindPopup(
        `<div style="font-family:monospace;font-size:11px;max-width:260px;">
          <strong>${cat.toUpperCase()} · ${sig.hazard} ${sig.qualifier}</strong><br/>
          ${sig.baseFt !== null ? `FL${Math.round(sig.baseFt / 100)}` : 'SFC'} - ${
            sig.topFt !== null ? `FL${Math.round(sig.topFt / 100)}` : 'UNL'
          }<br/>
          <span style="opacity:0.8">${sig.rawText.slice(0, 180)}</span>
        </div>`,
      );
      poly.addTo(layer);
    }

    if (settings.showAdvisoryHazards && disruptions.length > 0) {
      for (const d of disruptions) {
        const matchAp =
          mapAirports.find((a) => a.icao === d.icao || (d.iata && a.iata === d.iata)) ??
          AIRPORT_CATALOG.find((a) => a.icao === d.icao || (d.iata && a.iata === d.iata));
        if (!matchAp) continue;
        const ringColor =
          d.type === 'GS' || d.type === 'CLOSURE'
            ? '#EF4444'
            : d.type === 'GDP'
              ? '#F59E0B'
              : '#0EA5E9';
        const ring = L.circle([matchAp.lat, matchAp.lon], {
          radius: d.severity === 'HIGH' ? 32000 : 22000,
          color: ringColor,
          weight: 1.8,
          dashArray: '4 4',
          fillColor: ringColor,
          fillOpacity: 0.08,
        });
        ring.bindPopup(
          `<div style="font-family:monospace;font-size:11px;max-width:240px;">
            <strong>${d.iata || d.icao} · ${d.type} (${d.severity})</strong><br/>
            ${d.reason}${d.avgDelayMinutes ? ` · Avg ${d.avgDelayMinutes}m` : ''}<br/>
            <span style="opacity:0.75">${d.source}</span>
          </div>`,
        );
        ring.addTo(layer);
      }
    }
  }, [
    sigmets,
    disruptions,
    mapAirports,
    settings.showSigmets,
    settings.showTurbHazards,
    settings.showIceHazards,
    settings.showAdvisoryHazards,
  ]);

  // All Airports merged (Viewport global directory + Catalog + Weather)
  const unifiedAirports = useMemo(() => {
    const wxMap = new Map(airports.map((a) => [a.icao, a]));
    const merged = new Map<
      string,
      {
        icao: string;
        iata: string;
        name: string;
        lat: number;
        lon: number;
        tier: 1 | 2 | 3;
        wx?: AirportWeather;
      }
    >();

    for (const a of mapAirports) {
      merged.set(a.icao, {
        icao: a.icao,
        iata: a.iata,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        tier: a.tier,
        wx: wxMap.get(a.icao),
      });
    }

    for (const spec of AIRPORT_CATALOG) {
      if (!merged.has(spec.icao)) {
        merged.set(spec.icao, {
          icao: spec.icao,
          iata: spec.iata,
          name: spec.name,
          lat: spec.lat,
          lon: spec.lon,
          tier: 1,
          wx: wxMap.get(spec.icao),
        });
      }
    }

    return Array.from(merged.values());
  }, [airports, mapAirports]);

  useEffect(() => {
    const layer = airportLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const ap of unifiedAirports) {
      const catColor = ap.wx ? FLT_CAT_COLOR[ap.wx.flightCategory] ?? '#64748B' : '#13233a';
      const isSelected =
        Boolean(selectedAirportIcao) &&
        (selectedAirportIcao === ap.icao || (Boolean(ap.iata) && selectedAirportIcao === ap.iata));
      const tagText = ap.iata || ap.icao;

      const marker = L.marker([ap.lat, ap.lon], {
        icon: makeAirportIcon(tagText, catColor, isSelected, settings.showMetarDots, ap.tier),
        zIndexOffset: isSelected ? 650 : ap.tier === 1 ? 280 : ap.tier === 2 ? 220 : 170,
      });
      marker.on('click', () =>
        onSelectAirportRef.current({icao: ap.icao, iata: ap.iata || ap.icao, name: ap.name}),
      );
      marker.bindTooltip(
        `${ap.iata ? `${ap.iata} (${ap.icao})` : ap.icao} · ${ap.name}${
          ap.wx ? ` · ${ap.wx.flightCategory}` : ''
        } — Click for Arrivals, Departures & Delay Index`,
        {direction: 'top', offset: [0, -10]},
      );
      marker.addTo(layer);
    }
  }, [unifiedAirports, selectedAirportIcao, settings.showMetarDots]);

  // Fetch detailed AIP/Overpass runway, apron & taxiway surface geometry for ALL airports in viewport (zoom >= 9.6)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapZoom < 9.6) {
      setSurfaceList([]);
      lastSurfaceBatchKeyRef.current = '';
      return;
    }

    const bounds = map.getBounds().pad(0.25);
    const center = map.getCenter();
    const candidates = unifiedAirports
      .filter((ap) => bounds.contains([ap.lat, ap.lon]))
      .sort((a, b) => {
        const dA = Math.hypot(a.lat - center.lat, a.lon - center.lng) + (a.tier - 1) * 0.08;
        const dB = Math.hypot(b.lat - center.lat, b.lon - center.lng) + (b.tier - 1) * 0.08;
        return dA - dB;
      })
      .slice(0, 3);

    const targets: Array<{key: string; icao: string; lat: number; lon: number}> =
      candidates.length > 0
        ? candidates.map((ap) => ({key: ap.icao, icao: ap.icao, lat: ap.lat, lon: ap.lon}))
        : [
            {
              key: selectedAirportIcao || `${center.lat.toFixed(2)},${center.lng.toFixed(2)}`,
              icao: selectedAirportIcao ?? '',
              lat: center.lat,
              lon: center.lng,
            },
          ];

    const batchKey = targets.map((t) => t.key).join('|');
    const cache = surfaceMemCacheRef.current;
    const nowMs = Date.now();
    const isFresh = (entry?: {ts: number; data: AirfieldSurfaceData}) => {
      if (!entry) return false;
      const ttl = entry.data.source === 'osm-overpass' && entry.data.taxiways.length > 0 ? 86400000 : 45000;
      return nowMs - entry.ts < ttl;
    };

    const immediate: AirfieldSurfaceData[] = [];
    const missing: typeof targets = [];
    for (const t of targets) {
      const hit = cache.get(t.key);
      if (hit && isFresh(hit)) immediate.push(hit.data);
      else missing.push(t);
    }

    if (batchKey === lastSurfaceBatchKeyRef.current && missing.length === 0) return;
    lastSurfaceBatchKeyRef.current = batchKey;

    if (immediate.length > 0) {
      setSurfaceList(immediate);
    }
    if (missing.length === 0) return;

    const ac = new AbortController();
    Promise.all(
      missing.map((t) => {
        const qs = new URLSearchParams({
          lat: t.lat.toFixed(4),
          lon: t.lon.toFixed(4),
          icao: t.icao,
        });
        return apiFetchJson<AirfieldSurfaceData>(`/api/surface?${qs.toString()}`, ac.signal)
          .then((data) => {
            if (data) cache.set(t.key, {ts: Date.now(), data});
            return data;
          })
          .catch(() => null);
      }),
    ).then((fetched) => {
      if (ac.signal.aborted) return;
      const merged: AirfieldSurfaceData[] = [];
      for (const t of targets) {
        const hit = cache.get(t.key);
        if (hit) merged.push(hit.data);
      }
      if (merged.length > 0 || fetched.some(Boolean)) {
        setSurfaceList(merged);
      }
    });

    return () => {
      ac.abort();
    };
  }, [mapZoom, viewportTick, unifiedAirports, selectedAirportIcao]);

  // Aspect-Locked Metric Illuminated Airfields across ALL airports:
  // Grouped Sublayers, Meter-Scaled Runways/Taxiways, Close-Zoom Gate Cap (<=55), 4-Unit PAPI, TDZ Barrettes & Hold-Short Bars
  useEffect(() => {
    const layer = surfaceLayerRef.current;
    const renderer = canvasRendererRef.current;
    const map = mapRef.current;
    if (!layer || !renderer) return;
    layer.clearLayers();
    if (surfaceList.length === 0 || mapZoom < 9.6) return;

    const viewBounds = map ? map.getBounds().pad(0.22) : null;
    const apronsGroup = L.layerGroup().addTo(layer);
    const terminalsGroup = L.layerGroup().addTo(layer);
    const taxiwaysGroup = L.layerGroup().addTo(layer);
    const runwaysGroup = L.layerGroup().addTo(layer);
    const lightingGroup = L.layerGroup().addTo(layer);
    const gatesGroup = L.layerGroup().addTo(layer);

    const apronFill = isDark ? '#111722' : '#3b485c';
    const apronStroke = isDark ? 'rgba(234, 179, 8, 0.28)' : 'rgba(245, 158, 11, 0.48)';
    const termFill = isDark ? '#1c293d' : '#37475e';
    const termStroke = isDark ? 'rgba(56, 189, 248, 0.55)' : 'rgba(14, 165, 233, 0.78)';
    const taxiFill = isDark ? '#0e1420' : '#475569';
    const taxiRim = isDark ? 'rgba(234, 179, 8, 0.36)' : 'rgba(245, 158, 11, 0.62)';
    const rwyAsphalt = '#090d14';
    const twyLabelSeen = new Set<string>();
    const apronLabelSeen = new Set<string>();
    const termLabelSeen = new Set<string>();
    const standLabelSeen = new Set<string>();
    let gateBadgeCount = 0;

    for (const surfaceData of surfaceList) {
      const mPerPx = metersPerPixelAtLatZoom(surfaceData.lat, mapZoom);

      // 1. Subtle Dark Aprons with Gold Perimeter + Apron Designators
      const apronItems =
        surfaceData.labeledAprons && surfaceData.labeledAprons.length > 0
          ? surfaceData.labeledAprons
          : surfaceData.aprons.map((coords, idx) => {
              let sLat = 0;
              let sLon = 0;
              for (const c of coords) {
                sLat += c[0];
                sLon += c[1];
              }
              return {
                id: `apron-raw-${idx}`,
                coords,
                center: [sLat / Math.max(1, coords.length), sLon / Math.max(1, coords.length)] as [
                  number,
                  number,
                ],
                ref: undefined as string | undefined,
                name: undefined as string | undefined,
              };
            });

      let autoApronNum = 1;
      for (const ap of apronItems) {
        if (ap.coords.length < 3) continue;
        L.polygon(ap.coords, {
          renderer,
          color: apronStroke,
          weight: 0.9,
          fillColor: apronFill,
          fillOpacity: isDark ? 0.52 : 0.42,
          interactive: false,
        }).addTo(apronsGroup);

        if (mapZoom >= 13.0) {
          let minLat = Infinity;
          let maxLat = -Infinity;
          let minLon = Infinity;
          let maxLon = -Infinity;
          for (const [aLat, aLon] of ap.coords) {
            if (aLat < minLat) minLat = aLat;
            if (aLat > maxLat) maxLat = aLat;
            if (aLon < minLon) minLon = aLon;
            if (aLon > maxLon) maxLon = aLon;
          }
          const span = Math.hypot(maxLat - minLat, maxLon - minLon);
          const explicitLabel = ap.ref || ap.name;
          const label = explicitLabel || (span >= 0.0022 ? `APRON ${autoApronNum++}` : '');
          if (label && (!viewBounds || viewBounds.contains(ap.center))) {
            const apKey = `${Math.round(ap.center[0] * 300)}-${Math.round(ap.center[1] * 300)}`;
            if (!apronLabelSeen.has(apKey)) {
              apronLabelSeen.add(apKey);
              const shortLbl = label.length > 18 ? `${label.slice(0, 17)}…` : label;
              L.marker(ap.center, {
                interactive: false,
                icon: L.divIcon({
                  className: 'skydeck-apron-badge',
                  iconSize: [96, 16],
                  iconAnchor: [48, 8],
                  html: `<span style="display:inline-block;padding:1px 5px;border-radius:4px;background:rgba(15,23,42,0.72);border:1px solid rgba(250,204,21,0.3);font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;color:#FDE68A;letter-spacing:0.04em;white-space:nowrap;">${shortLbl}</span>`,
                }),
              }).addTo(apronsGroup);
            }
          }
        }
      }

      // 2. Architectural Terminal Buildings & Concourses
      for (const term of surfaceData.terminals ?? []) {
        if (term.coords.length < 3) continue;
        L.polygon(term.coords, {
          renderer,
          color: termStroke,
          weight: mapZoom >= 14 ? 1.4 : 1.0,
          fillColor: termFill,
          fillOpacity: isDark ? 0.9 : 0.85,
          interactive: false,
        }).addTo(terminalsGroup);

        const termLabel = term.name || term.ref;
        if (mapZoom >= 12.2 && termLabel && (!viewBounds || viewBounds.contains(term.center))) {
          const tKey = `${termLabel.toUpperCase()}-${Math.round(term.center[0] * 240)}-${Math.round(
            term.center[1] * 240,
          )}`;
          if (!termLabelSeen.has(tKey)) {
            termLabelSeen.add(tKey);
            const shortName = termLabel.length > 22 ? `${termLabel.slice(0, 21)}…` : termLabel;
            L.marker(term.center, {
              interactive: false,
              icon: L.divIcon({
                className: 'skydeck-term-badge',
                iconSize: [116, 18],
                iconAnchor: [58, 9],
                html: `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:rgba(12,20,34,0.8);border:1px solid rgba(56,189,248,0.4);font-family:'JetBrains Mono',monospace;font-size:8.5px;font-weight:700;color:#E0F2FE;letter-spacing:0.02em;white-space:nowrap;">${shortName}</span>`,
              }),
            }).addTo(terminalsGroup);
          }
        }
      }

      // 3. Apron Parking Lead-In Guidelines (zoom >= 13.8)
      if (mapZoom >= 13.8) {
        const leadW = pxFromMeters(0.8, mPerPx, 0.7, 1.4);
        for (const stand of surfaceData.stands ?? []) {
          if (!stand.coords || stand.coords.length < 2) continue;
          if (viewBounds && !viewBounds.contains([stand.lat, stand.lon])) continue;
          L.polyline(stand.coords, {
            renderer,
            color: '#FACC15',
            weight: leadW,
            opacity: 0.55,
            interactive: false,
          }).addTo(taxiwaysGroup);
        }
      }

      // 4. Aspect-Locked Taxiway Network (Meter-scaled width + Emerald Centerline + Sapphire Edge Lights)
      for (const twy of surfaceData.taxiways) {
        const isLane = twy.kind === 'taxilane';
        const twyWidthM = twy.widthM ?? (isLane ? 13 : 22);
        const w = pxFromMeters(twyWidthM, mPerPx, isLane ? 1.8 : 2.6, isLane ? 14 : 26);
        const rimPad = pxFromMeters(2.2, mPerPx, 0.8, 2.6);
        const centerLineW = pxFromMeters(0.7, mPerPx, 0.7, 1.5);

        L.polyline(twy.coords, {
          renderer,
          color: taxiRim,
          weight: w + rimPad,
          opacity: isLane ? 0.52 : 0.78,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(taxiwaysGroup);

        L.polyline(twy.coords, {
          renderer,
          color: taxiFill,
          weight: w,
          opacity: 0.96,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(taxiwaysGroup);

        L.polyline(twy.coords, {
          renderer,
          color: '#FACC15',
          weight: centerLineW,
          opacity: isLane ? 0.48 : 0.68,
          dashArray: mapZoom >= 13.5 ? undefined : '4 4',
          interactive: false,
        }).addTo(taxiwaysGroup);

        // Taxiway green centerline & blue outer edge lights + amber hold-short bars at close zoom
        if (mapZoom >= 14.0 && !isLane && twy.coords.length >= 2) {
          const midCheck = twy.coords[Math.floor(twy.coords.length / 2)];
          if (!viewBounds || viewBounds.contains(midCheck)) {
            const maxSegs = Math.min(twy.coords.length - 1, 5);
            const halfTwyEdgeM = Math.max(7.5, twyWidthM * 0.45);
            for (let segIdx = 0; segIdx < maxSegs; segIdx++) {
              const pA = twy.coords[segIdx];
              const pB = twy.coords[segIdx + 1];
              const brg = computeBearingDeg(pA, pB);
              const midPt: [number, number] = [(pA[0] + pB[0]) * 0.5, (pA[1] + pB[1]) * 0.5];
              L.circleMarker(midPt, {
                renderer,
                radius: pxFromMeters(0.55, mPerPx, 1.0, 1.6),
                color: '#22c55e',
                fillColor: '#4ade80',
                fillOpacity: 0.78,
                weight: 0,
                interactive: false,
              }).addTo(lightingGroup);

              if (mapZoom >= 15.0) {
                const leftEdge = offsetLatLonMeters(midPt[0], midPt[1], brg, 0, -halfTwyEdgeM);
                const rightEdge = offsetLatLonMeters(midPt[0], midPt[1], brg, 0, halfTwyEdgeM);
                for (const edgePt of [leftEdge, rightEdge]) {
                  L.circleMarker(edgePt, {
                    renderer,
                    radius: pxFromMeters(0.45, mPerPx, 0.9, 1.4),
                    color: '#0ea5e9',
                    fillColor: '#38bdf8',
                    fillOpacity: 0.7,
                    weight: 0,
                    interactive: false,
                  }).addTo(lightingGroup);
                }
              }
            }

            // Amber hold-short guard lights near taxiway exit nodes at high zoom
            if (mapZoom >= 14.6 && twy.ref && /\d/.test(twy.ref)) {
              const exitPt = twy.coords[0];
              const holdBrg = computeBearingDeg(twy.coords[0], twy.coords[1]);
              const hL = offsetLatLonMeters(exitPt[0], exitPt[1], holdBrg, 18, -halfTwyEdgeM * 0.75);
              const hR = offsetLatLonMeters(exitPt[0], exitPt[1], holdBrg, 18, halfTwyEdgeM * 0.75);
              L.polyline([hL, hR], {
                renderer,
                color: '#f59e0b',
                weight: pxFromMeters(1.4, mPerPx, 1.4, 2.4),
                opacity: 0.85,
                dashArray: '3 2',
                interactive: false,
              }).addTo(lightingGroup);
            }
          }
        }

        // Crisp unboxed gold taxiway letter designator (~320m grid)
        if (mapZoom >= 12.2 && twy.ref) {
          const mid = twy.coords[Math.floor(twy.coords.length / 2)];
          if (!viewBounds || viewBounds.contains(mid)) {
            const badgeKey = `${twy.ref}-${Math.round(mid[0] * 320)}-${Math.round(mid[1] * 320)}`;
            if (!twyLabelSeen.has(badgeKey)) {
              twyLabelSeen.add(badgeKey);
              L.marker(mid, {
                interactive: false,
                icon: L.divIcon({
                  className: 'skydeck-taxi-badge',
                  iconSize: [30, 14],
                  iconAnchor: [15, 7],
                  html: `<span style="display:inline-block;font-family:'JetBrains Mono',monospace;font-size:${
                    mapZoom >= 14.5 ? 9.5 : 8.5
                  }px;font-weight:800;color:#FDE047;text-shadow:0 0 3px #000,0 1px 2px #000;letter-spacing:0.03em;white-space:nowrap;">${
                    twy.ref
                  }</span>`,
                }),
              }).addTo(gatesGroup);
            }
          }
        }
      }

      // 5. Close-Zoom Compact Gate & Stand Numbers (zoom >= 15.0, hard-capped at 55 to prevent lag)
      if (mapZoom >= 15.0 && gateBadgeCount < 55) {
        const standGrid = mapZoom >= 16.5 ? 4200 : 2800;
        const standItems =
          surfaceData.stands && surfaceData.stands.length > 0
            ? surfaceData.stands.filter((s) => Boolean(s.ref))
            : surfaceData.gates.map((g) => ({...g, kind: 'gate' as const}));

        for (const stand of standItems) {
          if (gateBadgeCount >= 55) break;
          if (viewBounds && !viewBounds.contains([stand.lat, stand.lon])) continue;
          const cellKey = `${Math.round(stand.lat * standGrid)}-${Math.round(stand.lon * standGrid)}`;
          if (standLabelSeen.has(cellKey)) continue;
          standLabelSeen.add(cellKey);
          gateBadgeCount++;
          const isPark = stand.kind === 'parking_position';
          L.marker([stand.lat, stand.lon], {
            interactive: false,
            icon: L.divIcon({
              className: 'skydeck-taxi-badge',
              iconSize: [24, 12],
              iconAnchor: [12, 6],
              html: `<span style="display:inline-block;font-family:'JetBrains Mono',monospace;font-size:7.5px;font-weight:700;color:${
                isPark ? '#FDE68A' : '#CBD5E1'
              };text-shadow:0 0 3px #000,0 1px 2px #000;white-space:nowrap;">${stand.ref}</span>`,
            }),
          }).addTo(gatesGroup);
        }
      }

      // 6. Aspect-Locked Precision Runways, 4-Unit PAPI, TDZ Barrettes & Dashed |- - - - -| Approach Paths
      for (const rwy of surfaceData.runways) {
        if (rwy.coords.length < 2) continue;

        const rwyWidthM = rwy.widthM ?? 45;
        const rwyWeight = pxFromMeters(rwyWidthM, mPerPx, 5.5, 48);
        const shoulderWeight = rwyWeight + pxFromMeters(8, mPerPx, 2.5, 9);
        const startPt = rwy.coords[0];
        const endPt = rwy.coords[rwy.coords.length - 1];
        const brg = computeBearingDeg(startPt, endPt);
        const revBrg = (brg + 180) % 360;
        const [labelA, labelB] = deriveRunwayEndLabels(rwy.ref, brg);

        const drawApproachPath = (thresholdPt: [number, number], landingHeadingDeg: number) => {
          const outboundBrg = (landingHeadingDeg + 180) % 360;
          const beamLenM = mapZoom >= 13.5 ? 2400 : 6000;
          const appBeamEnd = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, beamLenM, 0);
          const appLongEnd = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, 10186, 0);

          // Extended |- - - - -| ILS/Final Approach dashed centerline
          L.polyline([appBeamEnd, appLongEnd], {
            renderer,
            color: isDark ? 'rgba(226, 232, 240, 0.48)' : '#0369A1',
            weight: 1.25,
            opacity: 0.72,
            dashArray: '7 7',
            interactive: false,
          }).addTo(lightingGroup);

          // Approach Lighting System lead-in beam (restrained opacity so it doesn't look artificial)
          L.polyline([thresholdPt, appBeamEnd], {
            renderer,
            color: 'rgba(255, 255, 255, 0.22)',
            weight: pxFromMeters(10, mPerPx, 3.2, 7.5),
            opacity: 0.75,
            interactive: false,
          }).addTo(lightingGroup);
          L.polyline([thresholdPt, appBeamEnd], {
            renderer,
            color: '#f8fafc',
            weight: pxFromMeters(2.5, mPerPx, 1.3, 2.4),
            opacity: 0.78,
            interactive: false,
          }).addTo(lightingGroup);

          // Perpendicular 1 NM range gate ticks along |- - - - -|
          for (let nm = 1; nm <= 5; nm++) {
            const distM = nm * 1852;
            const barL = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, distM, -100);
            const barR = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, distM, 100);
            L.polyline([barL, barR], {
              renderer,
              color: isDark ? 'rgba(226, 232, 240, 0.42)' : '#0284C7',
              weight: 1.0,
              opacity: 0.68,
              interactive: false,
            }).addTo(lightingGroup);
          }

          // Flashing Sequenced Approach Lights ("Rabbit" strobes) + ALSF-II Red Decision Bar
          if (mapZoom >= 12.2) {
            const strobeCount = 6;
            for (let s = 1; s <= strobeCount; s++) {
              const distFromThresholdM = 120 + (strobeCount - s) * 125;
              const sPt = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, distFromThresholdM, 0);
              const delaySec = (s * 0.15).toFixed(2);
              L.marker(sPt, {
                interactive: false,
                icon: L.divIcon({
                  className: 'skydeck-rabbit-icon',
                  iconSize: [7, 7],
                  iconAnchor: [3.5, 3.5],
                  html: `<div class="skydeck-rabbit-dot" style="animation-delay:${delaySec}s;"></div>`,
                }),
              }).addTo(lightingGroup);
            }

            // Red ALSF-II side-row barrettes at 45m & 220m prior to threshold
            for (const d of [45, 220]) {
              const rPt = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, d, 0);
              L.circleMarker(rPt, {
                renderer,
                radius: pxFromMeters(2.2, mPerPx, 1.5, 2.8),
                color: '#fca5a5',
                fillColor: '#ef4444',
                fillOpacity: 0.9,
                weight: 0.6,
                interactive: false,
              }).addTo(lightingGroup);
            }
          }
        };

        drawApproachPath(startPt, brg);
        drawApproachPath(endPt, revBrg);

        // Runway shoulder apron bed (aspect-locked in real meters)
        L.polyline(rwy.coords, {
          renderer,
          color: isDark ? 'rgba(226, 232, 240, 0.16)' : 'rgba(15, 23, 42, 0.25)',
          weight: shoulderWeight,
          opacity: 0.9,
          lineCap: 'butt',
          interactive: false,
        }).addTo(runwaysGroup);

        // Runway asphalt pavement
        L.polyline(rwy.coords, {
          renderer,
          color: rwyAsphalt,
          weight: rwyWeight,
          opacity: 1,
          lineCap: 'butt',
          interactive: false,
        }).addTo(runwaysGroup);

        // Crisp white runway centerline
        L.polyline(rwy.coords, {
          renderer,
          color: '#f8fafc',
          weight: pxFromMeters(1.2, mPerPx, 1.1, 2.4),
          opacity: 0.9,
          dashArray: mapZoom >= 14.5 ? '10 8' : undefined,
          interactive: false,
        }).addTo(runwaysGroup);

        // Runway edge lights (white -> amber last 600m caution zone -> red runway end)
        if (mapZoom >= 12.0) {
          const steps = 26;
          const halfW = rwyWidthM * 0.49;
          const edgeR = pxFromMeters(0.9, mPerPx, 1.0, 2.0);
          for (let s = 0; s <= steps; s++) {
            const frac = s / steps;
            const lat = startPt[0] + (endPt[0] - startPt[0]) * frac;
            const lon = startPt[1] + (endPt[1] - startPt[1]) * frac;
            const lEdge = offsetLatLonMeters(lat, lon, brg, 0, -halfW);
            const rEdge = offsetLatLonMeters(lat, lon, brg, 0, halfW);
            const isEnd = s === 0 || s === steps;
            const isCautionZone = !isEnd && (s <= 2 || s >= steps - 2);
            const lightColor = isEnd ? '#ef4444' : isCautionZone ? '#f59e0b' : '#f8fafc';
            for (const pt of [lEdge, rEdge]) {
              L.circleMarker(pt, {
                renderer,
                radius: edgeR,
                color: lightColor,
                fillColor: lightColor,
                fillOpacity: 0.88,
                weight: 0,
                interactive: false,
              }).addTo(lightingGroup);
            }
          }
        }

        // Threshold lights, ICAO piano keys, Touchdown Zone barrettes, 4-Unit PAPI & runway designators
        const drawEnd = (pt: [number, number], endBrg: number, rwyNum: string) => {
          const halfW = rwyWidthM * 0.45;

          // Green threshold light bar
          for (let t = -3; t <= 3; t++) {
            const tPt = offsetLatLonMeters(pt[0], pt[1], endBrg, 0, (t / 3) * halfW);
            L.circleMarker(tPt, {
              renderer,
              radius: pxFromMeters(0.9, mPerPx, 1.2, 2.2),
              color: '#16a34a',
              fillColor: '#4ade80',
              fillOpacity: 0.9,
              weight: 0,
              interactive: false,
            }).addTo(lightingGroup);
          }

          // 4-Unit PAPI Array (2 White / 2 Red = on 3.0° glideslope) left of runway 300m upwind
          if (mapZoom >= 13.8) {
            for (let u = 0; u < 4; u++) {
              const papiPt = offsetLatLonMeters(
                pt[0],
                pt[1],
                endBrg,
                305,
                -(rwyWidthM * 0.5 + 14 + u * 6),
              );
              const isRed = u >= 2;
              L.circleMarker(papiPt, {
                renderer,
                radius: pxFromMeters(1.5, mPerPx, 1.6, 3.0),
                color: isRed ? '#ef4444' : '#ffffff',
                fillColor: isRed ? '#ef4444' : '#f8fafc',
                fillOpacity: 0.95,
                weight: 0.5,
                interactive: false,
              }).addTo(lightingGroup);
            }
          }

          // ICAO piano keys + aiming point blocks + TDZ barrettes (zoom >= 13.5)
          if (mapZoom >= 13.5) {
            const numKeys = 5;
            const keyW = pxFromMeters(1.8, mPerPx, 1.1, 3.2);
            for (let k = -numKeys; k <= numKeys; k++) {
              if (k === 0) continue;
              const latOffset = (k / numKeys) * (halfW * 0.84);
              const p1 = offsetLatLonMeters(pt[0], pt[1], endBrg, 14, latOffset);
              const p2 = offsetLatLonMeters(pt[0], pt[1], endBrg, 46, latOffset);
              L.polyline([p1, p2], {
                renderer,
                color: '#f8fafc',
                weight: keyW,
                opacity: 0.88,
                lineCap: 'butt',
                interactive: false,
              }).addTo(runwaysGroup);
            }

            // Touchdown zone white barrettes (zoom >= 14.2)
            if (mapZoom >= 14.2) {
              for (const distM of [150, 300, 450, 600]) {
                for (const side of [-1, 1]) {
                  const isAiming = distM === 300;
                  const b1 = offsetLatLonMeters(pt[0], pt[1], endBrg, distM, side * (halfW * 0.42));
                  const b2 = offsetLatLonMeters(
                    pt[0],
                    pt[1],
                    endBrg,
                    distM + (isAiming ? 45 : 22),
                    side * (halfW * 0.42),
                  );
                  L.polyline([b1, b2], {
                    renderer,
                    color: '#f8fafc',
                    weight: pxFromMeters(isAiming ? 4.5 : 2.2, mPerPx, 1.2, 4.2),
                    opacity: 0.85,
                    lineCap: 'butt',
                    interactive: false,
                  }).addTo(runwaysGroup);
                }
              }
            }
          }

          const numPos = offsetLatLonMeters(pt[0], pt[1], endBrg, 88, 0);
          const normDeg = ((endBrg % 360) + 360) % 360;
          const uprightDeg = normDeg > 90 && normDeg < 270 ? normDeg - 180 : normDeg;
          L.marker(numPos, {
            interactive: false,
            icon: L.divIcon({
              className: 'skydeck-runway-num',
              iconSize: [38, 18],
              iconAnchor: [19, 9],
              html: `<span style="display:inline-block;font-family:'JetBrains Mono',monospace;font-size:${
                mapZoom >= 14.5 ? 11 : 9.5
              }px;font-weight:800;letter-spacing:0.05em;color:#ffffff;text-shadow:0 0 4px #000,0 1px 3px #000;transform:rotate(${Math.round(
                uprightDeg,
              )}deg);">${rwyNum}</span>`,
            }),
          }).addTo(runwaysGroup);
        };

        drawEnd(startPt, brg, labelA);
        drawEnd(endPt, revBrg, labelB);
      }
    }
  }, [surfaceList, mapZoom, isDark, viewportTick]);

  // Sync flight pool & FOV trails (up to 2,200+ flights rendered at 60fps via Canvas2D without DOM lag)
  useEffect(() => {
    const pLayer = allPathsLayerRef.current;
    const drLayer = drLayerRef.current;
    const map = mapRef.current;
    const renderer = canvasRendererRef.current;
    if (!pLayer || !drLayer || !renderer) return;

    pLayer.clearLayers();
    drLayer.clearLayers();

    const mapBounds = map?.getBounds();
    const baseVisible = flights.filter((f) => settings.showGroundTraffic || !f.onGround);
    const visibleFlights =
      isolateSelected && selectedFlight
        ? baseVisible.filter((f) => f.id === selectedFlight.id)
        : baseVisible;

    const activeIds = new Set<string>();
    const pool = flightPoolRef.current;
    const nowMs = performance.now();
    let backgroundTrailCount = 0;
    const maxBackgroundTrails = mapZoom >= 8 ? 360 : 140;

    for (const f of visibleFlights) {
      const id = f.id;
      activeIds.add(id);

      const isSelected = selectedFlight?.id === id;
      const inView = mapBounds ? mapBounds.contains([f.lat, f.lon]) : true;

      if (
        !isolateSelected &&
        settings.flightPathMode === 'all' &&
        !f.onGround &&
        !isSelected &&
        inView &&
        backgroundTrailCount < maxBackgroundTrails
      ) {
        const key = f.icao24 || id;
        const rawTrail = clientTrailMapRef.current.get(key) ?? [];
        if (rawTrail.length >= 2) {
          const smoothedChains = sanitizeAndSmoothTrail(rawTrail.slice(-24), f, mapBounds);
          for (const chain of smoothedChains) {
            drawAltitudeGradientPath(pLayer, renderer, chain, 2.0, isDark ? 0.78 : 0.88);
          }
          backgroundTrailCount++;
        }
      }

      const pooled = pool.get(id);
      if (pooled) {
        const movedTarget =
          Math.abs(f.lat - pooled.targetLat) > 1e-6 ||
          Math.abs(f.lon - pooled.targetLon) > 1e-6 ||
          Math.abs(f.trueTrackDeg - pooled.targetTrack) > 0.2 ||
          f.lastContactEpoch !== pooled.flight.lastContactEpoch;

        pooled.flight = f;
        if (movedTarget) {
          const jumpDist = Math.hypot(f.lat - pooled.renderLat, f.lon - pooled.renderLon);
          if (jumpDist > 1.2) {
            pooled.fromLat = f.lat;
            pooled.fromLon = f.lon;
            pooled.renderLat = f.lat;
            pooled.renderLon = f.lon;
            pooled.fromTrack = f.trueTrackDeg;
            pooled.renderTrack = f.trueTrackDeg;
          } else {
            pooled.fromLat = pooled.renderLat;
            pooled.fromLon = pooled.renderLon;
            pooled.fromTrack = pooled.renderTrack;
          }
          pooled.targetLat = f.lat;
          pooled.targetLon = f.lon;
          pooled.targetTrack = f.trueTrackDeg;
          pooled.blendStartMs = nowMs;
          pooled.blendDurationMs = 1500;
          pooled.lastUpdateMs = nowMs;
        }
      } else {
        pool.set(id, {
          flight: f,
          renderLat: f.lat,
          renderLon: f.lon,
          renderTrack: f.trueTrackDeg,
          fromLat: f.lat,
          fromLon: f.lon,
          fromTrack: f.trueTrackDeg,
          targetLat: f.lat,
          targetLon: f.lon,
          targetTrack: f.trueTrackDeg,
          blendStartMs: nowMs,
          blendDurationMs: 0,
          lastUpdateMs: nowMs,
        });
      }

      if (settings.showDrRings && f.isEstimated && f.uncertaintyNm > 0 && inView) {
        L.circle([f.lat, f.lon], {
          renderer,
          radius: f.uncertaintyNm * 1852,
          color: '#D97706',
          weight: 1,
          dashArray: '4 4',
          fillColor: '#F59E0B',
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(drLayer);
      }
    }

    for (const id of pool.keys()) {
      if (!activeIds.has(id)) {
        pool.delete(id);
      }
    }
    needsCanvasRedrawRef.current = true;
  }, [
    flights,
    selectedFlight,
    isolateSelected,
    settings.planeSize,
    settings.flightPathMode,
    settings.showPlaneLabels,
    settings.showGroundTraffic,
    settings.showDrRings,
    isDark,
    mapZoom,
    viewportTick,
  ]);

  // Continuous 60fps Canvas2D Kinematic Aircraft Sprite Renderer + Zoom-Preserving Follow Pan Loop
  useEffect(() => {
    let rafId = 0;
    let lastDrawMs = 0;
    let lastFollowPanMs = 0;

    const drawFrame = (frameMs: number) => {
      rafId = window.requestAnimationFrame(drawFrame);
      const map = mapRef.current;
      const canvas = flightsCanvasRef.current;
      if (!map || !canvas) return;

      const intervalMs = isMapZoomingRef.current ? 16 : needsCanvasRedrawRef.current ? 16 : 30;
      if (frameMs - lastDrawMs < intervalMs) return;
      lastDrawMs = frameMs;
      needsCanvasRedrawRef.current = false;

      const size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.max(1, Math.round(size.x * dpr));
      const targetH = Math.max(1, Math.round(size.y * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);

      const bounds = map.getBounds().pad(0.18);
      const curSettings = settingsRef.current;
      const dark = isDarkRef.current;
      const selId = selectedFlightIdRef.current;
      const poolEntries = Array.from(flightPoolRef.current.values());

      // Draw ground -> airborne -> flagged -> selected -> emergency order so alerts stay cleanly on top
      poolEntries.sort((a, b) => {
        const aScore =
          getEmergencySquawkMeta(a.flight.squawk) ? 4 : a.flight.id === selId ? 3 : a.flight.isLadd ? 2 : a.flight.isMilitary ? 1 : a.flight.onGround ? -1 : 0;
        const bScore =
          getEmergencySquawkMeta(b.flight.squawk) ? 4 : b.flight.id === selId ? 3 : b.flight.isLadd ? 2 : b.flight.isMilitary ? 1 : b.flight.onGround ? -1 : 0;
        return aScore - bScore;
      });

      const nextHits: CanvasHitTarget[] = [];
      const pulsePhase = (frameMs % 1400) / 1400;

      for (const entry of poolEntries) {
        const f = entry.flight;
        const isSelected = f.id === selId;
        const isFollowed = followSelectedRef.current && isSelected;
        if (!isFollowed && !bounds.contains([entry.targetLat, entry.targetLon])) continue;

        const t =
          entry.blendDurationMs > 0
            ? Math.min(1, Math.max(0, (frameMs - entry.blendStartMs) / entry.blendDurationMs))
            : 1;
        const ease = 1 - Math.pow(1 - t, 3);

        const glideMaxSec = f.onGround ? 4.5 : 9.0;
        const glideSec = Math.min(glideMaxSec, Math.max(0, (frameMs - entry.lastUpdateMs) / 1000));
        let extLat = entry.targetLat;
        let extLon = entry.targetLon;

        const minGlideKts = f.onGround ? 4 : 25;
        if (!f.isEstimated && f.groundSpeedKts > minGlideKts && glideSec > 0.05) {
          const distNm = f.groundSpeedKts * (glideSec / 3600);
          const degLat = (distNm / 60) * Math.cos((entry.targetTrack * Math.PI) / 180);
          const cosLat = Math.max(0.15, Math.cos((entry.targetLat * Math.PI) / 180));
          const degLon = ((distNm / 60) * Math.sin((entry.targetTrack * Math.PI) / 180)) / cosLat;
          extLat += degLat;
          extLon += degLon;
        }

        const nextLat = entry.fromLat + (extLat - entry.fromLat) * ease;
        const nextLon = entry.fromLon + (extLon - entry.fromLon) * ease;
        const angleDelta = ((entry.targetTrack - entry.fromTrack + 540) % 360) - 180;
        const nextTrack = (entry.fromTrack + angleDelta * ease + 360) % 360;

        entry.renderLat = nextLat;
        entry.renderLon = nextLon;
        entry.renderTrack = nextTrack;

        if (isFollowed && frameMs - lastFollowPanMs > 110) {
          lastFollowPanMs = frameMs;
          const c = map.getCenter();
          if (Math.hypot(nextLat - c.lat, nextLon - c.lng) > 0.00015) {
            map.panTo([nextLat, nextLon], {animate: false});
          }
        }

        const pt = map.latLngToContainerPoint([nextLat, nextLon]);
        if (pt.x < -36 || pt.y < -36 || pt.x > size.x + 36 || pt.y > size.y + 36) continue;

        const emerg = getEmergencySquawkMeta(f.squawk);
        const dbMeta = getDbFlagMeta(f);
        const modelClass = resolveFr24ModelClass(f.aircraftType, f.callsign);

        const baseSize = curSettings.planeSize;
        const iconSize = Math.max(
          13,
          Math.min(
            40,
            emerg
              ? Math.max(baseSize + 6, 25)
              : isSelected
                ? baseSize + 6
                : dbMeta
                  ? Math.max(baseSize + 2, 19)
                  : f.onGround
                    ? Math.max(13, baseSize - 3)
                    : baseSize,
          ),
        );

        const iconFill = emerg
          ? '#EF4444'
          : isSelected
            ? '#F59E0B'
            : dbMeta?.kind === 'LADD'
              ? '#C084FC'
              : dbMeta?.kind === 'MIL'
                ? '#34D399'
                : dbMeta?.kind === 'PIA'
                  ? '#22D3EE'
                  : '#F9D949';
        const stroke = emerg
          ? '#ffffff'
          : isSelected
            ? '#ffffff'
            : dbMeta?.kind === 'LADD'
              ? '#4C1D95'
              : dark
                ? '#0B0E14'
                : '#13233a';

        // Pulsing Emergency Squawk Ring
        if (emerg) {
          const ringR = (iconSize * 0.5 + 4) * (0.8 + pulsePhase * 1.1);
          ctx.save();
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(239, 68, 68, ${Math.max(0, 1 - pulsePhase)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        } else if (dbMeta?.kind === 'LADD') {
          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([3, 3]);
          ctx.arc(pt.x, pt.y, iconSize * 0.5 + 5, 0, Math.PI * 2);
          ctx.strokeStyle = '#A855F7';
          ctx.lineWidth = 1.4;
          ctx.fillStyle = 'rgba(168, 85, 247, 0.14)';
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else if (isSelected) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, iconSize * 0.5 + 6, 0, Math.PI * 2);
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        const sprite = getPlaneSprite(modelClass, iconSize, iconFill, stroke);
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate((nextTrack * Math.PI) / 180);
        ctx.shadowColor = f.onGround ? 'rgba(0, 0, 0, 0.92)' : 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = f.onGround ? 5.5 : 2;
        if (sprite) {
          ctx.drawImage(sprite, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
        } else {
          // Instant crisp fallback delta shape on first microsecond while sprite decodes
          ctx.beginPath();
          ctx.moveTo(0, -iconSize * 0.45);
          ctx.lineTo(iconSize * 0.35, iconSize * 0.35);
          ctx.lineTo(0, iconSize * 0.18);
          ctx.lineTo(-iconSize * 0.35, iconSize * 0.35);
          ctx.closePath();
          ctx.fillStyle = iconFill;
          ctx.fill();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.restore();

        // Compact Pill Labels for Emergencies, Selected Aircraft, or when "Plane Labels" toggle is active
        if (emerg || isSelected || curSettings.showPlaneLabels) {
          const text = emerg
            ? `▲ ${emerg.shortLabel} · ${f.callsign}`
            : `${dbMeta ? `[${dbMeta.shortLabel}] ` : ''}${f.callsign}${
                f.onGround ? ' GND' : ` FL${Math.round(f.altitudeFt / 100)}`
              }`;
          ctx.font = '700 10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(text).width;
          const bx = pt.x + iconSize * 0.5 + 4;
          const by = pt.y - 8;
          const bw = tw + 10;
          const bh = 16;
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 8);
          ctx.fillStyle = emerg
            ? '#DC2626'
            : dbMeta?.kind === 'LADD'
              ? '#7E22CE'
              : dbMeta?.kind === 'MIL'
                ? '#065F46'
                : '#F9D949';
          ctx.fill();
          ctx.strokeStyle = emerg || isSelected ? '#ffffff' : 'rgba(19,35,58,0.45)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = emerg || dbMeta?.kind === 'LADD' || dbMeta?.kind === 'MIL' ? '#ffffff' : '#13233a';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, bx + 5, by + 8.5);
          ctx.restore();
        }

        nextHits.push({
          x: pt.x,
          y: pt.y,
          r: Math.max(14, iconSize * 0.65),
          flight: f,
        });
      }

      hitTargetsRef.current = nextHits;
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  // Immediately center map (preserving user's current zoom) when Follow Mode is activated
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followSelected || !selectedFlight) return;
    map.panTo([selectedFlight.lat, selectedFlight.lon], {animate: true});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followSelected, selectedFlight?.id]);

  // Selected Flight Actual Flown Route (Merged Server + Live Trail + Unclipped when Isolated)
  useEffect(() => {
    const tLayer = trailLayerRef.current;
    const map = mapRef.current;
    const renderer = canvasRendererRef.current;
    if (!tLayer || !renderer) return;
    tLayer.clearLayers();

    const mapBounds = map?.getBounds();

    if (selectedFlight && (isolateSelected || settings.flightPathMode !== 'off')) {
      const inView = mapBounds ? mapBounds.contains([selectedFlight.lat, selectedFlight.lon]) : true;
      if (isolateSelected || inView) {
        const serverTrail = selectedDetail?.trail ?? [];
        const fallbackTrail = clientTrailMapRef.current.get(selectedFlight.icao24 || selectedFlight.id) ?? [];

        // Always keep the richest trail available (critical for military/adsb.lol flights without FR24 trail IDs)
        let fullFlown: TrailPt[] = [];
        if (serverTrail.length > 1) {
          fullFlown = serverTrail.map((p) => ({lat: p.lat, lon: p.lon, altFt: p.altFt}));
          for (const pt of fallbackTrail) {
            const last = fullFlown[fullFlown.length - 1];
            if (!last || Math.hypot(pt.lat - last.lat, pt.lon - last.lon) > 0.001) {
              fullFlown.push(pt);
            }
          }
        } else if (fallbackTrail.length > 1) {
          fullFlown = fallbackTrail;
        }

        const smoothedChains = sanitizeAndSmoothTrail(
          fullFlown,
          selectedFlight,
          isolateSelected ? undefined : mapBounds,
        );
        for (const chain of smoothedChains) {
          drawAltitudeGradientPath(tLayer, renderer, chain, isolateSelected ? 4 : 3.4, 0.96);
        }

        // If isolated and destination airport is known in directory, draw projected dashed course ahead
        if (isolateSelected && !plannedRoute) {
          const destCode = (selectedDetail?.destinationIata || selectedFlight.destination || '').toUpperCase();
          const destIcao = (selectedDetail?.destinationIcao || '').toUpperCase();
          const destAp = unifiedAirports.find(
            (a) => (destIcao && a.icao === destIcao) || (destCode && a.iata === destCode),
          );
          if (destAp) {
            L.polyline(
              [
                [selectedFlight.lat, selectedFlight.lon],
                [destAp.lat, destAp.lon],
              ],
              {
                renderer,
                color: '#38BDF8',
                weight: 2,
                opacity: 0.75,
                dashArray: '6 6',
                interactive: false,
              },
            ).addTo(tLayer);
          }
        }
      }
    }

    if (plannedRoute) {
      const routeBounds: L.LatLngBoundsExpression = [
        [plannedRoute.originLat, plannedRoute.originLon],
        [plannedRoute.destLat, plannedRoute.destLon],
      ];
      L.polyline(routeBounds, {
        renderer,
        color: '#D946EF',
        weight: 2.5,
        dashArray: '6 6',
      }).addTo(tLayer);
      mapRef.current?.fitBounds(routeBounds, {padding: [48, 48], maxZoom: 7});
    }
  }, [
    selectedFlight,
    selectedDetail,
    plannedRoute,
    isolateSelected,
    unifiedAirports,
    settings.flightPathMode,
    isDark,
    viewportTick,
  ]);

  const currentFrameTime =
    rainviewer && rainviewer.frames[radarFrameIdx]
      ? new Date(rainviewer.frames[radarFrameIdx].time * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <div className={`relative w-full h-full overflow-hidden bg-card ${isMobilePortrait ? 'skydeck-mobile-map' : ''}`}>
      <div ref={mapDivRef} className="w-full h-full" />

      {/* Crisp Floating Aircraft Hover Tooltip for Canvas2D Plane Targets */}
      <div
        ref={hoverTooltipRef}
        className="pointer-events-none fixed left-0 top-0 z-[720] rounded-lg border border-border bg-card/95 px-2.5 py-1 font-mono text-[11px] font-medium text-foreground shadow-lg backdrop-blur-md transition-opacity duration-100 whitespace-nowrap"
        style={{opacity: 0}}
      />

      {/* Top-Right Compact GeoFS Altitude Legend & Optional Weather Radar Player */}
      <div className="hidden md:flex absolute top-3 right-14 z-[450] flex-wrap items-center gap-2.5 rounded-full bg-card/90 backdrop-blur-md border border-border px-3.5 py-1.5 text-[10.5px] shadow-sm transition-all">
        {settings.showRadar && rainviewer && rainviewer.frames.length > 0 && (
          <div className="flex items-center gap-2 pr-2.5 border-r border-border">
            <button
              type="button"
              onClick={() => setRadarPlaying((p) => !p)}
              aria-label={radarPlaying ? 'Pause weather radar loop' : 'Play weather radar loop'}
              className="p-1 rounded-full bg-secondary text-foreground hover:text-primary cursor-pointer"
            >
              {radarPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
            <input
              type="range"
              min={0}
              max={rainviewer.frames.length - 1}
              value={radarFrameIdx}
              onChange={(e) => {
                setRadarPlaying(false);
                setRadarFrameIdx(Number(e.target.value));
              }}
              className="w-16 accent-[#13233a] dark:accent-sky-400"
              aria-label="Precipitation radar frame"
            />
            <span className="font-mono tabular-nums text-muted-foreground">{currentFrameTime}</span>
          </div>
        )}
        <div className="flex items-center gap-2 font-mono text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#FACC15]" />
            0k
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            10k
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
            25k
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#7C5CBF]" />
            30k
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#BE185D]" />
            40k
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#F472B6]" />
            50k+
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#F9D949]" />
            ACFT
          </span>
          {loading && flights.length === 0 && (
            <span className="text-primary font-semibold ml-1">Syncing…</span>
          )}
        </div>
      </div>
    </div>
  );
};
