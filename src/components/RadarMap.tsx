import L from 'leaflet';
import {
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AIRPORT_CATALOG, type RegionPreset} from '../data/aviationCatalog';
import {apiFetchJson, DEFAULT_CF_WORKER_URL, getCloudflareWorkerUrl} from '../services/directAviationClient';
import {
  buildFr24AircraftSvg,
  getDbFlagMeta,
  getEmergencySquawkMeta,
  resolveFr24ModelClass,
} from './aircraftIcons';
import type {
  AirfieldSurfaceData,
  AirportMarker,
  AirportWeather,
  FlightDetail,
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
  locateMeEnabled: true,
  timeDisplayMode: 'airport',
  showPlaneLabels: false,
  showMetarDots: true,
  showSigmets: true,
  showRadar: false,
  radarOpacity: 0.5,
  showGroundTraffic: true,
  showDrRings: true,
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
        <div className="text-xs font-medium text-foreground">Map Overlays & Controls</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              {key: 'locateMeEnabled', label: 'Locate Me'},
              {key: 'showPlaneLabels', label: 'Plane Labels'},
              {key: 'showMetarDots', label: 'METAR Colors'},
              {key: 'showSigmets', label: 'SIGMET Zones'},
              {key: 'showGroundTraffic', label: 'Ground Traffic'},
              {key: 'showDrRings', label: 'DR Rings'},
              {key: 'showRadar', label: 'Precip Radar'},
            ] as const
          ).map((item) => {
            const active = settings[item.key];
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

      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Cloudflare Worker CORS Proxy</span>
            <span className="text-[10px] font-mono text-primary">
              {settings.cfWorkerUrl?.trim() || getCloudflareWorkerUrl() ? 'Worker Active' : 'Public Fallback'}
            </span>
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
                // ignore storage errors
              }
            }}
            placeholder={DEFAULT_CF_WORKER_URL}
            aria-label="Cloudflare Worker CORS proxy URL"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground leading-snug">
            Bypasses GitHub Pages / Surge CORS blocks on FR24, ADS-B.lol &amp; Overpass.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Custom Backend Relay (Optional)</span>
            <span className="text-[10px] text-muted-foreground font-mono">Netlify / Node</span>
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

