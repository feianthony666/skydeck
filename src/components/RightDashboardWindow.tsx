import {
  Activity,
  AlertTriangle,
  CheckSquare,
  Cloud,
  CloudRain,
  Compass,
  Crosshair,
  ExternalLink,
  Flame,
  History,
  Layers,
  Pause,
  Plane,
  Play,
  Radio,
  RotateCcw,
  Route,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Snowflake,
  Square,
  Trash2,
  Volume2,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import React, {useEffect, useMemo, useState} from 'react';
import {AIRPORT_CATALOG} from '../data/aviationCatalog';
import {
  apiFetchJson,
  DEFAULT_CF_WORKER_URL,
  isStaticHostingMode,
} from '../services/directAviationClient';
import type {
  AcarsMessage,
  AirfieldSurfaceData,
  AirportBoardFlight,
  AirportBoardResponse,
  AirportDisruption,
  AirportMarker,
  AirportWeather,
  FlightDetail,
  LiveAtcStation,
  LiveFlight,
  LiveFlightUpdateItem,
  PastFlightRecord,
  PlaneLabelSettings,
  ProviderStatus,
  RadarSettings,
  SafetyRecordResponse,
  SigmetHazard,
  TrafficFlagFilter,
  WeatherOverlaySettings,
} from '../types/aviation';
import {AirportBoardPanel} from './AirportBoardPanel';
import {type PlaybackState} from './BottomOpsDrawer';
import {FlightInspectorPanel} from './FlightInspectorPanel';
import {DEFAULT_PLANE_LABELS} from './RadarMap';
import {getDbFlagMeta, getEmergencySquawkMeta} from './aircraftIcons';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Separator} from './ui/separator';
import {TabsList, TabsTrigger} from './ui/tabs';

export type DashboardTab = 'inspector' | 'traffic' | 'layers' | 'ops';

interface RightDashboardWindowProps {
  open: boolean;
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  onClose: () => void;
  isPortraitMobile: boolean;
  onOpenCredits: () => void;
  onOpenHistoryView: (query?: string) => void;

  // Inspector props
  activeInspectorType: 'flight' | 'airport' | null;
  onInspectorTypeChange: (mode: 'flight' | 'airport') => void;
  selectedFlight: LiveFlight | null;
  selectedDetail: FlightDetail | null;
  detailLoading: boolean;
  nowEpochSec: number;
  userLocation?: {lat: number; lon: number; label?: string} | null;
  mapAirports: AirportMarker[];
  matchingAcars: AcarsMessage[];
  followSelected: boolean;
  isolateSelected: boolean;
  flightTrailsActive: boolean;
  onToggleFollow: () => void;
  onToggleIsolate: () => void;
  onToggleFlightTrails: () => void;
  onCloseFlight: () => void;

  // Multi-select props
  multiSelectFlights: LiveFlight[];
  selectedFlightIds: string[];
  multiSelectMode: boolean;
  onToggleMultiSelectMode: () => void;
  onToggleFlightInMultiSelect: (f: LiveFlight) => void;
  onRemoveMultiFlight: (id: string) => void;
  onClearMultiFlights: () => void;

  // Airport board props
  selectedAirport: {icao: string; iata: string; name: string} | null;
  airportBoard: AirportBoardResponse | null;
  airportBoardLoading: boolean;
  selectedAirportWeather?: AirportWeather;
  selectedAirportSurface: AirfieldSurfaceData | null;
  airportTrafficFilter: 'none' | 'all' | 'arrivals' | 'departures' | 'delayed';
  onAirportFilterChange: (filter: 'none' | 'all' | 'arrivals' | 'departures' | 'delayed') => void;
  onSelectAirport: (ap: {icao: string; iata: string; name: string}) => void;
  onSelectFlightFromBoard: (item: AirportBoardFlight) => void;
  onFocusAirfield: () => void;
  onCloseAirport: () => void;

  // Traffic & filter props
  flights: LiveFlight[];
  filteredFlights: LiveFlight[];
  fovFlights: LiveFlight[];
  flightsLoading: boolean;
  providers: ProviderStatus[];
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  phaseFilter: 'all' | 'air' | 'ground';
  onPhaseFilterChange: (p: 'all' | 'air' | 'ground') => void;
  trafficFilter: TrafficFlagFilter;
  onTrafficFilterChange: (t: TrafficFlagFilter) => void;
  modelFilter: string;
  onModelFilterChange: (m: string) => void;
  availableModels: Array<{code: string; count: number}>;
  countryFilter: string;
  onCountryFilterChange: (c: string) => void;
  availableCountries: Array<{code: string; name: string; count: number}>;
  laddCount: number;
  militaryCount: number;
  piaCount: number;
  emergencyCount: number;
  airborneCount: number;
  groundCount: number;
  onFocusFlight: (flight: LiveFlight) => void;

  // Settings / Weather props
  radarSettings: RadarSettings;
  onUpdateRadarSettings: (patch: Partial<RadarSettings>) => void;
  onResetRadarSettings: () => void;

  // Ops / Radio / Playback props
  liveUpdates: LiveFlightUpdateItem[];
  sigmets: SigmetHazard[];
  disruptions: AirportDisruption[];
  acarsMessages: AcarsMessage[];
  playbackState: PlaybackState;
  onUpdatePlayback: (patch: Partial<PlaybackState>) => void;
  onSelectFlightByHexOrCallsign: (icao24?: string, callsign?: string) => void;
  onFlyToAirport: (code: string) => void;
  onFlyToPoint: (lat: number, lon: number, zoom?: number) => void;
}

