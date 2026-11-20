import {
  Compass,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {AIRPORT_CATALOG, type RegionPreset} from '../data/aviationCatalog';
import {apiFetchJson, DEFAULT_CF_WORKER_URL} from '../services/directAviationClient';
import {AviationOverlaysManager, type AviationHudLabel} from '../three/aviationOverlays';
import {World3DBuildingsManager} from '../three/cesiumBuildingsLayer';
import {
  buildGpuAirfieldGroup,
  PersistentAirfieldStore,
  type AirfieldHudLabel,
  type GpuAirfieldGroupHandle,
} from '../three/gpuAirfieldEngine';
import {
  GpuTileManager,
  latToMy,
  lonToMx,
  MERCATOR_WORLD_M,
  mercatorScaleAtLat,
  mxToLon,
  myToLat,
  type BasemapVariant,
} from '../three/gpuTileLayer';
import {buildWorld3DAircraft, type WorldAircraftHandle} from '../three/worldAircraftPool';
import type {
  AirportDisruption,
  AirportMarker,
  AirportWeather,
  AtcBoundaryFeature,
  EnrouteChartResponse,
  FlightDetail,
  HazardCategory,
  LiveFlight,
  OceanicTrackSpec,
  RadarSettings,
  RainViewerMeta,
  SigmetHazard,
} from '../types/aviation';
import {
  buildFr24AircraftSvg,
  getDbFlagMeta,
  getEmergencySquawkMeta,
  resolveFr24ModelClass,
  type Fr24ModelClass,
} from './aircraftIcons';
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
  show3DBuildings: false,
  showDayNightLine: true,
  showAtcBoundaries: true,
  showOceanicTracks: true,
  showHighAirways: true,
  showLowAirways: true,
  showWaypoints: true,
  preferNoWorkerMode: false,
  apiBaseUrl: '',
  cfWorkerUrl: DEFAULT_CF_WORKER_URL,
};

