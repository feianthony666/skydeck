import {
  Activity,
  AlertTriangle,
  CheckSquare,
  Cloud,
  CloudRain,
  Compass,
  ExternalLink,
  Flame,
  History,
  Layers,
  Pause,
  Plane,
  Play,
  Radio,
  RotateCcw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  Square,
  Volume2,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import React, {useEffect, useMemo, useState} from 'react';
import {AIRPORT_CATALOG} from '../data/aviationCatalog';
import {apiFetchJson} from '../services/directAviationClient';
import type {
  AcarsMessage,
  AirportDisruption,
  LiveAtcStation,
  LiveFlight,
  LiveFlightUpdateItem,
  PastFlightRecord,
  RadarSettings,
  SafetyRecordResponse,
  SigmetHazard,
  WeatherOverlaySettings,
} from '../types/aviation';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {TabsList, TabsTrigger} from './ui/tabs';

export type BottomOpsTab = 'fov' | 'wx' | 'radio' | 'playback' | 'past' | 'updates' | 'safety';

export interface PlaybackState {
  enabled: boolean;
  playing: boolean;
  progress: number;
  speed: number;
}

interface BottomOpsDrawerProps {
  open: boolean;
  activeTab: BottomOpsTab;
  onTabChange: (tab: BottomOpsTab) => void;
  onClose: () => void;
  isPortraitMobile: boolean;
  selectedFlight: LiveFlight | null;
  fovFlights: LiveFlight[];
  selectedFlightIds: string[];
  multiSelectMode: boolean;
  onToggleMultiSelectMode: () => void;
  onToggleFlightInMultiSelect: (flight: LiveFlight) => void;
  onFocusFlight: (flight: LiveFlight) => void;
  liveUpdates: LiveFlightUpdateItem[];
  sigmets: SigmetHazard[];
  disruptions: AirportDisruption[];
  acarsMessages: AcarsMessage[];
  radarSettings: RadarSettings;
  onUpdateRadarSettings: (patch: Partial<RadarSettings>) => void;
  playbackState: PlaybackState;
  onUpdatePlayback: (patch: Partial<PlaybackState>) => void;
  onSelectFlightByHexOrCallsign: (icao24?: string, callsign?: string) => void;
  onFlyToAirport: (icao: string) => void;
  onFlyToPoint: (lat: number, lon: number, zoom?: number) => void;
  onOpenCredits: () => void;
}

function formatEpochShort(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const WX_OVERLAY_TOGGLES: Array<{
  key: keyof WeatherOverlaySettings;
  label: string;
  kind: 'tile' | 'vector';
}> = [
  {key: 'cloudCoverage', label: 'Cloud Coverage', kind: 'tile'},
  {key: 'totalPrecip', label: 'Total Precip', kind: 'tile'},
  {key: 'intensePrecip', label: 'Intense Precip', kind: 'tile'},
  {key: 'naRadar', label: 'North American Radar', kind: 'tile'},
  {key: 'windBarbs', label: 'Wind Barbs', kind: 'vector'},
  {key: 'sigwx', label: 'Significant WX (250-630FL)', kind: 'vector'},
  {key: 'airmetsSigmets', label: 'AIRMETs & SIGMETs', kind: 'vector'},
  {key: 'airepsPireps', label: 'AIREPs & PIREPs', kind: 'vector'},
  {key: 'volcanic', label: 'Volcanic Eruptions', kind: 'vector'},
  {key: 'turbulence', label: 'Turbulence', kind: 'vector'},
  {key: 'icing', label: 'Icing', kind: 'vector'},
  {key: 'lightning', label: 'Lightning', kind: 'vector'},
  {key: 'fog', label: 'Fog', kind: 'vector'},
];

export const BottomOpsDrawer: React.FC<BottomOpsDrawerProps> = ({
  open,
  activeTab,
  onTabChange,
  onClose,
  isPortraitMobile,
  selectedFlight,
  fovFlights,
  selectedFlightIds,
  multiSelectMode,
  onToggleMultiSelectMode,
  onToggleFlightInMultiSelect,
  onFocusFlight,
  liveUpdates,
  sigmets,
  disruptions,
  acarsMessages,
  radarSettings,
  onUpdateRadarSettings,
  playbackState,
  onUpdatePlayback,
  onSelectFlightByHexOrCallsign,
  onFlyToAirport,
  onFlyToPoint,
  onOpenCredits,
}) => {
  const [pastQuery, setPastQuery] = useState('');
  const [pastLoading, setPastLoading] = useState(false);
  const [pastItems, setPastItems] = useState<PastFlightRecord[]>([]);
  const [pastSearched, setPastSearched] = useState(false);

  const [safetyQuery, setSafetyQuery] = useState('');
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyResult, setSafetyResult] = useState<SafetyRecordResponse | null>(null);

  const [fovSearch, setFovSearch] = useState('');
  const [fovSort, setFovSort] = useState<'alt' | 'speed' | 'callsign'>('alt');

  const [radioQuery, setRadioQuery] = useState('');
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioStations, setRadioStations] = useState<LiveAtcStation[]>([]);
  const [activeStation, setActiveStation] = useState<LiveAtcStation | null>(null);
  const [radioError, setRadioError] = useState<string | null>(null);

  // Sync default registration / flight suggestion cleanly when selected flight changes
  useEffect(() => {
    if (selectedFlight?.registration && !safetyQuery) {
      setSafetyQuery(selectedFlight.registration);
    }
    if ((selectedFlight?.flightNumber || selectedFlight?.callsign) && !pastQuery) {
      setPastQuery(selectedFlight.flightNumber || selectedFlight.callsign);
    }
  }, [selectedFlight?.registration, selectedFlight?.flightNumber, selectedFlight?.callsign, safetyQuery, pastQuery]);

  const fetchAtcStations = async (q: string) => {
    setRadioLoading(true);
    setRadioError(null);
    try {
      const data = await apiFetchJson<{stations?: LiveAtcStation[]}>(
        `/api/liveatc/stations?q=${encodeURIComponent(q.trim())}`,
      );
      setRadioStations(Array.isArray(data.stations) ? data.stations : []);
    } catch {
      setRadioStations([]);
      setRadioError('Unable to reach LiveATC station index right now.');
    } finally {
      setRadioLoading(false);
    }
  };

  useEffect(() => {
    if (open && activeTab === 'radio' && radioStations.length === 0 && !radioLoading) {
      void fetchAtcStations(radioQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab]);

  const toggleWxLayer = (key: keyof WeatherOverlaySettings) => {
    const prevWx = radarSettings.wxLayers;
    const nextVal = !prevWx[key];
    const nextWx: WeatherOverlaySettings = {
      ...prevWx,
      [key]: nextVal,
    };
    const patch: Partial<RadarSettings> = {wxLayers: nextWx};
    if (key === 'airmetsSigmets') patch.showSigmets = nextVal;
    if (key === 'turbulence') patch.showTurbHazards = nextVal;
    if (key === 'icing') patch.showIceHazards = nextVal;
    if (key === 'naRadar' || key === 'totalPrecip' || key === 'intensePrecip') {
      patch.showRadar = Boolean(nextWx.naRadar || nextWx.totalPrecip || nextWx.intensePrecip);
    }
    onUpdateRadarSettings(patch);
  };

  const sortedFovFlights = useMemo(() => {
    const q = fovSearch.trim().toUpperCase();
    const filtered = q
      ? fovFlights.filter(
          (f) =>
            f.callsign.toUpperCase().includes(q) ||
            f.flightNumber.toUpperCase().includes(q) ||
            f.registration.toUpperCase().includes(q) ||
            f.aircraftType.toUpperCase().includes(q) ||
            f.origin.toUpperCase().includes(q) ||
            f.destination.toUpperCase().includes(q),
        )
      : fovFlights;
    return [...filtered]
      .sort((a, b) => {
        if (fovSort === 'speed') return b.groundSpeedKts - a.groundSpeedKts;
        if (fovSort === 'callsign') return (a.callsign || a.icao24).localeCompare(b.callsign || b.icao24);
        return b.altitudeFt - a.altitudeFt;
      })
      .slice(0, 120);
  }, [fovFlights, fovSearch, fovSort]);

  const trailFlightCount = useMemo(
    () => fovFlights.filter((f) => (f.trail?.length ?? 0) >= 2).length,
    [fovFlights],
  );

  const runPastSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? pastQuery).trim().toUpperCase();
    if (!q) return;
    setPastLoading(true);
    setPastSearched(true);
    try {
      const data = await apiFetchJson<{items?: PastFlightRecord[]}>(
        `/api/past-flights?query=${encodeURIComponent(q)}`,
      );
      setPastItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setPastItems([]);
    } finally {
      setPastLoading(false);
    }
  };

  const runSafetySearch = async (overrideReg?: string) => {
    const reg = (overrideReg ?? safetyQuery).trim().toUpperCase();
    if (!reg) return;
    setSafetyLoading(true);
    try {
      const data = await apiFetchJson<SafetyRecordResponse>(
        `/api/safety-record?registration=${encodeURIComponent(reg)}`,
      );
      setSafetyResult(data);
    } catch {
      setSafetyResult({
        registration: reg,
        items: [],
        searchUrl: `https://aviation-safety.net/wikibase/dblist.php?Reg=${encodeURIComponent(reg)}`,
        source: 'Aviation Safety Network',
        fetchedAt: Date.now(),
        note: 'Unable to reach ASN mirror directly; open external ASN dossier link below.',
      });
    } finally {
      setSafetyLoading(false);
    }
  };

  const maintAcars = acarsMessages.filter(
    (m) => m.category === 'MAINT' || /EMERG|MAYDAY|PAN|DIVERT|GATE|DELAY/i.test(m.rawText),
  );

  const turbCount = sigmets.filter((s) => s.category === 'turbulence').length;
  const iceCount = sigmets.filter((s) => s.category === 'icing').length;
  const advCount = sigmets.filter((s) => !s.category || s.category === 'advisory').length;

  const activeWxCount = Object.values(radarSettings.wxLayers).filter(Boolean).length;

  return (
    <section
      aria-hidden={!open}
      aria-label="Flight operations drawer"
      className={`fixed left-1/2 -translate-x-1/2 z-[565] w-[min(860px,calc(100vw-16px))] rounded-2xl border border-border bg-card shadow-2xl transition-all duration-300 ease-out flex flex-col overflow-hidden ${
        isPortraitMobile ? 'bottom-[70px] max-h-[68dvh]' : 'bottom-[68px] max-h-[60dvh]'
      } ${
        open
          ? 'translate-y-0 opacity-100 pointer-events-auto'
          : 'translate-y-6 opacity-0 pointer-events-none'
      }`}
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border/70 shrink-0">
        <TabsList className="flex-wrap h-auto gap-0.5">
          <TabsTrigger active={activeTab === 'fov'} onClick={() => onTabChange('fov')}>
            <Plane className="w-3.5 h-3.5 mr-1 inline" />
            Flight List ({fovFlights.length})
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'wx'} onClick={() => onTabChange('wx')}>
            <Wind className="w-3.5 h-3.5 mr-1 inline" />
            Weather ({activeWxCount})
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'radio'} onClick={() => onTabChange('radio')}>
            <Radio className="w-3.5 h-3.5 mr-1 inline" />
            LiveATC
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'playback'} onClick={() => onTabChange('playback')}>
            <Play className="w-3.5 h-3.5 mr-1 inline" />
            Playback{playbackState.enabled ? ' ●' : ''}
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'updates'} onClick={() => onTabChange('updates')}>
            <Activity className="w-3.5 h-3.5 mr-1 inline" />
            Updates ({liveUpdates.length + maintAcars.length})
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'past'} onClick={() => onTabChange('past')}>
            <History className="w-3.5 h-3.5 mr-1 inline" />
            Past
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'safety'} onClick={() => onTabChange('safety')}>
            <ShieldAlert className="w-3.5 h-3.5 mr-1 inline" />
            ASN Safety
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenCredits}
            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            title="Credits, Open Data & Legal Attributions"
          >
            <Scale className="w-3.5 h-3.5 mr-1" />
            Credits
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close operations drawer"
            className="h-7 w-7"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 space-y-3 [scrollbar-width:thin]">
        {activeTab === 'fov' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={fovSearch}
                  onChange={(e) => setFovSearch(e.target.value)}
                  placeholder="Filter FOV aircraft (callsign, route, model, tail)…"
                  aria-label="Filter flights in viewport"
                  className="h-8 pl-8 text-xs font-mono"
                />
              </div>

              <select
                value={fovSort}
                onChange={(e) => setFovSort(e.target.value as 'alt' | 'speed' | 'callsign')}
                aria-label="Sort flights in FOV"
                className="h-8 rounded-lg bg-background border border-input px-2.5 text-xs text-foreground cursor-pointer"
              >
                <option value="alt">Sort: Altitude</option>
                <option value="speed">Sort: Speed</option>
                <option value="callsign">Sort: Callsign</option>
              </select>

              <Button
                size="sm"
                variant={multiSelectMode ? 'default' : 'outline'}
                onClick={onToggleMultiSelectMode}
                className="h-8 text-xs"
              >
                <Layers className="w-3.5 h-3.5 mr-1" />
                Multi-Select {multiSelectMode ? 'ON' : 'OFF'}
                {selectedFlightIds.length > 0 ? ` (${selectedFlightIds.length})` : ''}
              </Button>
            </div>

            {sortedFovFlights.length === 0 ? (
              <div className="rounded-xl border border-border bg-secondary/35 p-5 text-center text-xs text-muted-foreground">
                No aircraft currently inside your active map FOV matching filters.
              </div>
            ) : (
              <div className="space-y-1.5">
                {sortedFovFlights.map((f) => {
                  const isChecked = selectedFlightIds.includes(f.id) || selectedFlight?.id === f.id;
                  return (
                    <div
                      key={f.id}
                      className={`rounded-xl border p-2 flex items-center justify-between gap-2 text-xs transition-colors ${
                        isChecked
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-background/75 hover:bg-accent/50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onToggleFlightInMultiSelect(f)}
                        title={isChecked ? 'Remove from multi-select' : 'Add to multi-select'}
                        aria-label={`Toggle multi-select for ${f.callsign || f.icao24}`}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                      >
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onFocusFlight(f)}
                        className="flex-1 min-w-0 text-left flex flex-wrap items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0 flex items-center gap-2 font-mono">
                          <span className="font-bold text-foreground">
                            {f.callsign || f.flightNumber || f.icao24}
                          </span>
                          {f.aircraftType && (
                            <Badge variant="outline" className="text-[10px]">
                              {f.aircraftType}
                            </Badge>
                          )}
                          <span className="text-muted-foreground truncate">
                            {f.origin || '—'} → {f.destination || '—'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 font-mono text-[11px] tabular-nums shrink-0">
                          <span className="text-foreground">
                            {f.onGround
                              ? 'GND'
                              : f.altitudeFt >= 18000
                                ? `FL${Math.round(f.altitudeFt / 100)}`
                                : `${f.altitudeFt.toLocaleString()}ft`}
                          </span>
                          <span className="text-muted-foreground">{Math.round(f.groundSpeedKts)} kt</span>
                          <Badge variant={f.isEstimated ? 'warning' : 'success'} className="text-[9.5px]">
                            {f.isEstimated ? 'DR' : 'LIVE'}
                          </Badge>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'radio' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={radioQuery}
                  onChange={(e) => setRadioQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void fetchAtcStations(radioQuery);
                  }}
                  placeholder="Search LiveATC by ICAO, city, or facility (KSFO, KJFK, EGLL, KLAX)…"
                  aria-label="Search LiveATC stations"
                  className="h-9 pl-8 text-xs font-mono"
                />
              </div>
              <Button size="sm" onClick={() => void fetchAtcStations(radioQuery)} disabled={radioLoading}>
                {radioLoading ? 'Loading…' : 'Find Feeds'}
              </Button>
            </div>

            {activeStation && (
              <div className="rounded-xl border border-primary/50 bg-primary/10 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Volume2 className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-foreground truncate">
                        {activeStation.icao} · {activeStation.facility} ({activeStation.freq})
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {activeStation.name} · {activeStation.country}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveStation(null)}
                    className="h-7 text-xs shrink-0"
                  >
                    Stop Audio
                  </Button>
                </div>
                <audio
                  key={activeStation.mount}
                  controls
                  autoPlay
                  preload="none"
                  src={`/api/liveatc/stream?mount=${encodeURIComponent(activeStation.mount)}`}
                  className="w-full h-9"
                />
                <div className="text-[10.5px] text-muted-foreground">
                  Streaming proxied LiveATC MP3 mount ({activeStation.mount}). Availability depends on
                  volunteer receiver uptime.
                </div>
              </div>
            )}

            {radioError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground">
                {radioError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {radioStations.map((st) => {
                const isPlaying = activeStation?.id === st.id;
                return (
                  <div
                    key={st.id}
                    className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 text-xs ${
                      isPlaying ? 'border-primary bg-primary/10' : 'border-border bg-background/75'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="font-bold text-foreground">{st.icao}</span>
                        {st.iata && <span className="text-muted-foreground">/ {st.iata}</span>}
                        <Badge variant="outline" className="text-[10px]">
                          {st.freq}
                        </Badge>
                      </div>
                      <div className="font-medium text-foreground truncate">{st.facility}</div>
                      <div className="text-[10.5px] text-muted-foreground truncate">
                        {st.name} · {st.country}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isPlaying ? 'default' : 'outline'}
                      onClick={() => {
                        setActiveStation(isPlaying ? null : st);
                        if (!isPlaying && Number.isFinite(st.lat) && Number.isFinite(st.lon)) {
                          onFlyToPoint(st.lat, st.lon, 11);
                        }
                      }}
                      className="shrink-0 h-8"
                    >
                      {isPlaying ? 'Listening' : 'Tune'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'playback' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-secondary/35 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Recorded Trail Flight Playback
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Scrub {trailFlightCount} aircraft along their recorded 4D breadcrumb trails in the active viewport.
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={playbackState.enabled ? 'default' : 'outline'}
                    onClick={() =>
                      onUpdatePlayback({
                        enabled: !playbackState.enabled,
                        playing: !playbackState.enabled,
                      })
                    }
                  >
                    {playbackState.enabled ? 'Playback Active' : 'Enable Playback'}
                  </Button>
                  {playbackState.enabled && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onUpdatePlayback({enabled: false, playing: false, progress: 1})
                      }
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      Exit to Live
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!playbackState.enabled}
                  onClick={() => onUpdatePlayback({playing: !playbackState.playing})}
                  className="h-8 w-24"
                >
                  {playbackState.playing ? (
                    <>
                      <Pause className="w-3.5 h-3.5 mr-1" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Play
                    </>
                  )}
                </Button>

                <div className="flex-1 min-w-[200px] space-y-1">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={Math.round(playbackState.progress * 1000) / 10}
                    onChange={(e) => {
                      const nextProg = Math.max(0, Math.min(1, Number(e.target.value) / 100));
                      onUpdatePlayback({enabled: true, progress: nextProg});
                    }}
                    aria-label="Flight playback timeline progress"
                    className="w-full accent-primary cursor-pointer"
                  />
                  <div className="flex items-center justify-between font-mono text-[10.5px] text-muted-foreground tabular-nums">
                    <span>T-History (0%)</span>
                    <span className="font-semibold text-foreground">
                      {Math.round(playbackState.progress * 100)}%
                    </span>
                    <span>Latest Fix (100%)</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 rounded-lg bg-background border border-border p-1">
                  {[1, 5, 20, 60].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => onUpdatePlayback({speed: spd})}
                      className={`px-2 py-1 rounded-md text-[11px] font-mono font-semibold cursor-pointer ${
                        playbackState.speed === spd
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'past' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={pastQuery}
                  onChange={(e) => setPastQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runPastSearch();
                  }}
                  placeholder="Enter flight number (CXA811) or tail registration (B-1356)"
                  aria-label="Search past flights by flight number or registration"
                  className="h-9 pl-8 text-xs font-mono"
                />
              </div>
              <Button size="sm" onClick={() => void runPastSearch()} disabled={pastLoading}>
                {pastLoading ? 'Searching…' : 'Search History'}
              </Button>
              {selectedFlight?.registration && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPastQuery(selectedFlight.registration);
                    void runPastSearch(selectedFlight.registration);
                  }}
                >
                  Use {selectedFlight.registration}
                </Button>
              )}
              {(selectedFlight?.flightNumber || selectedFlight?.callsign) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const q = selectedFlight.flightNumber || selectedFlight.callsign;
                    setPastQuery(q);
                    void runPastSearch(q);
                  }}
                >
                  Use {selectedFlight.flightNumber || selectedFlight.callsign}
                </Button>
              )}
            </div>

            {pastLoading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Querying live historical sector logs…
              </div>
            ) : pastItems.length === 0 ? (
              <div className="rounded-xl border border-border bg-secondary/35 p-4 text-xs text-muted-foreground text-center">
                {pastSearched
                  ? `No recent sectors found for "${pastQuery}". Try a commercial flight number (e.g. UA857, CA981) or active airframe tail.`
                  : 'Search any flight number or tail registration to view recent sectors, block times, and assigned airframes.'}
              </div>
            ) : (
              <div className="space-y-2">
                {pastItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border bg-background/75 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="font-bold text-foreground">
                          {item.flightNumber || item.callsign}
                        </span>
                        <span className="text-muted-foreground">
                          {item.originIata || item.originIcao || '—'} → {item.destinationIata || item.destinationIcao || '—'}
                        </span>
                        {item.registration && (
                          <Badge variant="outline">{item.registration}</Badge>
                        )}
                        {item.aircraftCode && (
                          <span className="text-[10.5px] text-muted-foreground">{item.aircraftCode}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono tabular-nums">
                        Dep {formatEpochShort(item.actualDep || item.scheduledDep)} · Arr{' '}
                        {formatEpochShort(item.actualArr || item.scheduledArr)} · {item.source}
                      </div>
                    </div>
                    <Badge
                      variant={
                        /cancel/i.test(item.statusText)
                          ? 'destructive'
                          : /delay/i.test(item.statusText)
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {item.statusText || 'Completed'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'updates' && (
          <div className="space-y-2.5">
            {liveUpdates.length === 0 && maintAcars.length === 0 ? (
              <div className="rounded-xl border border-border bg-secondary/35 p-5 text-center text-xs text-muted-foreground">
                No emergency squawks, major delays (&gt;=20m), or gate changes detected in the active sector. Click any airport to monitor live gate &amp; schedule changes.
              </div>
            ) : (
              <div className="space-y-2">
                {liveUpdates.map((upd) => (
                  <div
                    key={upd.id}
                    className={`rounded-xl border p-2.5 flex items-start justify-between gap-2 text-xs ${
                      upd.severity === 'high'
                        ? 'border-red-500/60 bg-red-500/10'
                        : upd.severity === 'medium'
                          ? 'border-amber-500/50 bg-amber-500/10'
                          : 'border-border bg-background/75'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={
                            upd.severity === 'high'
                              ? 'destructive'
                              : upd.severity === 'medium'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {upd.badge}
                        </Badge>
                        <span className="font-mono font-bold text-foreground">{upd.title}</span>
                        <span className="text-[11px] text-muted-foreground">{upd.subtitle}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">{upd.detail}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(upd.icao24 || upd.kind === 'emergency') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSelectFlightByHexOrCallsign(upd.icao24, upd.title)}
                        >
                          Track
                        </Button>
                      )}
                      {upd.airportIata && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onFlyToAirport(upd.airportIata!)}
                        >
                          Airport
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {maintAcars.slice(0, 6).map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl border border-border bg-background/75 p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono">
                      <span className="font-bold text-foreground">
                        ACARS {m.callsign} {m.tail ? `(${m.tail})` : ''}
                      </span>
                      <Badge variant="warning">[{m.labelName}]</Badge>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground break-all">{m.rawText}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'wx' && (
          <div className="space-y-3">
            {/* All 13 Aviation Weather Overlay Toggles */}
            <div className="rounded-xl border border-border bg-secondary/35 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Weather &amp; Atmospheric Overlays (13 Layers)
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={radarSettings.showSigmets ? 'default' : 'outline'}
                    className="h-6 px-2 text-[10.5px]"
                    onClick={() => onUpdateRadarSettings({showSigmets: !radarSettings.showSigmets})}
                  >
                    All Advisories ({advCount + turbCount + iceCount})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10.5px]"
                    onClick={() =>
                      onUpdateRadarSettings({
                        showRadar: false,
                        wxLayers: {
                          cloudCoverage: false,
                          totalPrecip: false,
                          intensePrecip: false,
                          naRadar: false,
                          windBarbs: false,
                          sigwx: false,
                          airmetsSigmets: false,
                          airepsPireps: false,
                          volcanic: false,
                          turbulence: false,
                          icing: false,
                          lightning: false,
                          fog: false,
                        },
                      })
                    }
                  >
                    Clear WX
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                {WX_OVERLAY_TOGGLES.map((item) => {
                  const active = radarSettings.wxLayers[item.key];
                  const IconComp =
                    item.key === 'cloudCoverage' || item.key === 'fog'
                      ? Cloud
                      : item.key === 'totalPrecip' || item.key === 'intensePrecip' || item.key === 'naRadar'
                        ? CloudRain
                        : item.key === 'icing'
                          ? Snowflake
                          : item.key === 'lightning'
                            ? Zap
                            : item.key === 'volcanic'
                              ? Flame
                              : item.key === 'windBarbs'
                                ? Compass
                                : item.key === 'turbulence'
                                  ? Wind
                                  : AlertTriangle;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleWxLayer(item.key)}
                      className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-background text-foreground border-border hover:bg-accent'
                      }`}
                    >
                      <IconComp className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Airport Restrictions & Ground Delays */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Airport Restrictions &amp; Weather Advisories ({disruptions.length})
                </div>
                {disruptions.length === 0 ? (
                  <div className="rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground">
                    No active ground stops, GDPs, or severe hub restrictions reported.
                  </div>
                ) : (
                  disruptions.slice(0, 12).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onFlyToAirport(d.icao)}
                      className="w-full text-left rounded-xl border border-border bg-background/75 hover:bg-accent/60 p-2.5 text-xs space-y-1 cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-foreground">
                          {d.iata || d.icao} · {d.airportName}
                        </span>
                        <Badge variant={d.severity === 'HIGH' ? 'destructive' : 'warning'}>
                          {d.type}
                          {d.avgDelayMinutes ? ` ${d.avgDelayMinutes}m` : ''}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">{d.reason}</p>
                    </button>
                  ))
                )}
              </div>

              {/* Active Turbulence, Icing & Convective SIGMETs */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Active Map SIGMETs / G-AIRMETs ({sigmets.length})
                </div>
                {sigmets.length === 0 ? (
                  <div className="rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground">
                    No active NOAA AWC SIGMET/G-AIRMET polygons decoded in feed.
                  </div>
                ) : (
                  sigmets.slice(0, 14).map((hz) => {
                    const center = hz.coords[0];
                    return (
                      <button
                        key={hz.id}
                        type="button"
                        onClick={() => center && onFlyToPoint(center[0], center[1], 5)}
                        className="w-full text-left rounded-xl border border-border bg-background/75 hover:bg-accent/60 p-2.5 text-xs space-y-1 cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-foreground">
                            {hz.hazard} {hz.qualifier ? `· ${hz.qualifier}` : ''}
                          </span>
                          <Badge
                            variant={
                              hz.category === 'icing'
                                ? 'secondary'
                                : hz.category === 'turbulence'
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {(hz.category ?? 'advisory').toUpperCase()}
                          </Badge>
                        </div>
                        <div className="text-[10.5px] font-mono text-muted-foreground">
                          {hz.baseFt !== null || hz.topFt !== null
                            ? `FL${Math.round((hz.baseFt ?? 0) / 100)}–FL${Math.round((hz.topFt ?? 45000) / 100)}`
                            : 'Surface–Upper'}{' '}
                          · {hz.source}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'safety' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={safetyQuery}
                  onChange={(e) => setSafetyQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSafetySearch();
                  }}
                  placeholder="Enter tail registration (e.g. B-1356, N123AB, G-BYGC)"
                  aria-label="Lookup Aviation Safety Network records by registration"
                  className="h-9 pl-8 text-xs font-mono"
                />
              </div>
              <Button size="sm" onClick={() => void runSafetySearch()} disabled={safetyLoading}>
                {safetyLoading ? 'Checking ASN…' : 'Lookup ASN'}
              </Button>
              {selectedFlight?.registration && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSafetyQuery(selectedFlight.registration);
                    void runSafetySearch(selectedFlight.registration);
                  }}
                >
                  <Plane className="w-3.5 h-3.5" />
                  Use {selectedFlight.registration}
                </Button>
              )}
            </div>

            {safetyResult ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-foreground inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    ASN Database · {safetyResult.registration}
                  </span>
                  <a
                    href={safetyResult.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    Open aviation-safety.net
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {safetyResult.items.length === 0 ? (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-foreground">
                    <div className="font-semibold">
                      No Aviation Safety Network hull loss / incident records matched {safetyResult.registration}.
                    </div>
                    {safetyResult.note && (
                      <div className="text-[11px] text-muted-foreground mt-1">{safetyResult.note}</div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {safetyResult.items.map((rec, i) => (
                      <div
                        key={`${rec.date}-${i}`}
                        className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-foreground">
                            {rec.date} · {rec.type}
                          </span>
                          <Badge variant="warning">{rec.damage || 'Incident'}</Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {rec.operator} · {rec.location} · Fatalities: {rec.fatalities || '0'}
                        </div>
                        {rec.href && (
                          <a
                            href={rec.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                          >
                            Full ASN Dossier
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-secondary/35 p-4 text-xs text-muted-foreground text-center">
                Enter an airframe tail registration to query incident/accident history directly from{' '}
                <a
                  href="https://aviation-safety.net/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  aviation-safety.net
                </a>
                .
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export function resolveCatalogAirportCoords(code: string): {lat: number; lon: number} | null {
  const c = code.trim().toUpperCase();
  const match = AIRPORT_CATALOG.find((a) => a.icao === c || a.iata === c);
  return match ? {lat: match.lat, lon: match.lon} : null;
}