const WX_OVERLAY_TOGGLES: Array<{
  key: keyof WeatherOverlaySettings;
  label: string;
}> = [
  {key: 'cloudCoverage', label: 'Cloud Coverage'},
  {key: 'totalPrecip', label: 'Total Precip'},
  {key: 'intensePrecip', label: 'Intense Precip'},
  {key: 'naRadar', label: 'North American Radar'},
  {key: 'windBarbs', label: 'Wind Barbs'},
  {key: 'sigwx', label: 'Significant WX (250-630FL)'},
  {key: 'airmetsSigmets', label: 'AIRMETs & SIGMETs'},
  {key: 'airepsPireps', label: 'AIREPs & PIREPs'},
  {key: 'volcanic', label: 'Volcanic Eruptions'},
  {key: 'turbulence', label: 'Turbulence'},
  {key: 'icing', label: 'Icing'},
  {key: 'lightning', label: 'Lightning'},
  {key: 'fog', label: 'Fog'},
];

const PLANE_LABEL_FIELDS: Array<{
  key: Exclude<keyof PlaneLabelSettings, 'allowOverlap'>;
  label: string;
}> = [
  {key: 'showOnGround', label: 'Aircraft on Ground'},
  {key: 'showAirlineLogo', label: 'Airline Logo'},
  {key: 'showFlightNumber', label: 'Flight Number'},
  {key: 'showRoute', label: 'Route'},
  {key: 'showModel', label: 'Model'},
  {key: 'showRegistration', label: 'Registration'},
  {key: 'showModeS', label: 'Mode-S Hex'},
  {key: 'showAltitude', label: 'Altitude'},
  {key: 'showSpeed', label: 'Speed'},
  {key: 'showSquawk', label: 'Squawk'},
  {key: 'showHeading', label: 'Heading'},
  {key: 'showPhotoOnHover', label: 'Photo on Hover'},
  {key: 'showDepartureTime', label: 'Departure Time'},
  {key: 'showTakeOffTime', label: 'Take-Off Time'},
  {key: 'showEta', label: 'Estimated Arr (ETA)'},
  {key: 'showDistanceToDest', label: 'Dist to Dest'},
  {key: 'showRemainingTime', label: 'Remaining Time'},
  {key: 'showLastPositionReport', label: 'Last Pos Report'},
];

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

