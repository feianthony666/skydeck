import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Clock,
  Compass,
  Filter,
  Plane,
  Search,
  X,
} from 'lucide-react';
import React, {useMemo, useState} from 'react';
import {AIRPORT_CATALOG} from '../data/aviationCatalog';
import type {
  AirfieldSurfaceData,
  AirportBoardFlight,
  AirportBoardResponse,
  AirportWeather,
} from '../types/aviation';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Card, CardContent, CardHeader, CardTitle} from './ui/card';
import {Input} from './ui/input';
import {Separator} from './ui/separator';
import {TabsList, TabsTrigger} from './ui/tabs';

interface AirportBoardPanelProps {
  airport: {icao: string; iata: string; name: string};
  board: AirportBoardResponse | null;
  loading: boolean;
  weather?: AirportWeather;
  surface?: AirfieldSurfaceData | null;
  timeDisplayMode: 'airport' | 'local' | 'utc';
  onTimeDisplayModeChange: (mode: 'airport' | 'local' | 'utc') => void;
  activeFilter: 'none' | 'all' | 'arrivals' | 'departures' | 'delayed';
  onFilterChange: (filter: 'none' | 'all' | 'arrivals' | 'departures' | 'delayed') => void;
  onSelectFlightFromBoard: (item: AirportBoardFlight) => void;
  onFocusAirfield?: () => void;
  onClose: () => void;
}

