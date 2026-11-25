import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  History,
  LocateFixed,
  Moon,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Radio,
  Route,
  Search,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {type PlaybackState} from './components/BottomOpsDrawer';
import {CreditsAttributionsModal} from './components/CreditsAttributionsModal';
import {FlightHistoryView} from './components/FlightHistoryView';
import {FlightPlannerView} from './components/FlightPlannerView';
import {PWAInstallButton} from './components/PWAInstallButton';
import {
  DEFAULT_PLANE_LABELS,
  DEFAULT_RADAR_SETTINGS,
  DEFAULT_WX_LAYERS,
  RadarMap,
} from './components/RadarMap';
import {RightDashboardWindow, type DashboardTab} from './components/RightDashboardWindow';
import {TaxiAcarsView} from './components/TaxiAcarsView';
import {getEmergencySquawkMeta} from './components/aircraftIcons';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {
  AIRPORT_CATALOG,
  REGION_PRESETS,
  resolveCountryFromFlight,
  type RegionPreset,
} from './data/aviationCatalog';
import {useOnlineStatus} from './hooks/useOnlineStatus';
import {apiFetchJson, DEFAULT_CF_WORKER_URL} from './services/directAviationClient';
import {
  loadCachedAirportDirectory,
  saveCachedAirportDirectory,
} from './three/gpuAirfieldEngine';
import {
  deadReckonFlight,
  haversineNm,
  loadAcarsSnapshot,
  loadFlightSnapshot,
  loadWeatherSnapshot,
  saveAcarsSnapshot,
  saveFlightSnapshot,
  saveWeatherSnapshot,
} from './services/offlineStore';
import type {
  AcarsMessage,
  AirfieldSurfaceData,
  AirportBoardFlight,
  AirportBoardResponse,
  AirportDisruption,
  AirportMarker,
  AirportWeather,
  AppView,
  FlightDetail,
  FlightsResponse,
  LiveFlight,
  LiveFlightUpdateItem,
  ProviderStatus,
  RadarSettings,
  RainViewerMeta,
  SigmetHazard,
  TrafficFlagFilter,
} from './types/aviation';

const RADAR_SETTINGS_KEY = 'skydeck-radar-settings-v3';

function detectPortraitMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.innerWidth;
  const h = window.innerHeight;
  return (h > w && w <= 1024) || w < 640;
}

function loadSavedRadarSettings(): RadarSettings {
  try {
    const raw = window.localStorage.getItem(RADAR_SETTINGS_KEY);
    if (!raw) return DEFAULT_RADAR_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<RadarSettings>;
    const basemapStyle: RadarSettings['basemapStyle'] =
      parsed.basemapStyle === 'maptiler-light' || parsed.basemapStyle === 'maptiler-dark'
        ? parsed.basemapStyle
        : 'auto';
    return {
      ...DEFAULT_RADAR_SETTINGS,
      ...parsed,
      basemapStyle,
      showPlaneLabels: parsed.showPlaneLabels ?? true,
      aircraft3DStyle: parsed.aircraft3DStyle ?? 'livery',
      showTimeZones: parsed.showTimeZones ?? true,
      planeLabels: {
        ...DEFAULT_PLANE_LABELS,
        ...(parsed.planeLabels ?? {}),
        allowOverlap: false,
      },
      wxLayers: {
        ...DEFAULT_WX_LAYERS,
        ...(parsed.wxLayers ?? {}),
      },
      cfWorkerUrl: parsed.cfWorkerUrl?.trim() ? parsed.cfWorkerUrl : DEFAULT_CF_WORKER_URL,
    };
  } catch {
    return DEFAULT_RADAR_SETTINGS;
  }
}

function buildLocalRegion(lat: number, lon: number, label?: string): RegionPreset {
  const latSpan = 3.2;
  const lonSpan = 4.6;
  return {
    id: 'local',
    label: label ? `Near Me (${label})` : 'Near Me (Local)',
    subtitle: `${lat.toFixed(2)}°, ${lon.toFixed(2)}° · Live local ADS-B sector`,
    center: [lat, lon],
    zoom: 8,
    bounds: {
      lamin: Math.max(-85, lat - latSpan),
      lomin: Math.max(-180, lon - lonSpan),
      lamax: Math.min(85, lat + latSpan),
      lomax: Math.min(180, lon + lonSpan),
    },
  };
}

function detectInitialViewFromUrl(): {view: AppView; historyQuery: string} {
  if (typeof window === 'undefined') return {view: 'radar', historyQuery: ''};
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const viewParam = (params.get('view') || '').toLowerCase();
  const historyQuery = (params.get('flight') || params.get('q') || '').trim().toUpperCase();
  if (
    host.startsWith('history.') ||
    /(^|\/)history\/?$/.test(path) ||
    hash.startsWith('#/history') ||
    hash === '#history' ||
    viewParam === 'history'
  ) {
    return {view: 'history', historyQuery};
  }
  if (hash.startsWith('#/taxi') || viewParam === 'taxi') return {view: 'taxi', historyQuery: ''};
  if (hash.startsWith('#/planner') || viewParam === 'planner') return {view: 'planner', historyQuery: ''};
  return {view: 'radar', historyQuery: ''};
}