export const RightDashboardWindow: React.FC<RightDashboardWindowProps> = ({
  open,
  activeTab,
  onTabChange,
  onClose,
  isPortraitMobile,
  onOpenCredits,
  onOpenHistoryView,
  activeInspectorType,
  onInspectorTypeChange,
  selectedFlight,
  selectedDetail,
  detailLoading,
  nowEpochSec,
  userLocation,
  mapAirports,
  matchingAcars,
  followSelected,
  isolateSelected,
  flightTrailsActive,
  onToggleFollow,
  onToggleIsolate,
  onToggleFlightTrails,
  onCloseFlight,
  multiSelectFlights,
  selectedFlightIds,
  multiSelectMode,
  onToggleMultiSelectMode,
  onToggleFlightInMultiSelect,
  onRemoveMultiFlight,
  onClearMultiFlights,
  selectedAirport,
  airportBoard,
  airportBoardLoading,
  selectedAirportWeather,
  selectedAirportSurface,
  airportTrafficFilter,
  onAirportFilterChange,
  onSelectAirport,
  onSelectFlightFromBoard,
  onFocusAirfield,
  onCloseAirport,
  flights,
  filteredFlights,
  fovFlights,
  providers,
  searchQuery,
  onSearchQueryChange,
  phaseFilter,
  onPhaseFilterChange,
  trafficFilter,
  onTrafficFilterChange,
  modelFilter,
  onModelFilterChange,
  availableModels,
  countryFilter,
  onCountryFilterChange,
  availableCountries,
  laddCount,
  militaryCount,
  piaCount,
  emergencyCount,
  airborneCount,
  groundCount,
  onFocusFlight,
  radarSettings,
  onUpdateRadarSettings,
  onResetRadarSettings,
  liveUpdates,
  sigmets,
  disruptions,
  acarsMessages,
  playbackState,
  onUpdatePlayback,
  onSelectFlightByHexOrCallsign,
  onFlyToAirport,
  onFlyToPoint,
}) => {
  const [trafficScope, setTrafficScope] = useState<'fov' | 'sector'>('fov');
  const [trafficSort, setTrafficSort] = useState<'alt' | 'speed' | 'callsign'>('alt');
  const [opsSubTab, setOpsSubTab] = useState<'radio' | 'playback' | 'updates' | 'history'>('radio');

  const [radioQuery, setRadioQuery] = useState('');
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioStations, setRadioStations] = useState<LiveAtcStation[]>([]);
  const [activeStation, setActiveStation] = useState<LiveAtcStation | null>(null);
  const [radioError, setRadioError] = useState<string | null>(null);

  const [pastQuery, setPastQuery] = useState('');
  const [pastLoading, setPastLoading] = useState(false);
  const [pastItems, setPastItems] = useState<PastFlightRecord[]>([]);
  const [pastSearched, setPastSearched] = useState(false);

  const [safetyQuery, setSafetyQuery] = useState('');
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyResult, setSafetyResult] = useState<SafetyRecordResponse | null>(null);

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
    if (open && activeTab === 'ops' && opsSubTab === 'radio' && radioStations.length === 0 && !radioLoading) {
      void fetchAtcStations(radioQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, opsSubTab]);

  const runPastSearch = async (override?: string) => {
    const q = (override ?? pastQuery).trim().toUpperCase();
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

  const toggleWxLayer = (key: keyof WeatherOverlaySettings) => {
    const prevWx = radarSettings.wxLayers;
    const nextVal = !prevWx[key];
    const nextWx: WeatherOverlaySettings = {...prevWx, [key]: nextVal};
    const patch: Partial<RadarSettings> = {wxLayers: nextWx};
    if (key === 'airmetsSigmets') patch.showSigmets = nextVal;
    if (key === 'turbulence') patch.showTurbHazards = nextVal;
    if (key === 'icing') patch.showIceHazards = nextVal;
    if (key === 'naRadar' || key === 'totalPrecip' || key === 'intensePrecip') {
      patch.showRadar = Boolean(nextWx.naRadar || nextWx.totalPrecip || nextWx.intensePrecip);
    }
    onUpdateRadarSettings(patch);
  };

  const pl = radarSettings.planeLabels ?? DEFAULT_PLANE_LABELS;
  const togglePlaneLabelField = (key: Exclude<keyof PlaneLabelSettings, 'allowOverlap'>) => {
    onUpdateRadarSettings({
      planeLabels: {
        ...pl,
        [key]: !pl[key],
        allowOverlap: false,
      },
    });
  };

  const trafficPool = useMemo(() => {
    const base = trafficScope === 'fov' ? fovFlights : filteredFlights;
    return [...base]
      .sort((a, b) => {
        if (trafficSort === 'speed') return b.groundSpeedKts - a.groundSpeedKts;
        if (trafficSort === 'callsign') return (a.callsign || a.icao24).localeCompare(b.callsign || b.icao24);
        return b.altitudeFt - a.altitudeFt;
      })
      .slice(0, 140);
  }, [trafficScope, fovFlights, filteredFlights, trafficSort]);

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (phaseFilter !== 'all' ? 1 : 0) +
    (trafficFilter !== 'all' ? 1 : 0) +
    (modelFilter !== 'all' ? 1 : 0) +
    (countryFilter !== 'all' ? 1 : 0);

  const activeWxCount = Object.values(radarSettings.wxLayers).filter(Boolean).length;
  const maintAcars = acarsMessages.filter(
    (m) => m.category === 'MAINT' || /EMERG|MAYDAY|PAN|DIVERT|GATE|DELAY/i.test(m.rawText),
  );
  const trailFlightCount = useMemo(
    () => fovFlights.filter((f) => (f.trail?.length ?? 0) >= 2).length,
    [fovFlights],
  );

  const quickPickAirborne = useMemo(
    () => fovFlights.filter((f) => !f.onGround).slice(0, 6),
    [fovFlights],
  );

  if (!open) return null;

  return (
    <aside
      aria-label="SkyDeck right dashboard window"
      data-no-map-wheel
      className={
        isPortraitMobile
          ? 'fixed inset-x-2 top-[58px] bottom-[72px] z-[565] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden'
          : 'fixed top-3 right-3 bottom-[72px] z-[565] w-[min(436px,calc(100vw-24px))] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden'
      }
    >
      {/* Window Chrome Header */}
      <div className="px-3.5 py-2.5 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-xs font-bold tracking-tight text-foreground">
              Operations Window
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
              {fovFlights.length} in view · {filteredFlights.length} total
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenCredits}
            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            title="Credits & Open Data Attributions"
          >
            <Scale className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Credits</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close dashboard window"
            className="h-7 w-7"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Primary 4-Tab Bar */}
      <div className="px-3 py-2 border-b border-border/70 shrink-0 bg-secondary/25">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger active={activeTab === 'inspector'} onClick={() => onTabChange('inspector')}>
            <Plane className="w-3.5 h-3.5 mr-1 inline" />
            Inspect
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'traffic'} onClick={() => onTabChange('traffic')}>
            <Search className="w-3.5 h-3.5 mr-1 inline" />
            Traffic
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'layers'} onClick={() => onTabChange('layers')}>
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1 inline" />
            Layers
            {activeWxCount > 0 ? ` (${activeWxCount})` : ''}
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'ops'} onClick={() => onTabChange('ops')}>
            <Radio className="w-3.5 h-3.5 mr-1 inline" />
            Ops
            {liveUpdates.length > 0 ? ` (${liveUpdates.length})` : ''}
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Window Body */}
      {activeTab === 'inspector' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Compact Multi-Select Strip when 1+ flights tracked via Shift+Click */}
          {multiSelectFlights.length > 0 && (
            <div className="px-3 py-2 border-b border-border/70 bg-secondary/30 shrink-0 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span>Tracked ({multiSelectFlights.length})</span>
                  <button
                    type="button"
                    onClick={onToggleMultiSelectMode}
                    className={`rounded px-1.5 py-0.5 text-[9.5px] font-mono border cursor-pointer ${
                      multiSelectMode
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border'
                    }`}
                  >
                    {multiSelectMode ? 'MULTI ON' : 'SHIFT+CLICK'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onClearMultiFlights}
                  className="text-[10.5px] text-muted-foreground hover:text-destructive inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
                {multiSelectFlights.map((f) => {
                  const isPrimary = f.id === selectedFlight?.id;
                  return (
                    <div
                      key={f.id}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-mono shrink-0 ${
                        isPrimary
                          ? 'border-primary bg-primary/15 text-foreground'
                          : 'border-border bg-background text-foreground'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onFocusFlight(f)}
                        className="font-bold hover:text-primary cursor-pointer whitespace-nowrap"
                      >
                        {f.callsign || f.icao24}
                      </button>
                      <span className="text-muted-foreground tabular-nums">
                        {f.onGround ? 'GND' : `FL${Math.round(f.altitudeFt / 100)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveMultiFlight(f.id)}
                        aria-label={`Remove ${f.callsign || f.icao24}`}
                        className="text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Switch between selected Flight & selected Airport */}
          {selectedFlight && selectedAirport && (
            <div className="px-3 py-1.5 border-b border-border/60 shrink-0">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger
                  active={activeInspectorType === 'flight'}
                  onClick={() => onInspectorTypeChange('flight')}
                >
                  Flight: {selectedFlight.callsign}
                </TabsTrigger>
                <TabsTrigger
                  active={activeInspectorType === 'airport'}
                  onClick={() => onInspectorTypeChange('airport')}
                >
                  Airport: {selectedAirport.iata || selectedAirport.icao}
                </TabsTrigger>
              </TabsList>
            </div>
          )}

          {activeInspectorType === 'airport' && selectedAirport ? (
            <AirportBoardPanel
              embedded
              airport={selectedAirport}
              board={airportBoard}
              loading={airportBoardLoading}
              weather={selectedAirportWeather}
              surface={selectedAirportSurface}
              timeDisplayMode={radarSettings.timeDisplayMode}
              onTimeDisplayModeChange={(mode) => onUpdateRadarSettings({timeDisplayMode: mode})}
              activeFilter={airportTrafficFilter}
              onFilterChange={onAirportFilterChange}
              onSelectFlightFromBoard={onSelectFlightFromBoard}
              onFocusAirfield={onFocusAirfield}
              onClose={onCloseAirport}
            />
          ) : selectedFlight ? (
            <FlightInspectorPanel
              embedded
              flight={selectedFlight}
              detail={selectedDetail}
              detailLoading={detailLoading}
              nowEpochSec={nowEpochSec}
              timeDisplayMode={radarSettings.timeDisplayMode}
              userLocation={userLocation}
              mapAirports={mapAirports}
              matchingAcars={matchingAcars}
              followSelected={followSelected}
              isolateSelected={isolateSelected}
              showFlightTrails={flightTrailsActive}
              onToggleFollow={onToggleFollow}
              onToggleIsolate={onToggleIsolate}
              onToggleFlightTrails={onToggleFlightTrails}
              onSelectAirport={onSelectAirport}
              onClose={onCloseFlight}
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              <div className="rounded-xl border border-border bg-secondary/35 p-4 text-center space-y-1.5">
                <Crosshair className="w-5 h-5 text-primary mx-auto" />
                <div className="text-xs font-semibold text-foreground">
                  Select an Aircraft or Airport on the Map
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Click any plane for live telemetry, altitude-gradient flight trail, speed profile, and registration dossier, or click an airport pin for arrivals/departures and ground charts.
                </p>
              </div>

              {quickPickAirborne.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Live Airborne in Viewport
                  </div>
                  <div className="space-y-1.5">
                    {quickPickAirborne.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => onFocusFlight(f)}
                        className="w-full text-left rounded-xl border border-border bg-background/75 hover:bg-accent/60 p-2.5 flex items-center justify-between gap-2 text-xs cursor-pointer"
                      >
                        <div className="min-w-0 font-mono">
                          <span className="font-bold text-foreground">{f.callsign || f.icao24}</span>
                          <span className="text-muted-foreground ml-2">
                            {f.origin || '—'} → {f.destination || '—'}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground tabular-nums shrink-0">
                          {f.altitudeFt >= 18000 ? `FL${Math.round(f.altitudeFt / 100)}` : `${f.altitudeFt}ft`} ·{' '}
                          {Math.round(f.groundSpeedKts)} kt
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Major Airports
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AIRPORT_CATALOG.slice(0, 8).map((ap) => (
                    <button
                      key={ap.icao}
                      type="button"
                      onClick={() => onSelectAirport({icao: ap.icao, iata: ap.iata, name: ap.name})}
                      className="rounded-lg border border-border bg-background hover:bg-accent px-2.5 py-1 text-[11px] font-mono font-semibold text-foreground cursor-pointer"
                    >
                      {ap.iata} · {ap.icao}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 space-y-3.5 [scrollbar-width:thin]">
          {activeTab === 'traffic' && (
            <div className="space-y-3">
              {/* Search & Reset */}
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    placeholder="Callsign, tail, hex, squawk (7700)…"
                    aria-label="Search live ADS-B flights"
                    className="h-8 pl-8 text-xs font-mono"
                  />
                </div>
                {activeFilterCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-[11px]"
                    onClick={() => {
                      onSearchQueryChange('');
                      onPhaseFilterChange('all');
                      onTrafficFilterChange('all');
                      onModelFilterChange('all');
                      onCountryFilterChange('all');
                    }}
                  >
                    Reset ({activeFilterCount})
                  </Button>
                )}
              </div>

              {/* Phase + Flag Filters */}
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary/65 p-1">
                {(
                  [
                    {id: 'all', label: `All (${flights.length})`},
                    {id: 'air', label: `Air (${airborneCount})`},
                    {id: 'ground', label: `Gnd (${groundCount})`},
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onPhaseFilterChange(p.id)}
                    className={`rounded-lg py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                      phaseFilter === p.id
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-1">
                {(
                  [
                    {id: 'all', label: 'All Feeds'},
                    {id: 'emergency', label: `EMERG (${emergencyCount})`},
                    {id: 'ladd', label: `LADD (${laddCount})`},
                    {id: 'military', label: `MIL (${militaryCount})`},
                    {id: 'pia', label: `PIA (${piaCount})`},
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.id}
                    size="sm"
                    variant={trafficFilter === opt.id ? 'default' : 'outline'}
                    onClick={() => onTrafficFilterChange(opt.id)}
                    className="h-7 px-2 text-[10.5px]"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              {/* Model & Country Dropdowns */}
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={modelFilter}
                  onChange={(e) => onModelFilterChange(e.target.value)}
                  aria-label="Filter by aircraft model"
                  className="h-8 rounded-lg bg-background border border-input px-2 text-xs text-foreground cursor-pointer"
                >
                  <option value="all">All Models ({availableModels.length})</option>
                  {availableModels.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.code} ({m.count})
                    </option>
                  ))}
                </select>
                <select
                  value={countryFilter}
                  onChange={(e) => onCountryFilterChange(e.target.value)}
                  aria-label="Filter by country of registration"
                  className="h-8 rounded-lg bg-background border border-input px-2 text-xs text-foreground cursor-pointer"
                >
                  <option value="all">All Countries ({availableCountries.length})</option>
                  {availableCountries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope, Sort & Multi-Select */}
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 rounded-lg bg-secondary/55 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setTrafficScope('fov')}
                    className={`rounded-md px-2 py-1 font-medium cursor-pointer ${
                      trafficScope === 'fov' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    In FOV ({fovFlights.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrafficScope('sector')}
                    className={`rounded-md px-2 py-1 font-medium cursor-pointer ${
                      trafficScope === 'sector'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground'
                    }`}
                  >
                    Sector ({filteredFlights.length})
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <select
                    value={trafficSort}
                    onChange={(e) => setTrafficSort(e.target.value as 'alt' | 'speed' | 'callsign')}
                    aria-label="Sort traffic"
                    className="h-7 rounded-lg bg-background border border-input px-2 text-[11px] text-foreground cursor-pointer"
                  >
                    <option value="alt">Sort: Alt</option>
                    <option value="speed">Sort: Speed</option>
                    <option value="callsign">Sort: Callsign</option>
                  </select>
                  <Button
                    size="sm"
                    variant={multiSelectMode ? 'default' : 'outline'}
                    onClick={onToggleMultiSelectMode}
                    className="h-7 px-2 text-[10.5px]"
                  >
                    Multi
                  </Button>
                </div>
              </div>

              {/* Flight List Rows */}
              <div className="space-y-1.5">
                {trafficPool.length === 0 ? (
                  <div className="rounded-xl border border-border bg-secondary/35 p-5 text-center text-xs text-muted-foreground">
                    No aircraft match the current viewport and filter criteria.
                  </div>
                ) : (
                  trafficPool.map((f) => {
                    const isChecked = selectedFlightIds.includes(f.id) || selectedFlight?.id === f.id;
                    const db = getDbFlagMeta(f);
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
                          aria-label={`Toggle multi-select for ${f.callsign || f.icao24}`}
                          className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
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
                          className="flex-1 min-w-0 text-left flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-mono">
                              <span className="font-bold text-foreground">
                                {f.callsign || f.flightNumber || f.icao24}
                              </span>
                              {f.aircraftType && (
                                <span className="text-[10.5px] text-muted-foreground">{f.aircraftType}</span>
                              )}
                              {db && <Badge variant="outline" className="text-[9.5px] h-4 px-1">{db.shortLabel}</Badge>}
                            </div>
                            <div className="text-[10.5px] font-mono text-muted-foreground truncate">
                              {f.origin || '—'} → {f.destination || '—'}
                              {f.registration ? ` · ${f.registration}` : ''}
                            </div>
                          </div>
                          <div className="text-right font-mono text-[11px] tabular-nums shrink-0">
                            <div className="font-semibold text-foreground">
                              {f.onGround
                                ? 'GND'
                                : f.altitudeFt >= 18000
                                  ? `FL${Math.round(f.altitudeFt / 100)}`
                                  : `${f.altitudeFt.toLocaleString()}ft`}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {Math.round(f.groundSpeedKts)} kt
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Compact ADS-B Provider Health */}
              <details className="rounded-xl border border-border bg-secondary/30 p-2.5 text-xs">
                <summary className="cursor-pointer font-medium text-foreground select-none">
                  Live ADS-B Receiver Feeds ({providers.filter((p) => p.ok).length}/{providers.length || 0} active)
                </summary>
                <div className="mt-2 divide-y divide-border/70 font-mono text-[11px]">
                  {providers.map((p) => (
                    <div key={p.provider} className="py-1.5 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-foreground">{p.provider.toUpperCase()}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {p.ok ? `${p.count} contacts · ${p.latencyMs}ms` : p.note || 'Idle'}
                        </div>
                      </div>
                      <Badge variant={p.ok ? 'success' : 'warning'}>{p.ok ? 'LIVE' : 'IDLE'}</Badge>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {activeTab === 'layers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Map, Weather &amp; Label Controls</span>
                <Button size="sm" variant="ghost" onClick={onResetRadarSettings} className="h-7 px-2 text-xs">
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Reset
                </Button>
              </div>

              {/* Flight Trails Toggle + Trail Policy */}
              <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Route className="w-3.5 h-3.5 text-primary" />
                    <span>Flight Trails</span>
                  </div>
                  <Button
                    size="sm"
                    variant={flightTrailsActive ? 'default' : 'outline'}
                    onClick={onToggleFlightTrails}
                    className="h-7 text-[11px]"
                  >
                    {flightTrailsActive ? 'Selected Trail ON' : 'Selected Trail OFF'}
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-1">
                  {(['all', 'selected', 'off'] as const).map((mode) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={radarSettings.flightPathMode === mode ? 'default' : 'outline'}
                      onClick={() => onUpdateRadarSettings({flightPathMode: mode})}
                      className="h-7 text-[11px]"
                    >
                      {mode === 'all' ? 'All Paths' : mode === 'selected' ? 'Selected' : 'Off'}
                    </Button>
                  ))}
                </div>

                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground font-medium">Aircraft Size</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {radarSettings.planeSize} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={34}
                    step={2}
                    value={radarSettings.planeSize}
                    onChange={(e) => onUpdateRadarSettings({planeSize: Number(e.target.value)})}
                    aria-label="Airplane icon size"
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>
              </div>

              {/* Basemap, 3D Model Style & Timezone */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Basemap, 3D Aircraft &amp; Time
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      {id: 'auto', label: 'Auto Map'},
                      {id: 'maptiler-light', label: 'Day Map'},
                      {id: 'maptiler-dark', label: 'Night Map'},
                    ] as const
                  ).map((b) => (
                    <Button
                      key={b.id}
                      size="sm"
                      variant={radarSettings.basemapStyle === b.id ? 'default' : 'outline'}
                      onClick={() => onUpdateRadarSettings({basemapStyle: b.id})}
                      className="h-7 text-[11px]"
                    >
                      {b.label}
                    </Button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant={(radarSettings.aircraft3DStyle ?? 'livery') === 'livery' ? 'default' : 'outline'}
                    onClick={() => onUpdateRadarSettings({aircraft3DStyle: 'livery'})}
                    className="h-7 text-[11px]"
                  >
                    3D Live Liveries
                  </Button>
                  <Button
                    size="sm"
                    variant={radarSettings.aircraft3DStyle === 'airnav-yellow' ? 'default' : 'outline'}
                    onClick={() => onUpdateRadarSettings({aircraft3DStyle: 'airnav-yellow'})}
                    className="h-7 text-[11px]"
                  >
                    3D AirNav Yellow
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      {id: 'airport', label: 'Airport TZ'},
                      {id: 'local', label: 'Local TZ'},
                      {id: 'utc', label: 'UTC'},
                    ] as const
                  ).map((tz) => (
                    <Button
                      key={tz.id}
                      size="sm"
                      variant={radarSettings.timeDisplayMode === tz.id ? 'default' : 'outline'}
                      onClick={() => onUpdateRadarSettings({timeDisplayMode: tz.id})}
                      className="h-7 text-[11px]"
                    >
                      {tz.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* 13 Weather Overlays */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Weather Overlays ({activeWxCount}/13)
                  </span>
                  {activeWxCount > 0 && (
                    <button
                      type="button"
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
                      className="text-[11px] text-primary hover:underline cursor-pointer"
                    >
                      Clear WX
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
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
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-foreground border-border hover:bg-accent'
                        }`}
                      >
                        <IconComp className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                {radarSettings.showRadar && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Radar Opacity</span>
                      <span className="font-mono text-foreground tabular-nums">
                        {Math.round(radarSettings.radarOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={0.9}
                      step={0.05}
                      value={radarSettings.radarOpacity}
                      onChange={(e) => onUpdateRadarSettings({radarOpacity: Number(e.target.value)})}
                      aria-label="Precipitation radar opacity"
                      className="w-full accent-primary cursor-pointer"
                    />
                  </div>
                )}
              </div>

              <Separator />

              {/* Aeronautical & Map Layers */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Aeronautical &amp; World Layers
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      {key: 'showDayNightLine', label: 'Day/Night Line'},
                      {key: 'showTimeZones', label: 'Time Zones'},
                      {key: 'showAtcBoundaries', label: 'ATC Boundaries'},
                      {key: 'showOceanicTracks', label: 'Oceanic Tracks'},
                      {key: 'showHighAirways', label: 'High Airways'},
                      {key: 'showLowAirways', label: 'Low Airways'},
                      {key: 'showWaypoints', label: 'Nav Waypoints'},
                      {key: 'showMetarDots', label: 'METAR Dots'},
                      {key: 'showGroundTraffic', label: 'Ground Traffic'},
                      {key: 'showDrRings', label: 'DR Rings'},
                      {key: 'show3DBuildings', label: '3D Buildings'},
                      {key: 'locateMeEnabled', label: 'Locate Me'},
                    ] as const
                  ).map((item) => {
                    const active = Boolean(radarSettings[item.key]);
                    return (
                      <Button
                        key={item.key}
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        onClick={() => onUpdateRadarSettings({[item.key]: !active})}
                        className="justify-start h-7 text-[11px]"
                      >
                        {item.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* Aircraft Labels */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Aircraft Labels
                  </span>
                  <Button
                    size="sm"
                    variant={radarSettings.showPlaneLabels ? 'default' : 'outline'}
                    onClick={() => onUpdateRadarSettings({showPlaneLabels: !radarSettings.showPlaneLabels})}
                    className="h-7 text-[11px]"
                  >
                    {radarSettings.showPlaneLabels ? 'All Visible' : 'Selected Only'}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-1">
                  {PLANE_LABEL_FIELDS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => togglePlaneLabelField(item.key)}
                      className={`h-7 px-2 rounded-md border text-[10.5px] font-medium text-left truncate transition-colors cursor-pointer ${
                        pl[item.key]
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:text-foreground'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 opacity-55 cursor-not-allowed select-none"
                  title="Non-overlapping label culling is enforced"
                >
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground">Allow Label Overlap</div>
                    <div className="text-[9.5px] text-muted-foreground">Collision culling permanently active</div>
                  </div>
                  <span className="rounded-full bg-muted border border-border px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                    OFF
                  </span>
                </div>
              </div>

              {/* Collapsed Proxy / Worker Config */}
              <details className="rounded-xl border border-border bg-secondary/30 p-2.5 text-xs">
                <summary className="cursor-pointer font-medium text-foreground select-none">
                  CORS Proxy &amp; Strict Wi-Fi Mode
                </summary>
                <div className="mt-2.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Bypass Workers (Strict Wi-Fi)</span>
                    <Button
                      size="sm"
                      variant={radarSettings.preferNoWorkerMode ? 'default' : 'outline'}
                      onClick={() => onUpdateRadarSettings({preferNoWorkerMode: !radarSettings.preferNoWorkerMode})}
                      className="h-7 text-[11px]"
                    >
                      {radarSettings.preferNoWorkerMode ? 'On' : 'Off'}
                    </Button>
                  </div>
                  <input
                    type="url"
                    value={radarSettings.cfWorkerUrl ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateRadarSettings({cfWorkerUrl: val});
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
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-mono text-foreground"
                  />
                  <input
                    type="url"
                    value={radarSettings.apiBaseUrl ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateRadarSettings({apiBaseUrl: val});
                      try {
                        const clean = val.trim().replace(/\/+$/, '');
                        if (clean) window.localStorage.setItem('skydeck-api-base', clean);
                        else window.localStorage.removeItem('skydeck-api-base');
                      } catch {
                        // ignore
                      }
                    }}
                    placeholder="Optional https://your-backend.example"
                    aria-label="Custom SkyDeck API relay URL"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-mono text-foreground"
                  />
                </div>
              </details>
            </div>
          )}

          {activeTab === 'ops' && (
            <div className="space-y-3">
              {/* Sub-mode switcher */}
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-secondary/65 p-1">
                {(
                  [
                    {id: 'radio', label: 'LiveATC'},
                    {id: 'playback', label: 'Playback'},
                    {id: 'updates', label: `Alerts (${liveUpdates.length})`},
                    {id: 'history', label: 'History'},
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setOpsSubTab(sub.id)}
                    className={`rounded-lg py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                      opsSubTab === sub.id
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {opsSubTab === 'radio' && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={radioQuery}
                      onChange={(e) => setRadioQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void fetchAtcStations(radioQuery);
                      }}
                      placeholder="ICAO, city, or facility (KSFO, KJFK, EGLL)…"
                      aria-label="Search LiveATC stations"
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={() => void fetchAtcStations(radioQuery)}
                      disabled={radioLoading}
                      className="h-8"
                    >
                      {radioLoading ? '…' : 'Find'}
                    </Button>
                  </div>

                  {activeStation && (
                    <div className="rounded-xl border border-primary/50 bg-primary/10 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Volume2 className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-mono text-xs font-bold text-foreground truncate">
                            {activeStation.icao} · {activeStation.facility} ({activeStation.freq})
                          </span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setActiveStation(null)} className="h-6 text-[11px]">
                          Stop
                        </Button>
                      </div>
                      <audio
                        key={activeStation.mount}
                        controls
                        autoPlay
                        preload="none"
                        src={
                          isStaticHostingMode()
                            ? `https://d.liveatc.net/${encodeURIComponent(activeStation.mount)}`
                            : `./api/liveatc/stream?mount=${encodeURIComponent(activeStation.mount)}`
                        }
                        className="w-full h-8"
                      />
                    </div>
                  )}

                  {radioError && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-foreground">
                      {radioError}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {radioStations.map((st) => {
                      const isPlaying = activeStation?.id === st.id;
                      return (
                        <div
                          key={st.id}
                          className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 text-xs ${
                            isPlaying ? 'border-primary bg-primary/10' : 'border-border bg-background/75'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-foreground">
                              {st.icao} {st.iata ? `/ ${st.iata}` : ''} · {st.freq}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {st.facility} · {st.name}
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
                            className="h-7 shrink-0"
                          >
                            {isPlaying ? 'Live' : 'Tune'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {opsSubTab === 'playback' && (
                <div className="rounded-xl border border-border bg-secondary/35 p-3 space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-foreground">4D Viewport Trail Playback</div>
                    <div className="text-[11px] text-muted-foreground">
                      Scrub {trailFlightCount} aircraft along recorded trails inside the active sector.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
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
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!playbackState.enabled}
                      onClick={() => onUpdatePlayback({playing: !playbackState.playing})}
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
                    {playbackState.enabled && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onUpdatePlayback({enabled: false, playing: false, progress: 1})}
                      >
                        Live
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={0.5}
                      value={Math.round(playbackState.progress * 1000) / 10}
                      onChange={(e) =>
                        onUpdatePlayback({
                          enabled: true,
                          progress: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                        })
                      }
                      aria-label="Flight playback progress"
                      className="w-full accent-primary cursor-pointer"
                    />
                    <div className="flex justify-between font-mono text-[10.5px] text-muted-foreground tabular-nums">
                      <span>0%</span>
                      <span className="text-foreground font-semibold">
                        {Math.round(playbackState.progress * 100)}%
                      </span>
                      <span>100%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {[1, 5, 20, 60].map((spd) => (
                      <Button
                        key={spd}
                        size="sm"
                        variant={playbackState.speed === spd ? 'default' : 'outline'}
                        onClick={() => onUpdatePlayback({speed: spd})}
                        className="h-7 px-2.5 text-[11px] font-mono"
                      >
                        {spd}x
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {opsSubTab === 'updates' && (
                <div className="space-y-2">
                  {liveUpdates.length === 0 && maintAcars.length === 0 && disruptions.length === 0 ? (
                    <div className="rounded-xl border border-border bg-secondary/35 p-5 text-center text-xs text-muted-foreground">
                      No active emergency squawks, delays, or SIGMET hazards surfaced for this sector.
                    </div>
                  ) : (
                    <>
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
                            <div className="flex items-center gap-1.5">
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
                            </div>
                            <div className="text-[11px] text-muted-foreground">{upd.detail}</div>
                          </div>
                          {(upd.icao24 || upd.kind === 'emergency') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onSelectFlightByHexOrCallsign(upd.icao24, upd.title)}
                              className="h-7 shrink-0"
                            >
                              Track
                            </Button>
                          )}
                        </div>
                      ))}

                      {disruptions.slice(0, 6).map((d) => (
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
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{d.reason}</p>
                        </button>
                      ))}

                      {sigmets.slice(0, 5).map((hz) => {
                        const center = hz.coords[0];
                        return (
                          <button
                            key={hz.id}
                            type="button"
                            onClick={() => center && onFlyToPoint(center[0], center[1], 5)}
                            className="w-full text-left rounded-xl border border-border bg-background/75 hover:bg-accent/60 p-2.5 text-xs flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <span className="font-mono font-semibold text-foreground">{hz.hazard}</span>
                            <Badge variant="outline">{(hz.category ?? 'advisory').toUpperCase()}</Badge>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {opsSubTab === 'history' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-secondary/35 p-2.5">
                    <div className="text-xs text-foreground font-medium">
                      Full Flight History &amp; Playback Page
                    </div>
                    <Button
                      size="sm"
                      onClick={() => onOpenHistoryView(pastQuery || selectedFlight?.flightNumber || selectedFlight?.callsign)}
                      className="h-7 text-[11px] whitespace-nowrap"
                    >
                      <History className="w-3.5 h-3.5 mr-1" />
                      Open History Page
                    </Button>
                  </div>

                  {/* Quick Past Flights Search */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={pastQuery}
                        onChange={(e) => setPastQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runPastSearch();
                        }}
                        placeholder="Flight (UA857) or tail (B-1356)…"
                        aria-label="Quick search past flights"
                        className="h-8 text-xs font-mono"
                      />
                      <Button size="sm" onClick={() => void runPastSearch()} disabled={pastLoading} className="h-8">
                        {pastLoading ? '…' : 'Search'}
                      </Button>
                    </div>
                    {pastSearched && pastItems.length === 0 && !pastLoading && (
                      <div className="text-[11px] text-muted-foreground">No recent sectors found for {pastQuery}.</div>
                    )}
                    {pastItems.slice(0, 6).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-border bg-background/75 p-2 text-xs flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 font-mono">
                          <div className="font-bold text-foreground">
                            {item.flightNumber || item.callsign} · {item.originIata || item.originIcao || '—'} →{' '}
                            {item.destinationIata || item.destinationIcao || '—'}
                          </div>
                          <div className="text-[10.5px] text-muted-foreground tabular-nums">
                            {formatEpochShort(item.actualDep || item.scheduledDep)}
                          </div>
                        </div>
                        <Badge variant="outline">{item.statusText || 'Completed'}</Badge>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  {/* Quick ASN Safety Check */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={safetyQuery}
                        onChange={(e) => setSafetyQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runSafetySearch();
                        }}
                        placeholder="ASN tail check (e.g. N123AB)…"
                        aria-label="ASN safety lookup by tail"
                        className="h-8 text-xs font-mono"
                      />
                      <Button size="sm" onClick={() => void runSafetySearch()} disabled={safetyLoading} className="h-8">
                        {safetyLoading ? '…' : 'ASN'}
                      </Button>
                    </div>
                    {safetyResult && (
                      <div className="rounded-xl border border-border bg-background/75 p-2.5 text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-foreground inline-flex items-center gap-1">
                            {safetyResult.items.length > 0 ? (
                              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                            {safetyResult.registration} ({safetyResult.items.length})
                          </span>
                          <a
                            href={safetyResult.searchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1 text-[11px]"
                          >
                            ASN <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {safetyResult.note && (
                          <div className="text-[11px] text-muted-foreground">{safetyResult.note}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