function formatEpochInMode(
  ts: number | undefined,
  mode: 'airport' | 'local' | 'utc',
  tzName?: string,
  utcOffsetSec?: number,
): string {
  if (!ts) return '—';
  try {
    if (mode === 'utc') {
      return new Intl.DateTimeFormat([], {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(ts * 1000));
    }
    if (mode === 'airport') {
      if (tzName) {
        return new Intl.DateTimeFormat([], {
          timeZone: tzName,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ts * 1000));
      }
      if (typeof utcOffsetSec === 'number') {
        return new Intl.DateTimeFormat([], {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date((ts + utcOffsetSec) * 1000));
      }
    }
    return new Date(ts * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date(ts * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}

function formatSynchronizedStatus(
  item: AirportBoardFlight,
  tab: 'departures' | 'arrivals',
  mode: 'airport' | 'local' | 'utc',
  tzName?: string,
  utcOffsetSec?: number,
): string {
  const raw = item.statusText || '';
  if (/cancel/i.test(raw)) return 'Canceled';

  const fmt = (t?: number) => formatEpochInMode(t, mode, tzName, utcOffsetSec);

  if (/landed/i.test(raw)) {
    const t = item.actualTime || item.estimatedTime || item.scheduledTime;
    return t ? `Landed ${fmt(t)}` : raw;
  }
  if (/departed/i.test(raw)) {
    const t = item.actualTime || item.estimatedTime || item.scheduledTime;
    return t ? `Departed ${fmt(t)}` : raw;
  }
  if (/delay/i.test(raw)) {
    const t = item.estimatedTime || item.actualTime || item.scheduledTime;
    return t ? `Delayed ${fmt(t)}` : 'Delayed';
  }
  if (item.actualTime) {
    return `${tab === 'departures' ? 'Departed' : 'Arrived'} ${fmt(item.actualTime)}`;
  }
  if (item.estimatedTime) {
    return `${tab === 'departures' ? 'Est Dep' : 'Est Arr'} ${fmt(item.estimatedTime)}`;
  }
  if (item.scheduledTime && /est|sched/i.test(raw)) {
    return `Sched ${fmt(item.scheduledTime)}`;
  }
  return raw || 'Scheduled';
}

function delayBadgeVariant(index: number | null): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (index === null) return 'secondary';
  if (index >= 3) return 'destructive';
  if (index >= 1.5) return 'warning';
  return 'success';
}

function delayLabel(index: number | null): string {
  if (index === null) return 'N/A';
  if (index >= 3) return 'High Delays';
  if (index >= 1.5) return 'Moderate';
  return 'Normal Ops';
}

interface SchematicRunway {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelA: string;
  labelB: string;
}

interface SchematicTaxiway {
  id: string;
  points: string;
}

interface SchematicPolygon {
  id: string;
  points: string;
}

interface AirfieldSchematic {
  runways: SchematicRunway[];
  taxiways: SchematicTaxiway[];
  aprons: SchematicPolygon[];
  terminals: SchematicPolygon[];
}

function buildAirfieldSchematic(
  icao: string,
  surface?: AirfieldSurfaceData | null,
): AirfieldSchematic {
  const W = 320;
  const H = 104;
  const padX = 36;
  const padY = 16;

  if (surface && surface.runways.length > 0) {
    const rwyPts = surface.runways.flatMap((r) => r.coords);
    let rLatSum = 0;
    let rLonSum = 0;
    for (const [lat, lon] of rwyPts) {
      rLatSum += lat;
      rLonSum += lon;
    }
    const rLatMid = rLatSum / Math.max(1, rwyPts.length);
    const rLonMid = rLonSum / Math.max(1, rwyPts.length);

    const nearSurface = (pts: Array<[number, number]>) =>
      pts.length > 0 && Math.hypot(pts[0][0] - rLatMid, pts[0][1] - rLonMid) < 0.065;

    const nearAprons = (surface.aprons ?? []).filter(nearSurface);
    const nearTerminals = (surface.terminals ?? []).filter((t) => nearSurface(t.coords));
    const allPts = [
      ...rwyPts,
      ...nearAprons.flat(),
      ...nearTerminals.flatMap((t) => t.coords),
    ];

    if (allPts.length >= 2) {
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLon = Infinity;
      let maxLon = -Infinity;
      for (const [lat, lon] of allPts) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
      const midLatRad = (((minLat + maxLat) * 0.5) * Math.PI) / 180;
      const cosLat = Math.max(0.2, Math.cos(midLatRad));
      const spanX = Math.max(0.004, (maxLon - minLon) * cosLat);
      const spanY = Math.max(0.004, maxLat - minLat);
      const scale = Math.min((W - padX * 2) / spanX, (H - padY * 2) / spanY);
      const offX = (W - spanX * scale) * 0.5;
      const offY = (H - spanY * scale) * 0.5;

      const proj = ([lat, lon]: [number, number]) => ({
        x: offX + (lon - minLon) * cosLat * scale,
        y: offY + (maxLat - lat) * scale,
      });

      const toPointsStr = (coords: Array<[number, number]>) =>
        coords
          .map((c) => {
            const p = proj(c);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          })
          .join(' ');

      const aprons: SchematicPolygon[] = nearAprons.slice(0, 40).map((coords, idx) => ({
        id: `ap-${idx}`,
        points: toPointsStr(coords),
      }));

      const terminals: SchematicPolygon[] = nearTerminals.slice(0, 28).map((t) => ({
        id: t.id,
        points: toPointsStr(t.coords),
      }));

      const runways = surface.runways.slice(0, 8).map((r) => {
        const a = proj(r.coords[0]);
        const b = proj(r.coords[r.coords.length - 1]);
        const parts = (r.ref || '').split('/');
        return {
          id: r.id,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          labelA: (parts[0] || '').trim(),
          labelB: (parts[1] || '').trim(),
        };
      });

      const taxiways = surface.taxiways
        .slice(0, 180)
        .filter((t) => t.coords.length >= 2)
        .map((t) => ({
          id: t.id,
          points: toPointsStr(t.coords),
        }));

      return {runways, taxiways, aprons, terminals};
    }
  }

  const cat = AIRPORT_CATALOG.find((a) => a.icao.toUpperCase() === icao.toUpperCase());
  const rwys = cat?.runways ?? [];
  if (rwys.length === 0) return {runways: [], taxiways: [], aprons: [], terminals: []};

  return {
    taxiways: [],
    aprons: [],
    terminals: [],
    runways: rwys.slice(0, 4).map((r, idx) => {
      const rad = ((r.headingDeg - 90) * Math.PI) / 180;
      const halfLen = 42;
      const spreadY = (idx - (rwys.length - 1) * 0.5) * 20;
      const cx = W * 0.5;
      const cy = H * 0.5 + spreadY;
      const parts = r.ident.split('/');
      return {
        id: `${icao}-${r.ident}-${idx}`,
        x1: cx - Math.cos(rad) * halfLen,
        y1: cy - Math.sin(rad) * halfLen,
        x2: cx + Math.cos(rad) * halfLen,
        y2: cy + Math.sin(rad) * halfLen,
        labelA: (parts[0] || '').trim(),
        labelB: (parts[1] || '').trim(),
      };
    }),
  };
}

export const AirportBoardPanel: React.FC<AirportBoardPanelProps> = ({
  airport,
  board,
  loading,
  weather,
  surface,
  timeDisplayMode,
  onTimeDisplayModeChange,
  activeFilter,
  onFilterChange,
  onSelectFlightFromBoard,
  onFocusAirfield,
  onClose,
}) => {
  const [boardTab, setBoardTab] = useState<'departures' | 'arrivals'>('departures');
  const [listStatusFilter, setListStatusFilter] = useState<'all' | 'delayed' | 'cancelled'>('all');
  const [boardSearch, setBoardSearch] = useState('');

  const isRowCancelled = (item: AirportBoardFlight) =>
    Boolean(item.isCancelled || /cancel/i.test(item.statusText) || item.statusColor === 'red');

  const rawTabRows = useMemo(
    () => (boardTab === 'departures' ? (board?.departures ?? []) : (board?.arrivals ?? [])),
    [board, boardTab],
  );

  const listItems = useMemo(() => {
    const q = boardSearch.trim().toUpperCase();
    return rawTabRows.filter((item) => {
      if (listStatusFilter === 'delayed' && !item.isDelayed) return false;
      if (listStatusFilter === 'cancelled' && !isRowCancelled(item)) return false;
      if (!q) return true;
      const peerCode = boardTab === 'departures' ? item.destinationIata : item.originIata;
      const peerName = boardTab === 'departures' ? item.destinationName : item.originName;
      return (
        item.flightNumber.toUpperCase().includes(q) ||
        item.callsign.toUpperCase().includes(q) ||
        peerCode.toUpperCase().includes(q) ||
        peerName.toUpperCase().includes(q) ||
        item.airlineName.toUpperCase().includes(q) ||
        item.registration.toUpperCase().includes(q) ||
        item.aircraftCode.toUpperCase().includes(q) ||
        (item.terminal ?? '').toUpperCase().includes(q) ||
        (item.gate ?? '').toUpperCase().includes(q) ||
        item.statusText.toUpperCase().includes(q)
      );
    });
  }, [rawTabRows, listStatusFilter, boardSearch, boardTab]);

  const cancelledTabCount = useMemo(
    () => rawTabRows.filter((f) => isRowCancelled(f)).length,
    [rawTabRows],
  );

  const delayedTotalCount = useMemo(() => {
    const all = [...(board?.departures ?? []), ...(board?.arrivals ?? [])];
    return all.filter((f) => f.isDelayed).length;
  }, [board]);

  const airfieldSchematic = useMemo(
    () => buildAirfieldSchematic(airport.icao, surface),
    [airport.icao, surface],
  );

  const delayIdx = board?.delayIndex;
  const onTimePct = useMemo(() => {
    const depPct = delayIdx?.departuresDelayedPct;
    const arrPct = delayIdx?.arrivalsDelayedPct;
    if (typeof depPct === 'number' && typeof arrPct === 'number') {
      return Math.max(0, Math.min(100, Math.round(100 - (depPct + arrPct) * 0.5)));
    }
    if (typeof depPct === 'number') return Math.max(0, Math.min(100, Math.round(100 - depPct)));
    const all = [...(board?.departures ?? []), ...(board?.arrivals ?? [])];
    if (all.length > 0) {
      const delayed = all.filter((f) => f.isDelayed || isRowCancelled(f)).length;
      return Math.max(0, Math.min(100, Math.round(((all.length - delayed) / all.length) * 100)));
    }
    return null;
  }, [board, delayIdx]);

  const opsTone =
    onTimePct === null
      ? 'Flights operating'
      : onTimePct >= 82
        ? 'Flights are on time.'
        : onTimePct >= 65
          ? 'Minor schedule delays.'
          : 'Significant airport delays.';

  const airportLocalClock = formatEpochInMode(
    Math.floor(Date.now() / 1000),
    'airport',
    board?.timezoneName,
    board?.utcOffsetSec,
  );

  const tzAbbr =
    timeDisplayMode === 'utc'
      ? 'UTC'
      : timeDisplayMode === 'airport'
        ? board?.timezoneAbbr || 'APT'
        : 'LOCAL';

  return (
    <aside
      role="complementary"
      aria-label={`Airport arrivals, departures, and delay index for ${airport.iata || airport.icao}`}
      className="flex-1 h-full min-h-0 flex flex-col"
    >
      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden shadow-2xl">
        {/* Compact Sticky Airport Top Bar */}
        <CardHeader className="py-2.5 px-4 shrink-0 border-b border-border/70 flex flex-row items-center justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <span className="font-bold text-foreground">
                {airport.iata ? `${airport.iata}` : airport.icao}
              </span>
              {board?.city && <span className="truncate">{board.city}</span>}
              <span className="tabular-nums text-foreground/80">{airportLocalClock}</span>
              <span className="text-[10px]">({airport.icao})</span>
              {weather && (
                <Badge
                  variant={
                    weather.flightCategory === 'VFR'
                      ? 'success'
                      : weather.flightCategory === 'MVFR'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {weather.flightCategory}
                </Badge>
              )}
            </div>
            <CardTitle className="font-display text-sm sm:text-base font-bold leading-tight text-foreground truncate">
              {board?.name || airport.name}
            </CardTitle>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onFocusAirfield && (
              <Button
                size="sm"
                variant="outline"
                onClick={onFocusAirfield}
                title="Zoom radar onto airport taxiways and runways"
              >
                <Compass className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">Airfield</span>
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              aria-label="Close airport board"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-3 pb-6 [scrollbar-width:thin]">
          <div className="space-y-3">
            {/* FlightDeck-style Dark Airfield Schematic (Runways + Gold Taxiways for ALL Airports) */}
            <div className="relative rounded-xl bg-[#0B0E14] text-white overflow-hidden border border-border">
              <div className="h-[104px] w-full relative">
                <svg
                  viewBox="0 0 320 104"
                  className="w-full h-full block"
                  role="img"
                  aria-label={`Runway schematic for ${airport.iata || airport.icao}`}
                >
                  <rect width="320" height="104" fill="#0B0E14" />
                  <g stroke="rgba(255,255,255,0.045)" strokeWidth="1">
                    <line x1="0" y1="26" x2="320" y2="26" />
                    <line x1="0" y1="52" x2="320" y2="52" />
                    <line x1="0" y1="78" x2="320" y2="78" />
                    <line x1="80" y1="0" x2="80" y2="104" />
                    <line x1="160" y1="0" x2="160" y2="104" />
                    <line x1="240" y1="0" x2="240" y2="104" />
                  </g>
                  {airfieldSchematic.aprons.map((ap) => (
                    <polygon
                      key={ap.id}
                      points={ap.points}
                      fill="#131b2b"
                      fillOpacity="0.85"
                      stroke="rgba(250, 204, 21, 0.25)"
                      strokeWidth="0.6"
                    />
                  ))}
                  {airfieldSchematic.terminals.map((term) => (
                    <polygon
                      key={term.id}
                      points={term.points}
                      fill="#1e2d44"
                      fillOpacity="0.95"
                      stroke="rgba(56, 189, 248, 0.6)"
                      strokeWidth="0.8"
                    />
                  ))}
                  {airfieldSchematic.taxiways.map((twy) => (
                    <polyline
                      key={twy.id}
                      points={twy.points}
                      fill="none"
                      stroke="rgba(250, 204, 21, 0.42)"
                      strokeWidth="0.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {airfieldSchematic.runways.map((r) => (
                    <g key={r.id}>
                      <line
                        x1={r.x1}
                        y1={r.y1}
                        x2={r.x2}
                        y2={r.y2}
                        stroke="rgba(255,255,255,0.22)"
                        strokeWidth="5"
                        strokeLinecap="round"
                      />
                      <line
                        x1={r.x1}
                        y1={r.y1}
                        x2={r.x2}
                        y2={r.y2}
                        stroke="#F8FAFC"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      {r.labelA && (
                        <text
                          x={r.x1}
                          y={Math.max(11, r.y1 - 4)}
                          fill="rgba(248,250,252,0.88)"
                          fontSize="8.5"
                          fontFamily="JetBrains Mono, monospace"
                          fontWeight="700"
                          textAnchor="middle"
                        >
                          {r.labelA}
                        </text>
                      )}
                      {r.labelB && (
                        <text
                          x={r.x2}
                          y={Math.min(100, r.y2 + 10)}
                          fill="rgba(248,250,252,0.88)"
                          fontSize="8.5"
                          fontFamily="JetBrains Mono, monospace"
                          fontWeight="700"
                          textAnchor="middle"
                        >
                          {r.labelB}
                        </text>
                      )}
                    </g>
                  ))}
                  {airfieldSchematic.runways.length === 0 && (
                    <text
                      x="160"
                      y="55"
                      fill="rgba(248,250,252,0.55)"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="middle"
                    >
                      Loading {airport.icao} runway & taxiway geometry…
                    </text>
                  )}
                </svg>
                {onFocusAirfield && (
                  <button
                    type="button"
                    onClick={onFocusAirfield}
                    className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/12 hover:bg-white/22 backdrop-blur-md px-2.5 py-0.5 text-[10.5px] font-medium text-white border border-white/15 cursor-pointer"
                  >
                    <Compass className="w-3 h-3 text-amber-300" />
                    Zoom Airfield
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs font-medium text-muted-foreground">{opsTone}</p>
          {/* FlightDeck-style On-Time Today & Weather Summary Card */}
          <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-border bg-secondary/45 p-3">
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground font-medium">On time today</div>
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 -rotate-90" aria-hidden="true">
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.18"
                    strokeWidth="3"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke={
                      onTimePct === null || onTimePct >= 80
                        ? '#22c55e'
                        : onTimePct >= 65
                          ? '#f59e0b'
                          : '#ef4444'
                    }
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${((onTimePct ?? 85) / 100) * 56.55} 56.55`}
                  />
                </svg>
                <span className="font-mono text-lg font-bold text-foreground tabular-nums">
                  {onTimePct !== null ? `${onTimePct}%` : '—'}
                </span>
              </div>
            </div>

            <div className="space-y-1 border-l border-border pl-3">
              <div className="text-[11px] text-muted-foreground font-medium">Weather</div>
              <div className="font-mono text-sm font-bold text-foreground truncate tabular-nums">
                {weather ? (
                  <>
                    {weather.tempC !== null ? `${Math.round(weather.tempC)}°C` : weather.flightCategory}{' '}
                    <span className="font-sans text-xs font-semibold text-muted-foreground">
                      {weather.wxString || weather.flightCategory}
                    </span>
                  </>
                ) : (
                  'Syncing METAR…'
                )}
              </div>
              {weather && (
                <div className="font-mono text-[10px] text-muted-foreground truncate tabular-nums">
                  {weather.windDirDeg ?? 'VRB'}°/{weather.windSpeedKts}kt · Vis {weather.visibilitySm ?? '—'}SM
                </div>
              )}
            </div>
          </div>

          {/* Live Delay Index Breakdown Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Dep Delay Index
                </span>
                <Badge variant={delayBadgeVariant(delayIdx?.departuresIndex ?? null)}>
                  {delayIdx?.departuresIndex !== null && delayIdx?.departuresIndex !== undefined
                    ? delayIdx.departuresIndex.toFixed(2)
                    : '—'}
                </Badge>
              </div>
              <div className="mt-1.5 font-mono text-xs font-semibold text-foreground tabular-nums">
                {delayIdx?.departuresDelayAvgMin !== null && delayIdx?.departuresDelayAvgMin !== undefined
                  ? `${delayIdx.departuresDelayAvgMin} min avg`
                  : delayLabel(delayIdx?.departuresIndex ?? null)}
              </div>
              {delayIdx?.departuresIndex !== null && delayIdx?.departuresIndex !== undefined && (
                <div className="text-[9.5px] text-muted-foreground">Raw provider delay index</div>
              )}
              <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {delayIdx?.departuresDelayedPct !== null && delayIdx?.departuresDelayedPct !== undefined
                  ? `${delayIdx.departuresDelayedPct}% delayed · ${delayIdx.departuresDelayedCount ?? 0}/${
                      (delayIdx.departuresOnTimeCount ?? 0) + (delayIdx.departuresDelayedCount ?? 0)
                    }`
                  : 'Live ops monitor'}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/60 p-3">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1">
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  Arr Delay Index
                </span>
                <Badge variant={delayBadgeVariant(delayIdx?.arrivalsIndex ?? null)}>
                  {delayIdx?.arrivalsIndex !== null && delayIdx?.arrivalsIndex !== undefined
                    ? delayIdx.arrivalsIndex.toFixed(2)
                    : '—'}
                </Badge>
              </div>
              <div className="mt-1.5 font-mono text-xs font-semibold text-foreground tabular-nums">
                {delayIdx?.arrivalsDelayAvgMin !== null && delayIdx?.arrivalsDelayAvgMin !== undefined
                  ? `${delayIdx.arrivalsDelayAvgMin} min avg`
                  : delayLabel(delayIdx?.arrivalsIndex ?? null)}
              </div>
              {delayIdx?.arrivalsIndex !== null && delayIdx?.arrivalsIndex !== undefined && (
                <div className="text-[9.5px] text-muted-foreground">Raw provider delay index</div>
              )}
              <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {delayIdx?.arrivalsDelayedPct !== null && delayIdx?.arrivalsDelayedPct !== undefined
                  ? `${delayIdx.arrivalsDelayedPct}% delayed · ${delayIdx.arrivalsDelayedCount ?? 0}/${
                      (delayIdx.arrivalsOnTimeCount ?? 0) + (delayIdx.arrivalsDelayedCount ?? 0)
                    }`
                  : 'Live ops monitor'}
              </div>
            </div>
          </div>

          {weather && (
            <div className="rounded-xl border border-border bg-secondary/50 px-3 py-2 text-[11px] font-mono text-foreground">
              Wind {weather.windDirDeg ?? 'VRB'}° @ {weather.windSpeedKts} kt · Vis {weather.visibilitySm ?? '—'} SM · QNH{' '}
              {weather.altimeterHpa ?? '—'} hPa
            </div>
          )}

          {/* Filter Radar Traffic to this Airport */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <Filter className="w-3 h-3" />
                Filter Radar Traffic
              </span>
              {activeFilter !== 'none' && (
                <Button size="sm" variant="ghost" onClick={() => onFilterChange('none')}>
                  Reset
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={activeFilter === 'none' ? 'default' : 'outline'}
                onClick={() => onFilterChange('none')}
              >
                All Sector
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'all' ? 'default' : 'outline'}
                onClick={() => onFilterChange('all')}
              >
                {airport.iata || airport.icao} All
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'departures' ? 'default' : 'outline'}
                onClick={() => onFilterChange('departures')}
              >
                Departures
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'arrivals' ? 'default' : 'outline'}
                onClick={() => onFilterChange('arrivals')}
              >
                Arrivals
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'delayed' ? 'destructive' : 'outline'}
                onClick={() => onFilterChange('delayed')}
              >
                Delayed ({delayedTotalCount})
              </Button>
            </div>
          </div>

          <Separator />

          {/* Synchronized Schedule Timezone Switcher + Board Tabs */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Times ({tzAbbr})
              </span>
              <TabsList>
                <TabsTrigger
                  active={timeDisplayMode === 'airport'}
                  onClick={() => onTimeDisplayModeChange('airport')}
                >
                  Airport
                </TabsTrigger>
                <TabsTrigger
                  active={timeDisplayMode === 'local'}
                  onClick={() => onTimeDisplayModeChange('local')}
                >
                  My Local
                </TabsTrigger>
                <TabsTrigger
                  active={timeDisplayMode === 'utc'}
                  onClick={() => onTimeDisplayModeChange('utc')}
                >
                  UTC
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger active={boardTab === 'departures'} onClick={() => setBoardTab('departures')}>
                  Departures ({board?.departures.length ?? 0})
                </TabsTrigger>
                <TabsTrigger active={boardTab === 'arrivals'} onClick={() => setBoardTab('arrivals')}>
                  Arrivals ({board?.arrivals.length ?? 0})
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={listStatusFilter === 'delayed' ? 'destructive' : 'outline'}
                  onClick={() =>
                    setListStatusFilter((prev) => (prev === 'delayed' ? 'all' : 'delayed'))
                  }
                >
                  <AlertTriangle className="w-3 h-3" />
                  Delayed
                </Button>
                <Button
                  size="sm"
                  variant={listStatusFilter === 'cancelled' ? 'destructive' : 'outline'}
                  onClick={() =>
                    setListStatusFilter((prev) => (prev === 'cancelled' ? 'all' : 'cancelled'))
                  }
                >
                  <Ban className="w-3 h-3" />
                  Cancelled ({cancelledTabCount})
                </Button>
              </div>
            </div>

            {/* Live Search Bar for Departures / Arrivals / Cancelled Flights */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={boardSearch}
                onChange={(e) => setBoardSearch(e.target.value)}
                placeholder={`Search ${boardTab} by flight, airport, reg, gate, or "cancelled"`}
                aria-label="Search airport board flights"
                className="h-8 pl-8 pr-8 text-xs"
              />
              {boardSearch && (
                <button
                  type="button"
                  onClick={() => setBoardSearch('')}
                  aria-label="Clear board search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Flight Board Rows (All fetched entries, >25) */}
          <div className="space-y-2">
            {loading && !board ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Fetching live arrivals, departures, and delay index…
              </div>
            ) : listItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No {listStatusFilter !== 'all' ? `${listStatusFilter} ` : ''}
                {boardTab} matched{boardSearch ? ` "${boardSearch}"` : ''} right now.
              </div>
            ) : (
              listItems.map((item) => {
                const peerCode = boardTab === 'departures' ? item.destinationIata : item.originIata;
                const peerName = boardTab === 'departures' ? item.destinationName : item.originName;
                const schedClock = formatEpochInMode(
                  item.scheduledTime || item.estimatedTime || item.actualTime,
                  timeDisplayMode,
                  board?.timezoneName,
                  board?.utcOffsetSec,
                );
                const syncStatus = formatSynchronizedStatus(
                  item,
                  boardTab,
                  timeDisplayMode,
                  board?.timezoneName,
                  board?.utcOffsetSec,
                );

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectFlightFromBoard(item)}
                    className="w-full text-left rounded-xl border border-border bg-background/70 hover:bg-accent/70 p-2.5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {item.flightNumber || item.callsign}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground truncate">
                          {boardTab === 'departures' ? `→ ${peerCode || '—'}` : `← ${peerCode || '—'}`}
                        </span>
                        {item.aircraftCode && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {item.aircraftCode}
                          </span>
                        )}
                      </div>
                      <Badge
                        variant={
                          item.statusColor === 'red'
                            ? 'destructive'
                            : item.statusColor === 'amber'
                              ? 'warning'
                              : item.statusColor === 'green'
                                ? 'success'
                                : 'secondary'
                        }
                      >
                        {syncStatus}
                      </Badge>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {peerName || item.airlineName || 'Scheduled service'}
                      </span>
                      <span className="font-mono tabular-nums shrink-0 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Sched {schedClock} {tzAbbr}
                      </span>
                    </div>

                    {(item.terminal || item.gate || item.baggage || item.registration) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-mono text-foreground">
                        {item.terminal && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">T{item.terminal}</span>
                        )}
                        {item.gate && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">Gate {item.gate}</span>
                        )}
                        {item.baggage && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">Bag {item.baggage}</span>
                        )}
                        {item.registration && (
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <Plane className="w-2.5 h-2.5" />
                            {item.registration}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
          </div>
        </CardContent>
      </Card>
    </aside>
  );
};