export default function App() {
  const isOnline = useOnlineStatus();
  const initialRoute = useMemo(() => detectInitialViewFromUrl(), []);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [radarSettings, setRadarSettings] = useState<RadarSettings>(() => loadSavedRadarSettings());
  const [activeView, setActiveView] = useState<AppView>(initialRoute.view);
  const [historyInitialQuery, setHistoryInitialQuery] = useState<string>(initialRoute.historyQuery);
  const [activeRegion, setActiveRegion] = useState<RegionPreset>(REGION_PRESETS[0]);
  const [localRegion, setLocalRegion] = useState<RegionPreset | null>(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lon: number;
    label?: string;
    source: 'gps' | 'ip';
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [flyToLocation, setFlyToLocation] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    seq: number;
  } | null>(null);
  const [bounds, setBounds] = useState(REGION_PRESETS[0].bounds);
  const [phaseFilter, setPhaseFilter] = useState<'all' | 'air' | 'ground'>('all');
  const [trafficFilter, setTrafficFilter] = useState<TrafficFlagFilter>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [isPortraitMobile, setIsPortraitMobile] = useState<boolean>(() => detectPortraitMobileViewport());
  const [rightDashboardOpen, setRightDashboardOpen] = useState<boolean>(false);
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('inspector');
  const [selectedTrailsEnabled, setSelectedTrailsEnabled] = useState<boolean>(
    () => loadSavedRadarSettings().flightPathMode !== 'off',
  );

  const [rawFlights, setRawFlights] = useState<LiveFlight[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [flightsLoading, setFlightsLoading] = useState(true);
  const [flightsError, setFlightsError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(Date.now());
  const [nowEpochSec, setNowEpochSec] = useState<number>(() => Math.floor(Date.now() / 1000));

  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [selectedFlightIds, setSelectedFlightIds] = useState<string[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<FlightDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [isolateSelected, setIsolateSelected] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    enabled: false,
    playing: false,
    progress: 1,
    speed: 5,
  });
  const [creditsOpen, setCreditsOpen] = useState(false);

  const [selectedAirport, setSelectedAirport] = useState<{
    icao: string;
    iata: string;
    name: string;
  } | null>(null);
  const [airportBoard, setAirportBoard] = useState<AirportBoardResponse | null>(null);
  const [airportBoardLoading, setAirportBoardLoading] = useState(false);
  const [selectedAirportSurface, setSelectedAirportSurface] = useState<AirfieldSurfaceData | null>(null);
  const [airportTrafficFilter, setAirportTrafficFilter] = useState<
    'none' | 'all' | 'arrivals' | 'departures' | 'delayed'
  >('none');
  const [sidebarMode, setSidebarMode] = useState<'flight' | 'airport' | null>(null);

  const [mapAirports, setMapAirports] = useState<AirportMarker[]>(() =>
    AIRPORT_CATALOG.map((a) => ({
      icao: a.icao,
      iata: a.iata,
      name: a.name,
      city: a.city,
      country: a.country,
      lat: a.lat,
      lon: a.lon,
      tier: 1 as const,
    })),
  );
  const [airportsWeather, setAirportsWeather] = useState<AirportWeather[]>([]);
  const [sigmets, setSigmets] = useState<SigmetHazard[]>([]);
  const [rainviewer, setRainviewer] = useState<RainViewerMeta | null>(null);
  const [acarsMessages, setAcarsMessages] = useState<AcarsMessage[]>([]);
  const [acarsStatus, setAcarsStatus] = useState<string>('Airframes.io live');
  const [disruptions, setDisruptions] = useState<AirportDisruption[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [dockHidden, setDockHidden] = useState(false);
  const [gateChangeUpdates, setGateChangeUpdates] = useState<LiveFlightUpdateItem[]>([]);
  const prevGateMapRef = useRef<Map<string, string>>(new Map());
  const [plannedRoute, setPlannedRoute] = useState<{
    originLat: number;
    originLon: number;
    destLat: number;
    destLon: number;
  } | null>(null);

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const rawFlightsCountRef = useRef(0);
  rawFlightsCountRef.current = rawFlights.length;
  const flightRegistryRef = useRef<Map<string, {flight: LiveFlight; seenAtMs: number}>>(new Map());
  const initialLocateAttemptedRef = useRef(false);
  const flightsAbortRef = useRef<AbortController | null>(null);
  const airportsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const updateViewport = () => setIsPortraitMobile(detectPortraitMobileViewport());
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(RADAR_SETTINGS_KEY, JSON.stringify(radarSettings));
    } catch {
      // Ignore storage quota errors
    }
  }, [radarSettings]);

  const updateRadarSettings = useCallback((patch: Partial<RadarSettings>) => {
    setRadarSettings((prev) => {
      const next: RadarSettings = {
        ...prev,
        ...patch,
        planeLabels: patch.planeLabels
          ? {...prev.planeLabels, ...patch.planeLabels, allowOverlap: false}
          : {...prev.planeLabels, allowOverlap: false},
        wxLayers: patch.wxLayers ? {...prev.wxLayers, ...patch.wxLayers} : prev.wxLayers,
      };
      if (patch.locateMeEnabled === false) {
        setUserLocation(null);
        setLocalRegion(null);
        if (activeRegion.id === 'local') {
          setActiveRegion(REGION_PRESETS[0]);
          setBounds(REGION_PRESETS[0].bounds);
        }
      }
      return next;
    });
  }, [activeRegion.id]);

  const resetRadarSettings = useCallback(() => {
    setRadarSettings(DEFAULT_RADAR_SETTINGS);
    setSelectedTrailsEnabled(true);
  }, []);

  const toggleFlightTrails = useCallback(() => {
    setSelectedTrailsEnabled((prev) => {
      const next = !prev;
      updateRadarSettings({
        flightPathMode: next ? (radarSettings.flightPathMode === 'all' ? 'all' : 'selected') : 'off',
      });
      return next;
    });
  }, [radarSettings.flightPathMode, updateRadarSettings]);

  const navigateView = useCallback((nextView: AppView, historyQuery?: string) => {
    if (historyQuery !== undefined) {
      setHistoryInitialQuery(historyQuery);
    }
    setActiveView(nextView);
    if (typeof window !== 'undefined' && !window.location.hostname.toLowerCase().startsWith('history.')) {
      const targetHash =
        nextView === 'history'
          ? '#/history'
          : nextView === 'taxi'
            ? '#/taxi'
            : nextView === 'planner'
              ? '#/planner'
              : '';
      if (window.location.hash !== targetHash) {
        try {
          window.history.replaceState(null, '', targetHash || window.location.pathname + window.location.search);
        } catch {
          window.location.hash = targetHash;
        }
      }
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const detected = detectInitialViewFromUrl();
      setActiveView(detected.view);
      if (detected.historyQuery) setHistoryInitialQuery(detected.historyQuery);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Preload cached global airport directory immediately on entry, then refresh in background
  useEffect(() => {
    let cancelled = false;
    void loadCachedAirportDirectory().then((cached) => {
      if (!cancelled && cached && cached.length > 0) {
        setMapAirports((prev) => {
          if (prev.length >= cached.length) return prev;
          const byIcao = new Map(cached.map((a) => [a.icao, a]));
          for (const a of prev) byIcao.set(a.icao, a);
          return Array.from(byIcao.values());
        });
      }
    });
    if (navigator.onLine) {
      apiFetchJson<{airports?: AirportMarker[]}>(
        '/api/airports?lamin=-85&lomin=-180&lamax=85&lomax=180&zoom=2',
      )
        .then((data) => {
          if (!cancelled && Array.isArray(data.airports) && data.airports.length > 0) {
            void saveCachedAirportDirectory(data.airports);
            setMapAirports((prev) => {
              const byIcao = new Map(data.airports!.map((a) => [a.icao, a]));
              for (const a of prev) byIcao.set(a.icao, a);
              return Array.from(byIcao.values());
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const id = window.setInterval(
      () => {
        setNowEpochSec(Math.floor(Date.now() / 1000));
      },
      2000,
    );
    return () => clearInterval(id);
  }, []);

  const airportDirSaveTimerRef = useRef<number | null>(null);
  const airportDirCountRef = useRef<number>(0);
  const boundsEmitTimerRef = useRef<number | null>(null);

  const fetchAirportsInView = useCallback(
    async (targetBounds = boundsRef.current, zoom = activeRegion.zoom) => {
      if (!navigator.onLine) return;
      airportsAbortRef.current?.abort();
      const ac = new AbortController();
      airportsAbortRef.current = ac;
      try {
        const qs = new URLSearchParams({
          lamin: String(targetBounds.lamin),
          lomin: String(targetBounds.lomin),
          lamax: String(targetBounds.lamax),
          lomax: String(targetBounds.lomax),
          zoom: String(zoom),
        });
        const data = await apiFetchJson<{airports?: AirportMarker[]}>(
          `/api/airports?${qs.toString()}`,
          ac.signal,
        );
        if (!ac.signal.aborted && Array.isArray(data.airports)) {
          let latestMerged: AirportMarker[] | null = null;
          setMapAirports((prev) => {
            const byIcao = new Map(prev.map((a) => [a.icao, a]));
            let changed = false;
            for (const a of data.airports!) {
              const ex = byIcao.get(a.icao);
              if (!ex || ex.tier !== a.tier) {
                byIcao.set(a.icao, a);
                changed = true;
              }
            }
            if (!changed) return prev;
            const merged = Array.from(byIcao.values());
            latestMerged = merged;
            return merged;
          });
          if (latestMerged && (latestMerged as AirportMarker[]).length > airportDirCountRef.current) {
            const snapshot = latestMerged as AirportMarker[];
            airportDirCountRef.current = snapshot.length;
            if (airportDirSaveTimerRef.current) window.clearTimeout(airportDirSaveTimerRef.current);
            airportDirSaveTimerRef.current = window.setTimeout(() => {
              void saveCachedAirportDirectory(snapshot);
            }, 3500);
          }
        }
      } catch {
        // retain previous viewport airports or ignore aborted request
      }
    },
    [activeRegion.zoom],
  );

  const fetchLiveFlights = useCallback(
    async (targetBounds = boundsRef.current, regionKey = activeRegion.id) => {
      if (!navigator.onLine) {
        const cached = await loadFlightSnapshot(regionKey);
        if (cached) {
          setRawFlights(cached.flights);
          setLastFetchedAt(cached.fetchedAt);
          setFlightsError(null);
        }
        setFlightsLoading(false);
        return;
      }

      flightsAbortRef.current?.abort();
      const ac = new AbortController();
      flightsAbortRef.current = ac;

      try {
        const qs = new URLSearchParams({
          lamin: String(targetBounds.lamin),
          lomin: String(targetBounds.lomin),
          lamax: String(targetBounds.lamax),
          lomax: String(targetBounds.lomax),
          region: regionKey,
        });
        const data = await apiFetchJson<FlightsResponse>(`/api/flights?${qs.toString()}`, ac.signal);
        if (ac.signal.aborted) return;

        if (data.flights.length > 0) {
          const nowMs = Date.now();
          const reg = flightRegistryRef.current;

          for (const incoming of data.flights) {
            const key = (incoming.icao24 || incoming.id).toLowerCase();
            const prev = reg.get(key)?.flight;
            const merged: LiveFlight = prev
              ? {
                  ...prev,
                  ...incoming,
                  dbFlags: (prev.dbFlags ?? 0) | (incoming.dbFlags ?? 0) || undefined,
                  isLadd: Boolean(prev.isLadd || incoming.isLadd),
                  isMilitary: Boolean(prev.isMilitary || incoming.isMilitary),
                  isPia: Boolean(prev.isPia || incoming.isPia),
                  ownerOperator: incoming.ownerOperator || prev.ownerOperator,
                  registration: incoming.registration || prev.registration,
                  aircraftType:
                    incoming.aircraftType && incoming.aircraftType !== 'A320'
                      ? incoming.aircraftType
                      : prev.aircraftType || incoming.aircraftType,
                  origin: incoming.origin || prev.origin,
                  destination: incoming.destination || prev.destination,
                  trail:
                    incoming.trail && incoming.trail.length > 0 ? incoming.trail : prev.trail,
                }
              : incoming;
            reg.set(key, {flight: merged, seenAtMs: nowMs});
          }

          // Prune stale aircraft (> 65 seconds unseen)
          for (const [k, entry] of reg.entries()) {
            if (nowMs - entry.seenAtMs > 65_000) {
              reg.delete(k);
            }
          }

          // Keep up to 2,600 tracked aircraft, prioritizing Emergency -> Flagged -> Recent/In-Bounds
          const priorityRank = (e: {flight: LiveFlight; seenAtMs: number}) => {
            const f = e.flight;
            if (f.squawk === '7500' || f.squawk === '7600' || f.squawk === '7700') return 4;
            if (f.isLadd || f.isMilitary || f.isPia) return 3;
            const inB =
              f.lat >= targetBounds.lamin &&
              f.lat <= targetBounds.lamax &&
              f.lon >= targetBounds.lomin &&
              f.lon <= targetBounds.lomax;
            if (inB && !f.onGround) return 2;
            if (inB) return 1;
            return 0;
          };

          const mergedList = Array.from(reg.values())
            .sort((a, b) => {
              const pa = priorityRank(a);
              const pb = priorityRank(b);
              if (pa !== pb) return pb - pa;
              return b.seenAtMs - a.seenAtMs;
            })
            .slice(0, 16000)
            .map((e) => e.flight);

          setRawFlights(mergedList);
          setLastFetchedAt(data.fetchedAt);
          setFlightsError(null);
          await saveFlightSnapshot(regionKey, mergedList.slice(0, 2500), data.fetchedAt);
        } else {
          const cached = await loadFlightSnapshot(regionKey);
          if (cached && rawFlightsCountRef.current === 0) {
            setRawFlights(cached.flights);
            setLastFetchedAt(cached.fetchedAt);
          }
        }
        setProviders(data.providers ?? []);
      } catch (err) {
        if (ac.signal.aborted) return;
        const cached = await loadFlightSnapshot(regionKey);
        if (cached && rawFlightsCountRef.current === 0) {
          setRawFlights(cached.flights);
          setLastFetchedAt(cached.fetchedAt);
          setFlightsError('Using cached ADS-B snapshot with Dead-Reckoning');
        } else if (rawFlightsCountRef.current === 0) {
          setFlightsError(err instanceof Error ? err.message : 'Unable to reach ADS-B feeds');
        }
      } finally {
        if (!ac.signal.aborted) setFlightsLoading(false);
      }
    },
    [activeRegion.id],
  );

  const fetchWeatherAndHazards = useCallback(async () => {
    const icaos = AIRPORT_CATALOG.map((a) => a.icao).join(',');
    try {
      const [wxData, hzData, disData] = await Promise.all([
        apiFetchJson<{airports?: AirportWeather[]}>(`/api/weather?icaos=${encodeURIComponent(icaos)}`),
        apiFetchJson<{sigmets?: SigmetHazard[]; rainviewer?: RainViewerMeta | null}>('/api/weather/hazards'),
        apiFetchJson<{items?: AirportDisruption[]}>('/api/disruptions'),
      ]);

      if (wxData.airports && wxData.airports.length > 0) {
        setAirportsWeather(wxData.airports);
        await saveWeatherSnapshot('hubs', wxData.airports);
      }
      setSigmets(hzData.sigmets ?? []);
      if (hzData.rainviewer) setRainviewer(hzData.rainviewer);
      setDisruptions(disData.items ?? []);
    } catch {
      const cachedWx = await loadWeatherSnapshot('hubs');
      if (cachedWx) setAirportsWeather(cachedWx.airports);
    }
  }, []);

  const fetchAcars = useCallback(async () => {
    try {
      const data = await apiFetchJson<{messages?: AcarsMessage[]; sourceStatus?: string}>('/api/acars');
      if (data.messages && data.messages.length > 0) {
        setAcarsMessages(data.messages);
        await saveAcarsSnapshot(data.messages);
      }
      if (data.sourceStatus) setAcarsStatus(data.sourceStatus);
    } catch {
      const cached = await loadAcarsSnapshot();
      if (cached) {
        setAcarsMessages(cached.messages);
        setAcarsStatus('Offline cached ACARS');
      }
    }
  }, []);

  const applyUserLocation = useCallback(
    (lat: number, lon: number, label: string | undefined, source: 'gps' | 'ip') => {
      const preset = buildLocalRegion(lat, lon, label);
      setUserLocation({lat, lon, label, source});
      setLocalRegion(preset);
      setActiveRegion(preset);
      setBounds(preset.bounds);
      setFlyToLocation((prev) => ({lat, lon, zoom: 8, seq: (prev?.seq ?? 0) + 1}));
    },
    [],
  );

  const syncToUserLocation = useCallback(async () => {
    if (!radarSettings.locateMeEnabled) return;
    setLocating(true);
    const tryIpFallback = async () => {
      try {
        const data = await apiFetchJson<{
          lat?: number;
          lon?: number;
          city?: string;
          country?: string;
        }>('/api/locate');
        if (typeof data.lat === 'number' && typeof data.lon === 'number') {
          const label = data.city
            ? `${data.city}${data.country ? `, ${data.country}` : ''}`
            : data.country || 'IP';
          applyUserLocation(data.lat, data.lon, label, 'ip');
        }
      } catch {
        // Keep current region if geolocation and IP lookup are unavailable
      } finally {
        setLocating(false);
      }
    };

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyUserLocation(pos.coords.latitude, pos.coords.longitude, 'GPS', 'gps');
          setLocating(false);
        },
        () => {
          void tryIpFallback();
        },
        {enableHighAccuracy: false, timeout: 5500, maximumAge: 300000},
      );
    } else {
      await tryIpFallback();
    }
  }, [applyUserLocation, radarSettings.locateMeEnabled]);

  useEffect(() => {
    if (initialLocateAttemptedRef.current) return;
    initialLocateAttemptedRef.current = true;
    if (radarSettings.locateMeEnabled) {
      void syncToUserLocation();
    }
  }, [radarSettings.locateMeEnabled, syncToUserLocation]);

  const fetchingFlightsRef = useRef(false);

  useEffect(() => {
    setFlightsLoading(true);
    fetchLiveFlights(activeRegion.bounds, activeRegion.id);
    fetchAirportsInView(activeRegion.bounds, activeRegion.zoom);
    const id = window.setInterval(() => {
      if (fetchingFlightsRef.current) return;
      fetchingFlightsRef.current = true;
      void fetchLiveFlights(boundsRef.current, activeRegion.id).finally(() => {
        fetchingFlightsRef.current = false;
      });
    }, 3000);
    return () => clearInterval(id);
  }, [activeRegion, fetchLiveFlights, fetchAirportsInView]);

  useEffect(() => {
    fetchWeatherAndHazards();
    fetchAcars();
    const wxId = window.setInterval(fetchWeatherAndHazards, 65000);
    const acarsId = window.setInterval(fetchAcars, 35000);
    return () => {
      clearInterval(wxId);
      clearInterval(acarsId);
    };
  }, [fetchWeatherAndHazards, fetchAcars]);

  // Smooth Flight Playback timeline advance
  useEffect(() => {
    if (!playbackState.enabled || !playbackState.playing) return;
    const id = window.setInterval(() => {
      setPlaybackState((prev) => {
        if (!prev.enabled || !prev.playing) return prev;
        const step = (0.05 * prev.speed) / 60;
        const nextProg = prev.progress + step;
        if (nextProg >= 1) {
          return {...prev, progress: 1, playing: false};
        }
        return {...prev, progress: nextProg};
      });
    }, 50);
    return () => clearInterval(id);
  }, [playbackState.enabled, playbackState.playing, playbackState.speed]);

  const flights = useMemo(() => {
    if (isOnline) return rawFlights;
    return rawFlights.map((f) => deadReckonFlight(f, nowEpochSec, true));
  }, [rawFlights, nowEpochSec, isOnline]);

  const availableModels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of flights) {
      const code = (f.aircraftType || '').trim().toUpperCase();
      if (!code || code === 'UNKN') continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([code, count]) => ({code, count}))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [flights]);

  const availableCountries = useMemo(() => {
    const map = new Map<string, {code: string; name: string; count: number}>();
    for (const f of flights) {
      const info = resolveCountryFromFlight(f.icao24, f.registration);
      const prev = map.get(info.code);
      if (prev) prev.count += 1;
      else map.set(info.code, {code: info.code, name: info.name, count: 1});
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [flights]);

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (phaseFilter !== 'all' ? 1 : 0) +
    (trafficFilter !== 'all' ? 1 : 0) +
    (modelFilter !== 'all' ? 1 : 0) +
    (countryFilter !== 'all' ? 1 : 0);

  const filteredFlights = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();

    const boardMatches = (
      f: LiveFlight,
      items: AirportBoardFlight[] | undefined,
      onlyDelayed = false,
    ) => {
      if (!items || items.length === 0) return false;
      const fn = f.flightNumber.toUpperCase();
      const cs = f.callsign.toUpperCase();
      const reg = f.registration.toUpperCase();
      const hex = f.icao24.toUpperCase();
      return items.some((b) => {
        if (onlyDelayed && !b.isDelayed) return false;
        return (
          (b.flightNumber && fn && b.flightNumber.toUpperCase() === fn) ||
          (b.callsign && cs && b.callsign.toUpperCase() === cs) ||
          (b.registration && reg && b.registration.toUpperCase() === reg) ||
          (b.icao24 && hex && b.icao24.toUpperCase() === hex)
        );
      });
    };

    const apIata = selectedAirport?.iata.toUpperCase() ?? '';
    const apIcao = selectedAirport?.icao.toUpperCase() ?? '';

    return flights.filter((f) => {
      if (phaseFilter === 'air' && f.onGround) return false;
      if (phaseFilter === 'ground' && !f.onGround) return false;

      if (trafficFilter === 'ladd' && !(f.isLadd || ((f.dbFlags ?? 0) & 8) !== 0)) return false;
      if (trafficFilter === 'military' && !(f.isMilitary || ((f.dbFlags ?? 0) & 1) !== 0)) return false;
      if (trafficFilter === 'pia' && !(f.isPia || ((f.dbFlags ?? 0) & 4) !== 0)) return false;
      if (trafficFilter === 'emergency' && !getEmergencySquawkMeta(f.squawk)) return false;

      if (modelFilter !== 'all' && (f.aircraftType || '').trim().toUpperCase() !== modelFilter) {
        return false;
      }

      if (countryFilter !== 'all') {
        const regCountry = resolveCountryFromFlight(f.icao24, f.registration);
        if (regCountry.code !== countryFilter) return false;
      }

      if (selectedAirport && airportTrafficFilter !== 'none') {
        const orig = f.origin.toUpperCase();
        const dest = f.destination.toUpperCase();
        const matchesDep =
          (orig && (orig === apIata || orig === apIcao)) ||
          boardMatches(f, airportBoard?.departures);
        const matchesArr =
          (dest && (dest === apIata || dest === apIcao)) ||
          boardMatches(f, airportBoard?.arrivals);

        if (airportTrafficFilter === 'departures' && !matchesDep) return false;
        if (airportTrafficFilter === 'arrivals' && !matchesArr) return false;
        if (airportTrafficFilter === 'all' && !matchesDep && !matchesArr) return false;
        if (
          airportTrafficFilter === 'delayed' &&
          !boardMatches(f, airportBoard?.departures, true) &&
          !boardMatches(f, airportBoard?.arrivals, true)
        ) {
          return false;
        }
      }

      if (!q) return true;
      return (
        f.callsign.includes(q) ||
        f.flightNumber.includes(q) ||
        f.registration.toUpperCase().includes(q) ||
        f.icao24.toUpperCase().includes(q) ||
        f.origin.toUpperCase().includes(q) ||
        f.destination.toUpperCase().includes(q) ||
        f.aircraftType.toUpperCase().includes(q) ||
        f.squawk.includes(q)
      );
    });
  }, [
    flights,
    searchQuery,
    phaseFilter,
    trafficFilter,
    modelFilter,
    countryFilter,
    selectedAirport,
    airportTrafficFilter,
    airportBoard,
  ]);

  const selectedFlight = useMemo(
    () => flights.find((f) => f.id === selectedFlightId) ?? null,
    [flights, selectedFlightId],
  );

  const fovFlights = useMemo(
    () =>
      filteredFlights.filter(
        (f) =>
          f.lat >= bounds.lamin &&
          f.lat <= bounds.lamax &&
          f.lon >= bounds.lomin &&
          f.lon <= bounds.lomax,
      ),
    [filteredFlights, bounds],
  );

  const multiSelectFlights = useMemo(
    () =>
      selectedFlightIds
        .map((id) => flights.find((f) => f.id === id))
        .filter((f): f is LiveFlight => Boolean(f)),
    [flights, selectedFlightIds],
  );

  useEffect(() => {
    if (!selectedFlight || !isOnline) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    const fetchDetail = (initial: boolean) => {
      if (initial) setDetailLoading(true);
      const qs = new URLSearchParams({
        fr24Id: selectedFlight.fr24Id ?? '',
        icao24: selectedFlight.icao24,
        callsign: selectedFlight.callsign,
        reg: selectedFlight.registration ?? '',
        fnum: selectedFlight.flightNumber ?? '',
        orig: selectedFlight.origin ?? '',
      });
      apiFetchJson<FlightDetail>(`/api/flight-detail?${qs.toString()}`)
        .then((d) => {
          if (!cancelled) setSelectedDetail(d);
        })
        .catch(() => {
          if (!cancelled && initial) setSelectedDetail(null);
        })
        .finally(() => {
          if (!cancelled && initial) setDetailLoading(false);
        });
    };
    fetchDetail(true);
    const timer = window.setInterval(() => fetchDetail(false), 18000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlight?.id, isOnline]);

  const nearestWeather = useMemo(() => {
    if (!selectedFlight || airportsWeather.length === 0) return airportsWeather[0];
    let best = airportsWeather[0];
    let bestDist = Infinity;
    for (const w of airportsWeather) {
      const d = haversineNm(selectedFlight.lat, selectedFlight.lon, w.lat, w.lon);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    return best;
  }, [selectedFlight, airportsWeather]);

  const groundTraffic = useMemo(() => flights.filter((f) => f.onGround), [flights]);
  const airborneTraffic = useMemo(() => flights.filter((f) => !f.onGround), [flights]);
  const laddCount = useMemo(
    () => flights.filter((f) => Boolean(f.isLadd || ((f.dbFlags ?? 0) & 8) !== 0)).length,
    [flights],
  );
  const militaryCount = useMemo(
    () => flights.filter((f) => Boolean(f.isMilitary || ((f.dbFlags ?? 0) & 1) !== 0)).length,
    [flights],
  );
  const piaCount = useMemo(
    () => flights.filter((f) => Boolean(f.isPia || ((f.dbFlags ?? 0) & 4) !== 0)).length,
    [flights],
  );
  const emergencyFlights = useMemo(
    () => flights.filter((f) => Boolean(getEmergencySquawkMeta(f.squawk))),
    [flights],
  );

  const matchingAcars = useMemo(() => {
    if (!selectedFlight) return [];
    const cs = selectedFlight.callsign.toUpperCase();
    const reg = selectedFlight.registration.toUpperCase();
    return acarsMessages.filter(
      (m) => m.callsign.toUpperCase() === cs || (reg && m.tail.toUpperCase() === reg),
    );
  }, [acarsMessages, selectedFlight]);

  const liveUpdates = useMemo<LiveFlightUpdateItem[]>(() => {
    const items: LiveFlightUpdateItem[] = [...gateChangeUpdates];
    const nowSec = Math.floor(Date.now() / 1000);

    for (const ef of emergencyFlights) {
      const em = getEmergencySquawkMeta(ef.squawk);
      if (!em) continue;
      items.push({
        id: `em-${ef.icao24}-${ef.squawk}`,
        kind: 'emergency',
        title: ef.callsign || ef.icao24,
        subtitle: `${ef.aircraftType} · ${ef.registration || ef.icao24}`,
        detail: `${em.title} at ${ef.onGround ? 'GND' : `${ef.altitudeFt.toLocaleString()} ft`}`,
        badge: em.shortLabel,
        severity: 'high',
        ts: ef.lastContactEpoch || nowSec,
        icao24: ef.icao24,
      });
    }

    if (airportBoard) {
      const apCode = airportBoard.iata || airportBoard.icao;
      const allBoard = [...airportBoard.departures, ...airportBoard.arrivals];
      for (const b of allBoard) {
        if (!b.isDelayed && !b.isCancelled) continue;
        const delayMin =
          b.scheduledTime && (b.estimatedTime || b.actualTime)
            ? Math.round(((b.estimatedTime || b.actualTime)! - b.scheduledTime) / 60)
            : 0;
        if (b.isCancelled || delayMin >= 20 || b.statusColor === 'red') {
          items.push({
            id: `bd-${apCode}-${b.id}`,
            kind: 'delay',
            title: b.flightNumber || b.callsign,
            subtitle: `${apCode} · ${b.originIata || '—'} → ${b.destinationIata || '—'}`,
            detail: b.isCancelled
              ? 'Flight cancelled on live airport board'
              : delayMin >= 20
                ? `Delayed +${delayMin}m (${b.statusText})`
                : b.statusText,
            badge: b.isCancelled ? 'CANCELLED' : `DLY +${Math.max(delayMin, 20)}m`,
            severity: b.isCancelled ? 'high' : 'medium',
            ts: b.estimatedTime || b.scheduledTime || nowSec,
            icao24: b.icao24 || undefined,
            airportIata: apCode,
          });
        }
        if (items.length >= 24) break;
      }
    }

    return items.slice(0, 24);
  }, [gateChangeUpdates, emergencyFlights, airportBoard]);

  const handleSelectRegion = (regionId: string) => {
    setFollowSelected(false);
    if (regionId === 'local' && localRegion) {
      setActiveRegion(localRegion);
      setBounds(localRegion.bounds);
      return;
    }
    const preset = REGION_PRESETS.find((r) => r.id === regionId) ?? REGION_PRESETS[0];
    setActiveRegion(preset);
    setBounds(preset.bounds);
  };

  const handleSelectFlight = useCallback(
    (f: LiveFlight, opts?: {in3DMode?: boolean; multiSelect?: boolean}) => {
      const useMulti = Boolean(opts?.multiSelect || multiSelectMode);
      if (useMulti) {
        setSelectedFlightIds((prev) => {
          const exists = prev.includes(f.id);
          const next = exists ? prev.filter((id) => id !== f.id) : [...prev, f.id];
          if (!exists) {
            setSelectedFlightId(f.id);
          } else if (selectedFlightId === f.id) {
            setSelectedFlightId(next[0] ?? null);
          }
          return next;
        });
      } else {
        setSelectedFlightId(f.id);
      }
      setSidebarMode('flight');
      setDashboardTab('inspector');
      setRightDashboardOpen(true);
      navigateView('radar');
      if (opts?.in3DMode) {
        setFollowSelected(true);
      }
    },
    [multiSelectMode, selectedFlightId, navigateView],
  );

  const toggleFlightInMultiSelect = useCallback(
    (f: LiveFlight) => {
      setSelectedFlightIds((prev) => {
        const exists = prev.includes(f.id);
        const next = exists ? prev.filter((id) => id !== f.id) : [...prev, f.id];
        if (!exists && !selectedFlightId) {
          setSelectedFlightId(f.id);
        }
        return next;
      });
    },
    [selectedFlightId],
  );

  const handleSelectAirport = useCallback(async (ap: {icao: string; iata: string; name: string}) => {
    setSelectedAirport(ap);
    setSidebarMode('airport');
    setDashboardTab('inspector');
    setRightDashboardOpen(true);
    setAirportTrafficFilter('none');
    setAirportBoardLoading(true);
    setAirportBoard(null);
    setSelectedAirportSurface(null);
    navigateView('radar');

    const matchMarker =
      mapAirports.find((m) => m.icao.toUpperCase() === ap.icao.toUpperCase()) ??
      AIRPORT_CATALOG.find((c) => c.icao.toUpperCase() === ap.icao.toUpperCase());

    if (matchMarker) {
      apiFetchJson<AirfieldSurfaceData>(
        `/api/surface?icao=${encodeURIComponent(ap.icao)}&lat=${matchMarker.lat}&lon=${matchMarker.lon}`,
      )
        .then((surf) => setSelectedAirportSurface(surf))
        .catch(() => {});
    } else {
      apiFetchJson<AirfieldSurfaceData>(
        `/api/surface?icao=${encodeURIComponent(ap.icao || ap.iata)}`,
      )
        .then((surf) => setSelectedAirportSurface(surf))
        .catch(() => {});
    }

    try {
      const qs = new URLSearchParams({
        code: ap.iata || ap.icao,
        icao: ap.icao,
      });
      const data = await apiFetchJson<AirportBoardResponse>(`/api/airport-board?${qs.toString()}`);
      setAirportBoard(data);
      // Track gate/terminal changes across airport board polls
      const apKey = (data.iata || data.icao || ap.icao).toUpperCase();
      const detectedChanges: LiveFlightUpdateItem[] = [];
      for (const row of [...data.departures, ...data.arrivals]) {
        const flightKey = `${apKey}:${(row.flightNumber || row.callsign || row.id).toUpperCase()}`;
        const curLoc = `${row.terminal ? `T${row.terminal}` : ''}${row.gate ? ` G${row.gate}` : ''}`.trim();
        if (!curLoc) continue;
        const prevLoc = prevGateMapRef.current.get(flightKey);
        if (prevLoc && prevLoc !== curLoc) {
          detectedChanges.push({
            id: `gate-${flightKey}-${Date.now()}`,
            kind: 'gate-change',
            title: row.flightNumber || row.callsign,
            subtitle: `${apKey} · ${row.originIata || '—'} → ${row.destinationIata || '—'}`,
            detail: `Gate assignment changed from ${prevLoc} to ${curLoc}`,
            badge: 'GATE CHG',
            severity: 'info',
            ts: Math.floor(Date.now() / 1000),
            icao24: row.icao24 || undefined,
            airportIata: apKey,
          });
        }
        prevGateMapRef.current.set(flightKey, curLoc);
      }
      if (detectedChanges.length > 0) {
        setGateChangeUpdates((prev) => [...detectedChanges, ...prev].slice(0, 12));
      }
      if (!matchMarker && Number.isFinite(data.lat) && Number.isFinite(data.lon) && (data.lat !== 0 || data.lon !== 0)) {
        apiFetchJson<AirfieldSurfaceData>(
          `/api/surface?icao=${encodeURIComponent(ap.icao)}&lat=${data.lat}&lon=${data.lon}`,
        )
          .then((surf) => setSelectedAirportSurface(surf))
          .catch(() => {});
      }
    } catch {
      // Keep panel open with local catalog info
    } finally {
      setAirportBoardLoading(false);
    }
  }, [mapAirports, navigateView]);

  const handleSelectFlightFromBoard = useCallback(
    (item: AirportBoardFlight) => {
      const fn = item.flightNumber.toUpperCase();
      const cs = item.callsign.toUpperCase();
      const reg = item.registration.toUpperCase();
      const hex = item.icao24.toUpperCase();
      const match = flights.find(
        (f) =>
          (hex && f.icao24.toUpperCase() === hex) ||
          (reg && f.registration.toUpperCase() === reg) ||
          (fn && f.flightNumber.toUpperCase() === fn) ||
          (cs && f.callsign.toUpperCase() === cs),
      );
      if (match) {
        handleSelectFlight(match);
        setFlyToLocation((prev) => ({
          lat: match.lat,
          lon: match.lon,
          zoom: 8,
          seq: (prev?.seq ?? 0) + 1,
        }));
      } else {
        setSearchQuery(item.flightNumber || item.callsign || item.registration);
      }
    },
    [flights, handleSelectFlight],
  );

  const selectedAirportWeather = useMemo(() => {
    if (!selectedAirport) return undefined;
    return airportsWeather.find(
      (a) =>
        a.icao.toUpperCase() === selectedAirport.icao.toUpperCase() ||
        a.iata.toUpperCase() === selectedAirport.iata.toUpperCase(),
    );
  }, [airportsWeather, selectedAirport]);

  const activeInspectorType: 'flight' | 'airport' | null =
    sidebarMode === 'airport' && selectedAirport
      ? 'airport'
      : sidebarMode === 'flight' && selectedFlight
        ? 'flight'
        : selectedFlight
          ? 'flight'
          : selectedAirport
            ? 'airport'
            : null;

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-background text-foreground">
      {/* Full-Viewport Non-Scrolling Real Map */}
      <main className="fixed inset-0 z-0">
        <RadarMap
          flights={filteredFlights}
          selectedFlight={selectedFlight}
          selectedFlightIds={selectedFlightIds}
          multiSelectMode={multiSelectMode}
          selectedDetail={selectedDetail}
          selectedAirportIcao={selectedAirport?.icao}
          mapAirports={mapAirports}
          airports={airportsWeather}
          sigmets={sigmets}
          disruptions={disruptions}
          rainviewer={rainviewer}
          activeRegion={activeRegion}
          theme={theme}
          loading={flightsLoading}
          plannedRoute={plannedRoute}
          userLocation={userLocation}
          flyToLocation={flyToLocation}
          followSelected={followSelected}
          isolateSelected={isolateSelected}
          playbackState={playbackState}
          isMobilePortrait={isPortraitMobile}
          rightPanelOpen={rightDashboardOpen && activeView === 'radar'}
          selectedFlightTrailsOnly={selectedTrailsEnabled}
          onUserDragBreakFollow={() => setFollowSelected(false)}
          settings={radarSettings}
          onSelectFlight={handleSelectFlight}
          onSelectAirport={(ap) => void handleSelectAirport(ap)}
          onBoundsChange={(newBounds, zoom) => {
            boundsRef.current = newBounds;
            if (boundsEmitTimerRef.current !== null) {
              window.clearTimeout(boundsEmitTimerRef.current);
            }
            boundsEmitTimerRef.current = window.setTimeout(() => {
              boundsEmitTimerRef.current = null;
              setBounds(newBounds);
              void fetchLiveFlights(newBounds, activeRegion.id);
              void fetchAirportsInView(newBounds, zoom);
            }, 420);
          }}
        />
      </main>

      {/* Dedicated Portrait Phone & Tablet Top App Bar (<= 52px high) */}
      {isPortraitMobile && (
        <header className="fixed top-2 left-2 right-2 z-[560] h-[48px] flex items-center justify-between gap-1.5 rounded-2xl bg-card/95 backdrop-blur-md border border-border px-2.5 shadow-lg">
          <button
            type="button"
            onClick={() => navigateView('radar')}
            className="flex items-center gap-1.5 min-h-[40px] px-1.5 rounded-xl font-display text-sm font-bold text-foreground whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>SkyDeck</span>
            <span className="font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
              · {filteredFlights.length}
            </span>
          </button>

          <select
            value={activeRegion.id}
            onChange={(e) => handleSelectRegion(e.target.value)}
            aria-label="Select radar coverage region"
            className="h-9 min-w-0 flex-1 max-w-[165px] rounded-xl bg-background border border-input px-2 text-xs font-medium text-foreground truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {localRegion && <option value={localRegion.id}>{localRegion.label}</option>}
            {REGION_PRESETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleFlightTrails}
              aria-label="Toggle flight trails for selected aircraft"
              title="Flight Trails"
              className={`inline-flex items-center justify-center min-w-[38px] min-h-[38px] rounded-xl border cursor-pointer ${
                selectedTrailsEnabled
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-border'
              }`}
            >
              <Route className="w-4 h-4" />
            </button>

            {radarSettings.locateMeEnabled && (
              <button
                type="button"
                onClick={() => void syncToUserLocation()}
                disabled={locating}
                aria-label="Locate me"
                className={`inline-flex items-center justify-center min-w-[38px] min-h-[38px] rounded-xl border border-border cursor-pointer ${
                  activeRegion.id === 'local'
                    ? 'bg-secondary text-secondary-foreground'
                    : 'bg-background text-foreground'
                }`}
              >
                <LocateFixed className={`w-4 h-4 ${locating ? 'animate-spin' : ''}`} />
              </button>
            )}

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label="Toggle dark or light theme"
              className="inline-flex items-center justify-center min-w-[38px] min-h-[38px] rounded-xl border border-border bg-background text-foreground cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>
      )}

      {/* Compact Top Status, Emergency Squawk, Filter & Mode Banners */}
      {(!isOnline ||
        flightsError ||
        emergencyFlights.length > 0 ||
        isolateSelected ||
        followSelected ||
        trafficFilter !== 'all' ||
        modelFilter !== 'all' ||
        countryFilter !== 'all' ||
        phaseFilter !== 'all' ||
        (selectedAirport && airportTrafficFilter !== 'none')) && (
        <div
          className={`fixed z-[520] flex flex-wrap items-center gap-1.5 transition-[left] duration-200 ${
            isPortraitMobile
              ? 'top-[62px] left-2 right-12'
              : rightDashboardOpen && activeView === 'radar'
                ? 'top-3 left-[444px] max-w-[min(560px,calc(100vw-600px))]'
                : 'top-3 left-3 max-w-[min(560px,calc(100vw-280px))]'
          }`}
        >
          {emergencyFlights.slice(0, 3).map((ef) => {
            const em = getEmergencySquawkMeta(ef.squawk);
            if (!em) return null;
            return (
              <button
                key={ef.id}
                type="button"
                onClick={() => {
                  handleSelectFlight(ef);
                  setFlyToLocation((prev) => ({
                    lat: ef.lat,
                    lon: ef.lon,
                    zoom: 9,
                    seq: (prev?.seq ?? 0) + 1,
                  }));
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 px-3 py-1.5 font-mono text-xs font-bold text-white shadow-lg border border-white/70 cursor-pointer"
                title={em.title}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {em.shortLabel} · {ef.callsign}
              </button>
            );
          })}
          {!isOnline && (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-white shadow-md">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              Offline DR-EST ({new Date(lastFetchedAt).toLocaleTimeString()})
            </div>
          )}
          {flightsError && isOnline && (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-md">
              {flightsError}
            </div>
          )}
          {trafficFilter !== 'all' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTrafficFilter('all')}
              className="shadow-md"
            >
              Flag: {trafficFilter.toUpperCase()} ({filteredFlights.length})
              <X className="w-3 h-3" />
            </Button>
          )}
          {modelFilter !== 'all' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setModelFilter('all')}
              className="shadow-md"
            >
              Model: {modelFilter} ({filteredFlights.length})
              <X className="w-3 h-3" />
            </Button>
          )}
          {countryFilter !== 'all' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCountryFilter('all')}
              className="shadow-md"
            >
              Origin: {availableCountries.find((c) => c.code === countryFilter)?.name || countryFilter}
              <X className="w-3 h-3" />
            </Button>
          )}
          {phaseFilter !== 'all' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPhaseFilter('all')}
              className="shadow-md"
            >
              Phase: {phaseFilter === 'air' ? 'Airborne' : 'Ground'}
              <X className="w-3 h-3" />
            </Button>
          )}
          {isolateSelected && selectedFlight && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsolateSelected(false)}
              className="shadow-md"
            >
              Isolated: {selectedFlight.callsign}
              <X className="w-3 h-3" />
            </Button>
          )}
          {followSelected && selectedFlight && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setFollowSelected(false)}
              className="shadow-md"
            >
              Following: {selectedFlight.callsign}
              <X className="w-3 h-3" />
            </Button>
          )}
          {selectedAirport && airportTrafficFilter !== 'none' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAirportTrafficFilter('none')}
              className="shadow-md"
              title="Clear airport traffic filter"
            >
              {selectedAirport.iata}: {airportTrafficFilter}
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      )}

      {/* Docked Right-Side Split Window Dashboard (Claude Artifacts / AI Studio style) */}
      <RightDashboardWindow
        open={rightDashboardOpen && activeView === 'radar'}
        activeTab={dashboardTab}
        onTabChange={setDashboardTab}
        onClose={() => setRightDashboardOpen(false)}
        isPortraitMobile={isPortraitMobile}
        onOpenCredits={() => setCreditsOpen(true)}
        onOpenHistoryView={(q) => {
          setRightDashboardOpen(false);
          navigateView('history', q);
        }}
        activeInspectorType={activeInspectorType}
        onInspectorTypeChange={(m) => setSidebarMode(m)}
        selectedFlight={selectedFlight}
        selectedDetail={selectedDetail}
        detailLoading={detailLoading}
        nowEpochSec={nowEpochSec}
        userLocation={userLocation}
        mapAirports={mapAirports}
        matchingAcars={matchingAcars}
        followSelected={followSelected}
        isolateSelected={isolateSelected}
        flightTrailsActive={selectedTrailsEnabled}
        onToggleFollow={() => setFollowSelected((v) => !v)}
        onToggleIsolate={() => setIsolateSelected((v) => !v)}
        onToggleFlightTrails={toggleFlightTrails}
        onCloseFlight={() => {
          setSelectedFlightId(null);
          setFollowSelected(false);
          setIsolateSelected(false);
          setSidebarMode(selectedAirport ? 'airport' : null);
        }}
        multiSelectFlights={multiSelectFlights}
        selectedFlightIds={selectedFlightIds}
        multiSelectMode={multiSelectMode}
        onToggleMultiSelectMode={() => setMultiSelectMode((v) => !v)}
        onToggleFlightInMultiSelect={toggleFlightInMultiSelect}
        onRemoveMultiFlight={(id) => {
          setSelectedFlightIds((prev) => prev.filter((x) => x !== id));
          if (selectedFlightId === id) setSelectedFlightId(null);
        }}
        onClearMultiFlights={() => setSelectedFlightIds([])}
        selectedAirport={selectedAirport}
        airportBoard={airportBoard}
        airportBoardLoading={airportBoardLoading}
        selectedAirportWeather={selectedAirportWeather}
        selectedAirportSurface={selectedAirportSurface}
        airportTrafficFilter={airportTrafficFilter}
        onAirportFilterChange={setAirportTrafficFilter}
        onSelectAirport={(ap) => void handleSelectAirport(ap)}
        onSelectFlightFromBoard={handleSelectFlightFromBoard}
        onFocusAirfield={() => {
          if (!selectedAirport) return;
          const coords =
            selectedAirportSurface ??
            airportBoard ??
            mapAirports.find((m) => m.icao.toUpperCase() === selectedAirport.icao.toUpperCase()) ??
            AIRPORT_CATALOG.find((c) => c.icao.toUpperCase() === selectedAirport.icao.toUpperCase());
          if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
            setFlyToLocation((prev) => ({
              lat: coords.lat,
              lon: coords.lon,
              zoom: 13.6,
              seq: (prev?.seq ?? 0) + 1,
            }));
          }
        }}
        onCloseAirport={() => {
          setSelectedAirport(null);
          setSelectedAirportSurface(null);
          setAirportTrafficFilter('none');
          setSidebarMode(selectedFlight ? 'flight' : null);
        }}
        flights={flights}
        filteredFlights={filteredFlights}
        fovFlights={fovFlights}
        flightsLoading={flightsLoading}
        providers={providers}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        phaseFilter={phaseFilter}
        onPhaseFilterChange={setPhaseFilter}
        trafficFilter={trafficFilter}
        onTrafficFilterChange={setTrafficFilter}
        modelFilter={modelFilter}
        onModelFilterChange={setModelFilter}
        availableModels={availableModels}
        countryFilter={countryFilter}
        onCountryFilterChange={setCountryFilter}
        availableCountries={availableCountries}
        laddCount={laddCount}
        militaryCount={militaryCount}
        piaCount={piaCount}
        emergencyCount={emergencyFlights.length}
        airborneCount={airborneTraffic.length}
        groundCount={groundTraffic.length}
        onFocusFlight={(f) => {
          handleSelectFlight(f);
          setFlyToLocation((prev) => ({
            lat: f.lat,
            lon: f.lon,
            zoom: 8.5,
            seq: (prev?.seq ?? 0) + 1,
          }));
        }}
        radarSettings={radarSettings}
        onUpdateRadarSettings={updateRadarSettings}
        onResetRadarSettings={resetRadarSettings}
        liveUpdates={liveUpdates}
        sigmets={sigmets}
        disruptions={disruptions}
        acarsMessages={acarsMessages}
        playbackState={playbackState}
        onUpdatePlayback={(patch) => setPlaybackState((prev) => ({...prev, ...patch}))}
        onSelectFlightByHexOrCallsign={(icao24, callsign) => {
          const match = flights.find(
            (f) =>
              (icao24 && f.icao24.toUpperCase() === icao24.toUpperCase()) ||
              (callsign && f.callsign.toUpperCase() === callsign.toUpperCase()),
          );
          if (match) {
            handleSelectFlight(match);
            setFlyToLocation((prev) => ({
              lat: match.lat,
              lon: match.lon,
              zoom: 9,
              seq: (prev?.seq ?? 0) + 1,
            }));
          }
        }}
        onFlyToAirport={(code) => {
          const upper = code.trim().toUpperCase();
          const cat =
            AIRPORT_CATALOG.find((a) => a.icao === upper || a.iata === upper) ??
            mapAirports.find((a) => a.icao.toUpperCase() === upper || a.iata.toUpperCase() === upper);
          if (cat) {
            setFlyToLocation((prev) => ({
              lat: cat.lat,
              lon: cat.lon,
              zoom: 12.2,
              seq: (prev?.seq ?? 0) + 1,
            }));
            void handleSelectAirport({icao: cat.icao, iata: cat.iata, name: cat.name});
          }
        }}
        onFlyToPoint={(lat, lon, zoom = 6) => {
          setFlyToLocation((prev) => ({
            lat,
            lon,
            zoom,
            seq: (prev?.seq ?? 0) + 1,
          }));
        }}
      />

      {/* Full Workspace Overlay (History Sub-Domain · Taxi & ACARS · Flight Planner) */}
      {activeView !== 'radar' && (
        <section
          aria-label="Workspace panel"
          className={`fixed z-[540] border border-border bg-card/96 backdrop-blur-md shadow-2xl overflow-y-auto transition-all duration-200 ${
            isPortraitMobile
              ? 'inset-x-0 top-[58px] bottom-16 rounded-t-3xl p-3 pb-6'
              : 'inset-3 bottom-20 rounded-2xl p-4 sm:p-6'
          }`}
        >
          {activeView === 'history' && (
            <FlightHistoryView
              liveFlights={flights}
              selectedFlight={selectedFlight}
              initialQuery={historyInitialQuery}
              onBackToRadar={() => navigateView('radar')}
              onInspectLiveFlight={(f) => {
                handleSelectFlight(f);
                setFlyToLocation((prev) => ({
                  lat: f.lat,
                  lon: f.lon,
                  zoom: 8.5,
                  seq: (prev?.seq ?? 0) + 1,
                }));
              }}
              onFlyToPoint={(lat, lon, zoom = 5.5) => {
                setFlyToLocation((prev) => ({
                  lat,
                  lon,
                  zoom,
                  seq: (prev?.seq ?? 0) + 1,
                }));
              }}
            />
          )}

          {activeView === 'taxi' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-border">
                <div className="font-display text-sm sm:text-base font-semibold text-foreground">
                  Airport Surface Taxi &amp; ACARS
                </div>
                <Button size="sm" variant="outline" onClick={() => navigateView('radar')}>
                  <X className="w-3.5 h-3.5" />
                  Back to Map
                </Button>
              </div>
              <TaxiAcarsView
                acarsMessages={acarsMessages}
                acarsStatus={acarsStatus}
                airportsWeather={airportsWeather}
                theme={theme}
                onRefreshAcars={fetchAcars}
                onInspectFlight={(f) => handleSelectFlight(f)}
              />
            </div>
          )}

          {activeView === 'planner' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-border">
                <div className="font-display text-sm sm:text-base font-semibold text-foreground">
                  Weather-Coupled Flight Planner
                </div>
                <Button size="sm" variant="outline" onClick={() => navigateView('radar')}>
                  <X className="w-3.5 h-3.5" />
                  Back to Map
                </Button>
              </div>
              <FlightPlannerView
                airportsWeather={airportsWeather}
                sigmets={sigmets}
                disruptions={disruptions}
                onApplyRouteToRadar={(route) => {
                  setPlannedRoute(route);
                  navigateView('radar');
                }}
              />
            </div>
          )}
        </section>
      )}

      <CreditsAttributionsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />

      {/* Streamlined Bottom Navigation Dock */}
      {isPortraitMobile ? (
        <nav
          aria-label="SkyDeck mobile navigation"
          className="fixed bottom-0 left-0 right-0 z-[600] h-16 pb-safe bg-card/95 backdrop-blur-md border-t border-border grid grid-cols-5 items-center shadow-2xl"
        >
          {(
            [
              {
                id: 'radar',
                label: 'Radar',
                icon: <Radar className="w-5 h-5" />,
                active: activeView === 'radar' && !rightDashboardOpen,
                onClick: () => {
                  setRightDashboardOpen(false);
                  navigateView('radar');
                },
              },
              {
                id: 'dashboard',
                label: 'Dashboard',
                icon: <PanelLeftOpen className="w-5 h-5" />,
                active: activeView === 'radar' && rightDashboardOpen,
                onClick: () => {
                  navigateView('radar');
                  setRightDashboardOpen((v) => !v);
                },
              },
              {
                id: 'history',
                label: 'History',
                icon: <History className="w-5 h-5" />,
                active: activeView === 'history',
                onClick: () => {
                  setRightDashboardOpen(false);
                  navigateView('history');
                },
              },
              {
                id: 'taxi',
                label: 'Taxi',
                icon: <Radio className="w-5 h-5" />,
                active: activeView === 'taxi',
                onClick: () => {
                  setRightDashboardOpen(false);
                  navigateView('taxi');
                },
              },
              {
                id: 'planner',
                label: 'Plan',
                icon: <Navigation className="w-5 h-5" />,
                active: activeView === 'planner',
                onClick: () => {
                  setRightDashboardOpen(false);
                  navigateView('planner');
                },
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={tab.onClick}
              className={`flex flex-col items-center justify-center min-h-[48px] h-full px-1 transition-colors cursor-pointer ${
                tab.active
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.icon}
              <span className="text-[10.5px] leading-tight mt-0.5 whitespace-nowrap">{tab.label}</span>
            </button>
          ))}
        </nav>
      ) : (
        <nav
          aria-label="SkyDeck navigation and radar dock"
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[600] max-w-[calc(100vw-20px)]"
        >
          {dockHidden ? (
            <button
              type="button"
              onClick={() => setDockHidden(false)}
              className="inline-flex items-center gap-2 rounded-full bg-card/95 backdrop-blur-md border border-border px-4 py-2 text-xs font-semibold text-foreground shadow-xl hover:bg-accent cursor-pointer whitespace-nowrap"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              SkyDeck · {filteredFlights.length} ADS-B
            </button>
          ) : (
            <div className="flex items-center gap-1 rounded-full bg-card/95 backdrop-blur-md border border-border px-2 py-1 shadow-2xl overflow-x-auto max-w-full">
              {/* Brand */}
              <button
                type="button"
                onClick={() => navigateView('radar')}
                className="font-display text-xs sm:text-sm font-bold tracking-tight text-foreground px-2.5 py-1 rounded-full hover:bg-accent whitespace-nowrap shrink-0 cursor-pointer"
              >
                SkyDeck
              </button>

              {/* View Switcher */}
              <div className="flex items-center gap-0.5 rounded-full bg-secondary/75 p-0.5 shrink-0">
                {(
                  [
                    {id: 'radar', label: 'Radar'},
                    {id: 'history', label: 'History'},
                    {id: 'taxi', label: 'Taxi'},
                    {id: 'planner', label: 'Plan'},
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateView(item.id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                      activeView === item.id
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Region Selector */}
              <select
                value={activeRegion.id}
                onChange={(e) => handleSelectRegion(e.target.value)}
                aria-label="Select radar coverage region"
                className="h-8 max-w-[140px] rounded-full bg-background border border-input px-2.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer shrink-0"
              >
                {localRegion && <option value={localRegion.id}>{localRegion.label}</option>}
                {REGION_PRESETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>

              {/* Quick Flight Search */}
              <div className="relative hidden md:block w-32 lg:w-40 shrink-0">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Callsign / Tail…"
                  aria-label="Quick search flights"
                  className="h-8 rounded-full pl-8 pr-6 text-xs font-mono"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear quick search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Selected-Aircraft Flight Trails Toggle */}
              <Button
                size="sm"
                variant={selectedTrailsEnabled ? 'default' : 'outline'}
                onClick={toggleFlightTrails}
                title="Toggle altitude-gradient flight trail polyline for selected aircraft"
                className="shrink-0 h-8 px-2.5 whitespace-nowrap"
              >
                <Route className="w-3.5 h-3.5" />
                <span>Flight Trails</span>
              </Button>

              {/* Live Contact Count -> Opens Traffic Tab in Left Dashboard */}
              <button
                type="button"
                onClick={() => {
                  navigateView('radar');
                  setDashboardTab('traffic');
                  setRightDashboardOpen(true);
                }}
                aria-label="Open sector traffic in left dashboard"
                className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-background px-2.5 font-mono text-[11px] text-foreground hover:bg-accent tabular-nums cursor-pointer whitespace-nowrap shrink-0"
              >
                <span className="font-semibold">{filteredFlights.length}</span>
                <span className="hidden lg:inline text-muted-foreground">ADS-B</span>
              </button>

              {/* Theme Toggle */}
              <Button
                size="icon"
                variant="outline"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                aria-label="Toggle dark or light theme"
                title={theme === 'dark' ? 'Switch to light map' : 'Switch to night map'}
                className="shrink-0 h-8 w-8"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </Button>

              {/* Left Dashboard Window Toggle */}
              <Button
                size="sm"
                variant={rightDashboardOpen && activeView === 'radar' ? 'default' : 'outline'}
                onClick={() => {
                  navigateView('radar');
                  setRightDashboardOpen((v) => !v);
                }}
                aria-label="Toggle left operations dashboard"
                className="shrink-0 h-8 px-2.5 whitespace-nowrap"
              >
                {rightDashboardOpen && activeView === 'radar' ? (
                  <PanelLeftClose className="w-3.5 h-3.5" />
                ) : (
                  <PanelLeftOpen className="w-3.5 h-3.5" />
                )}
                <span>Dashboard</span>
              </Button>

              <div className="hidden xl:block shrink-0">
                <PWAInstallButton onFallbackSync={() => fetchLiveFlights(bounds, activeRegion.id)} />
              </div>

              {/* Collapse Dock */}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setDockHidden(true)}
                aria-label="Hide bottom dock"
                title="Hide dock"
                className="shrink-0 h-8 w-8"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