function makePlaneIcon(
  flight: LiveFlight,
  isSelected: boolean,
  baseSize: number,
  isDark: boolean,
  showLabel: boolean,
  initialTrackDeg = flight.trueTrackDeg,
): L.DivIcon {
  const emerg = getEmergencySquawkMeta(flight.squawk);
  const dbMeta = getDbFlagMeta(flight);
  const modelClass = resolveFr24ModelClass(flight.aircraftType, flight.callsign);

  // Maintain #F9D949 for commercial, distinct LADD/MIL/PIA highlights, and crisp red alert for emergency squawks
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
        : isDark
          ? '#0B0E14'
          : '#13233a';
  const size = Math.max(
    14,
    Math.min(
      42,
      emerg
        ? Math.max(baseSize + 6, 26)
        : isSelected
          ? baseSize + 6
          : dbMeta
            ? Math.max(baseSize + 2, 20)
            : flight.onGround
              ? Math.max(14, baseSize - 3)
              : baseSize,
    ),
  );

  const emergBadgeHtml = emerg
    ? `<span style="margin-left:5px;padding:1px 7px;border-radius:9999px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;white-space:nowrap;background:#DC2626;color:#ffffff;border:1.5px solid #ffffff;box-shadow:0 2px 8px rgba(220,38,38,0.65);letter-spacing:0.03em;">▲ ${emerg.shortLabel} · ${flight.callsign}</span>`
    : '';

  const flagTag = dbMeta ? `[${dbMeta.shortLabel}] ` : '';
  const labelBg = dbMeta?.kind === 'LADD' ? '#7E22CE' : dbMeta?.kind === 'MIL' ? '#065F46' : '#F9D949';
  const labelFg = dbMeta?.kind === 'LADD' || dbMeta?.kind === 'MIL' ? '#ffffff' : '#13233a';

  const labelHtml = emerg
    ? emergBadgeHtml
    : showLabel || isSelected
      ? `<span style="margin-left:5px;padding:1px 7px;border-radius:9999px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;background:${labelBg};color:${labelFg};border:1px solid ${
          isSelected ? '#ffffff' : 'rgba(19,35,58,0.45)'
        };box-shadow:0 1px 4px rgba(19,35,58,0.28);">${flagTag}${flight.callsign}${
          flight.onGround ? ' GND' : ` FL${Math.round(flight.altitudeFt / 100)}`
        }</span>`
      : '';

  const ringSize = size + 16;
  const emergRingHtml = emerg
    ? `<div class="skydeck-emerg-ring" style="width:${ringSize}px;height:${ringSize}px;"></div>`
    : dbMeta?.kind === 'LADD'
      ? `<div style="position:absolute;left:50%;top:50%;width:${size + 10}px;height:${size + 10}px;transform:translate(-50%,-50%);border-radius:9999px;border:1.5px dashed #A855F7;background:rgba(168,85,247,0.12);pointer-events:none;"></div>`
      : '';

  const svgHtml = buildFr24AircraftSvg(modelClass, size, iconFill, stroke);

  return L.divIcon({
    className: 'skydeck-plane-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;">
      ${emergRingHtml}
      <div class="skydeck-plane-rot" style="position:relative;z-index:2;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transform:rotate(${initialTrackDeg.toFixed(
        1,
      )}deg);">
        ${svgHtml}
      </div>
      ${labelHtml}
    </div>`,
  });
}

interface PooledFlightMarker {
  marker: L.Marker;
  visualKey: string;
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

export const RadarMap: React.FC<RadarMapProps> = ({
  flights,
  selectedFlight,
  selectedDetail,
  selectedAirportIcao,
  mapAirports = [],
  airports,
  sigmets,
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
  const flightsLayerRef = useRef<L.LayerGroup | null>(null);
  const flightMarkersRef = useRef<Map<string, PooledFlightMarker>>(new Map());
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
  const [surfaceData, setSurfaceData] = useState<AirfieldSurfaceData | null>(null);
  const lastSurfaceKeyRef = useRef<string>('');

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
      minZoom: 3,
      maxZoom: 20,
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
    const flightsLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    surfaceLayerRef.current = surfaceLayer;
    sigmetLayerRef.current = sigmetLayer;
    allPathsLayerRef.current = allPathsLayer;
    drLayerRef.current = drLayer;
    airportLayerRef.current = airportLayer;
    trailLayerRef.current = trailLayer;
    userLayerRef.current = userLayer;
    flightsLayerRef.current = flightsLayer;

    const existingMarkerPool = flightMarkersRef.current;

    map.on('zoomstart', () => {
      isMapZoomingRef.current = true;
    });
    map.on('zoomend', () => {
      isMapZoomingRef.current = false;
      setMapZoom(map.getZoom());
    });
    map.on('dragstart', () => {
      onUserDragBreakFollowRef.current?.();
    });

    let moveTimer: number | undefined;
    map.on('moveend', () => {
      const z = map.getZoom();
      setMapZoom(z);
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
      }, 480);
    });

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      setViewportTick((t) => t + 1);
    });
    ro.observe(el);

    return () => {
      clearTimeout(moveTimer);
      ro.disconnect();
      existingMarkerPool.clear();
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
      keepBuffer: 4,
      updateWhenIdle: true,
      updateWhenZooming: false,
    };

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
          maxNativeZoom: 19,
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
      const color = sig.hazard.includes('TURB')
        ? '#F59E0B'
        : sig.hazard.includes('ICE')
          ? '#0284C7'
          : '#EF4444';
      const poly = L.polygon(sig.coords, {
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.1,
        dashArray: '4 4',
      });
      poly.bindPopup(
        `<div style="font-family:monospace;font-size:11px;max-width:260px;">
          <strong>${sig.hazard} ${sig.qualifier}</strong><br/>
          ${sig.baseFt !== null ? `FL${Math.round(sig.baseFt / 100)}` : 'SFC'} - ${
            sig.topFt !== null ? `FL${Math.round(sig.topFt / 100)}` : 'UNL'
          }<br/>
          <span style="opacity:0.8">${sig.rawText.slice(0, 180)}</span>
        </div>`,
      );
      poly.addTo(layer);
    }
  }, [sigmets, settings.showSigmets]);

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

  // Fetch detailed AIP/Overpass runway, apron & taxiway surface geometry when zoomed into an airfield (zoom >= 10.8)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapZoom < 10.8) {
      setSurfaceData(null);
      lastSurfaceKeyRef.current = '';
      return;
    }

    const center = map.getCenter();
    let bestAp: {icao: string; lat: number; lon: number} | null = null;
    let bestDist = 0.28;
    for (const ap of unifiedAirports) {
      const d = Math.hypot(ap.lat - center.lat, ap.lon - center.lng);
      if (d < bestDist) {
        bestDist = d;
        bestAp = {icao: ap.icao, lat: ap.lat, lon: ap.lon};
      }
    }

    const targetLat = bestAp ? bestAp.lat : center.lat;
    const targetLon = bestAp ? bestAp.lon : center.lng;
    const targetIcao = bestAp?.icao ?? '';
    const key = targetIcao || `${targetLat.toFixed(2)},${targetLon.toFixed(2)}`;
    if (key === lastSurfaceKeyRef.current) return;
    lastSurfaceKeyRef.current = key;

    const ac = new AbortController();
    const qs = new URLSearchParams({
      lat: targetLat.toFixed(4),
      lon: targetLon.toFixed(4),
      icao: targetIcao,
    });
    apiFetchJson<AirfieldSurfaceData>(`/api/surface?${qs.toString()}`, ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setSurfaceData(data);
      })
      .catch(() => {
        // optional overlay
      });
    return () => {
      ac.abort();
    };
  }, [mapZoom, viewportTick, unifiedAirports]);

  // Render FlightDeck-Precision Vectorized Runway, Taxiway, Approach Path & Flashing Approach Lighting Overlay
  useEffect(() => {
    const layer = surfaceLayerRef.current;
    const renderer = canvasRendererRef.current;
    if (!layer || !renderer) return;
    layer.clearLayers();
    if (!surfaceData || mapZoom < 10.8) return;

    const apronFill = isDark ? '#1e293b' : '#475569';
    const apronStroke = isDark ? '#475569' : '#1e293b';
    const taxiFill = isDark ? '#334155' : '#64748b';
    const rwyCasing = isDark ? '#94a3b8' : '#1e293b';
    const rwyAsphalt = '#0b1220';
    const twyLabelSeen = new Set<string>();

    // 1. Aprons
    for (const poly of surfaceData.aprons) {
      L.polygon(poly, {
        renderer,
        color: apronStroke,
        weight: 1,
        fillColor: apronFill,
        fillOpacity: 0.72,
        interactive: false,
      }).addTo(layer);
    }

    // 2. Taxiways + Amber Centerline + Realistic Green Centerline Lights + Blue Edge Lights + ICAO Signage
    const twyWeight = mapZoom >= 15 ? 11 : mapZoom >= 13 ? 7 : 3.5;
    for (const twy of surfaceData.taxiways) {
      L.polyline(twy.coords, {
        renderer,
        color: taxiFill,
        weight: twyWeight,
        opacity: 0.94,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(layer);

      L.polyline(twy.coords, {
        renderer,
        color: '#f59e0b',
        weight: mapZoom >= 14 ? 1.5 : 0.9,
        opacity: 0.8,
        interactive: false,
      }).addTo(layer);

      if (mapZoom >= 13 && twy.coords.length >= 2) {
        for (let segIdx = 0; segIdx < twy.coords.length - 1; segIdx++) {
          const pA = twy.coords[segIdx];
          const pB = twy.coords[segIdx + 1];
          const brg = computeBearingDeg(pA, pB);
          const subSteps = mapZoom >= 15 ? 3 : 1;
          for (let k = 0; k < subSteps; k++) {
            const frac = k / subSteps;
            const pt: [number, number] = [
              pA[0] + (pB[0] - pA[0]) * frac,
              pA[1] + (pB[1] - pA[1]) * frac,
            ];
            L.circleMarker(pt, {
              renderer,
              radius: mapZoom >= 15 ? 2.0 : 1.4,
              color: '#16a34a',
              fillColor: '#4ade80',
              fillOpacity: 0.96,
              weight: 0,
              interactive: false,
            }).addTo(layer);

            if (mapZoom >= 14.2) {
              const leftEdge = offsetLatLonMeters(pt[0], pt[1], brg, 0, -10.5);
              const rightEdge = offsetLatLonMeters(pt[0], pt[1], brg, 0, 10.5);
              for (const edgePt of [leftEdge, rightEdge]) {
                L.circleMarker(edgePt, {
                  renderer,
                  radius: mapZoom >= 15.5 ? 1.8 : 1.4,
                  color: '#0284c7',
                  fillColor: '#38bdf8',
                  fillOpacity: 0.94,
                  weight: 0,
                  interactive: false,
                }).addTo(layer);
              }
            }
          }
        }
      }

      if (mapZoom >= 13 && twy.ref) {
        const badgeKey = `${twy.ref}-${Math.round(twy.coords[0][0] * 140)}-${Math.round(twy.coords[0][1] * 140)}`;
        if (!twyLabelSeen.has(badgeKey)) {
          twyLabelSeen.add(badgeKey);
          const mid = twy.coords[Math.floor(twy.coords.length / 2)];
          L.marker(mid, {
            interactive: false,
            icon: L.divIcon({
              className: 'skydeck-taxi-badge',
              iconSize: [26, 16],
              iconAnchor: [13, 8],
              html: `<span style="display:inline-block;padding:0px 4px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;background:#090d16;color:#FACC15;border:1px solid #FACC15;box-shadow:0 1px 3px rgba(0,0,0,0.45);">${twy.ref}</span>`,
            }),
          }).addTo(layer);
        }
      }
    }

    // 3. Runways + Piano Keys + Aiming Blocks + Flashing Sequenced Approach Lights ("Rabbit") + Dashed |- - - - -| Approach Paths
    const rwyWeight = mapZoom >= 16 ? 32 : mapZoom >= 15 ? 24 : mapZoom >= 13.5 ? 15 : 9;
    const approachLabelSeen = new Set<string>();

    for (const rwy of surfaceData.runways) {
      if (rwy.coords.length < 2) continue;

      const startPt = rwy.coords[0];
      const endPt = rwy.coords[rwy.coords.length - 1];
      const brg = computeBearingDeg(startPt, endPt);
      const revBrg = (brg + 180) % 360;
      const [labelA, labelB] = deriveRunwayEndLabels(rwy.ref, brg);

      // Extended Dashed Approach Path |- - - - -| from both runway thresholds
      const drawApproachPath = (thresholdPt: [number, number], landingHeadingDeg: number, rwyLabel: string) => {
        // Outbound opposite of landing heading (towards approaching traffic)
        const outboundBrg = (landingHeadingDeg + 180) % 360;
        const appEnd = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, 10186, 0); // 5.5 NM

        // Extended |- - - - -| dashed centerline
        L.polyline([thresholdPt, appEnd], {
          renderer,
          color: isDark ? '#38BDF8' : '#0369A1',
          weight: mapZoom >= 13 ? 1.8 : 1.4,
          opacity: 0.82,
          dashArray: '8 7',
          interactive: false,
        }).addTo(layer);

        // Perpendicular | range gate ticks every 1 NM (1852 m)
        for (let nm = 1; nm <= 5; nm++) {
          const distM = nm * 1852;
          const barL = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, distM, -170);
          const barR = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, distM, 170);
          L.polyline([barL, barR], {
            renderer,
            color: isDark ? '#7DD3FC' : '#0284C7',
            weight: 1.5,
            opacity: 0.85,
            interactive: false,
          }).addTo(layer);
        }

        // Approach identifier badge at ~3.1 NM
        if (mapZoom >= 11.2 && !approachLabelSeen.has(`${rwyLabel}-${Math.round(thresholdPt[0] * 100)}`)) {
          approachLabelSeen.add(`${rwyLabel}-${Math.round(thresholdPt[0] * 100)}`);
          const tagPt = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, 5700, 0);
          L.marker(tagPt, {
            interactive: false,
            icon: L.divIcon({
              className: 'skydeck-approach-badge',
              iconSize: [96, 18],
              iconAnchor: [48, 9],
              html: `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;white-space:nowrap;background:${
                isDark ? 'rgba(11,14,20,0.88)' : 'rgba(242,247,254,0.94)'
              };color:${isDark ? '#7DD3FC' : '#0369A1'};border:1px solid ${
                isDark ? 'rgba(56,189,248,0.55)' : 'rgba(3,105,161,0.45)'
              };">APP ${rwyLabel} · ${String(Math.round(landingHeadingDeg)).padStart(3, '0')}°</span>`,
            }),
          }).addTo(layer);
        }

        // Flashing Sequenced Approach Lights ("Rabbit" strobes) + ALSF-II crossbars on approach zoom
        if (mapZoom >= 12.5) {
          const strobeCount = 7;
          for (let s = 1; s <= strobeCount; s++) {
            const distFromThresholdM = 120 + (strobeCount - s) * 115; // flashes sweep inward toward runway
            const sPt = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, distFromThresholdM, 0);
            const delaySec = (s * 0.14).toFixed(2);
            L.marker(sPt, {
              interactive: false,
              icon: L.divIcon({
                className: 'skydeck-rabbit-icon',
                iconSize: [8, 8],
                iconAnchor: [4, 4],
                html: `<div class="skydeck-rabbit-dot" style="animation-delay:${delaySec}s;"></div>`,
              }),
            }).addTo(layer);
          }
          // 300m decision crossbar
          const cbL = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, 300, -28);
          const cbR = offsetLatLonMeters(thresholdPt[0], thresholdPt[1], outboundBrg, 300, 28);
          L.polyline([cbL, cbR], {
            renderer,
            color: '#f8fafc',
            weight: 2.2,
            opacity: 0.9,
            dashArray: '3 4',
            interactive: false,
          }).addTo(layer);
        }
      };

      drawApproachPath(startPt, brg, labelA);
      drawApproachPath(endPt, revBrg, labelB);

      // Shoulder casing
      L.polyline(rwy.coords, {
        renderer,
        color: rwyCasing,
        weight: rwyWeight + 3,
        opacity: 0.96,
        lineCap: 'butt',
        interactive: false,
      }).addTo(layer);

      // Asphalt runway surface
      L.polyline(rwy.coords, {
        renderer,
        color: rwyAsphalt,
        weight: rwyWeight,
        opacity: 1,
        lineCap: 'butt',
        interactive: false,
      }).addTo(layer);

      // Centerline dashed white markings
      L.polyline(rwy.coords, {
        renderer,
        color: '#f8fafc',
        weight: mapZoom >= 14 ? 1.9 : 1.2,
        opacity: 0.92,
        dashArray: mapZoom >= 14 ? '10 10' : '6 6',
        interactive: false,
      }).addTo(layer);

      // Runway edge lights (white/amber last 600m)
      if (mapZoom >= 12.2) {
        const steps = 18;
        const halfW = (rwy.widthM ?? 45) * 0.5;
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
              radius: mapZoom >= 14.5 ? 2.1 : 1.4,
              color: lightColor,
              fillColor: lightColor,
              fillOpacity: 0.95,
              weight: 0,
              interactive: false,
            }).addTo(layer);
          }
        }
      }

      // Piano-key threshold markings, aiming point blocks, green threshold lights & rotated runway designator
      const drawEnd = (pt: [number, number], endBrg: number, rwyNum: string) => {
        const halfW = (rwy.widthM ?? 45) * 0.45;
        for (let t = -3; t <= 3; t++) {
          const tPt = offsetLatLonMeters(pt[0], pt[1], endBrg, 0, (t / 3) * halfW);
          L.circleMarker(tPt, {
            renderer,
            radius: mapZoom >= 14 ? 2.3 : 1.6,
            color: '#16a34a',
            fillColor: '#4ade80',
            fillOpacity: 1,
            weight: 0,
            interactive: false,
          }).addTo(layer);
        }

        if (mapZoom >= 13) {
          // Longitudinal ICAO Piano-Key Threshold Bars
          const numKeys = 6;
          for (let k = -numKeys; k <= numKeys; k++) {
            if (k === 0) continue;
            const latOffset = (k / numKeys) * (halfW * 0.85);
            const p1 = offsetLatLonMeters(pt[0], pt[1], endBrg, 14, latOffset);
            const p2 = offsetLatLonMeters(pt[0], pt[1], endBrg, 48, latOffset);
            L.polyline([p1, p2], {
              renderer,
              color: '#ffffff',
              weight: mapZoom >= 15 ? 2.4 : 1.5,
              opacity: 0.92,
              lineCap: 'butt',
              interactive: false,
            }).addTo(layer);
          }

          // Touchdown Aiming Point Blocks (~260m from threshold)
          if (mapZoom >= 14) {
            for (const side of [-1, 1]) {
              const a1 = offsetLatLonMeters(pt[0], pt[1], endBrg, 240, side * halfW * 0.45);
              const a2 = offsetLatLonMeters(pt[0], pt[1], endBrg, 285, side * halfW * 0.45);
              L.polyline([a1, a2], {
                renderer,
                color: '#ffffff',
                weight: mapZoom >= 15.5 ? 4.5 : 3,
                opacity: 0.92,
                lineCap: 'butt',
                interactive: false,
              }).addTo(layer);
            }
          }
        }

        const numPos = offsetLatLonMeters(pt[0], pt[1], endBrg, 105, 0);
        L.marker(numPos, {
          interactive: false,
          icon: L.divIcon({
            className: 'skydeck-runway-num',
            iconSize: [38, 20],
            iconAnchor: [19, 10],
            html: `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:0.05em;background:rgba(11,18,32,0.92);color:#ffffff;border:1px solid rgba(255,255,255,0.7);box-shadow:0 1px 4px rgba(0,0,0,0.45);transform:rotate(${Math.round(
              endBrg,
            )}deg);">${rwyNum}</span>`,
          }),
        }).addTo(layer);
      };

      drawEnd(startPt, brg, labelA);
      drawEnd(endPt, revBrg, labelB);
    }

    // 4. Gate / Stand Labels on Close Zoom
    if (mapZoom >= 14.5) {
      for (const gate of surfaceData.gates) {
        L.marker([gate.lat, gate.lon], {
          interactive: false,
          icon: L.divIcon({
            className: 'skydeck-taxi-badge',
            iconSize: [24, 14],
            iconAnchor: [12, 7],
            html: `<span style="font-family:'JetBrains Mono',monospace;font-size:8.5px;font-weight:600;color:#e2e8f0;background:rgba(15,23,42,0.82);padding:0 3px;border-radius:3px;">${gate.ref}</span>`,
          }),
        }).addTo(layer);
      }
    }
  }, [surfaceData, mapZoom, isDark]);

  // Smooth 60fps Interpolated & Forward-Gliding Flight Markers + FOV-Clipped GeoFS Paths + Isolation Filter
  useEffect(() => {
    const fLayer = flightsLayerRef.current;
    const pLayer = allPathsLayerRef.current;
    const drLayer = drLayerRef.current;
    const map = mapRef.current;
    const renderer = canvasRendererRef.current;
    if (!fLayer || !pLayer || !drLayer || !renderer) return;

    pLayer.clearLayers();
    drLayer.clearLayers();

    const mapBounds = map?.getBounds();
    const baseVisible = flights.filter((f) => settings.showGroundTraffic || !f.onGround);
    const visibleFlights =
      isolateSelected && selectedFlight
        ? baseVisible.filter((f) => f.id === selectedFlight.id)
        : baseVisible;

    const activeIds = new Set<string>();
    const markerPool = flightMarkersRef.current;
    const nowMs = performance.now();

    for (const f of visibleFlights) {
      const id = f.id;
      activeIds.add(id);

      const isSelected = selectedFlight?.id === id;
      const emerg = getEmergencySquawkMeta(f.squawk);
      const inView = mapBounds ? mapBounds.contains([f.lat, f.lon]) : true;

      // Flown routes strictly only for aircraft inside user FOV + GeoFS altitude gradient (hidden for non-selected when isolated)
      if (!isolateSelected && settings.flightPathMode === 'all' && !f.onGround && !isSelected && inView) {
        const key = f.icao24 || id;
        const rawTrail = clientTrailMapRef.current.get(key) ?? [];
        const smoothedChains = sanitizeAndSmoothTrail(rawTrail.slice(-28), f, mapBounds);
        for (const chain of smoothedChains) {
          drawAltitudeGradientPath(pLayer, renderer, chain, 2.1, isDark ? 0.8 : 0.9);
        }
      }

      const dbMeta = getDbFlagMeta(f);
      const visualKey = `${isSelected ? 1 : 0}-${settings.planeSize}-${settings.showPlaneLabels ? 1 : 0}-${
        isDark ? 1 : 0
      }-${f.onGround ? 1 : 0}-${f.callsign}-${f.aircraftType}-${f.squawk}-${emerg?.code ?? ''}-${
        dbMeta?.kind ?? ''
      }-${f.dbFlags ?? 0}-${Math.round(f.altitudeFt / 500)}`;

      const zOffset = emerg ? 1500 : isSelected ? 1000 : f.isLadd ? 350 : f.isMilitary ? 250 : f.onGround ? 10 : 120;
      const pooled = markerPool.get(id);
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
            pooled.marker.setLatLng([f.lat, f.lon]);
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
        pooled.marker.setZIndexOffset(zOffset);
        if (pooled.visualKey !== visualKey) {
          pooled.visualKey = visualKey;
          pooled.marker.setIcon(
            makePlaneIcon(f, isSelected, settings.planeSize, isDark, settings.showPlaneLabels, pooled.renderTrack),
          );
        }
      } else {
        const marker = L.marker([f.lat, f.lon], {
          icon: makePlaneIcon(f, isSelected, settings.planeSize, isDark, settings.showPlaneLabels, f.trueTrackDeg),
          zIndexOffset: zOffset,
        });
        marker.on('click', () => {
          const latest = markerPool.get(id)?.flight ?? f;
          onSelectRef.current(latest);
        });
        marker.bindTooltip(
          () => {
            const latest = markerPool.get(id)?.flight ?? f;
            const em = getEmergencySquawkMeta(latest.squawk);
            const db = getDbFlagMeta(latest);
            return `${em ? `[${em.shortLabel}] ` : ''}${db ? `[${db.shortLabel}] ` : ''}${latest.callsign} · ${
              latest.aircraftType
            }${latest.origin && latest.destination ? ` · ${latest.origin} → ${latest.destination}` : ''} · ${
              latest.onGround ? 'GND' : `FL${Math.round(latest.altitudeFt / 100)}`
            }${latest.squawk ? ` · SQK ${latest.squawk}` : ''}${latest.isEstimated ? ' [DR-EST]' : ''}`;
          },
          {direction: 'right', offset: [10, 0]},
        );
        marker.addTo(fLayer);
        markerPool.set(id, {
          marker,
          visualKey,
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

    // Remove markers that left visible set
    for (const [id, entry] of markerPool.entries()) {
      if (!activeIds.has(id)) {
        fLayer.removeLayer(entry.marker);
        markerPool.delete(id);
      }
    }
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
    viewportTick,
  ]);

  // Continuous 60fps Aircraft Kinematic Glide + Zoom-Preserving Follow Pan Loop
  useEffect(() => {
    let rafId = 0;
    let lastTickMs = 0;
    let lastFollowPanMs = 0;

    const step = (frameMs: number) => {
      rafId = window.requestAnimationFrame(step);
      if (isMapZoomingRef.current || frameMs - lastTickMs < 24) return;
      lastTickMs = frameMs;

      const map = mapRef.current;
      if (!map) return;
      const bounds = map.getBounds().pad(0.25);

      for (const entry of flightMarkersRef.current.values()) {
        const f = entry.flight;
        const isFollowed = followSelectedRef.current && selectedFlightIdRef.current === f.id;
        if (!isFollowed && !bounds.contains([entry.targetLat, entry.targetLon])) continue;

        // 1. Eased convergence from previous rendered point to latest ADS-B report
        const t =
          entry.blendDurationMs > 0
            ? Math.min(1, Math.max(0, (frameMs - entry.blendStartMs) / entry.blendDurationMs))
            : 1;
        const ease = 1 - Math.pow(1 - t, 3);

        // 2. Smooth forward dead-reckoned glide between polls (capped at 9s to avoid overshoot)
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

        // 3. Shortest-angle smooth heading rotation
        const angleDelta = ((entry.targetTrack - entry.fromTrack + 540) % 360) - 180;
        const nextTrack = (entry.fromTrack + angleDelta * ease + 360) % 360;

        if (
          Math.abs(nextLat - entry.renderLat) > 1e-6 ||
          Math.abs(nextLon - entry.renderLon) > 1e-6
        ) {
          entry.renderLat = nextLat;
          entry.renderLon = nextLon;
          entry.marker.setLatLng([nextLat, nextLon]);
        }

        if (Math.abs(((nextTrack - entry.renderTrack + 540) % 360) - 180) > 0.25) {
          entry.renderTrack = nextTrack;
          const el = entry.marker.getElement();
          const rotEl = el?.querySelector('.skydeck-plane-rot') as HTMLElement | null;
          if (rotEl) {
            rotEl.style.transform = `rotate(${nextTrack.toFixed(1)}deg)`;
          }
        }

        // 4. Follow Mode: Keep aircraft centered at the user's current zoom level
        if (isFollowed && frameMs - lastFollowPanMs > 110) {
          lastFollowPanMs = frameMs;
          const c = map.getCenter();
          if (Math.hypot(nextLat - c.lat, nextLon - c.lng) > 0.00015) {
            map.panTo([nextLat, nextLon], {animate: false});
          }
        }
      }
    };

    rafId = window.requestAnimationFrame(step);
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