const BASEMAP_LABEL: Record<RadarSettings['basemapStyle'], string> = {
  auto: 'Google Terrain',
  terrain: 'Terrain Day',
  'terrain-night': 'Terrain Night',
  light: 'Terrain Light',
  dark: 'Terrain Dark',
  satellite: 'Satellite',
  osm: 'OSM Vector',
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
          <h3 className="text-xs font-semibold text-foreground">Radar &amp; Overlay Settings</h3>
          <p className="text-[11px] text-muted-foreground">Customize aircraft scale, times &amp; layers</p>
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
          {(['auto', 'terrain', 'terrain-night', 'satellite', 'osm'] as const).map((style) => (
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

      {/* Aeronautical & World Chart Overlays */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-foreground">Aeronautical Charts &amp; World Layers</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              {key: 'showDayNightLine', label: 'Day/Night Line'},
              {key: 'showAtcBoundaries', label: 'ATC Boundaries'},
              {key: 'showOceanicTracks', label: 'Oceanic Tracks'},
              {key: 'showHighAirways', label: 'High Airways'},
              {key: 'showLowAirways', label: 'Low Airways'},
              {key: 'showWaypoints', label: 'Nav Waypoints'},
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
              {key: 'show3DBuildings', label: '3D Buildings (OSM/Cesium)'},
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
              Bypass .workers.dev relays using direct ADS-B, China FR24 relays &amp; live snapshots
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
  onSelectFlight: (flight: LiveFlight, opts?: {in3DMode?: boolean}) => void;
  onSelectAirport: (airport: {icao: string; iata: string; name: string}) => void;
  onBoundsChange: (
    bounds: {lamin: number; lomin: number; lamax: number; lomax: number},
    zoom: number,
  ) => void;
}

interface GeoBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

const FLT_CAT_COLOR: Record<string, string> = {
  VFR: '#16A34A',
  MVFR: '#0284C7',
  IFR: '#DC2626',
  LIFR: '#C026D3',
  UNK: '#64748B',
};

const GEOFS_ALT_STOPS: Array<{altFt: number; rgb: [number, number, number]}> = [
  {altFt: 0, rgb: [250, 204, 21]},
  {altFt: 10000, rgb: [34, 197, 94]},
  {altFt: 25000, rgb: [37, 99, 235]},
  {altFt: 30000, rgb: [124, 92, 191]},
  {altFt: 40000, rgb: [190, 24, 93]},
  {altFt: 50000, rgb: [244, 114, 182]},
];

function geofsAltitudeRgbNorm(altitudeFt: number): [number, number, number] {
  const alt = Math.max(0, altitudeFt);
  if (alt >= GEOFS_ALT_STOPS[GEOFS_ALT_STOPS.length - 1].altFt) {
    const [r, g, b] = GEOFS_ALT_STOPS[GEOFS_ALT_STOPS.length - 1].rgb;
    return [r / 255, g / 255, b / 255];
  }
  for (let i = 0; i < GEOFS_ALT_STOPS.length - 1; i++) {
    const a = GEOFS_ALT_STOPS[i];
    const b = GEOFS_ALT_STOPS[i + 1];
    if (alt >= a.altFt && alt <= b.altFt) {
      const t = (alt - a.altFt) / (b.altFt - a.altFt);
      return [
        (a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t) / 255,
        (a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t) / 255,
        (a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t) / 255,
      ];
    }
  }
  return [0.98, 0.8, 0.08];
}

function classifySigmetCategory(sig: SigmetHazard): HazardCategory {
  if (sig.category) return sig.category;
  const text = `${sig.hazard} ${sig.rawText}`.toUpperCase();
  if (/TURB|LLWS|MTW|CAT/.test(text)) return 'turbulence';
  if (/ICE|ICG|FZLVL|FZL|MIX|CLR/.test(text)) return 'icing';
  return 'advisory';
}

type TrailPt = {lat: number; lon: number; altFt: number};

function sanitizeAndSmoothTrail(
  rawPoints: TrailPt[],
  flight: LiveFlight,
  liveLat?: number,
  liveLon?: number,
): TrailPt[][] {
  const chains: TrailPt[][] = [];
  let current: TrailPt[] = [];

  for (const pt of rawPoints) {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
    const prev = current[current.length - 1];
    if (prev) {
      const dLat = Math.abs(pt.lat - prev.lat);
      const dLon = Math.abs(pt.lon - prev.lon);
      if (dLat < 0.00015 && dLon < 0.00015) continue;
      // Only break into a separate chain across antimeridian or extreme teleports (>12 deg)
      if (dLat > 12.0 || dLon > 12.0) {
        if (current.length >= 2) chains.push(current);
        current = [pt];
        continue;
      }
    }
    current.push(pt);
  }

  const tipLat = liveLat ?? flight.lat;
  const tipLon = liveLon ?? flight.lon;
  if (Number.isFinite(tipLat) && Number.isFinite(tipLon)) {
    const liveTip: TrailPt = {lat: tipLat, lon: tipLon, altFt: flight.altitudeFt};
    const last = current[current.length - 1];
    if (!last) {
      current.push(liveTip);
    } else {
      const dLat = Math.abs(liveTip.lat - last.lat);
      const dLon = Math.abs(liveTip.lon - last.lon);
      if (dLat > 12.0 || dLon > 12.0) {
        if (current.length >= 2) chains.push(current);
        current = [liveTip];
      } else if (dLat > 0.00005 || dLon > 0.00005) {
        current.push(liveTip);
      } else {
        current[current.length - 1] = liveTip;
      }
    }
  }
  if (current.length >= 2) chains.push(current);
  if (chains.length === 0) return [];

  const smoothedChains: TrailPt[][] = [];
  for (const chain of chains) {
    const despiked: TrailPt[] = [chain[0]];
    for (let i = 1; i < chain.length - 1; i++) {
      const a = despiked[despiked.length - 1];
      const b = chain[i];
      const c = chain[i + 1];
      const v1x = b.lon - a.lon;
      const v1y = b.lat - a.lat;
      const v2x = c.lon - b.lon;
      const v2y = c.lat - b.lat;
      const m1 = Math.hypot(v1x, v1y);
      const m2 = Math.hypot(v2x, v2y);
      if (m1 > 0 && m2 > 0 && m1 < 0.035 && m2 < 0.035) {
        const cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
        if (cos < -0.82) continue;
      }
      despiked.push(b);
    }
    despiked.push(chain[chain.length - 1]);
    if (despiked.length < 2) continue;

    // 1-pass Chaikin smoothing keeps sharp terminal turns while smoothing cruise legs
    let curr = despiked;
    if (curr.length >= 4 && curr.length <= 260) {
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
    smoothedChains.push(curr);
  }
  return smoothedChains;
}

function getZoomRegionFlightCap(zoom: number): number {
  if (zoom < 4.2) return 150;
  if (zoom < 6.0) return 260;
  if (zoom < 8.2) return 380;
  if (zoom < 11.0) return 560;
  return 900;
}

function selectFlightsForZoomAndRegion(
  flights: LiveFlight[],
  bounds: GeoBounds,
  zoom: number,
  selectedFlightId: string | null,
  isolateSelected: boolean,
): LiveFlight[] {
  if (isolateSelected && selectedFlightId) {
    return flights.filter((f) => f.id === selectedFlightId);
  }

  const maxCap = getZoomRegionFlightCap(zoom);
  const contains = (lat: number, lon: number) =>
    lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;

  const inBounds = flights.filter(
    (f) => f.id === selectedFlightId || contains(f.lat, f.lon),
  );
  if (inBounds.length <= maxCap) return inBounds;

  const mustKeep: LiveFlight[] = [];
  const candidates: LiveFlight[] = [];

  for (const f of inBounds) {
    if (
      f.id === selectedFlightId ||
      getEmergencySquawkMeta(f.squawk) ||
      f.isLadd ||
      f.isMilitary ||
      f.isPia
    ) {
      mustKeep.push(f);
    } else {
      candidates.push(f);
    }
  }

  if (mustKeep.length >= maxCap) return mustKeep.slice(0, maxCap);

  const remainingBudget = maxCap - mustKeep.length;
  if (candidates.length <= remainingBudget) return [...mustKeep, ...candidates];

  const latSpan = Math.max(0.05, bounds.north - bounds.south);
  const lonSpan = Math.max(0.05, bounds.east - bounds.west);
  const cols = zoom < 6 ? 12 : zoom < 10 ? 10 : 8;
  const rows = zoom < 6 ? 8 : 6;
  const buckets = new Map<number, LiveFlight[]>();

  for (const f of candidates) {
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((f.lon - bounds.west) / lonSpan) * cols)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((f.lat - bounds.south) / latSpan) * rows)));
    const cellIdx = row * cols + col;
    const arr = buckets.get(cellIdx);
    if (arr) arr.push(f);
    else buckets.set(cellIdx, [f]);
  }

  const cellQueues = Array.from(buckets.values());
  for (const q of cellQueues) {
    q.sort((a, b) => {
      if (a.onGround !== b.onGround) return a.onGround ? 1 : -1;
      return (b.lastContactEpoch || 0) - (a.lastContactEpoch || 0);
    });
  }

  const chosen: LiveFlight[] = [...mustKeep];
  let round = 0;
  while (chosen.length < maxCap) {
    let addedInRound = false;
    for (const q of cellQueues) {
      if (round < q.length) {
        chosen.push(q[round]);
        addedInRound = true;
        if (chosen.length >= maxCap) break;
      }
    }
    if (!addedInRound) break;
    round++;
  }
  return chosen;
}

// Shared Texture Cache for Crisp FR24 SVG Aircraft Sprites in GPU 2D View
const fr24SpriteTexCache = new Map<string, THREE.CanvasTexture>();
function getFr24SpriteTexture(
  modelClass: Fr24ModelClass,
  fill: string,
  stroke: string,
  onReady: () => void,
): THREE.CanvasTexture {
  const key = `${modelClass}|${fill}|${stroke}`;
  const hit = fr24SpriteTexCache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  // Immediate fallback triangle until SVG finishes decoding (first ~2ms)
  g.fillStyle = fill;
  g.strokeStyle = stroke;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(64, 16);
  g.lineTo(106, 102);
  g.lineTo(64, 82);
  g.lineTo(22, 102);
  g.closePath();
  g.fill();
  g.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  fr24SpriteTexCache.set(key, tex);

  const rawSvg = buildFr24AircraftSvg(modelClass, 112, fill, stroke);
  const svg = rawSvg.includes('xmlns=')
    ? rawSvg
    : rawSvg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  const img = new Image();
  img.onload = () => {
    g.clearRect(0, 0, 128, 128);
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 2;
    g.drawImage(img, 8, 8, 112, 112);
    tex.needsUpdate = true;
    onReady();
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return tex;
}

interface PooledFlightState {
  flight: LiveFlight;
  sortScore: number;
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

interface ScreenHitTarget {
  x: number;
  y: number;
  r: number;
  flight: LiveFlight;
}

interface ProjectedAirportBadge {
  icao: string;
  iata: string;
  name: string;
  x: number;
  y: number;
  tier: 1 | 2 | 3;
  catColor: string;
  isSelected: boolean;
  wxCat?: string;
}

interface ProjectedPlaneTag {
  id: string;
  x: number;
  y: number;
  text: string;
  kind: 'emerg' | 'ladd' | 'mil' | 'std';
}

interface ProjectedSurfaceLabel extends AirfieldHudLabel {
  id: string;
  x: number;
  y: number;
}

const FOV_DEG = 46;
const FOV_HALF_RAD = THREE.MathUtils.degToRad(FOV_DEG * 0.5);
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Reusable scratch vectors (zero per-frame GC pressure)
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _hitPt = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _dummyMatrix = new THREE.Matrix4();
const _dummyQuat = new THREE.Quaternion();
const _dummyScale = new THREE.Vector3();

function worldAltY(altitudeFt: number, onGround: boolean, zoom: number, mercScale: number, pitchDeg: number): number {
  if (pitchDeg <= 12) return 1.65;
  if (onGround) return 0.9 * mercScale;
  const altM = Math.max(40, altitudeFt * 0.3048);
  const exag =
    zoom >= 14.5 ? 1.0 : zoom >= 12 ? 1.35 : zoom >= 9.5 ? 2.2 : zoom >= 7 ? 3.8 : 7.0;
  return altM * exag * mercScale;
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
  const mountDivRef = useRef<HTMLDivElement | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement | null>(null);
  const airportHudRef = useRef<HTMLDivElement | null>(null);
  const planeHudRef = useRef<HTMLDivElement | null>(null);

  const [radarFrameIdx, setRadarFrameIdx] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [hudCamera, setHudCamera] = useState<{zoom: number; bearing: number; pitch: number}>({
    zoom: activeRegion.zoom,
    bearing: 0,
    pitch: 0,
  });
  const [airportBadges, setAirportBadges] = useState<ProjectedAirportBadge[]>([]);
  const [planeTags, setPlaneTags] = useState<ProjectedPlaneTag[]>([]);
  const [surfaceLabels, setSurfaceLabels] = useState<ProjectedSurfaceLabel[]>([]);
  const [navLabels, setNavLabels] = useState<Array<AviationHudLabel & {x: number; y: number}>>([]);
  const buildingsEnabledRef = useRef<boolean>(Boolean(settings.show3DBuildings));
  buildingsEnabledRef.current = Boolean(settings.show3DBuildings);

  // Live prop refs for stable 60fps WebGL loop
  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  const selectedFlightRef = useRef(selectedFlight);
  selectedFlightRef.current = selectedFlight;
  const selectedDetailRef = useRef(selectedDetail);
  selectedDetailRef.current = selectedDetail;
  const selectedAirportIcaoRef = useRef(selectedAirportIcao);
  selectedAirportIcaoRef.current = selectedAirportIcao;
  const airportsRef = useRef(airports);
  airportsRef.current = airports;
  const sigmetsRef = useRef(sigmets);
  sigmetsRef.current = sigmets;
  const disruptionsRef = useRef(disruptions);
  disruptionsRef.current = disruptions;
  const rainviewerRef = useRef(rainviewer);
  rainviewerRef.current = rainviewer;
  const radarFrameIdxRef = useRef(radarFrameIdx);
  radarFrameIdxRef.current = radarFrameIdx;
  const plannedRouteRef = useRef(plannedRoute);
  plannedRouteRef.current = plannedRoute;
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const followSelectedRef = useRef(followSelected);
  followSelectedRef.current = followSelected;
  const isolateSelectedRef = useRef(isolateSelected);
  isolateSelectedRef.current = isolateSelected;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const onSelectRef = useRef(onSelectFlight);
  onSelectRef.current = onSelectFlight;
  const onSelectAirportRef = useRef(onSelectAirport);
  onSelectAirportRef.current = onSelectAirport;
  const onBoundsRef = useRef(onBoundsChange);
  onBoundsRef.current = onBoundsChange;
  const onUserDragBreakFollowRef = useRef(onUserDragBreakFollow);
  onUserDragBreakFollowRef.current = onUserDragBreakFollow;

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

  const unifiedAirportsRef = useRef(unifiedAirports);
  unifiedAirportsRef.current = unifiedAirports;

  // Camera state managed cleanly inside ref for GPU interpolation + inertia
  const camStateRef = useRef({
    mx: lonToMx(activeRegion.center[1]),
    my: latToMy(activeRegion.center[0]),
    zoom: activeRegion.zoom,
    bearingDeg: 0,
    pitchDeg: 0,
    elevOffsetM: 0,
    targetMx: lonToMx(activeRegion.center[1]),
    targetMy: latToMy(activeRegion.center[0]),
    targetZoom: activeRegion.zoom,
    targetBearingDeg: 0,
    targetPitchDeg: 0,
    targetElevOffsetM: 0,
    velMx: 0,
    velMy: 0,
  });

  const dirtyRef = useRef({
    trails: true,
    hazards: true,
    airfields: true,
    flights: true,
    clouds: true,
    tileAndHud: true,
    dayNight: true,
    atc: true,
    oceanic: true,
    enroute: true,
  });

  const clientTrailMapRef = useRef<Map<string, TrailPt[]>>(new Map());
  const flightPoolRef = useRef<Map<string, PooledFlightState>>(new Map());
  const hitTargetsRef = useRef<ScreenHitTarget[]>([]);

  // Accumulate & merge client trail breadcrumbs without discarding fresh updates
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
      let merged: TrailPt[];
      if (incoming.length > 0) {
        merged = [...incoming];
        const incLast = incoming[incoming.length - 1];
        for (const ep of existing) {
          if (Math.hypot(ep.lat - incLast.lat, ep.lon - incLast.lon) > 0.001) {
            // Keep prior client breadcrumbs only if they don't duplicate incoming tail
            if (merged.length < 380 && Math.hypot(ep.lat - merged[merged.length - 1].lat, ep.lon - merged[merged.length - 1].lon) > 0.0005) {
              merged.push(ep);
            }
          }
        }
      } else {
        merged = [...existing];
      }
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({lat: f.lat, lon: f.lon, altFt: f.altitudeFt});
      } else {
        const dist = Math.hypot(f.lat - last.lat, f.lon - last.lon);
        if (dist > 0.00025 && dist < 12.0) {
          merged.push({lat: f.lat, lon: f.lon, altFt: f.altitudeFt});
        } else if (dist <= 0.00025) {
          merged[merged.length - 1] = {lat: f.lat, lon: f.lon, altFt: f.altitudeFt};
        }
      }
      if (merged.length > 400) merged.splice(0, merged.length - 400);
      map.set(key, merged);
    }

    // Update Flight Pool smoothly without overshoot
    const nowMs = performance.now();
    const pool = flightPoolRef.current;
    const seen = new Set<string>();
    for (const f of flights) {
      seen.add(f.id);
      const isSelected = selectedFlight?.id === f.id;
      const emerg = getEmergencySquawkMeta(f.squawk);
      const sortScore = emerg
        ? 4
        : isSelected
          ? 3
          : f.isLadd
            ? 2
            : f.isMilitary
              ? 1
              : f.onGround
                ? -1
                : 0;

      const existing = pool.get(f.id);
      if (existing) {
        existing.sortScore = sortScore;
        const moved =
          Math.abs(f.lat - existing.targetLat) > 1e-6 ||
          Math.abs(f.lon - existing.targetLon) > 1e-6 ||
          Math.abs(f.trueTrackDeg - existing.targetTrack) > 0.2 ||
          f.lastContactEpoch !== existing.flight.lastContactEpoch;
        existing.flight = f;
        if (moved) {
          const jumpDist = Math.hypot(f.lat - existing.renderLat, f.lon - existing.renderLon);
          if (jumpDist > 1.0) {
            existing.fromLat = f.lat;
            existing.fromLon = f.lon;
            existing.renderLat = f.lat;
            existing.renderLon = f.lon;
            existing.fromTrack = f.trueTrackDeg;
            existing.renderTrack = f.trueTrackDeg;
          } else {
            existing.fromLat = existing.renderLat;
            existing.fromLon = existing.renderLon;
            existing.fromTrack = existing.renderTrack;
          }
          existing.targetLat = f.lat;
          existing.targetLon = f.lon;
          existing.targetTrack = f.trueTrackDeg;
          existing.blendStartMs = nowMs;
          existing.blendDurationMs = 1350;
          existing.lastUpdateMs = nowMs;
        }
      } else {
        pool.set(f.id, {
          flight: f,
          sortScore,
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
    }
    for (const k of pool.keys()) {
      if (!seen.has(k)) pool.delete(k);
    }
    dirtyRef.current.flights = true;
    dirtyRef.current.trails = true;
  }, [flights, selectedFlight]);

  useEffect(() => {
    dirtyRef.current.trails = true;
  }, [selectedFlight, selectedDetail, isolateSelected, plannedRoute, settings.flightPathMode]);

  useEffect(() => {
    dirtyRef.current.hazards = true;
    dirtyRef.current.clouds = true;
  }, [
    sigmets,
    disruptions,
    airports,
    settings.showSigmets,
    settings.showTurbHazards,
    settings.showIceHazards,
    settings.showAdvisoryHazards,
    settings.showDrRings,
    userLocation,
    settings.locateMeEnabled,
  ]);

  useEffect(() => {
    dirtyRef.current.airfields = true;
    dirtyRef.current.dayNight = true;
    dirtyRef.current.atc = true;
    dirtyRef.current.oceanic = true;
    dirtyRef.current.enroute = true;
    dirtyRef.current.tileAndHud = true;
  }, [
    theme,
    settings.basemapStyle,
    settings.showDayNightLine,
    settings.showAtcBoundaries,
    settings.showOceanicTracks,
    settings.showHighAirways,
    settings.showLowAirways,
    settings.showWaypoints,
  ]);

  // RainViewer auto-loop
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

  // Respond to region switch / flyToLocation / followSelected
  useEffect(() => {
    const cam = camStateRef.current;
    cam.targetMx = lonToMx(activeRegion.center[1]);
    cam.targetMy = latToMy(activeRegion.center[0]);
    cam.targetZoom = activeRegion.zoom;
    cam.velMx = 0;
    cam.velMy = 0;
  }, [activeRegion]);

  useEffect(() => {
    if (!flyToLocation) return;
    const cam = camStateRef.current;
    cam.targetMx = lonToMx(flyToLocation.lon);
    cam.targetMy = latToMy(flyToLocation.lat);
    if (flyToLocation.zoom !== undefined) {
      cam.targetZoom = Math.max(2.2, Math.min(19.0, flyToLocation.zoom));
    }
    cam.velMx = 0;
    cam.velMy = 0;
  }, [flyToLocation]);

  useEffect(() => {
    if (!plannedRoute) return;
    const midLat = (plannedRoute.originLat + plannedRoute.destLat) * 0.5;
    const midLon = (plannedRoute.originLon + plannedRoute.destLon) * 0.5;
    const span = Math.max(
      1,
      Math.abs(plannedRoute.originLat - plannedRoute.destLat),
      Math.abs(plannedRoute.originLon - plannedRoute.destLon),
    );
    const z = Math.max(2.6, Math.min(7.2, Math.round(9 - Math.log2(span) * 1.15)));
    const cam = camStateRef.current;
    cam.targetMx = lonToMx(midLon);
    cam.targetMy = latToMy(midLat);
    cam.targetZoom = z;
  }, [plannedRoute]);

  useEffect(() => {
    if (!followSelected || !selectedFlight) return;
    const cam = camStateRef.current;
    cam.targetMx = lonToMx(selectedFlight.lon);
    cam.targetMy = latToMy(selectedFlight.lat);
  }, [followSelected, selectedFlight?.id]);

  // Preload all AIRFIELD_CATALOG entries + visible airports once OpenStreetMap surface API works cleanly
  const airfieldStoreRef = useRef<PersistentAirfieldStore | null>(null);

  // Main WebGL2 / OpenGL Three.js Engine
  useEffect(() => {
    const container = mountDivRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = false;
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 540);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#cad2d3');

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight('#E0F2FE', '#1E293B', 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#FFF7ED', 1.45);
    sun.position.set(1.2, 2.2, 0.8);
    scene.add(sun);

    const wInit = container.clientWidth || 800;
    const hInit = container.clientHeight || 540;
    const camera = new THREE.PerspectiveCamera(FOV_DEG, wInit / hInit, 5, 500000);

    // Stable world anchor root:
    // Basemap tiles, airfields/runways, buildings, overlays, hazards, trails & clouds ALL share ONE GPU matrix!
    // Runways and map tiles move identically per frame with ZERO drift!
    const stableAnchorRoot = new THREE.Group();
    scene.add(stableAnchorRoot);
    const initCam = camStateRef.current;
    const worldAnchorRef = {mx: initCam.mx, my: initCam.my};

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const tileManager = new GpuTileManager(maxAniso, () => {
      dirtyRef.current.tileAndHud = true;
    });
    stableAnchorRoot.add(tileManager.getGroup());

    // Preload global base tiles + active region Google Terrain tiles immediately on website entry
    const resolveEffectiveStyle = (): BasemapVariant => {
      const s = settingsRef.current;
      if (s.basemapStyle === 'auto') {
        return themeRef.current === 'dark' ? 'terrain-night' : 'terrain';
      }
      if (s.basemapStyle === 'light') return 'terrain';
      if (s.basemapStyle === 'dark') return 'terrain-night';
      return s.basemapStyle;
    };
    tileManager.preloadWorldAndRegion(resolveEffectiveStyle(), initCam.mx, initCam.my, initCam.zoom);

    const aviationOverlays = new AviationOverlaysManager();
    stableAnchorRoot.add(aviationOverlays.root);

    // Fetch Global ATC/FIR Boundaries, Live NAT/PACOT Oceanic Tracks & Refresh Day/Night Terminator
    let lastEnrouteQueryKey = '';
    let lastEnrouteFetchMs = 0;
    let enrouteFetchInFlight = false;

    void apiFetchJson<{boundaries?: AtcBoundaryFeature[]}>('/api/nav/atc-boundaries')
      .then((res) => {
        if (!disposed && res?.boundaries?.length) {
          aviationOverlays.setAtcBoundaries(res.boundaries);
          dirtyRef.current.atc = true;
        }
      })
      .catch(() => {});

    const fetchOceanic = () => {
      void apiFetchJson<{tracks?: OceanicTrackSpec[]}>('/api/nav/oceanic-tracks')
        .then((res) => {
          if (!disposed && res?.tracks?.length) {
            aviationOverlays.setOceanicTracks(res.tracks);
            dirtyRef.current.oceanic = true;
          }
        })
        .catch(() => {});
    };
    fetchOceanic();
    const oceanicTimer = window.setInterval(fetchOceanic, 15 * 60_000);
    const dayNightTimer = window.setInterval(() => {
      dirtyRef.current.dayNight = true;
    }, 60_000);

    const airfieldsRoot = new THREE.Group();
    stableAnchorRoot.add(airfieldsRoot);
    const buildingsManager = new World3DBuildingsManager(() => {
      dirtyRef.current.tileAndHud = true;
    });
    stableAnchorRoot.add(buildingsManager.getGroup());
    const hazardsRoot = new THREE.Group();
    stableAnchorRoot.add(hazardsRoot);
    const trailsRoot = new THREE.Group();
    stableAnchorRoot.add(trailsRoot);
    const cloudsRoot = new THREE.Group();
    stableAnchorRoot.add(cloudsRoot);
    const precipRoot = new THREE.Group();
    scene.add(precipRoot);
    const aircraftRoot = new THREE.Group();
    scene.add(aircraftRoot);

    // Live 60Hz connector tip from last selected flight trail point to moving aircraft nose
    const selectedTipPositions = new Float32Array(6);
    const selectedTipGeo = new THREE.BufferGeometry();
    selectedTipGeo.setAttribute('position', new THREE.BufferAttribute(selectedTipPositions, 3));
    const selectedTipMat = new THREE.LineBasicMaterial({color: '#F59E0B', transparent: true, opacity: 0.96});
    const selectedTipLine = new THREE.Line(selectedTipGeo, selectedTipMat);
    selectedTipLine.frustumCulled = false;
    selectedTipLine.renderOrder = 12;
    selectedTipLine.visible = false;
    scene.add(selectedTipLine);
    let selectedLastTrailPt: TrailPt | null = null;

    const builtAirfields = new Map<string, {handle: GpuAirfieldGroupHandle; versionTag: string; lastSeen: number}>();
    const airfieldStore = new PersistentAirfieldStore(() => {
      dirtyRef.current.airfields = true;
    });
    airfieldStoreRef.current = airfieldStore;

    // Immediately preload ALL catalog airfields from IndexedDB + background OSM fetch at website entry!
    airfieldStore.preloadCatalogAirfields(myToLat(initCam.my), mxToLon(initCam.mx));

    // Aircraft GPU Pools:
    // 1) 2D FR24 Sprite Quads (depthTest: false & high renderOrder so terminals NEVER cover 2D airplanes!)
    const unitSpriteGeo = new THREE.PlaneGeometry(1, 1);
    unitSpriteGeo.rotateX(-Math.PI / 2);
    const ringGeo = new THREE.RingGeometry(0.62, 0.72, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMatSel = new THREE.MeshBasicMaterial({color: '#F59E0B', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false});
    const ringMatEmerg = new THREE.MeshBasicMaterial({color: '#EF4444', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false});
    const ringMatLadd = new THREE.MeshBasicMaterial({color: '#A855F7', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false});
    const stemMat = new THREE.LineBasicMaterial({color: '#38BDF8', transparent: true, opacity: 0.55});
    const stemGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1, 0),
    ]);
    const groundShadowGeo = new THREE.CircleGeometry(0.32, 12);
    groundShadowGeo.rotateX(-Math.PI / 2);
    const groundShadowMat = new THREE.MeshBasicMaterial({color: '#000000', transparent: true, opacity: 0.35, depthWrite: false});

    const spritePool = new Map<
      string,
      {
        group: THREE.Group;
        quad: THREE.Mesh;
        mat: THREE.MeshBasicMaterial;
        ring?: THREE.Mesh;
        spriteKey: string;
      }
    >();

    const world3DPool = new Map<
      string,
      {
        handle: WorldAircraftHandle;
        stem: THREE.Line;
        shadow: THREE.Mesh;
      }
    >();

    // Instanced 3D METAR Weather Clouds (dense volumetric cumulus decks in 3D World mode)
    const MAX_CLOUDS = 280;
    const cloudUnitGeo = new THREE.SphereGeometry(1, 10, 8);
    cloudUnitGeo.scale(2.5, 0.58, 1.85);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: '#F1F5F9',
      transparent: true,
      opacity: 0.56,
      roughness: 0.92,
      depthWrite: false,
    });
    const cloudInst = new THREE.InstancedMesh(cloudUnitGeo, cloudMat, MAX_CLOUDS);
    cloudInst.frustumCulled = false;
    cloudInst.count = 0;
    cloudInst.renderOrder = 14;
    cloudsRoot.add(cloudInst);

    // 3D Live Falling Precipitation Rain/Snow Shafts
    const MAX_PRECIP_DROPS = 420;
    const precipPos = new Float32Array(MAX_PRECIP_DROPS * 6);
    const precipGeo = new THREE.BufferGeometry();
    precipGeo.setAttribute('position', new THREE.BufferAttribute(precipPos, 3));
    const precipMat = new THREE.LineBasicMaterial({
      color: '#60A5FA',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const precipLines = new THREE.LineSegments(precipGeo, precipMat);
    precipLines.frustumCulled = false;
    precipLines.renderOrder = 13;
    precipLines.visible = false;
    precipRoot.add(precipLines);

    // Helper: update Three.js PerspectiveCamera from camStateRef (supports pitch up to 84deg horizon + vertical elevOffsetM)
    const syncCameraTransform = () => {
      const cam = camStateRef.current;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 540;
      const centerLat = myToLat(cam.my);
      const mPerPx = MERCATOR_WORLD_M / (256 * Math.pow(2, cam.zoom));
      const halfSpanY = 0.5 * h * mPerPx;
      const camDist = halfSpanY / Math.tan(FOV_HALF_RAD);

      const pitchRad = THREE.MathUtils.degToRad(cam.pitchDeg);
      const bearRad = THREE.MathUtils.degToRad(cam.bearingDeg);
      const fwdX = Math.sin(bearRad);
      const fwdZ = -Math.cos(bearRad);
      const horiz = camDist * Math.sin(pitchRad);
      const vert = Math.max(8, camDist * Math.cos(pitchRad) + cam.elevOffsetM);
      const targetY = Math.max(0, cam.elevOffsetM * 0.65);

      camera.aspect = w / Math.max(1, h);
      camera.near = Math.max(2, Math.min(camDist * 0.015, vert * 0.1));
      camera.far = Math.max(360000, camDist * 24);
      camera.updateProjectionMatrix();

      camera.position.set(-fwdX * horiz, vert, -fwdZ * horiz);
      camera.up.set(fwdX, 0, fwdZ);
      camera.lookAt(0, targetY, 0);
      camera.updateMatrixWorld(true);

      return {camDist, mPerPx, centerLat, w, h};
    };

    const rayToGround = (clientX: number, clientY: number, out: THREE.Vector3): boolean => {
      const rect = renderer.domElement.getBoundingClientRect();
      _ndc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      _ndc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      _raycaster.setFromCamera(_ndc, camera);
      const hit = _raycaster.ray.intersectPlane(GROUND_PLANE, out);
      if (!hit) return false;
      // Reject grazing horizon hits too far away
      if (hit.length() > camera.far * 0.45) return false;
      return true;
    };

    // Interactive Pointer & Wheel Controls (Pan, Cursor-Pinned Zoom, Right/Shift Bearing+Pitch)
    let dragMode: 'none' | 'pan' | 'orbit' = 'none';
    let lastClientX = 0;
    let lastClientY = 0;
    let downClientX = 0;
    let downClientY = 0;
    let lastMoveTime = 0;
    const pointers = new Map<number, {x: number; y: number}>();
    let prevPinchDist = 0;
    let prevPinchAngle = 0;
    let prevPinchMidX = 0;
    let prevPinchMidY = 0;
    let disposed = false;

    const canvasEl = renderer.domElement;

    const wheelAnchor = {
      active: false,
      anchorMx: 0,
      anchorMy: 0,
      startZoom: 0,
      startDMx: 0,
      startDMy: 0,
      expiresAt: 0,
    };

    const onPointerDown = (e: PointerEvent) => {
      canvasEl.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      const cam = camStateRef.current;
      wheelAnchor.active = false;

      if (pointers.size === 2) {
        dragMode = 'none';
        const pts = Array.from(pointers.values());
        prevPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        prevPinchAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
        prevPinchMidX = (pts[0].x + pts[1].x) * 0.5;
        prevPinchMidY = (pts[0].y + pts[1].y) * 0.5;
        onUserDragBreakFollowRef.current?.();
        return;
      }

      downClientX = e.clientX;
      downClientY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      lastMoveTime = performance.now();

      // Ctrl+Drag (or Meta/Shift/Alt/Right-Drag) freely looks/orbits up/down/left/right in 3D without breaking follow!
      if (e.button === 2 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        dragMode = 'orbit';
      } else if (e.button === 0) {
        dragMode = 'pan';
        cam.velMx = 0;
        cam.velMy = 0;
        onUserDragBreakFollowRef.current?.();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      }
      const cam = camStateRef.current;

      // Two-finger pinch-zoom + rotate + tilt
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
        const midX = (pts[0].x + pts[1].x) * 0.5;
        const midY = (pts[0].y + pts[1].y) * 0.5;

        if (prevPinchDist > 10) {
          const zoomDelta = Math.log2(dist / prevPinchDist);
          cam.targetZoom = THREE.MathUtils.clamp(cam.targetZoom + zoomDelta, 2.0, 19.2);
        }
        let dAng = angle - prevPinchAngle;
        if (dAng > Math.PI) dAng -= Math.PI * 2;
        if (dAng < -Math.PI) dAng += Math.PI * 2;
        cam.targetBearingDeg = (cam.targetBearingDeg - THREE.MathUtils.radToDeg(dAng) + 360) % 360;
        cam.targetPitchDeg = THREE.MathUtils.clamp(cam.targetPitchDeg - (midY - prevPinchMidY) * 0.25, 0, 84);

        prevPinchDist = dist;
        prevPinchAngle = angle;
        prevPinchMidX = midX;
        prevPinchMidY = midY;
        return;
      }

      if (dragMode === 'orbit') {
        const dx = e.clientX - lastClientX;
        const dy = e.clientY - lastClientY;
        cam.targetBearingDeg = (cam.targetBearingDeg + dx * 0.38 + 360) % 360;
        if (e.altKey) {
          const elevStep = Math.max(8, 280 * Math.pow(2, 12 - cam.zoom));
          cam.targetElevOffsetM = THREE.MathUtils.clamp(cam.targetElevOffsetM - dy * elevStep * 0.04, -500, 18000);
        } else {
          cam.targetPitchDeg = THREE.MathUtils.clamp(cam.targetPitchDeg - dy * 0.36, 0, 84);
        }
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        return;
      }

      if (dragMode === 'pan') {
        syncCameraTransform();
        const prevHit = new THREE.Vector3();
        const ok0 = cam.pitchDeg <= 56 && rayToGround(lastClientX, lastClientY, prevHit);
        const ok1 = cam.pitchDeg <= 56 && rayToGround(e.clientX, e.clientY, _hitPt);
        const now = performance.now();
        const dtMs = Math.max(8, now - lastMoveTime);

        let dMx = 0;
        let dMy = 0;
        if (ok0 && ok1) {
          dMx = (prevHit.x - _hitPt.x) / MERCATOR_WORLD_M;
          dMy = (prevHit.z - _hitPt.z) / MERCATOR_WORLD_M;
        } else {
          const dx = e.clientX - lastClientX;
          const dy = e.clientY - lastClientY;
          const mPerPx = MERCATOR_WORLD_M / (256 * Math.pow(2, cam.zoom));
          const bearRad = THREE.MathUtils.degToRad(cam.bearingDeg);
          const tiltScale = cam.pitchDeg > 56 ? 1.45 : 1.0;
          const wx = (-dx * Math.cos(bearRad) - dy * Math.sin(bearRad) * tiltScale) * mPerPx;
          const wz = (dx * Math.sin(bearRad) - dy * Math.cos(bearRad) * tiltScale) * mPerPx;
          dMx = wx / MERCATOR_WORLD_M;
          dMy = wz / MERCATOR_WORLD_M;
        }

        cam.targetMx = ((cam.targetMx + dMx) % 1 + 1) % 1;
        cam.targetMy = THREE.MathUtils.clamp(cam.targetMy + dMy, 0.03, 0.97);
        cam.mx = cam.targetMx;
        cam.my = cam.targetMy;

        const instVelX = THREE.MathUtils.clamp((dMx / dtMs) * 16.6, -0.015, 0.015);
        const instVelY = THREE.MathUtils.clamp((dMy / dtMs) * 16.6, -0.015, 0.015);
        cam.velMx = cam.velMx * 0.55 + instVelX * 0.45;
        cam.velMy = cam.velMy * 0.55 + instVelY * 0.45;

        lastClientX = e.clientX;
        lastClientY = e.clientY;
        lastMoveTime = now;
        return;
      }

      // Hover hit-testing against projected aircraft screen positions
      const rect = canvasEl.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const targets = hitTargetsRef.current;
      let best: LiveFlight | null = null;
      let bestDist = Infinity;
      for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        const d = Math.hypot(t.x - px, t.y - py);
        if (d <= t.r && d < bestDist) {
          bestDist = d;
          best = t.flight;
        }
      }
      const tipEl = hoverTooltipRef.current;
      if (best) {
        canvasEl.style.cursor = 'pointer';
        if (tipEl) {
          const em = getEmergencySquawkMeta(best.squawk);
          const db = getDbFlagMeta(best);
          tipEl.textContent = `${em ? `[${em.shortLabel}] ` : ''}${db ? `[${db.shortLabel}] ` : ''}${
            best.callsign
          } · ${best.aircraftType}${
            best.origin && best.destination ? ` · ${best.origin}→${best.destination}` : ''
          } · ${best.onGround ? 'GND' : `FL${Math.round(best.altitudeFt / 100)}`}${
            best.squawk ? ` · SQK ${best.squawk}` : ''
          }`;
          const tx = Math.min(rect.width - 210, Math.max(8, px + 14));
          const ty = Math.min(rect.height - 40, Math.max(8, py - 14));
          tipEl.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
          tipEl.style.opacity = '1';
        }
      } else {
        canvasEl.style.cursor = 'grab';
        if (tipEl) tipEl.style.opacity = '0';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const moved = Math.hypot(e.clientX - downClientX, e.clientY - downClientY);
      if (dragMode === 'pan' && moved < 6 && e.button === 0 && !e.ctrlKey && !e.metaKey) {
        const rect = canvasEl.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const targets = hitTargetsRef.current;
        let best: LiveFlight | null = null;
        let bestDist = Infinity;
        for (let i = targets.length - 1; i >= 0; i--) {
          const t = targets[i];
          const d = Math.hypot(t.x - px, t.y - py);
          if (d <= t.r && d < bestDist) {
            bestDist = d;
            best = t.flight;
          }
        }
        if (best) {
          onSelectRef.current(best, {in3DMode: camStateRef.current.pitchDeg > 10});
        }
      }
      if (pointers.size < 2) dragMode = 'none';
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camStateRef.current;
      const zoomStep = THREE.MathUtils.clamp(-e.deltaY * 0.0022, -0.75, 0.75);
      const nextZ = THREE.MathUtils.clamp(cam.targetZoom + zoomStep, 2.0, 19.2);

      if (followSelectedRef.current) {
        cam.targetZoom = nextZ;
        wheelAnchor.active = false;
        return;
      }

      syncCameraTransform();
      const hitBefore = new THREE.Vector3();
      const hasHit = rayToGround(e.clientX, e.clientY, hitBefore);
      cam.targetZoom = nextZ;

      if (hasHit && Math.abs(zoomStep) > 0.0005) {
        const anchorMx = cam.mx + hitBefore.x / MERCATOR_WORLD_M;
        const anchorMy = cam.my + hitBefore.z / MERCATOR_WORLD_M;
        const startDMx = anchorMx - cam.mx;
        const startDMy = anchorMy - cam.my;
        const startZoom = cam.zoom;
        const targetScale = Math.pow(2, startZoom - nextZ);

        cam.targetMx = ((anchorMx - startDMx * targetScale) % 1 + 1) % 1;
        cam.targetMy = THREE.MathUtils.clamp(anchorMy - startDMy * targetScale, 0.03, 0.97);

        wheelAnchor.active = true;
        wheelAnchor.anchorMx = anchorMx;
        wheelAnchor.anchorMy = anchorMy;
        wheelAnchor.startZoom = startZoom;
        wheelAnchor.startDMx = startDMx;
        wheelAnchor.startDMy = startDMy;
        wheelAnchor.expiresAt = performance.now() + 420;
      }
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onPointerLeave = () => {
      if (hoverTooltipRef.current) hoverTooltipRef.current.style.opacity = '0';
    };

    const pressedKeys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      pressedKeys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeys.delete(e.code);
    };

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('pointercancel', onPointerUp);
    canvasEl.addEventListener('pointerleave', onPointerLeave);
    canvasEl.addEventListener('wheel', onWheel, {passive: false});
    canvasEl.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h);
        dirtyRef.current.tileAndHud = true;
      }
    });
    resizeObserver.observe(container);

    // Helper: clear a Three.js Group cleanly
    const clearGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const ch = grp.children[grp.children.length - 1];
        grp.remove(ch);
        ch.traverse((node) => {
          const m = node as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) {
            if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
            else m.material.dispose();
          }
        });
      }
    };

    // Main Render Loop Helpers
    let frameId = 0;
    let lastFrameMs = performance.now();
    let lastBoundsEmitMs = 0;
    let lastEmittedKey = '';
    let lastHudSyncMs = 0;
    let lastTileHash = '';
    let lastCloudKey = '';
    let lastHazardKey = '';
    let lastTrailKey = '';

    const getVisibleBoundsApprox = (cam: typeof camStateRef.current, w: number, h: number): GeoBounds => {
      const spanMerc = Math.pow(2, -cam.zoom);
      const halfY = (spanMerc * (h / 256) * 0.55) * (cam.pitchDeg > 18 ? 1.5 : 1.1);
      const halfX = (spanMerc * (w / 256) * 0.55) * (cam.pitchDeg > 18 ? 1.5 : 1.1);
      return {
        south: Math.max(-84, myToLat(Math.min(0.98, cam.my + halfY))),
        north: Math.min(84, myToLat(Math.max(0.02, cam.my - halfY))),
        west: Math.max(-180, mxToLon(cam.mx - halfX)),
        east: Math.min(180, mxToLon(cam.mx + halfX)),
      };
    };

    const rebuildHazards = (originMx: number, originMy: number, is3D: boolean, camZoom: number) => {
      clearGroup(hazardsRoot);
      const s = settingsRef.current;

      // SIGMETs + 3D TFR / Turbulence / Icing volumes
      if (s.showSigmets) {
        for (const sig of sigmetsRef.current) {
          if (sig.coords.length < 3) continue;
          const cat = classifySigmetCategory(sig);
          if (cat === 'turbulence' && !s.showTurbHazards) continue;
          if (cat === 'icing' && !s.showIceHazards) continue;
          if (cat === 'advisory' && !s.showAdvisoryHazards) continue;

          const color = cat === 'turbulence' ? '#F59E0B' : cat === 'icing' ? '#0EA5E9' : '#EF4444';
          const shape = new THREE.Shape();
          const ptsXZ: Array<[number, number]> = [];
          sig.coords.forEach(([lat, lon], idx) => {
            const x = (lonToMx(lon) - originMx) * MERCATOR_WORLD_M;
            const z = (latToMy(lat) - originMy) * MERCATOR_WORLD_M;
            ptsXZ.push([x, z]);
            if (idx === 0) shape.moveTo(x, -z);
            else shape.lineTo(x, -z);
          });
          shape.closePath();

          const baseY = is3D
            ? worldAltY(sig.baseFt ?? 1000, false, camZoom, mercatorScaleAtLat(sig.coords[0][0]), 40)
            : 0.9;
          const topY = is3D
            ? worldAltY(sig.topFt ?? 32000, false, camZoom, mercatorScaleAtLat(sig.coords[0][0]), 40)
            : 1.0;

          if (is3D) {
            const extGeo = new THREE.ExtrudeGeometry(shape, {
              depth: Math.max(800, topY - baseY),
              bevelEnabled: false,
            });
            extGeo.rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.14,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const m = new THREE.Mesh(extGeo, mat);
            m.position.y = baseY;
            m.renderOrder = 8;
            hazardsRoot.add(m);

            const edgeGeo = new THREE.EdgesGeometry(extGeo);
            const edgeMat = new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.72});
            const edges = new THREE.LineSegments(edgeGeo, edgeMat);
            edges.position.y = baseY;
            edges.renderOrder = 9;
            hazardsRoot.add(edges);
          } else {
            const flatGeo = new THREE.ShapeGeometry(shape);
            flatGeo.rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.14,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const m = new THREE.Mesh(flatGeo, mat);
            m.position.y = 0.85;
            m.renderOrder = 7;
            hazardsRoot.add(m);

            const lineVerts: number[] = [];
            for (let i = 0; i < ptsXZ.length; i++) {
              const a = ptsXZ[i];
              const b = ptsXZ[(i + 1) % ptsXZ.length];
              lineVerts.push(a[0], 0.95, a[1], b[0], 0.95, b[1]);
            }
            const lGeo = new THREE.BufferGeometry();
            lGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
            const lMat = new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.85});
            hazardsRoot.add(new THREE.LineSegments(lGeo, lMat));
          }
        }
      }

      // Airport TFR / Disruption Restrictions
      if (s.showSigmets && s.showAdvisoryHazards) {
        for (const d of disruptionsRef.current) {
          const ap = unifiedAirportsRef.current.find(
            (a) => a.icao === d.icao || (d.iata && a.iata === d.iata),
          );
          if (!ap) continue;
          const ringColor =
            d.type === 'GS' || d.type === 'CLOSURE'
              ? '#EF4444'
              : d.type === 'GDP'
                ? '#F59E0B'
                : '#0EA5E9';
          const mScale = mercatorScaleAtLat(ap.lat);
          const rad = (d.severity === 'HIGH' ? 28000 : 18000) * mScale;
          const x = (lonToMx(ap.lon) - originMx) * MERCATOR_WORLD_M;
          const z = (latToMy(ap.lat) - originMy) * MERCATOR_WORLD_M;

          if (is3D) {
            const h = worldAltY(18000, false, camZoom, mScale, 40);
            const cylGeo = new THREE.CylinderGeometry(rad, rad, h, 36, 1, true);
            const cylMat = new THREE.MeshBasicMaterial({
              color: ringColor,
              transparent: true,
              opacity: 0.14,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const cyl = new THREE.Mesh(cylGeo, cylMat);
            cyl.position.set(x, h * 0.5, z);
            hazardsRoot.add(cyl);

            const edgeGeo = new THREE.EdgesGeometry(cylGeo);
            const edgeMat = new THREE.LineBasicMaterial({color: ringColor, transparent: true, opacity: 0.72});
            const edge = new THREE.LineSegments(edgeGeo, edgeMat);
            edge.position.set(x, h * 0.5, z);
            hazardsRoot.add(edge);
          } else {
            const cGeo = new THREE.RingGeometry(rad * 0.96, rad, 36);
            cGeo.rotateX(-Math.PI / 2);
            const cMat = new THREE.MeshBasicMaterial({
              color: ringColor,
              transparent: true,
              opacity: 0.75,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const m = new THREE.Mesh(cGeo, cMat);
            m.position.set(x, 0.9, z);
            hazardsRoot.add(m);
          }
        }
      }

      // User Location Beacon
      const uLoc = userLocationRef.current;
      if (s.locateMeEnabled && uLoc) {
        const mScale = mercatorScaleAtLat(uLoc.lat);
        const ux = (lonToMx(uLoc.lon) - originMx) * MERCATOR_WORLD_M;
        const uz = (latToMy(uLoc.lat) - originMy) * MERCATOR_WORLD_M;
        const haloG = new THREE.CircleGeometry(14000 * mScale, 32);
        haloG.rotateX(-Math.PI / 2);
        const haloM = new THREE.MeshBasicMaterial({color: '#38BDF8', transparent: true, opacity: 0.12, depthWrite: false});
        const halo = new THREE.Mesh(haloG, haloM);
        halo.position.set(ux, 0.9, uz);
        const dotG = new THREE.CircleGeometry(1800 * mScale, 20);
        dotG.rotateX(-Math.PI / 2);
        const dotM = new THREE.MeshBasicMaterial({color: '#0284C7'});
        const dot = new THREE.Mesh(dotG, dotM);
        dot.position.set(ux, 1.0, uz);
        hazardsRoot.add(halo, dot);
      }

      // Dead-Reckoning Uncertainty Rings
      if (s.showDrRings) {
        for (const f of flightsRef.current) {
          if (!f.isEstimated || f.uncertaintyNm <= 0) continue;
          const mScale = mercatorScaleAtLat(f.lat);
          const rad = f.uncertaintyNm * 1852 * mScale;
          const fx = (lonToMx(f.lon) - originMx) * MERCATOR_WORLD_M;
          const fz = (latToMy(f.lat) - originMy) * MERCATOR_WORLD_M;
          const rg = new THREE.RingGeometry(rad * 0.94, rad, 28);
          rg.rotateX(-Math.PI / 2);
          const rm = new THREE.MeshBasicMaterial({color: '#D97706', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false});
          const ring = new THREE.Mesh(rg, rm);
          ring.position.set(fx, 1.1, fz);
          hazardsRoot.add(ring);
        }
      }
    };

    const rebuildTrails = (anchorMx: number, anchorMy: number, is3D: boolean, camZoom: number, bounds: GeoBounds) => {
      clearGroup(trailsRoot);
      selectedLastTrailPt = null;
      const s = settingsRef.current;
      const sel = selectedFlightRef.current;
      const iso = isolateSelectedRef.current;

      const drawFlightTrail = (f: LiveFlight, isSel: boolean) => {
        const key = f.icao24 || f.id;
        const detailTrail =
          isSel && (selectedDetailRef.current?.trail?.length ?? 0) > 1
            ? selectedDetailRef.current!.trail.map((p) => ({lat: p.lat, lon: p.lon, altFt: p.altFt}))
            : [];
        const clientTrail = clientTrailMapRef.current.get(key) ?? [];
        const raw =
          detailTrail.length > 0
            ? [...detailTrail, ...clientTrail]
            : clientTrail;
        if (raw.length < 1 && !isSel) return;

        const pooled = flightPoolRef.current.get(f.id);
        const chains = sanitizeAndSmoothTrail(
          raw,
          f,
          pooled?.renderLat ?? f.lat,
          pooled?.renderLon ?? f.lon,
        );
        if (isSel && chains.length > 0) {
          const lastChain = chains[chains.length - 1];
          selectedLastTrailPt = lastChain[lastChain.length - 1] ?? null;
        }
        for (const chain of chains) {
          if (chain.length < 2) continue;
          const pos: number[] = [];
          const col: number[] = [];
          for (const pt of chain) {
            const x = (lonToMx(pt.lon) - anchorMx) * MERCATOR_WORLD_M;
            const z = (latToMy(pt.lat) - anchorMy) * MERCATOR_WORLD_M;
            const y = is3D
              ? worldAltY(pt.altFt, pt.altFt < 80, camZoom, mercatorScaleAtLat(pt.lat), 40)
              : isSel
                ? 1.5
                : 1.25;
            pos.push(x, y, z);
            const [r, g, b] = geofsAltitudeRgbNorm(pt.altFt);
            col.push(r, g, b);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
          const mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: isSel ? 0.96 : 0.72,
          });
          const line = new THREE.Line(geo, mat);
          line.renderOrder = isSel ? 11 : 8;
          trailsRoot.add(line);
        }
      };

      if (sel && (iso || s.flightPathMode !== 'off')) {
        drawFlightTrail(sel, true);
      }

      if (s.flightPathMode === 'all' && !iso) {
        let count = 0;
        const maxBg = camZoom >= 8 ? 140 : 60;
        for (const f of flightsRef.current) {
          if (count >= maxBg) break;
          if (f.onGround || f.id === sel?.id) continue;
          if (f.lat < bounds.south || f.lat > bounds.north || f.lon < bounds.west || f.lon > bounds.east) continue;
          drawFlightTrail(f, false);
          count++;
        }
      }

      if (sel && iso && !plannedRouteRef.current) {
        const destCode = (selectedDetailRef.current?.destinationIata || sel.destination || '').toUpperCase();
        const destIcao = (selectedDetailRef.current?.destinationIcao || '').toUpperCase();
        const destAp = unifiedAirportsRef.current.find(
          (a) => (destIcao && a.icao === destIcao) || (destCode && a.iata === destCode),
        );
        if (destAp) {
          const sx = (lonToMx(sel.lon) - anchorMx) * MERCATOR_WORLD_M;
          const sz = (latToMy(sel.lat) - anchorMy) * MERCATOR_WORLD_M;
          const sy = is3D ? worldAltY(sel.altitudeFt, sel.onGround, camZoom, mercatorScaleAtLat(sel.lat), 40) : 1.4;
          const dx = (lonToMx(destAp.lon) - anchorMx) * MERCATOR_WORLD_M;
          const dz = (latToMy(destAp.lat) - anchorMy) * MERCATOR_WORLD_M;
          const pGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(sx, sy, sz),
            new THREE.Vector3(dx, 2, dz),
          ]);
          const pMat = new THREE.LineDashedMaterial({
            color: '#38BDF8',
            dashSize: 12000,
            gapSize: 8000,
            transparent: true,
            opacity: 0.78,
          });
          const pLine = new THREE.Line(pGeo, pMat);
          pLine.computeLineDistances();
          trailsRoot.add(pLine);
        }
      }

      const route = plannedRouteRef.current;
      if (route) {
        const rGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3((lonToMx(route.originLon) - anchorMx) * MERCATOR_WORLD_M, 2, (latToMy(route.originLat) - anchorMy) * MERCATOR_WORLD_M),
          new THREE.Vector3((lonToMx(route.destLon) - anchorMx) * MERCATOR_WORLD_M, 2, (latToMy(route.destLat) - anchorMy) * MERCATOR_WORLD_M),
        ]);
        const rMat = new THREE.LineDashedMaterial({color: '#D946EF', dashSize: 15000, gapSize: 9000});
        const rLine = new THREE.Line(rGeo, rMat);
        rLine.computeLineDistances();
        trailsRoot.add(rLine);
      }
    };

    const rebuild3DClouds = (anchorMx: number, anchorMy: number, is3D: boolean, camZoom: number) => {
      if (!is3D || camZoom < 5.5) {
        cloudInst.count = 0;
        return;
      }
      let idx = 0;
      for (const wx of airportsRef.current) {
        if (idx >= MAX_CLOUDS - 4) break;
        const hasClouds =
          (wx.ceilingFt !== null && wx.ceilingFt < 26000) ||
          /BKN|OVC|SCT|RA|TS|SN|FG/.test(wx.rawMetar || '');
        if (!hasClouds) continue;
        const mScale = mercatorScaleAtLat(wx.lat);
        const ax = (lonToMx(wx.lon) - anchorMx) * MERCATOR_WORLD_M;
        const az = (latToMy(wx.lat) - anchorMy) * MERCATOR_WORLD_M;
        const ceilY = worldAltY(wx.ceilingFt ?? 6500, false, camZoom, mScale, 40);
        const puffs = /OVC|RA|TS/.test(wx.rawMetar || '') ? 4 : 2;
        const spread = (wx.flightCategory === 'IFR' ? 9500 : 7000) * mScale;
        const baseRad = Math.max(1200 * mScale, (MERCATOR_WORLD_M / (256 * Math.pow(2, camZoom))) * 18);

        for (let p = 0; p < puffs && idx < MAX_CLOUDS; p++) {
          const ang = (p * 1.9 + wx.lat) % (Math.PI * 2);
          const off = (p === 0 ? 0.15 : 0.75) * spread;
          _dummyScale.set(baseRad * (1 + (p % 2) * 0.35), baseRad * 0.75, baseRad);
          _dummyQuat.identity();
          _dummyMatrix.compose(
            _projVec.set(ax + Math.cos(ang) * off, ceilY + p * 180, az + Math.sin(ang) * off),
            _dummyQuat,
            _dummyScale,
          );
          cloudInst.setMatrixAt(idx++, _dummyMatrix);
        }
      }
      cloudInst.count = idx;
      cloudInst.instanceMatrix.needsUpdate = true;
    };

    const tick = () => {
      if (disposed) return;
      const nowMs = performance.now();
      const dt = Math.min(0.08, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
      lastFrameMs = nowMs;

      const cam = camStateRef.current;

      // Keyboard Free-Flight Navigation (WASD/Arrows pan, Q/E vertical altitude, R/F pitch up/down toward horizon)
      if (pressedKeys.size > 0) {
        const flySpeed = (Math.pow(2, -cam.zoom) * 0.45) * dt;
        const bearRad = THREE.MathUtils.degToRad(cam.bearingDeg);
        const fwdX = Math.sin(bearRad);
        const fwdZ = -Math.cos(bearRad);
        const rightX = Math.cos(bearRad);
        const rightZ = Math.sin(bearRad);
        let moved = false;
        if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) {
          cam.targetMx = ((cam.targetMx + fwdX * flySpeed) % 1 + 1) % 1;
          cam.targetMy = THREE.MathUtils.clamp(cam.targetMy + fwdZ * flySpeed, 0.03, 0.97);
          moved = true;
        }
        if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) {
          cam.targetMx = ((cam.targetMx - fwdX * flySpeed) % 1 + 1) % 1;
          cam.targetMy = THREE.MathUtils.clamp(cam.targetMy - fwdZ * flySpeed, 0.03, 0.97);
          moved = true;
        }
        if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) {
          cam.targetMx = ((cam.targetMx + rightX * flySpeed) % 1 + 1) % 1;
          cam.targetMy = THREE.MathUtils.clamp(cam.targetMy + rightZ * flySpeed, 0.03, 0.97);
          moved = true;
        }
        if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) {
          cam.targetMx = ((cam.targetMx - rightX * flySpeed) % 1 + 1) % 1;
          cam.targetMy = THREE.MathUtils.clamp(cam.targetMy - rightZ * flySpeed, 0.03, 0.97);
          moved = true;
        }
        if (pressedKeys.has('KeyE')) {
          cam.targetElevOffsetM = THREE.MathUtils.clamp(cam.targetElevOffsetM + 1600 * dt, -500, 18000);
        }
        if (pressedKeys.has('KeyQ')) {
          cam.targetElevOffsetM = THREE.MathUtils.clamp(cam.targetElevOffsetM - 1600 * dt, -500, 18000);
        }
        if (pressedKeys.has('KeyR')) {
          cam.targetPitchDeg = THREE.MathUtils.clamp(cam.targetPitchDeg + 38 * dt, 0, 84);
        }
        if (pressedKeys.has('KeyF')) {
          cam.targetPitchDeg = THREE.MathUtils.clamp(cam.targetPitchDeg - 38 * dt, 0, 84);
        }
        if (moved) onUserDragBreakFollowRef.current?.();
      }

      // Apply followSelected gently
      if (followSelectedRef.current && selectedFlightRef.current && dragMode === 'none') {
        const pooled = flightPoolRef.current.get(selectedFlightRef.current.id);
        cam.targetMx = lonToMx(pooled ? pooled.renderLon : selectedFlightRef.current.lon);
        cam.targetMy = latToMy(pooled ? pooled.renderLat : selectedFlightRef.current.lat);
      } else if (dragMode === 'none' && (Math.abs(cam.velMx) > 1e-8 || Math.abs(cam.velMy) > 1e-8)) {
        cam.targetMx = ((cam.targetMx + cam.velMx * (dt * 60)) % 1 + 1) % 1;
        cam.targetMy = THREE.MathUtils.clamp(cam.targetMy + cam.velMy * (dt * 60), 0.03, 0.97);
        const decay = Math.exp(-7.5 * dt);
        cam.velMx *= decay;
        cam.velMy *= decay;
      }

      cam.zoom = THREE.MathUtils.damp(cam.zoom, cam.targetZoom, 13, dt);
      cam.pitchDeg = THREE.MathUtils.damp(cam.pitchDeg, cam.targetPitchDeg, 11, dt);
      cam.elevOffsetM = THREE.MathUtils.damp(cam.elevOffsetM, cam.targetElevOffsetM, 10, dt);

      // Lock horizontal coords cleanly during pan or exact algebraic cursor-pinned wheel zoom
      if (dragMode === 'pan') {
        cam.mx = cam.targetMx;
        cam.my = cam.targetMy;
      } else if (
        wheelAnchor.active &&
        nowMs < wheelAnchor.expiresAt &&
        dragMode === 'none' &&
        !followSelectedRef.current &&
        Math.abs(cam.zoom - cam.targetZoom) > 0.0004
      ) {
        const curScale = Math.pow(2, wheelAnchor.startZoom - cam.zoom);
        cam.mx = ((wheelAnchor.anchorMx - wheelAnchor.startDMx * curScale) % 1 + 1) % 1;
        cam.my = THREE.MathUtils.clamp(wheelAnchor.anchorMy - wheelAnchor.startDMy * curScale, 0.03, 0.97);
      } else {
        if (wheelAnchor.active && (nowMs >= wheelAnchor.expiresAt || Math.abs(cam.zoom - cam.targetZoom) <= 0.0004)) {
          wheelAnchor.active = false;
        }
        cam.mx = THREE.MathUtils.damp(cam.mx, cam.targetMx, 14, dt);
        cam.my = THREE.MathUtils.damp(cam.my, cam.targetMy, 14, dt);
      }

      const bearDelta = ((cam.targetBearingDeg - cam.bearingDeg + 540) % 360) - 180;
      cam.bearingDeg = (cam.bearingDeg + bearDelta * (1 - Math.exp(-11 * dt)) + 360) % 360;

      const isDark = themeRef.current === 'dark';
      const s = settingsRef.current;
      const effectiveStyle = resolveEffectiveStyle();
      const isNightTerrain = effectiveStyle === 'terrain-night' || effectiveStyle === 'dark' || effectiveStyle === 'satellite';
      (scene.background as THREE.Color).set(
        isNightTerrain ? '#0e1726' : '#c6d5d8',
      );

      const {mPerPx, w, h} = syncCameraTransform();
      const originMx = cam.mx;
      const originMy = cam.my;
      const is3D = cam.pitchDeg > 10;
      const bounds = getVisibleBoundsApprox(cam, w, h);

      // Rebase stable world anchor ONLY if camera drifted > 0.04 Mercator units (~1,600km)
      let rebasedAnchor = false;
      if (Math.hypot(originMx - worldAnchorRef.mx, originMy - worldAnchorRef.my) > 0.04) {
        worldAnchorRef.mx = originMx;
        worldAnchorRef.my = originMy;
        rebasedAnchor = true;
        dirtyRef.current.tileAndHud = true;
        dirtyRef.current.hazards = true;
        dirtyRef.current.trails = true;
        dirtyRef.current.clouds = true;
        dirtyRef.current.dayNight = true;
        dirtyRef.current.atc = true;
        dirtyRef.current.oceanic = true;
        dirtyRef.current.enroute = true;
      }
      stableAnchorRoot.position.set(
        (worldAnchorRef.mx - originMx) * MERCATOR_WORLD_M,
        0,
        (worldAnchorRef.my - originMy) * MERCATOR_WORLD_M,
      );

      // Debounced bounds notification to parent app (for API traffic & airport queries)
      if (nowMs - lastBoundsEmitMs > 260) {
        const bKey = `${cam.mx.toFixed(4)}|${cam.my.toFixed(4)}|${cam.zoom.toFixed(1)}`;
        if (bKey !== lastEmittedKey) {
          lastEmittedKey = bKey;
          lastBoundsEmitMs = nowMs;
          onBoundsRef.current(
            {
              lamin: bounds.south,
              lomin: bounds.west,
              lamax: bounds.north,
              lomax: bounds.east,
            },
            cam.zoom,
          );
        }
      }

      // 1) Update Google Terrain Tiles + RainViewer Precipitation Overlay (anchored to stableAnchorRoot!)
      const rv = rainviewerRef.current;
      const rvFrame = rv && rv.frames.length > 0 ? rv.frames[radarFrameIdxRef.current] ?? rv.frames[rv.frames.length - 1] : null;
      const rvUrl = rv && rvFrame ? `${rv.host}${rvFrame.path}/256/{z}/{x}/{y}/2/1_1.png` : undefined;
      const tileCellX = Math.floor(cam.mx * 4096);
      const tileCellY = Math.floor(cam.my * 4096);
      const tileHash = `${tileCellX}|${tileCellY}|${cam.zoom.toFixed(2)}|${effectiveStyle}|${s.showRadar}|${rvUrl || ''}|${cam.pitchDeg.toFixed(0)}|${w}|${h}`;

      if (tileHash !== lastTileHash || dirtyRef.current.tileAndHud || rebasedAnchor) {
        lastTileHash = tileHash;
        dirtyRef.current.tileAndHud = false;
        tileManager.update({
          anchorMx: worldAnchorRef.mx,
          anchorMy: worldAnchorRef.my,
          centerMx: cam.mx,
          centerMy: cam.my,
          zoom: cam.zoom,
          style: effectiveStyle,
          showRadar: s.showRadar,
          radarOpacity: s.radarOpacity,
          radarUrlTemplate: rvUrl,
          aspect: w / Math.max(1, h),
          fovDeg: FOV_DEG,
          pitchDeg: cam.pitchDeg,
        });
      }

      // 1b) Update Day/Night Line, ATC Boundaries, Oceanic Tracks & Enroute Aeronautical Charts
      const zoomBand = Math.floor(cam.zoom / 1.5);
      if (dirtyRef.current.dayNight) {
        dirtyRef.current.dayNight = false;
        aviationOverlays.rebuildDayNight(worldAnchorRef.mx, worldAnchorRef.my, s.showDayNightLine);
      }
      if (dirtyRef.current.atc) {
        dirtyRef.current.atc = false;
        aviationOverlays.rebuildAtcBoundaries(
          worldAnchorRef.mx,
          worldAnchorRef.my,
          s.showAtcBoundaries,
          isNightTerrain,
        );
      }
      if (dirtyRef.current.oceanic) {
        dirtyRef.current.oceanic = false;
        aviationOverlays.rebuildOceanicTracks(
          worldAnchorRef.mx,
          worldAnchorRef.my,
          s.showOceanicTracks,
        );
      }

      // Fetch viewport enroute airways + waypoints when bounds/zoom bracket shifts
      const wantsEnroute = s.showHighAirways || s.showLowAirways || s.showWaypoints;
      if (wantsEnroute && !enrouteFetchInFlight && nowMs - lastEnrouteFetchMs > 380) {
        const zTier = cam.zoom < 4.5 ? 1 : cam.zoom < 6.5 ? 2 : cam.zoom < 8.8 ? 3 : 4;
        const eqKey = `${bounds.south.toFixed(0)}|${bounds.north.toFixed(0)}|${bounds.west.toFixed(0)}|${bounds.east.toFixed(0)}|${zTier}`;
        if (eqKey !== lastEnrouteQueryKey) {
          lastEnrouteQueryKey = eqKey;
          lastEnrouteFetchMs = nowMs;
          enrouteFetchInFlight = true;
          const qs = new URLSearchParams({
            lamin: bounds.south.toFixed(2),
            lamax: bounds.north.toFixed(2),
            lomin: bounds.west.toFixed(2),
            lomax: bounds.east.toFixed(2),
            zoom: cam.zoom.toFixed(1),
          });
          void apiFetchJson<EnrouteChartResponse>(`/api/nav/enroute?${qs.toString()}`)
            .then((res) => {
              if (!disposed && res) {
                aviationOverlays.setEnrouteData(res);
                dirtyRef.current.enroute = true;
              }
            })
            .catch(() => {})
            .finally(() => {
              enrouteFetchInFlight = false;
            });
        }
      }

      if (dirtyRef.current.enroute) {
        dirtyRef.current.enroute = false;
        aviationOverlays.rebuildEnrouteCharts(worldAnchorRef.mx, worldAnchorRef.my, {
          showHighAirways: s.showHighAirways,
          showLowAirways: s.showLowAirways,
          showWaypoints: s.showWaypoints,
          zoom: cam.zoom,
          isNightTerrain,
        });
      }

      // 2) Persistent GPU Airfields Layer (GLUED to worldAnchorRef inside stableAnchorRoot!)
      airfieldsRoot.visible = true;
      const centerLat = myToLat(cam.my);
      const centerLon = mxToLon(cam.mx);
      if (cam.zoom >= 7.5) {
        const nearbyAps = unifiedAirportsRef.current
          .filter(
            (ap) =>
              Math.abs(ap.lat - centerLat) < 1.6 &&
              Math.abs(ap.lon - centerLon) < 2.0,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.lat - centerLat, a.lon - centerLon) -
              Math.hypot(b.lat - centerLat, b.lon - centerLon),
          )
          .slice(0, 5);

        for (const ap of nearbyAps) {
          airfieldStore.getInstant(ap.icao, ap.lat, ap.lon);
          void airfieldStore.ensureLoaded(ap.icao, ap.iata, ap.lat, ap.lon);
        }
      }

      const loadedList = airfieldStore.getAllLoaded();
      const selApCode = (selectedAirportIcaoRef.current || '').toUpperCase();
      for (const surf of loadedList) {
        const distDeg = Math.hypot(surf.lat - centerLat, surf.lon - centerLon);
        const isSelAp = Boolean(selApCode) && (surf.icao.toUpperCase() === selApCode || surf.iata.toUpperCase() === selApCode);
        const inRange =
          (cam.zoom >= 8.2 && distDeg < 1.8) ||
          (isSelAp && cam.zoom >= 6.5 && distDeg < 3.0);
        const verTag = `${surf.source}|${surf.taxiways.length}|${surf.runways.length}|${isNightTerrain ? 1 : 0}`;
        let rec = builtAirfields.get(surf.icao);

        if (inRange) {
          if (!rec || rec.versionTag !== verTag) {
            if (rec) {
              airfieldsRoot.remove(rec.handle.group);
              rec.handle.dispose();
            }
            const handle = buildGpuAirfieldGroup(surf, isNightTerrain);
            airfieldsRoot.add(handle.group);
            rec = {handle, versionTag: verTag, lastSeen: nowMs};
            builtAirfields.set(surf.icao, rec);
          }
          rec.lastSeen = nowMs;
          rec.handle.group.visible = true;
          rec.handle.set3DMode(is3D);
          rec.handle.setZoom(cam.zoom);
          rec.handle.group.position.set(
            (rec.handle.anchorMx - worldAnchorRef.mx) * MERCATOR_WORLD_M,
            0,
            (rec.handle.anchorMy - worldAnchorRef.my) * MERCATOR_WORLD_M,
          );
          if (rec.handle.lightMat) {
            rec.handle.lightMat.uniforms.uZoom.value = cam.zoom;
            rec.handle.lightMat.uniforms.uTime.value = nowMs / 1000;
            rec.handle.lightMat.uniforms.uPixelRatio.value = isSoftwareGl ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
          }
        } else if (rec) {
          rec.handle.group.visible = false;
        }
      }

      // Retain up to 48 built airfields in GPU memory
      if (builtAirfields.size > 48) {
        const sortedOld = Array.from(builtAirfields.entries())
          .filter(([, v]) => !v.handle.group.visible)
          .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
        while (builtAirfields.size > 48 && sortedOld.length > 0) {
          const [k, v] = sortedOld.shift()!;
          airfieldsRoot.remove(v.handle.group);
          v.handle.dispose();
          builtAirfields.delete(k);
        }
      }

      // Optional 3D Buildings Layer (OSM Overpass primary + Cesium Ion fallback, anchored to worldAnchorRef)
      buildingsManager.update({
        enabled: buildingsEnabledRef.current,
        is3D,
        zoom: cam.zoom,
        centerLat,
        centerLon,
        originMx: worldAnchorRef.mx,
        originMy: worldAnchorRef.my,
      });

      // 3) Rebuild Hazards / Trails / 3D Clouds ONLY on real data change or large zoom bracket shift (ZERO pan churn!)
      const hazardKey = `${worldAnchorRef.mx.toFixed(3)}|${worldAnchorRef.my.toFixed(3)}|${is3D}|${zoomBand}`;
      if (dirtyRef.current.hazards || hazardKey !== lastHazardKey) {
        dirtyRef.current.hazards = false;
        lastHazardKey = hazardKey;
        rebuildHazards(worldAnchorRef.mx, worldAnchorRef.my, is3D, cam.zoom);
      }

      const trailKey = `${worldAnchorRef.mx.toFixed(3)}|${worldAnchorRef.my.toFixed(3)}|${is3D}|${zoomBand}`;
      if (dirtyRef.current.trails || trailKey !== lastTrailKey) {
        dirtyRef.current.trails = false;
        lastTrailKey = trailKey;
        rebuildTrails(worldAnchorRef.mx, worldAnchorRef.my, is3D, cam.zoom, bounds);
      }

      const cloudKey = `${worldAnchorRef.mx.toFixed(3)}|${worldAnchorRef.my.toFixed(3)}|${is3D}|${zoomBand}`;
      if (dirtyRef.current.clouds || cloudKey !== lastCloudKey) {
        dirtyRef.current.clouds = false;
        lastCloudKey = cloudKey;
        rebuild3DClouds(worldAnchorRef.mx, worldAnchorRef.my, is3D, cam.zoom);
      }

      // Live 3D Falling Precipitation Streaks beneath stormy/rainy METAR stations
      if (is3D && cam.zoom >= 5.5) {
        let pIdx = 0;
        const tFall = (nowMs * 0.001) % 1;
        for (const wx of airportsRef.current) {
          if (pIdx >= MAX_PRECIP_DROPS) break;
          if (!/RA|TS|SH|SN|DZ/.test(wx.rawMetar || '')) continue;
          const mScale = mercatorScaleAtLat(wx.lat);
          const ax = (lonToMx(wx.lon) - originMx) * MERCATOR_WORLD_M;
          const az = (latToMy(wx.lat) - originMy) * MERCATOR_WORLD_M;
          const ceilY = worldAltY(wx.ceilingFt ?? 4500, false, cam.zoom, mScale, 40);
          const radius = 5500 * mScale;
          for (let d = 0; d < 18 && pIdx < MAX_PRECIP_DROPS; d++) {
            const ang = d * 2.399 + wx.lat * 10;
            const rr = ((d * 0.37) % 1) * radius;
            const dx = ax + Math.cos(ang) * rr;
            const dz = az + Math.sin(ang) * rr;
            const phase = (tFall + d * 0.13) % 1;
            const yTop = ceilY * (1 - phase);
            const yBot = Math.max(0, yTop - Math.max(120, ceilY * 0.16));
            const off = pIdx * 6;
            precipPos[off] = dx;
            precipPos[off + 1] = yTop;
            precipPos[off + 2] = dz;
            precipPos[off + 3] = dx;
            precipPos[off + 4] = yBot;
            precipPos[off + 5] = dz;
            pIdx++;
          }
        }
        precipGeo.setDrawRange(0, pIdx * 2);
        (precipGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        precipLines.visible = pIdx > 0;
      } else {
        precipLines.visible = false;
      }

      // 4) Update Live Aircraft (Forward priority loop + Selected NEVER reverts to 2D in 3D view!)
      const activeFlights = selectFlightsForZoomAndRegion(
        flightsRef.current,
        bounds,
        cam.zoom,
        selectedFlightRef.current?.id ?? null,
        isolateSelectedRef.current,
      );

      const nextHits: ScreenHitTarget[] = [];
      const nextTags: ProjectedPlaneTag[] = [];
      const seen2D = new Set<string>();
      const seen3D = new Set<string>();
      let used3DCount = 0;
      const MAX_3D_MODELS = isSoftwareGl ? 360 : 520;

      const selId = selectedFlightRef.current?.id ?? null;
      const sortedForDraw = [...activeFlights].sort((a, b) => {
        const aScore = a.id === selId ? 100 : getEmergencySquawkMeta(a.squawk) ? 80 : a.isLadd ? 60 : a.isMilitary ? 40 : a.onGround ? -10 : 0;
        const bScore = b.id === selId ? 100 : getEmergencySquawkMeta(b.squawk) ? 80 : b.isLadd ? 60 : b.isMilitary ? 40 : b.onGround ? -10 : 0;
        if (aScore !== bScore) return bScore - aScore;
        const da = (a.lat - centerLat) ** 2 + (a.lon - centerLon) ** 2;
        const db = (b.lat - centerLat) ** 2 + (b.lon - centerLon) ** 2;
        return da - db; // Nearest planes get 3D priority first!
      });

      let selLivePos: {wx: number; wy: number; wz: number} | null = null;

      // Forward loop so selectedFlight (index 0) and nearest aircraft ALWAYS receive 3D models first
      for (let i = 0; i < sortedForDraw.length; i++) {
        const f = sortedForDraw[i];
        const entry = flightPoolRef.current.get(f.id);
        if (!entry) continue;

        const t =
          entry.blendDurationMs > 0
            ? Math.min(1, Math.max(0, (nowMs - entry.blendStartMs) / entry.blendDurationMs))
            : 1;
        const ease = 1 - Math.pow(1 - t, 3);

        const rawDtSec = Math.max(0, (nowMs - entry.lastUpdateMs) / 1000);
        const glideMaxSec = f.onGround ? 0.55 : 1.6;
        const speedFactor = f.onGround ? Math.max(0, Math.min(1, (f.groundSpeedKts - 16) / 35)) : 1;
        const glideSec = Math.min(glideMaxSec, rawDtSec) * speedFactor;

        let extLat = entry.targetLat;
        let extLon = entry.targetLon;
        if (!f.isEstimated && f.groundSpeedKts > (f.onGround ? 18 : 30) && glideSec > 0.04) {
          const distNm = f.groundSpeedKts * (glideSec / 3600);
          const trkRad = THREE.MathUtils.degToRad(entry.targetTrack);
          extLat += (distNm / 60) * Math.cos(trkRad);
          extLon += ((distNm / 60) * Math.sin(trkRad)) / Math.max(0.15, Math.cos(THREE.MathUtils.degToRad(entry.targetLat)));
        }

        const nextLat = entry.fromLat + (extLat - entry.fromLat) * ease;
        const nextLon = entry.fromLon + (extLon - entry.fromLon) * ease;
        const angDelta = ((entry.targetTrack - entry.fromTrack + 540) % 360) - 180;
        const nextTrack = (entry.fromTrack + angDelta * ease + 360) % 360;
        entry.renderLat = nextLat;
        entry.renderLon = nextLon;
        entry.renderTrack = nextTrack;

        const mScale = mercatorScaleAtLat(nextLat);
        const wx = (lonToMx(nextLon) - originMx) * MERCATOR_WORLD_M;
        const wz = (latToMy(nextLat) - originMy) * MERCATOR_WORLD_M;
        const wy = worldAltY(f.altitudeFt, f.onGround, cam.zoom, mScale, cam.pitchDeg);

        const isSelected = f.id === selId;
        if (isSelected) selLivePos = {wx, wy, wz};
        const emerg = getEmergencySquawkMeta(f.squawk);
        const dbMeta = getDbFlagMeta(f);
        const modelClass = resolveFr24ModelClass(f.aircraftType, f.callsign);

        const basePx = s.planeSize;
        const iconPx = Math.max(
          13,
          Math.min(
            38,
            emerg
              ? Math.max(basePx + 6, 25)
              : isSelected
                ? basePx + 6
                : dbMeta
                  ? Math.max(basePx + 2, 19)
                  : f.onGround
                    ? Math.max(13, basePx - 3)
                    : basePx,
          ),
        );

        // Selected plane in 3D view ALWAYS renders in 3D; ALL planes up to MAX_3D_MODELS render in 3D!
        const renderAs3D = is3D && (isSelected || used3DCount < MAX_3D_MODELS);
        let hitRadiusPx = Math.max(16, iconPx * 0.75);

        if (renderAs3D) {
          used3DCount++;
          seen3D.add(f.id);
          let rec = world3DPool.get(f.id);
          if (!rec || rec.handle.modelKey.indexOf(modelClass + '|') !== 0 || (isSelected || Boolean(emerg)) !== Boolean(rec.handle.beaconMesh)) {
            if (rec) {
              aircraftRoot.remove(rec.handle.group, rec.stem, rec.shadow);
              rec.handle.dispose();
            }
            const handle = buildWorld3DAircraft(f, maxAniso, isSelected, Boolean(emerg));
            const stem = new THREE.Line(stemGeo, stemMat);
            const shadow = new THREE.Mesh(groundShadowGeo, groundShadowMat);
            aircraftRoot.add(handle.group, stem, shadow);
            rec = {handle, stem, shadow};
            world3DPool.set(f.id, rec);
          }

          const realLenM = (modelClass === 'a380' || modelClass === 'heavy4' ? 68 : modelClass === 'widebody' ? 60 : 42) * mScale;
          const desiredWorldLen = Math.max(realLenM, iconPx * 1.35 * mPerPx);
          const s3 = desiredWorldLen / 6.0;
          hitRadiusPx = Math.max(20, Math.min(84, (desiredWorldLen * 0.55) / Math.max(0.05, mPerPx)));

          rec.handle.group.visible = true;
          rec.handle.group.position.set(wx, wy, wz);
          rec.handle.group.scale.setScalar(s3);
          rec.handle.group.rotation.y = -THREE.MathUtils.degToRad(nextTrack);
          rec.handle.bodyGroup.rotation.x = f.onGround
            ? 0
            : THREE.MathUtils.clamp(f.verticalRateFpm / 4500, -0.22, 0.25);
          if (rec.handle.rotor) {
            rec.handle.rotor.rotation.y += dt * 16;
          }

          const showStem = !f.onGround && wy > 12 && (isSelected || Boolean(emerg) || cam.zoom >= 10.2);
          if (showStem) {
            rec.stem.visible = true;
            rec.stem.position.set(wx, wy, wz);
            rec.stem.scale.set(1, wy - 1.2, 1);
            rec.shadow.visible = true;
            rec.shadow.position.set(wx, 1.1, wz);
            rec.shadow.scale.setScalar(s3 * 2.2);
          } else {
            rec.stem.visible = false;
            rec.shadow.visible = false;
          }
        } else {
          seen2D.add(f.id);
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
          const stroke = emerg || isSelected ? '#ffffff' : dbMeta?.kind === 'LADD' ? '#4C1D95' : isDark ? '#0B0E14' : '#13233a';
          const sKey = `${modelClass}|${iconFill}|${stroke}|${emerg ? 'e' : isSelected ? 's' : dbMeta?.kind === 'LADD' ? 'l' : 'n'}`;

          let sp = spritePool.get(f.id);
          if (!sp || sp.spriteKey !== sKey) {
            if (sp) {
              aircraftRoot.remove(sp.group);
              sp.mat.dispose();
            }
            const tex = getFr24SpriteTexture(modelClass, iconFill, stroke, () => {
              dirtyRef.current.flights = true;
            });
            const mat = new THREE.MeshBasicMaterial({
              map: tex,
              transparent: true,
              depthTest: false,
              depthWrite: false,
            });
            const grp = new THREE.Group();
            const quad = new THREE.Mesh(unitSpriteGeo, mat);
            quad.renderOrder = isSelected || emerg ? 24 : 20;
            grp.add(quad);

            let ring: THREE.Mesh | undefined;
            if (emerg || isSelected || dbMeta?.kind === 'LADD') {
              ring = new THREE.Mesh(
                ringGeo,
                emerg ? ringMatEmerg : isSelected ? ringMatSel : ringMatLadd,
              );
              ring.position.y = -0.05;
              ring.renderOrder = 19;
              grp.add(ring);
            }
            aircraftRoot.add(grp);
            sp = {group: grp, quad, mat, ring, spriteKey: sKey};
            spritePool.set(f.id, sp);
          }

          // World size matching exact crisp pixel scale
          const worldSize = Math.max(
            (f.onGround ? 36 : 42) * mScale,
            iconPx * mPerPx,
          );
          sp.group.visible = true;
          sp.group.position.set(wx, wy, wz);
          sp.group.scale.setScalar(worldSize);
          sp.quad.rotation.y = -THREE.MathUtils.degToRad(nextTrack);
        }

        // Screen-space projection for fast picking & labels
        _projVec.set(wx, wy, wz).project(camera);
        if (_projVec.z >= -1 && _projVec.z <= 1) {
          const sx = (_projVec.x * 0.5 + 0.5) * w;
          const sy = (-_projVec.y * 0.5 + 0.5) * h;
          if (sx >= -40 && sy >= -40 && sx <= w + 40 && sy <= h + 40) {
            nextHits.push({x: sx, y: sy, r: hitRadiusPx, flight: f});

            if ((emerg || isSelected || s.showPlaneLabels) && nextTags.length < 48) {
              const text = emerg
                ? `▲ ${emerg.shortLabel} · ${f.callsign}`
                : `${dbMeta ? `[${dbMeta.shortLabel}] ` : ''}${f.callsign}${
                    f.onGround ? ' GND' : ` FL${Math.round(f.altitudeFt / 100)}`
                  }`;
              nextTags.push({
                id: f.id,
                x: sx + iconPx * 0.5 + 4,
                y: sy - 8,
                text,
                kind: emerg ? 'emerg' : dbMeta?.kind === 'LADD' ? 'ladd' : dbMeta?.kind === 'MIL' ? 'mil' : 'std',
              });
            }
          }
        }
      }

      // Live 60Hz connector tip from selected flight's trail end to its moving nose
      if (selLivePos && selectedLastTrailPt && (isolateSelectedRef.current || s.flightPathMode !== 'off')) {
        const lx = (lonToMx(selectedLastTrailPt.lon) - originMx) * MERCATOR_WORLD_M;
        const lz = (latToMy(selectedLastTrailPt.lat) - originMy) * MERCATOR_WORLD_M;
        const ly = is3D
          ? worldAltY(selectedLastTrailPt.altFt, selectedLastTrailPt.altFt < 80, cam.zoom, mercatorScaleAtLat(selectedLastTrailPt.lat), 40)
          : 1.5;
        selectedTipPositions[0] = lx;
        selectedTipPositions[1] = ly;
        selectedTipPositions[2] = lz;
        selectedTipPositions[3] = selLivePos.wx;
        selectedTipPositions[4] = selLivePos.wy;
        selectedTipPositions[5] = selLivePos.wz;
        (selectedTipGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        selectedTipLine.visible = true;
      } else {
        selectedTipLine.visible = false;
      }

      // Sweep unused pooled sprites & 3D aircraft cleanly
      for (const [k, sp] of spritePool.entries()) {
        if (!seen2D.has(k)) {
          aircraftRoot.remove(sp.group);
          sp.mat.dispose();
          spritePool.delete(k);
        }
      }
      for (const [k, rec] of world3DPool.entries()) {
        if (!seen3D.has(k)) {
          aircraftRoot.remove(rec.handle.group, rec.stem, rec.shadow);
          rec.handle.dispose();
          world3DPool.delete(k);
        }
      }

      hitTargetsRef.current = nextHits;

      // 5) Throttled (10Hz) React HUD projection sync for clickable Airport chips, Plane Labels & Top-right readouts
      if (nowMs - lastHudSyncMs > 100) {
        lastHudSyncMs = nowMs;
        setHudCamera((prev) => {
          const nz = Number(cam.zoom.toFixed(1));
          const nb = Math.round(cam.bearingDeg);
          const np = Math.round(cam.pitchDeg);
          return prev.zoom === nz && prev.bearing === nb && prev.pitch === np
            ? prev
            : {zoom: nz, bearing: nb, pitch: np};
        });
        setPlaneTags(nextTags);

        const nextAps: ProjectedAirportBadge[] = [];
        for (const ap of unifiedAirportsRef.current) {
          if (ap.tier === 3 && cam.zoom < 7.2) continue;
          if (ap.tier === 2 && cam.zoom < 5.0) continue;
          const ax = (lonToMx(ap.lon) - originMx) * MERCATOR_WORLD_M;
          const az = (latToMy(ap.lat) - originMy) * MERCATOR_WORLD_M;
          _projVec.set(ax, 2, az).project(camera);
          if (_projVec.z < -1 || _projVec.z > 1) continue;
          const sx = (_projVec.x * 0.5 + 0.5) * w;
          const sy = (-_projVec.y * 0.5 + 0.5) * h;
          if (sx < -60 || sy < -30 || sx > w + 60 || sy > h + 30) continue;
          const isSelAp =
            Boolean(selectedAirportIcaoRef.current) &&
            (selectedAirportIcaoRef.current === ap.icao ||
              (Boolean(ap.iata) && selectedAirportIcaoRef.current === ap.iata));
          nextAps.push({
            icao: ap.icao,
            iata: ap.iata || ap.icao,
            name: ap.name,
            x: sx,
            y: sy,
            tier: ap.tier,
            catColor: ap.wx ? FLT_CAT_COLOR[ap.wx.flightCategory] ?? '#64748B' : '#13233a',
            isSelected: isSelAp,
            wxCat: ap.wx?.flightCategory,
          });
        }
        nextAps.sort((a, b) => (a.isSelected ? -1 : b.isSelected ? 1 : a.tier - b.tier));
        setAirportBadges(nextAps.slice(0, 42));

        // Project Taxiway, Apron, Terminal & Close-Up Gate Labels
        const nextSurfLabels: ProjectedSurfaceLabel[] = [];
        if (cam.zoom >= 12.6) {
          for (const rec of builtAirfields.values()) {
            if (!rec.handle.group.visible) continue;
            for (const lbl of rec.handle.apronLabels) {
              if (lbl.kind === 'gate' && cam.zoom < 15.8) continue;
              if (nextSurfLabels.length >= 44) break;
              const lx = (lonToMx(lbl.lon) - originMx) * MERCATOR_WORLD_M;
              const lz = (latToMy(lbl.lat) - originMy) * MERCATOR_WORLD_M;
              _projVec.set(lx, is3D && lbl.kind === 'terminal' ? 16 : 1, lz).project(camera);
              if (_projVec.z < -1 || _projVec.z > 1) continue;
              const sx = (_projVec.x * 0.5 + 0.5) * w;
              const sy = (-_projVec.y * 0.5 + 0.5) * h;
              if (sx < 10 || sy < 10 || sx > w - 10 || sy > h - 10) continue;
              nextSurfLabels.push({...lbl, id: `${rec.handle.icao}-${lbl.kind}-${lbl.text}-${nextSurfLabels.length}`, x: sx, y: sy});
            }
            if (cam.zoom >= 13.0) {
              for (const lbl of rec.handle.taxiwayLabels) {
                if (nextSurfLabels.length >= 52) break;
                const lx = (lonToMx(lbl.lon) - originMx) * MERCATOR_WORLD_M;
                const lz = (latToMy(lbl.lat) - originMy) * MERCATOR_WORLD_M;
                _projVec.set(lx, 1, lz).project(camera);
                if (_projVec.z < -1 || _projVec.z > 1) continue;
                const sx = (_projVec.x * 0.5 + 0.5) * w;
                const sy = (-_projVec.y * 0.5 + 0.5) * h;
                if (sx < 10 || sy < 10 || sx > w - 10 || sy > h - 10) continue;
                nextSurfLabels.push({...lbl, id: `${rec.handle.icao}-twy-${lbl.text}-${nextSurfLabels.length}`, x: sx, y: sy});
              }
            }
          }
        }
        setSurfaceLabels((prev) => (prev.length === 0 && nextSurfLabels.length === 0 ? prev : nextSurfLabels));

        // Project collision-culled FIR, Oceanic Track, Airway, and Waypoint HUD labels
        const rawNav = aviationOverlays.getHudLabels({
          showAtcBoundaries: s.showAtcBoundaries,
          showOceanicTracks: s.showOceanicTracks,
          showHighAirways: s.showHighAirways,
          showLowAirways: s.showLowAirways,
          showWaypoints: s.showWaypoints,
          zoom: cam.zoom,
        });
        const nextNav: Array<AviationHudLabel & {x: number; y: number}> = [];
        const occupiedCells = new Set<string>();
        for (const lbl of rawNav) {
          if (nextNav.length >= 64) break;
          const lx = (lonToMx(lbl.lon) - originMx) * MERCATOR_WORLD_M;
          const lz = (latToMy(lbl.lat) - originMy) * MERCATOR_WORLD_M;
          _projVec.set(lx, 1, lz).project(camera);
          if (_projVec.z < -1 || _projVec.z > 1) continue;
          const sx = (_projVec.x * 0.5 + 0.5) * w;
          const sy = (-_projVec.y * 0.5 + 0.5) * h;
          if (sx < 24 || sy < 24 || sx > w - 24 || sy > h - 24) continue;
          const cellKey = `${Math.round(sx / 78)}|${Math.round(sy / 30)}`;
          if (occupiedCells.has(cellKey)) continue;
          occupiedCells.add(cellKey);
          nextNav.push({...lbl, x: sx, y: sy});
        }
        setNavLabels((prev) => (prev.length === 0 && nextNav.length === 0 ? prev : nextNav));
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.clearInterval(oceanicTimer);
      window.clearInterval(dayNightTimer);
      resizeObserver.disconnect();
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('pointerup', onPointerUp);
      canvasEl.removeEventListener('pointercancel', onPointerUp);
      canvasEl.removeEventListener('pointerleave', onPointerLeave);
      canvasEl.removeEventListener('wheel', onWheel);
      canvasEl.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);

      tileManager.dispose();
      aviationOverlays.dispose();
      buildingsManager.dispose();
      for (const rec of builtAirfields.values()) {
        rec.handle.dispose();
      }
      builtAirfields.clear();
      clearGroup(hazardsRoot);
      clearGroup(trailsRoot);

      for (const sp of spritePool.values()) {
        sp.mat.dispose();
      }
      spritePool.clear();
      for (const w3 of world3DPool.values()) {
        w3.handle.dispose();
      }
      world3DPool.clear();

      selectedTipGeo.dispose();
      selectedTipMat.dispose();
      precipGeo.dispose();
      precipMat.dispose();
      unitSpriteGeo.dispose();
      ringGeo.dispose();
      ringMatSel.dispose();
      ringMatEmerg.dispose();
      ringMatLadd.dispose();
      stemGeo.dispose();
      stemMat.dispose();
      groundShadowGeo.dispose();
      groundShadowMat.dispose();
      cloudUnitGeo.dispose();
      cloudMat.dispose();
      renderer.dispose();
      if (canvasEl.parentNode === container) {
        container.removeChild(canvasEl);
      }
    };
  }, []);

  const currentFrameTime =
    rainviewer && rainviewer.frames[radarFrameIdx]
      ? new Date(rainviewer.frames[radarFrameIdx].time * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  const isWorld3DActive = hudCamera.pitch > 10;

  return (
    <div className={`relative w-full h-full overflow-hidden bg-card ${isMobilePortrait ? 'skydeck-mobile-map' : ''}`}>
      {/* Dedicated Three.js OpenGL/WebGL2 World Map Canvas */}
      <div ref={mountDivRef} className="w-full h-full" />

      {/* Projected ATC FIR, Oceanic Track, High/Low Airway & Waypoint Labels */}
      {navLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-[402]">
          {navLabels.map((lbl) => (
            <span
              key={lbl.id}
              style={{
                transform: `translate(${Math.round(lbl.x)}px, ${Math.round(lbl.y)}px) translate(-50%, -50%)`,
              }}
              className={`absolute left-0 top-0 rounded px-1 py-0.5 font-mono font-semibold whitespace-nowrap ${
                lbl.kind === 'fir' || lbl.kind === 'oceanic-fir'
                  ? 'text-[9.5px] tracking-wider bg-slate-900/65 text-sky-200 border border-sky-400/35'
                  : lbl.kind === 'nat'
                    ? lbl.direction === 'east'
                      ? 'text-[9.5px] bg-fuchsia-950/85 text-fuchsia-200 border border-fuchsia-400/50'
                      : 'text-[9.5px] bg-cyan-950/85 text-cyan-200 border border-cyan-400/50'
                    : lbl.kind === 'airway-hi'
                      ? 'text-[8.5px] bg-blue-950/75 text-blue-200 border border-blue-400/40'
                      : lbl.kind === 'airway-lo'
                        ? 'text-[8.5px] bg-emerald-950/75 text-emerald-200 border border-emerald-400/40'
                        : 'text-[8.5px] bg-white/80 dark:bg-slate-900/80 text-blue-900 dark:text-sky-200 border border-blue-500/30 translate-y-3'
              }`}
            >
              {lbl.text}
            </span>
          ))}
        </div>
      )}

      {/* Projected Taxiway, Apron, Terminal & Close-Up Gate Labels */}
      {surfaceLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-[405]">
          {surfaceLabels.map((lbl) => (
            <span
              key={lbl.id}
              style={{
                transform: `translate(${Math.round(lbl.x)}px, ${Math.round(lbl.y)}px) translate(-50%, -50%)`,
              }}
              className={`absolute left-0 top-0 rounded px-1 py-0.5 font-mono font-bold whitespace-nowrap shadow-xs ${
                lbl.kind === 'taxiway'
                  ? 'bg-amber-400 text-[#0B101B] text-[9.5px] border border-amber-200/80'
                  : lbl.kind === 'terminal'
                    ? 'bg-sky-900/95 text-sky-100 text-[9px] border border-sky-400/50'
                    : lbl.kind === 'apron'
                      ? 'bg-slate-800/95 text-amber-200 text-[9px] border border-amber-400/40'
                      : 'bg-slate-900/90 text-slate-200 text-[8.5px] border border-slate-600'
              }`}
            >
              {lbl.text}
            </span>
          ))}
        </div>
      )}

      {/* Projected Clickable Airport METAR Pins (Solid surfaces, zero backdrop-blur over WebGL) */}
      <div ref={airportHudRef} className="pointer-events-none absolute inset-0 overflow-hidden z-[410]">
        {airportBadges.map((ap) => (
          <button
            key={ap.icao}
            type="button"
            onClick={() => onSelectAirport({icao: ap.icao, iata: ap.iata, name: ap.name})}
            title={`${ap.iata} (${ap.icao}) · ${ap.name}${ap.wxCat ? ` · ${ap.wxCat}` : ''}`}
            style={{transform: `translate(${Math.round(ap.x)}px, ${Math.round(ap.y)}px) translate(-6px, -50%)`}}
            className="pointer-events-auto absolute left-0 top-0 inline-flex items-center cursor-pointer group"
          >
            <span
              style={{
                backgroundColor: ap.isSelected ? '#F59E0B' : settings.showMetarDots ? ap.catColor : '#13233a',
                width: ap.isSelected ? 12 : ap.tier === 1 ? 10 : 8,
                height: ap.isSelected ? 12 : ap.tier === 1 ? 10 : 8,
              }}
              className="rounded-full border-2 border-white shadow shrink-0"
            />
            <span
              className={`ml-1 px-1.5 py-0.5 rounded-full font-mono font-bold tracking-tight border whitespace-nowrap shadow-xs ${
                ap.isSelected
                  ? 'bg-[#13233a] text-white border-amber-400 text-[10px]'
                  : 'bg-[#F2F7FE]/95 text-[#13233a] border-[#13233a]/25 text-[9.5px] group-hover:border-sky-500'
              }`}
            >
              {ap.iata}
            </span>
          </button>
        ))}
      </div>

      {/* Projected Aircraft Labels (Selected / Emergency / Show Labels) */}
      <div ref={planeHudRef} className="pointer-events-none absolute inset-0 overflow-hidden z-[420]">
        {planeTags.map((tag) => (
          <div
            key={tag.id}
            style={{transform: `translate(${Math.round(tag.x)}px, ${Math.round(tag.y)}px)`}}
            className={`absolute left-0 top-0 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold whitespace-nowrap border ${
              tag.kind === 'emerg'
                ? 'bg-red-600 text-white border-white'
                : tag.kind === 'ladd'
                  ? 'bg-purple-700 text-white border-purple-300'
                  : tag.kind === 'mil'
                    ? 'bg-emerald-800 text-white border-emerald-300'
                    : 'bg-[#F9D949] text-[#13233a] border-[#13233a]/40'
            }`}
          >
            {tag.text}
          </div>
        ))}
      </div>

      {/* Hover Tooltip */}
      <div
        ref={hoverTooltipRef}
        className="pointer-events-none absolute left-0 top-0 z-[720] rounded-lg border border-border bg-card px-2.5 py-1 font-mono text-[11px] font-medium text-foreground shadow-lg transition-opacity duration-100 whitespace-nowrap"
        style={{opacity: 0}}
      />

      {/* Top-Right Compact GPU Camera Controls: 3D World Toggle, Horizon Pitch/Altitude, Compass, Zoom +/- */}
      <div className="absolute top-3 right-3 z-[460] flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => {
            const nextPitch = isWorld3DActive ? 0 : 62;
            camStateRef.current.targetPitchDeg = nextPitch;
            if (isWorld3DActive) camStateRef.current.targetElevOffsetM = 0;
          }}
          title={isWorld3DActive ? 'Switch to 2D Top-Down Radar' : 'Tilt into 3D World Map with 3D Planes (Ctrl+Drag up/down/left/right)'}
          className={`h-8 px-2.5 rounded-lg border font-mono text-[11px] font-bold flex items-center gap-1.5 shadow-md transition-colors cursor-pointer ${
            isWorld3DActive
              ? 'bg-sky-600 text-white border-sky-400'
              : 'bg-card text-foreground border-border hover:bg-accent'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          {isWorld3DActive ? `3D ${hudCamera.pitch}°` : '2D Map'}
        </button>

        <button
          type="button"
          onClick={() => {
            camStateRef.current.targetBearingDeg = 0;
            camStateRef.current.targetPitchDeg = 0;
            camStateRef.current.targetElevOffsetM = 0;
          }}
          title="Reset North Up & Flat 2D (Ctrl+Drag to pan up/down/left/right in 3D)"
          className="h-8 px-2.5 rounded-lg border border-border bg-card text-foreground hover:bg-accent font-mono text-[10.5px] flex items-center justify-center gap-1 shadow-md cursor-pointer"
        >
          <Compass
            className="w-3.5 h-3.5 text-sky-400"
            style={{transform: `rotate(${-hudCamera.bearing}deg)`}}
          />
          {hudCamera.bearing}°
        </button>

        <div className="flex flex-col rounded-lg border border-border bg-card overflow-hidden shadow-md">
          <button
            type="button"
            onClick={() => {
              camStateRef.current.targetZoom = Math.min(19.2, camStateRef.current.targetZoom + 1);
            }}
            aria-label="Zoom in"
            className="h-8 w-full flex items-center justify-center text-foreground hover:bg-accent border-b border-border cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              camStateRef.current.targetZoom = Math.max(2.0, camStateRef.current.targetZoom - 1);
            }}
            aria-label="Zoom out"
            className="h-8 w-full flex items-center justify-center text-foreground hover:bg-accent cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Top-Right Compact GeoFS Altitude Legend & Optional Weather Radar Player */}
      <div className="hidden md:flex absolute top-3 right-24 z-[450] flex-wrap items-center gap-2.5 rounded-full bg-card border border-border px-3.5 py-1.5 text-[10.5px] shadow-sm">
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
          <span className="text-border">|</span>
          <span className="text-foreground/80">z{hudCamera.zoom.toFixed(1)} · Ctrl+Drag 3D / WASD</span>
          {loading && flights.length === 0 && (
            <span className="text-primary font-semibold ml-1">Syncing…</span>
          )}
        </div>
      </div>
    </div>
  );
};
