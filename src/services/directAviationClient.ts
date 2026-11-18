import {AIRPORT_CATALOG} from '../data/aviationCatalog';
import type {
  AircraftPhoto,
  AirfieldPolygonFeature,
  AirfieldStandFeature,
  AirfieldSurfaceData,
  AirfieldSurfaceGate,
  AirportBoardFlight,
  AirportBoardResponse,
  AirportMarker,
  AirportWeather,
  FlightDetail,
  FlightsResponse,
  LiveFlight,
  ProviderStatus,
  RainViewerMeta,
  RunwayCondition,
  TaxiwaySegment,
  TrailPoint,
} from '../types/aviation';
import {
  buildOverpassAirfieldQuery,
  GLOBAL_OVERPASS_MIRRORS,
  mergeAndAlignRunways,
  parseOverpassAirfieldElements,
  type OverpassElement,
} from '../utils/airfieldGeometry';

let staticHostingDetected = false;
let globalAirportsPromise: Promise<AirportMarker[]> | null = null;
let cachedGlobalAirports: AirportMarker[] | null = null;
const browserTrailMap = new Map<string, TrailPoint[]>();
const browserFlightIndex = new Map<string, LiveFlight>();
const browserSurfaceCache = new Map<string, {ts: number; data: AirfieldSurfaceData}>();
const browserWeatherCache = new Map<string, {ts: number; airports: AirportWeather[]}>();
const browserBoardCache = new Map<string, {ts: number; board: AirportBoardResponse}>();

let inFlightFlightsPromise: Promise<FlightsResponse> | null = null;
let lastGoodFlightsSnapshot: {ts: number; data: FlightsResponse} | null = null;
let browserMilCache: {ts: number; ac: Array<Record<string, unknown>>; nowSec: number} | null = null;
let browserLaddCache: {ts: number; ac: Array<Record<string, unknown>>; nowSec: number} | null = null;
let relayQueue: Promise<void> = Promise.resolve();
let flightPollCycle = 0;

export const DEFAULT_CF_WORKER_URL = '';

const RETIRED_CF_WORKER_URLS = new Set([
  'https://royal-cherry-f2c2.feianthony666.workers.dev',
]);

interface CorsRelayState {
  id: string;
  cooldownUntil: number;
  lastUsedAt: number;
  minSpacingMs: number;
  buildUrl: (targetUrl: string) => string;
  unwrap: (rawText: string) => string | null;
}

const CORS_RELAYS: CorsRelayState[] = [
  {
    id: 'cors.lol',
    cooldownUntil: 0,
    lastUsedAt: 0,
    minSpacingMs: 2800,
    buildUrl: (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
    unwrap: (t) => t,
  },
  {
    id: 'allorigins-raw',
    cooldownUntil: 0,
    lastUsedAt: 0,
    minSpacingMs: 1200,
    buildUrl: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    unwrap: (t) => t,
  },
  {
    id: 'allorigins-get',
    cooldownUntil: 0,
    lastUsedAt: 0,
    minSpacingMs: 1200,
    buildUrl: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    unwrap: (t) => {
      try {
        const j = JSON.parse(t) as {contents?: string; status?: {http_code?: number}};
        if (typeof j.contents === 'string' && j.contents.length > 0) {
          if (j.status?.http_code && j.status.http_code >= 400) return null;
          return j.contents;
        }
      } catch {
        return null;
      }
      return null;
    },
  },
];

function isInvalidProxyPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('<')) return true;
  if (/rate limit exceeded|api key is required|corsfix_error|domain_not_registered/i.test(trimmed.slice(0, 260))) {
    return true;
  }
  return false;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function getCloudflareWorkerUrl(): string {
  if (typeof window === 'undefined') return '';
  const cleanWorker = (u: string) => normalizeBaseUrl(u).replace(/\?url=.*$/i, '');
  const isUsableWorker = (u: string) =>
    /^https?:\/\//i.test(u) && !RETIRED_CF_WORKER_URLS.has(u.toLowerCase());
  try {
    const qs = new URLSearchParams(window.location.search);
    const paramW = qs.get('worker') ? cleanWorker(qs.get('worker')!) : '';
    if (paramW && isUsableWorker(paramW)) {
      window.localStorage.setItem('skydeck-cf-worker', paramW);
      return paramW;
    }
    const stored = cleanWorker(window.localStorage.getItem('skydeck-cf-worker') ?? '');
    if (stored && isUsableWorker(stored)) return stored;

    const settingsRaw = window.localStorage.getItem('skydeck-radar-settings-v1');
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw) as {cfWorkerUrl?: string; apiBaseUrl?: string};
      const w = parsed.cfWorkerUrl ? cleanWorker(parsed.cfWorkerUrl) : '';
      if (w && isUsableWorker(w)) return w;
      if (parsed.apiBaseUrl) {
        const apiWorker = cleanWorker(parsed.apiBaseUrl);
        if (isUsableWorker(apiWorker) && /\.workers\.dev/i.test(apiWorker)) return apiWorker;
      }
    }
    const legacyApi = window.localStorage.getItem('skydeck-api-base') ?? '';
    if (/\.workers\.dev/i.test(legacyApi)) {
      const legacyWorker = cleanWorker(legacyApi);
      if (isUsableWorker(legacyWorker)) return legacyWorker;
    }
  } catch {
    // ignore
  }
  const envWorker =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as {env?: Record<string, string | undefined>}).env?.VITE_CF_WORKER_URL;
  const fallback = cleanWorker(envWorker || DEFAULT_CF_WORKER_URL);
  return isUsableWorker(fallback) ? fallback : '';
}

function getCustomApiBase(): string {
  if (typeof window === 'undefined') return '';
  const normalize = (u: string) => u.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  try {
    const qs = new URLSearchParams(window.location.search);
    const paramApi = qs.get('api') ? normalize(qs.get('api')!) : '';
    if (paramApi && /^https?:\/\//i.test(paramApi) && !/\.workers\.dev/i.test(paramApi)) {
      window.localStorage.setItem('skydeck-api-base', paramApi);
      return paramApi;
    }
    const stored = normalize(window.localStorage.getItem('skydeck-api-base') ?? '');
    if (stored && /^https?:\/\//i.test(stored) && !/\.workers\.dev/i.test(stored)) return stored;
    const settingsRaw = window.localStorage.getItem('skydeck-radar-settings-v1');
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw) as {apiBaseUrl?: string};
      const val = parsed.apiBaseUrl ? normalize(parsed.apiBaseUrl) : '';
      if (val && /^https?:\/\//i.test(val) && !/\.workers\.dev/i.test(val)) return val;
    }
  } catch {
    // ignore
  }
  return '';
}

function withRelayQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = relayQueue.then(fn, fn);
  relayQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fetchJsonViaCorsRelay<T>(targetUrl: string, timeoutMs = 8000): Promise<T | null> {
  // 1. User's Cloudflare Worker CORS Proxy (fast, parallel, zero rate-limit queue)
  const cfWorker = getCloudflareWorkerUrl();
  if (cfWorker) {
    try {
      const workerReqUrl = `${cfWorker}/?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(workerReqUrl, {signal: AbortSignal.timeout(timeoutMs)});
      if (res.ok) {
        const raw = await res.text();
        if (raw && !isInvalidProxyPayload(raw)) {
          return JSON.parse(raw) as T;
        }
      }
    } catch {
      // fall through to public relays if worker transiently fails
    }
  }

  // 2. Fallback Paced Public CORS Relays
  return withRelayQueue(async () => {
    const now = Date.now();
    for (const relay of CORS_RELAYS) {
      if (now < relay.cooldownUntil) continue;
      const waitMs = relay.lastUsedAt + relay.minSpacingMs - Date.now();
      if (waitMs > 0) {
        if (waitMs > 1800) continue;
        await new Promise((r) => setTimeout(r, waitMs));
      }
      relay.lastUsedAt = Date.now();
      try {
        const res = await fetch(relay.buildUrl(targetUrl), {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          relay.cooldownUntil = Date.now() + (res.status === 429 ? 35000 : 60000);
          continue;
        }
        if (!res.ok) {
          relay.cooldownUntil = Date.now() + 20000;
          continue;
        }
        const raw = await res.text();
        const unwrapped = relay.unwrap(raw);
        if (!unwrapped || isInvalidProxyPayload(unwrapped)) {
          relay.cooldownUntil = Date.now() + 20000;
          continue;
        }
        return JSON.parse(unwrapped) as T;
      } catch {
        relay.cooldownUntil = Date.now() + 20000;
      }
    }
    return null;
  });
}

function splitCsvRow(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function airlineIcaoFromCallsign(callsign: string): string {
  const clean = (callsign || '').trim().toUpperCase();
  const match = clean.match(/^([A-Z]{3})\d/);
  return match ? match[1] : clean.slice(0, 3);
}

function parseFr24Feed(raw: Record<string, unknown>): LiveFlight[] {
  const flights: LiveFlight[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'full_count' || key === 'version' || key === 'stats' || !Array.isArray(value)) {
      continue;
    }
    const arr = value as unknown[];
    if (arr.length < 15) continue;

    const icao24 = String(arr[0] ?? key).toUpperCase();
    const lat = Number(arr[1]);
    const lon = Number(arr[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const track = Number(arr[3]) || 0;
    const altFt = Number(arr[4]) || 0;
    const speedKts = Number(arr[5]) || 0;
    const squawk = String(arr[6] ?? '');

    const slot7 = String(arr[7] ?? '');
    const hasRadarPrefix = /^(F-|T-|N\/A|EST|SAT|MLAT|ADSB|GLID|FLARM)/i.test(slot7) || slot7 === '';

    const aircraftType = String((hasRadarPrefix ? arr[8] : arr[7]) ?? 'A320').toUpperCase();
    const registration = String((hasRadarPrefix ? arr[9] : arr[8]) ?? '');
    const ts = Number(hasRadarPrefix ? arr[10] : arr[9]) || nowSec;
    const origin = String((hasRadarPrefix ? arr[11] : arr[10]) ?? '');
    const destination = String((hasRadarPrefix ? arr[12] : arr[11]) ?? '');
    const flightNumber = String((hasRadarPrefix ? arr[13] : arr[12]) ?? '');
    const onGroundVal = Number(hasRadarPrefix ? arr[14] : arr[13]);
    const vrate = Number(hasRadarPrefix ? arr[15] : arr[14]) || 0;
    const callsign = String((hasRadarPrefix ? arr[16] : arr[15]) ?? flightNumber ?? icao24)
      .trim()
      .toUpperCase();
    const airlineIcao = String(arr[18] ?? airlineIcaoFromCallsign(callsign)).toUpperCase();

    flights.push({
      id: icao24 || key,
      fr24Id: key,
      icao24,
      callsign: callsign || flightNumber || icao24,
      flightNumber: flightNumber || callsign,
      registration,
      airlineIcao,
      airlineName: airlineIcao,
      aircraftType: aircraftType || 'A320',
      lat,
      lon,
      altitudeFt: Math.max(0, Math.round(altFt)),
      groundSpeedKts: Math.max(0, Math.round(speedKts)),
      trueTrackDeg: ((track % 360) + 360) % 360,
      verticalRateFpm: Math.round(vrate),
      onGround: onGroundVal === 1 || (altFt <= 150 && speedKts < 45),
      squawk,
      origin,
      destination,
      lastContactEpoch: ts,
      source: 'fr24-web',
      isEstimated: false,
      uncertaintyNm: 0,
    });
  }

  return flights;
}

function parseAdsbExchangeList(
  rows: Array<Record<string, unknown>>,
  source: 'adsb.lol' | 'adsb.fi',
  nowSec: number,
  forceFlagBits = 0,
): LiveFlight[] {
  return rows
    .filter((a) => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)))
    .map((a) => {
      const icao24 = String(a.hex ?? '').toUpperCase();
      const callsign = String(a.flight ?? a.r ?? icao24).trim().toUpperCase();
      const onGround = a.alt_baro === 'ground' || Number(a.alt_baro ?? 0) <= 0;
      const altFt = onGround ? 0 : Number(a.alt_baro ?? a.alt_geom ?? 0) || 0;
      const dbFlags = (Number(a.dbFlags ?? 0) || 0) | forceFlagBits;
      const isMilitary = (dbFlags & 1) !== 0;
      const isPia = (dbFlags & 4) !== 0;
      const isLadd = (dbFlags & 8) !== 0;
      return {
        id: icao24,
        icao24,
        callsign,
        flightNumber: callsign,
        registration: String(a.r ?? ''),
        airlineIcao: airlineIcaoFromCallsign(callsign) || (isMilitary ? 'MIL' : isLadd ? 'LADD' : ''),
        airlineName: String(a.ownOp ?? '') || airlineIcaoFromCallsign(callsign),
        aircraftType: String(a.t ?? (isLadd ? 'GLF6' : isMilitary ? 'F16' : 'A320')).toUpperCase(),
        lat: Number(a.lat),
        lon: Number(a.lon),
        altitudeFt: Math.max(0, Math.round(altFt)),
        groundSpeedKts: Math.round(Number(a.gs ?? 0)),
        trueTrackDeg: Math.round(Number(a.track ?? 0)),
        verticalRateFpm: Math.round(Number(a.baro_rate ?? a.geom_rate ?? 0)),
        onGround,
        squawk: String(a.squawk ?? ''),
        origin: '',
        destination: '',
        lastContactEpoch: nowSec - Math.round(Number(a.seen_pos ?? 0)),
        source,
        isEstimated: false,
        uncertaintyNm: 0,
        dbFlags,
        isMilitary,
        isPia,
        isLadd,
        ownerOperator: a.ownOp ? String(a.ownOp) : undefined,
      };
    });
}

function recordBrowserBreadcrumb(f: LiveFlight) {
  const key = f.icao24 || f.id;
  browserFlightIndex.set(key, f);
  const existing = browserTrailMap.get(key) ?? [];
  const last = existing[existing.length - 1];
  if (last) {
    const dLat = Math.abs(last.lat - f.lat);
    const dLon = Math.abs(last.lon - f.lon);
    const dt = Math.max(1, Math.abs(f.lastContactEpoch - last.ts));
    if (dLat > 0.35 || dLon > 0.35 || (dt < 45 && Math.hypot(dLat, dLon) > 0.28)) {
      return;
    }
    if (dLat < 0.0005 && dLon < 0.0005) return;
  }
  existing.push({
    lat: f.lat,
    lon: f.lon,
    altFt: f.altitudeFt,
    speedKts: f.groundSpeedKts,
    trackDeg: f.trueTrackDeg,
    ts: f.lastContactEpoch,
  });
  if (existing.length > 120) existing.shift();
  browserTrailMap.set(key, existing);
}

async function getBrowserGlobalAirports(): Promise<AirportMarker[]> {
  if (cachedGlobalAirports) return cachedGlobalAirports;
  if (globalAirportsPromise) return globalAirportsPromise;

  globalAirportsPromise = (async () => {
    const seeded = new Map<string, AirportMarker>();
    for (const a of AIRPORT_CATALOG) {
      seeded.set(a.icao, {
        icao: a.icao,
        iata: a.iata,
        name: a.name,
        city: a.city,
        country: a.country,
        lat: a.lat,
        lon: a.lon,
        tier: 1,
      });
    }

    try {
      const res = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv', {
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        const text = await res.text();
        const lines = text.split(/\r?\n/);
        if (lines.length > 1) {
          const header = splitCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
          const idxIdent = header.indexOf('ident');
          const idxType = header.indexOf('type');
          const idxName = header.indexOf('name');
          const idxLat = header.indexOf('latitude_deg');
          const idxLon = header.indexOf('longitude_deg');
          const idxCountry = header.indexOf('iso_country');
          const idxCity = header.indexOf('municipality');
          const idxSched = header.indexOf('scheduled_service');
          const idxIcao = header.indexOf('icao_code');
          const idxIata = header.indexOf('iata_code');
          const idxGps = header.indexOf('gps_code');

          for (let i = 1; i < lines.length; i++) {
            const raw = lines[i];
            if (!raw) continue;
            const cols = splitCsvRow(raw);
            const type = cols[idxType] ?? '';
            if (type !== 'large_airport' && type !== 'medium_airport' && type !== 'small_airport') continue;
            const lat = Number(cols[idxLat]);
            const lon = Number(cols[idxLon]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            const iata = (cols[idxIata] ?? '').trim().toUpperCase();
            const icao = (cols[idxIcao] || cols[idxGps] || cols[idxIdent] || '').trim().toUpperCase();
            if (!icao && !iata) continue;
            const sched = (cols[idxSched] ?? '').trim().toLowerCase() === 'yes';
            if (type === 'small_airport' && !iata && !sched && !/^[A-Z]{4}$/.test(icao)) continue;

            const tier: 1 | 2 | 3 =
              type === 'large_airport'
                ? 1
                : type === 'medium_airport' || Boolean(iata) || sched
                  ? 2
                  : 3;

            const key = icao || iata;
            if (!seeded.has(key)) {
              seeded.set(key, {
                icao: key,
                iata,
                name: (cols[idxName] ?? key).trim(),
                city: (cols[idxCity] ?? '').trim(),
                country: (cols[idxCountry] ?? '').trim(),
                lat,
                lon,
                tier,
              });
            }
          }
        }
      }
    } catch {
      // keep catalog airports
    }

    const list = Array.from(seeded.values());
    cachedGlobalAirports = list;
    return list;
  })();

  return globalAirportsPromise;
}

interface DirectAipRunwayEntry {
  airportIdent: string;
  leIdent: string;
  heIdent: string;
  leLat: number;
  leLon: number;
  heLat: number;
  heLon: number;
  widthM: number;
}
let directRunwaysPromise: Promise<Map<string, DirectAipRunwayEntry[]>> | null = null;
let cachedDirectRunways: {ts: number; map: Map<string, DirectAipRunwayEntry[]>} | null = null;

async function getBrowserGlobalRunways(): Promise<Map<string, DirectAipRunwayEntry[]>> {
  if (cachedDirectRunways) {
    const ttl = cachedDirectRunways.map.size > 0 ? 86400000 : 300000;
    if (Date.now() - cachedDirectRunways.ts < ttl) return cachedDirectRunways.map;
  }
  if (directRunwaysPromise) return directRunwaysPromise;

  directRunwaysPromise = (async () => {
    const byAirport = new Map<string, DirectAipRunwayEntry[]>();
    try {
      const cfWorker = getCloudflareWorkerUrl();
      const target = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
      let res = await fetch(target, {signal: AbortSignal.timeout(4500)}).catch(() => null);
      if ((!res || !res.ok) && cfWorker) {
        res = await fetch(`${cfWorker}/?url=${encodeURIComponent(target)}`, {
          signal: AbortSignal.timeout(4500),
        }).catch(() => null);
      }
      if (res && res.ok) {
        const text = await res.text();
        const lines = text.split(/\r?\n/);
        if (lines.length > 1) {
          const header = splitCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
          const idxIdent = header.indexOf('airport_ident');
          const idxWidth = header.indexOf('width_ft');
          const idxClosed = header.indexOf('closed');
          const idxLeIdent = header.indexOf('le_ident');
          const idxLeLat = header.indexOf('le_latitude_deg');
          const idxLeLon = header.indexOf('le_longitude_deg');
          const idxHeIdent = header.indexOf('he_ident');
          const idxHeLat = header.indexOf('he_latitude_deg');
          const idxHeLon = header.indexOf('he_longitude_deg');

          for (let i = 1; i < lines.length; i++) {
            const raw = lines[i];
            if (!raw) continue;
            const cols = splitCsvRow(raw);
            if ((cols[idxClosed] ?? '0').trim() === '1') continue;
            const airportIdent = (cols[idxIdent] ?? '').trim().toUpperCase();
            if (!airportIdent) continue;
            const leLat = Number(cols[idxLeLat]);
            const leLon = Number(cols[idxLeLon]);
            const heLat = Number(cols[idxHeLat]);
            const heLon = Number(cols[idxHeLon]);
            if (
              !Number.isFinite(leLat) ||
              !Number.isFinite(leLon) ||
              !Number.isFinite(heLat) ||
              !Number.isFinite(heLon) ||
              (leLat === 0 && leLon === 0) ||
              (heLat === 0 && heLon === 0)
            ) {
              continue;
            }
            const widthFt = Number(cols[idxWidth]);
            const entry: DirectAipRunwayEntry = {
              airportIdent,
              leIdent: (cols[idxLeIdent] ?? '').trim().toUpperCase(),
              heIdent: (cols[idxHeIdent] ?? '').trim().toUpperCase(),
              leLat,
              leLon,
              heLat,
              heLon,
              widthM: Number.isFinite(widthFt) && widthFt > 20 ? Math.round(widthFt * 0.3048) : 45,
            };
            const arr = byAirport.get(airportIdent);
            if (arr) arr.push(entry);
            else byAirport.set(airportIdent, [entry]);
          }
        }
      }
    } catch {
      // optional
    }
    cachedDirectRunways = {ts: Date.now(), map: byAirport};
    return byAirport;
  })().finally(() => {
    directRunwaysPromise = null;
  });

  return directRunwaysPromise;
}

async function fetchDirectFlights(params: URLSearchParams): Promise<FlightsResponse> {
  if (inFlightFlightsPromise) return inFlightFlightsPromise;

  const task = (async (): Promise<FlightsResponse> => {
    const lamin = Math.max(-85, Number(params.get('lamin') ?? 18));
    const lomin = Math.max(-180, Number(params.get('lomin') ?? 98));
    const lamax = Math.min(85, Number(params.get('lamax') ?? 43));
    const lomax = Math.min(180, Number(params.get('lomax') ?? 126));

    const centerLat = (lamin + lamax) / 2;
    const centerLon = (lomin + lomax) / 2;
    const latSpanNm = Math.abs(lamax - lamin) * 60;
    const lonSpanNm = Math.abs(lomax - lomin) * 60 * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));
    const radiusNm = Math.min(250, Math.max(50, Math.round(Math.hypot(latSpanNm, lonSpanNm) / 2)));

    // Expand OpenSky sector on zoomed-out spans while avoiding global full-world timeout
    const osMinLat = Math.max(-85, Math.max(lamin, centerLat - 22));
    const osMaxLat = Math.min(85, Math.min(lamax, centerLat + 22));
    const osMinLon = Math.max(-180, Math.max(lomin, centerLon - 32));
    const osMaxLon = Math.min(180, Math.min(lomax, centerLon + 32));

    const latSpan = lamax - lamin;
    const lonSpan = lomax - lomin;
    const frMinLat = Math.max(-85, lamin);
    const frMaxLat = Math.min(85, lamax);
    const frMinLon = Math.max(-180, lomin);
    const frMaxLon = Math.min(180, lomax);

    flightPollCycle++;
    const providers: ProviderStatus[] = [];

    // OpenSky is not browser-CORS compatible and was rate-limited on GitHub Pages.
    // It is intentionally skipped in static hosting mode.
    const openSkyPromise = Promise.resolve([] as LiveFlight[]);

    // 2. CORS-Relayed Waterfall / Parallel via Cloudflare Worker (FR24 gliders=1 + Military + adsb.lol + adsb.fi)
    const relayPromise = (async (): Promise<LiveFlight[]> => {
      const makeFr24Url = (bMinLat: number, bMaxLat: number, bMinLon: number, bMaxLon: number) =>
        `https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=${bMaxLat.toFixed(3)},${bMinLat.toFixed(3)},${bMinLon.toFixed(3)},${bMaxLon.toFixed(3)}&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=1&air=1&vehicles=0&estimated=1&maxage=14400&gliders=1&stats=1`;
      const fr24Url = makeFr24Url(frMinLat, frMaxLat, frMinLon, frMaxLon);
      const lolUrl = `https://api.adsb.lol/v2/point/${centerLat.toFixed(3)}/${centerLon.toFixed(3)}/${radiusNm}`;
      const milUrl = `https://api.adsb.lol/v2/mil`;
      const laddUrl = `https://api.adsb.lol/v2/ladd`;
      const fiUrl = `https://opendata.adsb.fi/api/v2/lat/${centerLat.toFixed(3)}/lon/${centerLon.toFixed(3)}/dist/${radiusNm}`;
      const directOut: LiveFlight[] = [];

      const directFetches = await Promise.allSettled([
        fetch(lolUrl, {signal: AbortSignal.timeout(8000)}),
        fetch(fiUrl, {signal: AbortSignal.timeout(8000)}),
        radiusNm <= 180 ? fetch(milUrl, {signal: AbortSignal.timeout(7000)}) : Promise.resolve(null),
        radiusNm <= 180 ? fetch(laddUrl, {signal: AbortSignal.timeout(7000)}) : Promise.resolve(null),
      ]);

      const parseDirectJson = async (item: PromiseSettledResult<Response | null>, kind: 'lol' | 'fi' | 'mil' | 'ladd') => {
        if (item.status !== 'fulfilled' || !item.value?.ok) return;
        const t0 = Date.now();
        try {
          const json = await item.value.json() as
            | {ac?: Array<Record<string, unknown>>; aircraft?: Array<Record<string, unknown>>; now?: number}
            | null;
          const rows = kind === 'fi' ? (json?.aircraft ?? []) : (json?.ac ?? []);
          if (rows.length === 0) return;
          const parsed = parseAdsbExchangeList(
            rows,
            kind === 'fi' ? 'adsb.fi' : 'adsb.lol',
            Math.floor((json?.now ?? Date.now()) / 1000),
            kind === 'mil' ? 1 : kind === 'ladd' ? 8 : 0,
          );
          if (parsed.length > 0) {
            directOut.push(...parsed);
            providers.push({
              provider: kind === 'mil' ? 'adsb.lol-mil' : kind === 'ladd' ? 'adsb.lol-ladd' : kind,
              ok: true,
              count: parsed.length,
              latencyMs: Date.now() - t0,
            });
          }
        } catch {
          // Provider payload may be transiently unavailable.
        }
      };

      await Promise.all([
        parseDirectJson(directFetches[0], 'lol'),
        parseDirectJson(directFetches[1], 'fi'),
        parseDirectJson(directFetches[2], 'mil'),
        parseDirectJson(directFetches[3], 'ladd'),
      ]);
      if (directOut.length > 0) return directOut;

      const fr24NativeBoxes: Array<[number, number, number, number]> =
        latSpan > 16 || lonSpan > 24
          ? (() => {
              const mLat = (frMinLat + frMaxLat) / 2;
              const mLon = (frMinLon + frMaxLon) / 2;
              return [
                [frMinLat, mLat, frMinLon, mLon],
                [frMinLat, mLat, mLon, frMaxLon],
                [mLat, frMaxLat, frMinLon, mLon],
                [mLat, frMaxLat, mLon, frMaxLon],
              ];
            })()
          : [[frMinLat, frMaxLat, frMinLon, frMaxLon]];
      const fr24NativePromises = fr24NativeBoxes.map(async (b) => {
        try {
          const url = makeFr24Url(b[0], b[1], b[2], b[3]);
          const response = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            headers: {Accept: 'application/json'},
          });
          if (!response.ok) return [];
          return parseFr24Feed(await response.json() as Record<string, unknown>);
        } catch {
          return [];
        }
      });
      const fr24NativeLists = await Promise.all(fr24NativePromises);
      const fr24Native = fr24NativeLists.flat();
      if (fr24Native.length > 0) {
        providers.push({
          provider: 'fr24-native',
          ok: true,
          count: fr24Native.length,
          latencyMs: 0,
        });
        return fr24Native;
      }

      const hasWorker = Boolean(getCloudflareWorkerUrl());

      if (hasWorker) {
        const t0 = Date.now();
        const nowMs = Date.now();
        const needMil = !browserMilCache || nowMs - browserMilCache.ts >= 12000;
        const needLadd = !browserLaddCache || nowMs - browserLaddCache.ts >= 15000;
        const frBoxes: Array<[number, number, number, number]> =
          latSpan > 16 || lonSpan > 24
            ? (() => {
                const mLat = (frMinLat + frMaxLat) / 2;
                const mLon = (frMinLon + frMaxLon) / 2;
                return [
                  [frMinLat, mLat, frMinLon, mLon],
                  [frMinLat, mLat, mLon, frMaxLon],
                  [mLat, frMaxLat, frMinLon, mLon],
                  [mLat, frMaxLat, mLon, frMaxLon],
                ];
              })()
            : [[frMinLat, frMaxLat, frMinLon, frMaxLon]];

        const [frJsonList, milJson, laddJson, lolJson] = await Promise.all([
          Promise.all(
            frBoxes.map((b) =>
              fetchJsonViaCorsRelay<Record<string, unknown>>(makeFr24Url(b[0], b[1], b[2], b[3]), 8000),
            ),
          ),
          needMil
            ? fetchJsonViaCorsRelay<{ac?: Array<Record<string, unknown>>; now?: number}>(milUrl, 7000)
            : Promise.resolve(null),
          needLadd
            ? fetchJsonViaCorsRelay<{ac?: Array<Record<string, unknown>>; now?: number}>(laddUrl, 7000)
            : Promise.resolve(null),
          fetchJsonViaCorsRelay<{ac?: Array<Record<string, unknown>>; now?: number}>(lolUrl, 7000),
        ]);

        if (milJson?.ac) {
          browserMilCache = {ts: Date.now(), ac: milJson.ac, nowSec: Math.floor((milJson.now ?? Date.now()) / 1000)};
        }
        if (laddJson?.ac) {
          browserLaddCache = {ts: Date.now(), ac: laddJson.ac, nowSec: Math.floor((laddJson.now ?? Date.now()) / 1000)};
        }

        const out: LiveFlight[] = [];
        let frCount = 0;
        for (const frJson of frJsonList) {
          if (!frJson) continue;
          const parsed = parseFr24Feed(frJson);
          if (parsed.length > 0) {
            out.push(...parsed);
            frCount += parsed.length;
          }
        }
        if (frCount > 0) {
          providers.push({provider: 'fr24-worker', ok: true, count: frCount, latencyMs: Date.now() - t0});
        }
        if (browserLaddCache?.ac) {
          const laddRows = browserLaddCache.ac.filter((a) => {
            const lat = Number(a.lat);
            const lon = Number(a.lon);
            return Number.isFinite(lat) && Number.isFinite(lon) && lat >= lamin - 1 && lat <= lamax + 1 && lon >= lomin - 1 && lon <= lomax + 1;
          });
          const laddParsed = parseAdsbExchangeList(laddRows, 'adsb.lol', browserLaddCache.nowSec, 8);
          if (laddParsed.length > 0) {
            out.push(...laddParsed);
            providers.push({provider: 'adsb.lol-ladd', ok: true, count: laddParsed.length, latencyMs: Date.now() - t0});
          }
        }
        if (browserMilCache?.ac) {
          const milRows = browserMilCache.ac.filter((a) => {
            const lat = Number(a.lat);
            const lon = Number(a.lon);
            return Number.isFinite(lat) && Number.isFinite(lon) && lat >= lamin - 1 && lat <= lamax + 1 && lon >= lomin - 1 && lon <= lomax + 1;
          });
          const milParsed = parseAdsbExchangeList(milRows, 'adsb.lol', browserMilCache.nowSec, 1);
          if (milParsed.length > 0) {
            out.push(...milParsed);
            providers.push({provider: 'adsb.lol-mil', ok: true, count: milParsed.length, latencyMs: Date.now() - t0});
          }
        }
        if (lolJson?.ac) {
          const lolParsed = parseAdsbExchangeList(lolJson.ac, 'adsb.lol', Math.floor((lolJson.now ?? Date.now()) / 1000));
          if (lolParsed.length > 0) {
            out.push(...lolParsed);
            providers.push({provider: 'adsb.lol', ok: true, count: lolParsed.length, latencyMs: Date.now() - t0});
          }
        }
        if (out.length > 0) return out;
      }

      const preferLol = radiusNm <= 180 && flightPollCycle % 3 === 2;
      const targets: Array<'fr24-web' | 'adsb.lol' | 'adsb.fi'> = preferLol
        ? ['adsb.lol', 'fr24-web', 'adsb.fi']
        : ['fr24-web', 'adsb.lol', 'adsb.fi'];

      for (const target of targets) {
        const t0 = Date.now();
        if (target === 'fr24-web') {
          const json = await fetchJsonViaCorsRelay<Record<string, unknown>>(fr24Url, 8500);
          if (json) {
            const parsed = parseFr24Feed(json);
            if (parsed.length > 0) {
              providers.push({
                provider: 'fr24-web',
                ok: true,
                count: parsed.length,
                latencyMs: Date.now() - t0,
              });
              return parsed;
            }
          }
          providers.push({
            provider: 'fr24-web',
            ok: false,
            count: 0,
            latencyMs: Date.now() - t0,
            note: 'Configure Cloudflare Worker in Settings for fast CORS',
          });
        } else if (target === 'adsb.lol') {
          const json = await fetchJsonViaCorsRelay<{ac?: Array<Record<string, unknown>>; now?: number}>(lolUrl, 7500);
          if (json?.ac) {
            const parsed = parseAdsbExchangeList(json.ac, 'adsb.lol', Math.floor((json.now ?? Date.now()) / 1000));
            if (parsed.length > 0) {
              providers.push({
                provider: 'adsb.lol',
                ok: true,
                count: parsed.length,
                latencyMs: Date.now() - t0,
              });
              return parsed;
            }
          }
          providers.push({
            provider: 'adsb.lol',
            ok: false,
            count: 0,
            latencyMs: Date.now() - t0,
            note: 'CORS relay unavailable',
          });
        } else {
          const json = await fetchJsonViaCorsRelay<{aircraft?: Array<Record<string, unknown>>; now?: number}>(
            fiUrl,
            7500,
          );
          if (json?.aircraft) {
            const parsed = parseAdsbExchangeList(
              json.aircraft,
              'adsb.fi',
              Math.floor((json.now ?? Date.now()) / 1000),
            );
            if (parsed.length > 0) {
              providers.push({
                provider: 'adsb.fi',
                ok: true,
                count: parsed.length,
                latencyMs: Date.now() - t0,
              });
              return parsed;
            }
          }
          providers.push({
            provider: 'adsb.fi',
            ok: false,
            count: 0,
            latencyMs: Date.now() - t0,
            note: 'CORS relay unavailable',
          });
        }
      }
      return [];
    })();

    const [relayFlights, openSkyFlights] = await Promise.all([relayPromise, openSkyPromise]);

    const mergedMap = new Map<string, LiveFlight>();
    for (const list of [relayFlights, openSkyFlights]) {
      for (const f of list) {
        const key = f.icao24 || f.callsign || f.id;
        const existing = mergedMap.get(key);
        if (!existing) {
          mergedMap.set(key, f);
        } else {
          if (!existing.origin && f.origin) existing.origin = f.origin;
          if (!existing.destination && f.destination) existing.destination = f.destination;
          if (!existing.squawk && f.squawk) existing.squawk = f.squawk;
          if (!existing.registration && f.registration) existing.registration = f.registration;
          if ((!existing.aircraftType || existing.aircraftType === 'A320') && f.aircraftType) {
            existing.aircraftType = f.aircraftType;
          }
          if (!existing.fr24Id && f.fr24Id) existing.fr24Id = f.fr24Id;
          if (f.dbFlags) existing.dbFlags = (existing.dbFlags ?? 0) | f.dbFlags;
          if (f.isLadd) existing.isLadd = true;
          if (f.isMilitary) existing.isMilitary = true;
          if (f.isPia) existing.isPia = true;
          if (!existing.ownerOperator && f.ownerOperator) existing.ownerOperator = f.ownerOperator;
        }
      }
    }

    const flights = Array.from(mergedMap.values())
      .filter((f) => f.lat >= lamin - 2 && f.lat <= lamax + 2 && f.lon >= lomin - 2 && f.lon <= lomax + 2)
      .sort((a, b) => {
        const aEmerg = a.squawk === '7700' || a.squawk === '7600' || a.squawk === '7500' ? 1 : 0;
        const bEmerg = b.squawk === '7700' || b.squawk === '7600' || b.squawk === '7500' ? 1 : 0;
        if (aEmerg !== bEmerg) return bEmerg - aEmerg;
        const aFlag = (a.isLadd ? 2 : 0) + (a.isMilitary ? 1 : 0) + (a.isPia ? 1 : 0);
        const bFlag = (b.isLadd ? 2 : 0) + (b.isMilitary ? 1 : 0) + (b.isPia ? 1 : 0);
        if (aFlag !== bFlag) return bFlag - aFlag;
        if (a.onGround !== b.onGround) return a.onGround ? 1 : -1;
        return 0;
      })
      .slice(0, 10000);

    for (const f of flights) {
      recordBrowserBreadcrumb(f);
      const trail = browserTrailMap.get(f.icao24 || f.id);
      if (trail && trail.length > 1) f.trail = trail.slice(-40);
    }

    if (flights.length > 0) {
      const payload: FlightsResponse = {
        flights,
        providers,
        fetchedAt: Date.now(),
        bounds: {lamin, lomin, lamax, lomax},
      };
      lastGoodFlightsSnapshot = {ts: Date.now(), data: payload};
      return payload;
    }

    if (lastGoodFlightsSnapshot && Date.now() - lastGoodFlightsSnapshot.ts < 90000) {
      return {
        ...lastGoodFlightsSnapshot.data,
        providers,
        fromServerCache: true,
      };
    }

    return {
      flights: [],
      providers,
      fetchedAt: Date.now(),
      bounds: {lamin, lomin, lamax, lomax},
    };
  })();

  inFlightFlightsPromise = task.finally(() => {
    inFlightFlightsPromise = null;
  });
  return inFlightFlightsPromise;
}

function computeDirectRunways(
  icao: string,
  windDirDeg: number | null,
  windSpeedKts: number,
  wxString: string,
  rawMetar: string,
): RunwayCondition[] {
  const spec = AIRPORT_CATALOG.find((a) => a.icao === icao);
  if (!spec) return [];

  const isSnowOrIce = /SN|FZRA|PL|GR|GS|BLSN|IC/i.test(`${wxString} ${rawMetar}`);
  const isRainOrWet = /RA|DZ|TS|SH/i.test(`${wxString} ${rawMetar}`);
  const surface: RunwayCondition['surface'] = isSnowOrIce ? 'CONTAMINATED' : isRainOrWet ? 'WET' : 'DRY';
  const brakingAction: RunwayCondition['brakingAction'] = isSnowOrIce ? 'POOR' : isRainOrWet ? 'MEDIUM' : 'GOOD';

  let bestIdx = 0;
  let bestHeadwind = -999;

  const list = spec.runways.map((rwy, idx) => {
    let headwindKts = 0;
    let crosswindKts = 0;
    let crosswindDir: RunwayCondition['crosswindDir'] = 'CALM';

    if (windDirDeg !== null && windSpeedKts > 0) {
      const diff1 = ((windDirDeg - rwy.headingDeg + 540) % 360) - 180;
      const rad = (diff1 * Math.PI) / 180;
      const hw1 = Math.round(windSpeedKts * Math.cos(rad));
      const useOpposite = hw1 < 0;
      const effectiveHeading = useOpposite ? (rwy.headingDeg + 180) % 360 : rwy.headingDeg;
      const diff = ((windDirDeg - effectiveHeading + 540) % 360) - 180;
      const effRad = (diff * Math.PI) / 180;
      headwindKts = Math.round(windSpeedKts * Math.cos(effRad));
      const xw = Math.round(windSpeedKts * Math.sin(effRad));
      crosswindKts = Math.abs(xw);
      crosswindDir = crosswindKts === 0 ? 'CALM' : xw > 0 ? 'R' : 'L';
    }

    if (headwindKts > bestHeadwind) {
      bestHeadwind = headwindKts;
      bestIdx = idx;
    }

    return {
      ident: rwy.ident,
      headingDeg: rwy.headingDeg,
      lengthFt: rwy.lengthFt,
      surface,
      brakingAction,
      headwindKts,
      crosswindKts,
      crosswindDir,
      favored: false,
    };
  });

  if (list[bestIdx]) list[bestIdx].favored = true;
  return list;
}

async function fetchDirectWeather(params: URLSearchParams): Promise<{airports: AirportWeather[]; cached: boolean}> {
  const icaosRaw = (params.get('icaos') || AIRPORT_CATALOG.map((a) => a.icao).join(',')).toUpperCase();
  const cached = browserWeatherCache.get(icaosRaw);
  if (cached && Date.now() - cached.ts < 180000) {
    return {airports: cached.airports, cached: true};
  }

  const targetUrl = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icaosRaw)}&format=json`;
  const rows = await fetchJsonViaCorsRelay<Array<Record<string, unknown>>>(targetUrl, 7500);
  if (!Array.isArray(rows) || rows.length === 0) {
    return {airports: cached?.airports ?? [], cached: Boolean(cached)};
  }

  const byIcao = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const id = String(r.icaoId ?? '').toUpperCase();
    if (id && !byIcao.has(id)) byIcao.set(id, r);
  }

  const airports: AirportWeather[] = [];
  for (const spec of AIRPORT_CATALOG) {
    const m = byIcao.get(spec.icao);
    if (!m) continue;
    const rawMetar = String(m.rawOb ?? '');
    const wspd = Number(m.wspd ?? 0);
    const wdir = Number.isFinite(Number(m.wdir)) ? Number(m.wdir) : null;
    const wgst = Number.isFinite(Number(m.wgst)) ? Number(m.wgst) : null;
    const vis = Number.isFinite(Number(m.visib)) ? Number(m.visib) : null;
    const wxString = String(m.wxString ?? '');
    const fltCatRaw = String(m.fltCat ?? 'VFR').toUpperCase();
    const flightCategory: AirportWeather['flightCategory'] =
      fltCatRaw === 'MVFR' || fltCatRaw === 'IFR' || fltCatRaw === 'LIFR' || fltCatRaw === 'VFR'
        ? fltCatRaw
        : 'UNK';

    airports.push({
      icao: spec.icao,
      iata: spec.iata,
      name: spec.name,
      city: spec.city,
      country: spec.country,
      lat: spec.lat,
      lon: spec.lon,
      rawMetar,
      flightCategory,
      windDirDeg: wdir,
      windSpeedKts: Math.round(wspd),
      windGustKts: wgst,
      visibilitySm: vis,
      ceilingFt: null,
      tempC: Number.isFinite(Number(m.temp)) ? Number(m.temp) : null,
      dewpointC: Number.isFinite(Number(m.dewp)) ? Number(m.dewp) : null,
      altimeterHpa: Number.isFinite(Number(m.altim)) ? Math.round(Number(m.altim)) : null,
      wxString,
      tafRaw: '',
      observedAt: String(m.reportTime ?? new Date().toISOString()),
      runways: computeDirectRunways(spec.icao, wdir, Math.round(wspd), wxString, rawMetar),
    });
  }

  if (airports.length > 0) {
    browserWeatherCache.set(icaosRaw, {ts: Date.now(), airports});
  }
  return {airports, cached: false};
}

async function fetchDirectPhoto(icao24: string, reg: string): Promise<AircraftPhoto | null> {
  // 1. Wikimedia Commons full-frame photo search by registration (native CORS via origin=*)
  const normReg = reg.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (normReg.length >= 4) {
    try {
      const wmRes = await fetch(
        `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(`"${reg}"`)}&gsrlimit=6&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1280&format=json&origin=*`,
        {signal: AbortSignal.timeout(4000)},
      );
      if (wmRes.ok) {
        const wmJson = (await wmRes.json()) as {
          query?: {pages?: Record<string, {title?: string; imageinfo?: Array<Record<string, unknown>>}>};
        };
        const pages = Object.values(wmJson.query?.pages ?? {});
        for (const page of pages) {
          const title = String(page.title ?? '');
          const normTitle = title.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (!normTitle.includes(normReg)) continue;
          if (!/\.(jpe?g|png|webp)$/i.test(title)) continue;
          const info = page.imageinfo?.[0];
          const url = String(info?.thumburl ?? info?.url ?? '');
          if (url) {
            return {
              url,
              thumbUrl: url,
              photographer: 'Wikimedia Commons contributor',
              link: String(info?.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`),
              source: 'wikimedia',
              width: Number(info?.thumbwidth ?? info?.width ?? 1280),
              height: Number(info?.thumbheight ?? info?.height ?? 850),
            };
          }
        }
      }
    } catch {
      // continue to planespotters
    }
  }

  // 2. Planespotters.net official CORS JSON API
  for (const url of [
    icao24 ? `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(icao24.toUpperCase())}` : '',
    reg ? `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg.toUpperCase())}` : '',
  ]) {
    if (!url) continue;
    try {
      const r = await fetch(url, {signal: AbortSignal.timeout(3500)});
      if (!r.ok) continue;
      const json = (await r.json()) as {
        photos?: Array<{
          thumbnail?: {src?: string; size?: {width?: number; height?: number}};
          thumbnail_large?: {src?: string; size?: {width?: number; height?: number}};
          photographer?: string;
          link?: string;
        }>;
      };
      const p = json.photos?.[0];
      const large = p?.thumbnail_large;
      if (p && large?.src && p.link) {
        return {
          url: large.src,
          thumbUrl: p.thumbnail?.src,
          photographer: p.photographer || 'Planespotters.net contributor',
          link: p.link,
          source: 'planespotters.net',
          width: large.size?.width,
          height: large.size?.height,
        };
      }
    } catch {
      // continue
    }
  }

  return null;
}

async function fetchDirectFlightDetail(params: URLSearchParams): Promise<FlightDetail> {
  const icao24 = (params.get('icao24') ?? '').toUpperCase();
  const callsign = (params.get('callsign') ?? '').toUpperCase();
  const regParam = params.get('reg') ?? '';
  const fnumParam = params.get('fnum') ?? '';
  const origParam = params.get('orig') ?? '';
  const fr24Id = params.get('fr24Id') ?? '';

  const [hexRes, routeRes, playbackRes] = await Promise.all([
    icao24
      ? fetch(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(icao24)}`, {
          signal: AbortSignal.timeout(3500),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null),
    callsign && callsign !== icao24
      ? fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
          signal: AbortSignal.timeout(3500),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null),
    fr24Id
      ? fetchJsonViaCorsRelay<{result?: {response?: {data?: {flight?: Record<string, unknown>}}}}>(
          `https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${encodeURIComponent(fr24Id)}`,
          6500,
        )
      : Promise.resolve(null),
  ]);

  const hex = (hexRes ?? {}) as Record<string, string>;
  const resolvedReg = regParam || hex.Registration || '';
  const photo = await fetchDirectPhoto(icao24, resolvedReg);

  const route = ((routeRes as {response?: {flightroute?: Record<string, unknown>}} | null)?.response?.flightroute ??
    {}) as Record<string, unknown>;
  const dbOrig = (route.origin ?? {}) as Record<string, unknown>;
  const dbDest = (route.destination ?? {}) as Record<string, unknown>;
  const dbAirline = (route.airline ?? {}) as Record<string, unknown>;

  const pbFlight = playbackRes?.result?.response?.data?.flight;
  const pbTrackRaw = Array.isArray(pbFlight?.track) ? (pbFlight.track as Array<Record<string, unknown>>) : [];
  const pbTrail: TrailPoint[] = pbTrackRaw
    .filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
    .map((p) => ({
      lat: Number(p.latitude),
      lon: Number(p.longitude),
      altFt: Number((p.altitude as Record<string, unknown> | undefined)?.feet ?? 0),
      speedKts: Number((p.speed as Record<string, unknown> | undefined)?.kts ?? 0),
      trackDeg: Number(p.heading ?? 0),
      ts: Number(p.timestamp ?? 0),
    }));

  const cached = browserFlightIndex.get(icao24);
  const trail = pbTrail.length >= 2 ? pbTrail : browserTrailMap.get(icao24) ?? [];

  return {
    id: icao24 || callsign,
    callsign: callsign || icao24,
    flightNumber: String(route.callsign_iata ?? fnumParam ?? callsign),
    registration: resolvedReg,
    squawk: cached?.squawk || undefined,
    aircraftModel: String(hex.Type ?? cached?.aircraftType ?? ''),
    aircraftCode: String(hex.ICAOTypeCode ?? cached?.aircraftType ?? ''),
    manufacturer: hex.Manufacturer || undefined,
    registeredOwner: hex.RegisteredOwners || undefined,
    airlineName: String(dbAirline.name ?? hex.RegisteredOwners ?? cached?.airlineName ?? ''),
    airlineIcao: String(dbAirline.icao ?? cached?.airlineIcao ?? airlineIcaoFromCallsign(callsign)),
    originIata: String(dbOrig.iata_code ?? origParam ?? cached?.origin ?? ''),
    originIcao: String(dbOrig.icao_code ?? ''),
    originName: String(dbOrig.name ?? ''),
    destinationIata: String(dbDest.iata_code ?? cached?.destination ?? ''),
    destinationIcao: String(dbDest.icao_code ?? ''),
    destinationName: String(dbDest.name ?? ''),
    statusText: cached?.onGround ? 'SURFACE TAXI' : 'ENROUTE LIVE',
    photo,
    trail,
    source: pbTrail.length >= 2 ? 'fr24-playback-cors' : 'cors-direct',
  };
}

function mapFr24BoardRow(
  row: Record<string, unknown>,
  mode: 'departures' | 'arrivals',
  airportIata: string,
  airportIcao: string,
  airportName: string,
): AirportBoardFlight {
  const identification = (row.identification ?? {}) as Record<string, unknown>;
  const idNum = (identification.number ?? {}) as Record<string, unknown>;
  const statusObj = (row.status ?? {}) as Record<string, unknown>;
  const statusGen = (statusObj.generic as Record<string, unknown> | undefined)?.status as
    | Record<string, unknown>
    | undefined;
  const aircraft = (row.aircraft ?? {}) as Record<string, unknown>;
  const model = (aircraft.model ?? {}) as Record<string, unknown>;
  const airline = (row.airline ?? {}) as Record<string, unknown>;
  const airlineCode = (airline.code ?? {}) as Record<string, unknown>;
  const apObj = (row.airport ?? {}) as Record<string, unknown>;
  const orig = (apObj.origin ?? {}) as Record<string, unknown>;
  const dest = (apObj.destination ?? {}) as Record<string, unknown>;
  const origCode = (orig.code ?? {}) as Record<string, unknown>;
  const destCode = (dest.code ?? {}) as Record<string, unknown>;
  const timeObj = (row.time ?? {}) as Record<string, unknown>;
  const sched = (timeObj.scheduled ?? {}) as Record<string, unknown>;
  const est = (timeObj.estimated ?? {}) as Record<string, unknown>;
  const real = (timeObj.real ?? {}) as Record<string, unknown>;

  const schedTs = Number(mode === 'departures' ? sched.departure : sched.arrival) || undefined;
  const estTs = Number(mode === 'departures' ? est.departure : est.arrival) || undefined;
  const realTs = Number(mode === 'departures' ? real.departure : real.arrival) || undefined;
  const statusText = String(statusObj.text ?? statusGen?.text ?? 'Scheduled');
  const rawColor = String(statusGen?.color ?? 'gray').toLowerCase();
  const statusColor: AirportBoardFlight['statusColor'] =
    rawColor === 'green' || rawColor === 'amber' || rawColor === 'red' ? rawColor : 'gray';
  const delaySec = ((realTs ?? estTs ?? schedTs ?? 0) - (schedTs ?? 0));
  const isCancelled = /cancel/i.test(statusText) || rawColor === 'red';
  const isDelayed =
    !isCancelled && (rawColor === 'amber' || /delay/i.test(statusText) || delaySec > 900);

  return {
    id: String(identification.id ?? identification.callsign ?? Math.random()),
    callsign: String(identification.callsign ?? idNum.default ?? '').toUpperCase(),
    flightNumber: String(idNum.default ?? identification.callsign ?? '').toUpperCase(),
    airlineName: String(airline.name ?? airlineCode.icao ?? ''),
    airlineIcao: String(airlineCode.icao ?? ''),
    originIata: mode === 'departures' ? airportIata : String(origCode.iata ?? '').toUpperCase(),
    originIcao: mode === 'departures' ? airportIcao : String(origCode.icao ?? '').toUpperCase(),
    originName: mode === 'departures' ? airportName : String(orig.name ?? ''),
    destinationIata: mode === 'arrivals' ? airportIata : String(destCode.iata ?? '').toUpperCase(),
    destinationIcao: mode === 'arrivals' ? airportIcao : String(destCode.icao ?? '').toUpperCase(),
    destinationName: mode === 'arrivals' ? airportName : String(dest.name ?? ''),
    aircraftCode: String(model.code ?? ''),
    aircraftModel: String(model.text ?? model.code ?? ''),
    registration: String(aircraft.registration ?? ''),
    icao24: String(aircraft.hex ?? '').toUpperCase(),
    scheduledTime: schedTs,
    estimatedTime: estTs,
    actualTime: realTs,
    statusText,
    statusColor,
    isDelayed,
    isCancelled,
    isLive: Boolean(statusObj.live),
  };
}

async function fetchDirectAirportBoard(params: URLSearchParams): Promise<AirportBoardResponse> {
  const code = (params.get('code') ?? '').toUpperCase();
  const icao = (params.get('icao') ?? '').toUpperCase();
  const all = await getBrowserGlobalAirports();
  const catalog = AIRPORT_CATALOG.find((a) => a.iata === code || a.icao === icao || a.icao === code);
  const dir = all.find((a) => (code && a.iata === code) || a.icao === icao || a.icao === code);
  const iata = catalog?.iata ?? dir?.iata ?? code;
  const resolvedIcao = catalog?.icao ?? dir?.icao ?? (icao || code);
  const cacheKey = resolvedIcao || iata;

  const cachedBoard = browserBoardCache.get(cacheKey);
  if (cachedBoard && Date.now() - cachedBoard.ts < 60000) return cachedBoard.board;

  const queryCode = (iata || resolvedIcao).toLowerCase();
  if (queryCode) {
    const ts = Math.floor(Date.now() / 1000);
    const makeUrl = (mode: 'departures' | 'arrivals', page: number) =>
      `https://api.flightradar24.com/common/v1/airport.json?code=${encodeURIComponent(queryCode)}&plugin[]=&plugin-setting[schedule][timestamp]=${ts}&plugin-setting[schedule][mode]=${mode}&page=${page}&limit=100`;

    const loadNativeBoardPages = async (
      mode: 'departures' | 'arrivals',
    ): Promise<Array<{result?: {response?: {airport?: {pluginData?: Record<string, unknown>}}}}>> => {
      const loaded: Array<{result?: {response?: {airport?: {pluginData?: Record<string, unknown>}}}}> = [];
      for (const page of [1, 2, 3, 4, 5]) {
        try {
          const response = await fetch(makeUrl(mode, page), {
            signal: AbortSignal.timeout(7000),
            headers: {Accept: 'application/json'},
          });
          if (!response.ok) break;
          const json = await response.json() as {result?: {response?: {airport?: {pluginData?: Record<string, unknown>}}}};
          loaded.push(json);
          const pd = json.result?.response?.airport?.pluginData ?? {};
          const sched = ((((pd.schedule as Record<string, unknown> | undefined)?.[mode] as Record<string, unknown> | undefined)?.data as
            | Array<{flight?: Record<string, unknown>}>
            | undefined) ?? []);
          if (sched.length === 0) break;
        } catch {
          break;
        }
      }
      return loaded;
    };

    const [nativeDepJsons, nativeArrJsons] = await Promise.all([
      loadNativeBoardPages('departures'),
      loadNativeBoardPages('arrivals'),
    ]);
    const nativeFound =
      nativeDepJsons.some((json) => {
        const pd = json.result?.response?.airport?.pluginData ?? {};
        return ((((pd.schedule as Record<string, unknown> | undefined)?.departures as Record<string, unknown> | undefined)?.data as
          | Array<{flight?: Record<string, unknown>}>
          | undefined) ?? []).length > 0;
      }) ||
      nativeArrJsons.some((json) => {
        const pd = json.result?.response?.airport?.pluginData ?? {};
        return ((((pd.schedule as Record<string, unknown> | undefined)?.arrivals as Record<string, unknown> | undefined)?.data as
          | Array<{flight?: Record<string, unknown>}>
          | undefined) ?? []).length > 0;
      });

    if (nativeFound) {
      const depJsons = nativeDepJsons;
      const arrJsons = nativeArrJsons;

      const depRows = depJsons.flatMap((json) => {
        const pd = json.result?.response?.airport?.pluginData ?? {};
        return ((((pd.schedule as Record<string, unknown> | undefined)?.departures as Record<string, unknown> | undefined)?.data as
          | Array<{flight?: Record<string, unknown>}>
          | undefined) ?? []);
      });
      const arrRows = arrJsons.flatMap((json) => {
        const pd = json.result?.response?.airport?.pluginData ?? {};
        return ((((pd.schedule as Record<string, unknown> | undefined)?.arrivals as Record<string, unknown> | undefined)?.data as
          | Array<{flight?: Record<string, unknown>}>
          | undefined) ?? []);
      });

      if (depRows.length > 0 || arrRows.length > 0) {
        const apName = catalog?.name ?? dir?.name ?? `${iata || resolvedIcao} Airport`;
        const departuresById = new Map<string, AirportBoardFlight>();
        for (const r of depRows) {
          if (!r.flight) continue;
          const row = mapFr24BoardRow(r.flight, 'departures', iata, resolvedIcao, apName);
          departuresById.set(row.id, row);
        }
        const arrivalsById = new Map<string, AirportBoardFlight>();
        for (const r of arrRows) {
          if (!r.flight) continue;
          const row = mapFr24BoardRow(r.flight, 'arrivals', iata, resolvedIcao, apName);
          arrivalsById.set(row.id, row);
        }
        const board: AirportBoardResponse = {
          icao: resolvedIcao,
          iata,
          name: apName,
          city: catalog?.city ?? dir?.city ?? '',
          country: catalog?.country ?? dir?.country ?? '',
          lat: catalog?.lat ?? dir?.lat ?? 0,
          lon: catalog?.lon ?? dir?.lon ?? 0,
          delayIndex: {
            arrivalsIndex: null,
            arrivalsDelayAvgMin: null,
            arrivalsDelayedPct: null,
            departuresIndex: null,
            departuresDelayAvgMin: null,
            departuresDelayedPct: null,
          },
          arrivals: Array.from(arrivalsById.values()),
          departures: Array.from(departuresById.values()),
          fetchedAt: Date.now(),
          source: 'fr24-native-board',
        };
        browserBoardCache.set(cacheKey, {ts: Date.now(), board});
        return board;
      }
    }

    const loadBoardPages = async (
      mode: 'departures' | 'arrivals',
    ): Promise<Array<{result?: {response?: {airport?: {pluginData?: Record<string, unknown>}}}}>> => {
      const loaded: Array<{result?: {response?: {airport?: {pluginData?: Record<string, unknown>}}}}> = [];
      for (const page of [1, 2, 3, 4, 5]) {
        const json = await fetchJsonViaCorsRelay<{result?: {response?: {airport?: {pluginData?: Record<string, unknown>}}}}>(
          makeUrl(mode, page),
          7000,
        );
        if (!json) break;
        loaded.push(json);
        const pd = json.result?.response?.airport?.pluginData ?? {};
        const sched = ((((pd.schedule as Record<string, unknown> | undefined)?.[mode] as Record<string, unknown> | undefined)?.data as
          | Array<{flight?: Record<string, unknown>}>
          | undefined) ?? []);
        if (sched.length === 0) break;
      }
      return loaded;
    };
    const [depJsons, arrJsons] = await Promise.all([
      loadBoardPages('departures'),
      loadBoardPages('arrivals'),
    ]);

    const depRows = depJsons.flatMap((json) => {
      const pd = json?.result?.response?.airport?.pluginData ?? {};
      return ((((pd.schedule as Record<string, unknown> | undefined)?.departures as Record<string, unknown> | undefined)?.data as
        | Array<{flight?: Record<string, unknown>}>
        | undefined) ?? []);
    });
    const arrRows = arrJsons.flatMap((json) => {
      const pd = json?.result?.response?.airport?.pluginData ?? {};
      return ((((pd.schedule as Record<string, unknown> | undefined)?.arrivals as Record<string, unknown> | undefined)?.data as
        | Array<{flight?: Record<string, unknown>}>
        | undefined) ?? []);
    });

    if ((Array.isArray(depRows) && depRows.length > 0) || (Array.isArray(arrRows) && arrRows.length > 0)) {
      const apName = catalog?.name ?? dir?.name ?? `${iata || resolvedIcao} Airport`;
      const departuresById = new Map<string, AirportBoardFlight>();
      for (const r of depRows ?? []) {
        if (!r.flight) continue;
        const row = mapFr24BoardRow(r.flight, 'departures', iata, resolvedIcao, apName);
        departuresById.set(row.id, row);
      }
      const arrivalsById = new Map<string, AirportBoardFlight>();
      for (const r of arrRows ?? []) {
        if (!r.flight) continue;
        const row = mapFr24BoardRow(r.flight, 'arrivals', iata, resolvedIcao, apName);
        arrivalsById.set(row.id, row);
      }
      const departures = Array.from(departuresById.values());
      const arrivals = Array.from(arrivalsById.values());
      const board: AirportBoardResponse = {
        icao: resolvedIcao,
        iata,
        name: apName,
        city: catalog?.city ?? dir?.city ?? '',
        country: catalog?.country ?? dir?.country ?? '',
        lat: catalog?.lat ?? dir?.lat ?? 0,
        lon: catalog?.lon ?? dir?.lon ?? 0,
        delayIndex: {
          arrivalsIndex: null,
          arrivalsDelayAvgMin: null,
          arrivalsDelayedPct: null,
          departuresIndex: null,
          departuresDelayAvgMin: null,
          departuresDelayedPct: null,
        },
        arrivals,
        departures,
        fetchedAt: Date.now(),
        source: 'fr24-cors-board',
      };
      browserBoardCache.set(cacheKey, {ts: Date.now(), board});
      return board;
    }
  }

  const nearby = Array.from(browserFlightIndex.values());
  const arrivals: AirportBoardFlight[] = nearby
    .filter((f) => (iata && f.destination === iata) || f.destination === resolvedIcao)
    .map((f) => ({
      id: f.id,
      callsign: f.callsign,
      flightNumber: f.flightNumber,
      airlineName: f.airlineName,
      airlineIcao: f.airlineIcao,
      originIata: f.origin,
      originIcao: '',
      originName: f.origin,
      destinationIata: iata,
      destinationIcao: resolvedIcao,
      destinationName: catalog?.name ?? dir?.name ?? iata,
      aircraftCode: f.aircraftType,
      aircraftModel: f.aircraftType,
      registration: f.registration,
      icao24: f.icao24,
      statusText: f.onGround ? 'Arrived' : 'Enroute Inbound',
      statusColor: 'green',
      isDelayed: false,
      isLive: true,
    }));
  const departures: AirportBoardFlight[] = nearby
    .filter((f) => (iata && f.origin === iata) || f.origin === resolvedIcao)
    .map((f) => ({
      id: f.id,
      callsign: f.callsign,
      flightNumber: f.flightNumber,
      airlineName: f.airlineName,
      airlineIcao: f.airlineIcao,
      originIata: iata,
      originIcao: resolvedIcao,
      originName: catalog?.name ?? dir?.name ?? iata,
      destinationIata: f.destination,
      destinationIcao: '',
      destinationName: f.destination,
      aircraftCode: f.aircraftType,
      aircraftModel: f.aircraftType,
      registration: f.registration,
      icao24: f.icao24,
      statusText: f.onGround ? 'Taxiing' : 'Departed Live',
      statusColor: 'green',
      isDelayed: false,
      isLive: true,
    }));
  return {
    icao: resolvedIcao,
    iata,
    name: catalog?.name ?? dir?.name ?? `${iata || resolvedIcao} Airport`,
    city: catalog?.city ?? dir?.city ?? '',
    country: catalog?.country ?? dir?.country ?? '',
    lat: catalog?.lat ?? dir?.lat ?? 0,
    lon: catalog?.lon ?? dir?.lon ?? 0,
    delayIndex: {
      arrivalsIndex: null,
      arrivalsDelayAvgMin: null,
      arrivalsDelayedPct: null,
      departuresIndex: null,
      departuresDelayAvgMin: null,
      departuresDelayedPct: null,
    },
    arrivals,
    departures,
    fetchedAt: Date.now(),
    source: 'direct-adsb',
  };
}

async function fetchDirectSurface(params: URLSearchParams): Promise<AirfieldSurfaceData> {
  const rawCode = (params.get('icao') ?? '').trim().toUpperCase();
  const catalog = AIRPORT_CATALOG.find((a) => a.icao === rawCode || a.iata === rawCode);
  let lat = Number(params.get('lat') ?? catalog?.lat ?? 0);
  let lon = Number(params.get('lon') ?? catalog?.lon ?? 0);
  let icao = catalog?.icao ?? rawCode;
  let iata = catalog?.iata ?? '';

  if ((!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) && rawCode) {
    const all = await getBrowserGlobalAirports().catch(() => []);
    const dirMatch = all.find(
      (a) => a.icao.toUpperCase() === rawCode || (Boolean(a.iata) && a.iata.toUpperCase() === rawCode),
    );
    if (dirMatch) {
      lat = dirMatch.lat;
      lon = dirMatch.lon;
      icao = dirMatch.icao;
      iata = dirMatch.iata;
    }
  }

  const cacheKey = `${icao || `${lat.toFixed(3)},${lon.toFixed(3)}`}`;
  const existing = browserSurfaceCache.get(cacheKey);
  const existingTtl =
    existing && existing.data.source === 'osm-overpass' && existing.data.taxiways.length > 0
      ? 86400000
      : 45000;
  if (existing && Date.now() - existing.ts < existingTtl) return existing.data;

  let aprons: Array<Array<[number, number]>> = [];
  let labeledAprons: AirfieldPolygonFeature[] = [];
  let terminals: AirfieldPolygonFeature[] = [];
  let stands: AirfieldStandFeature[] = [];
  let osmRunways: TaxiwaySegment[] = [];
  let taxiways: TaxiwaySegment[] = [];
  let gates: AirfieldSurfaceGate[] = [];
  let osmSucceeded = false;

  const overpassPromise = (async () => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
    const q = buildOverpassAirfieldQuery(lat, lon);
    const cfWorker = getCloudflareWorkerUrl();
    const endpoints = [
      ...GLOBAL_OVERPASS_MIRRORS.slice(0, 3),
      ...(cfWorker
        ? [
            `${cfWorker}/?url=${encodeURIComponent('https://overpass.openstreetmap.fr/api/interpreter')}`,
            `${cfWorker}/?url=${encodeURIComponent('https://overpass-api.de/api/interpreter')}`,
          ]
        : []),
    ];

    try {
      const json = await Promise.any(
        endpoints.map(async (ep) => {
          const osmRes = await fetch(ep, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            body: `data=${encodeURIComponent(q)}`,
            signal: AbortSignal.timeout(10500),
          });
          if (!osmRes.ok) throw new Error(`HTTP ${osmRes.status}`);
          const parsed = (await osmRes.json()) as {elements?: OverpassElement[]};
          if (!Array.isArray(parsed.elements) || parsed.elements.length === 0) {
            throw new Error('Empty Overpass payload');
          }
          return parsed;
        }),
      );

      const parsed = parseOverpassAirfieldElements(json.elements ?? []);
      osmRunways = parsed.osmRunways;
      taxiways = parsed.taxiways.slice(0, 2600);
      aprons = parsed.aprons;
      labeledAprons = parsed.labeledAprons;
      terminals = parsed.terminals;
      stands = parsed.stands;
      gates = parsed.gates;
      osmSucceeded =
        osmRunways.length > 0 || taxiways.length > 0 || aprons.length > 0 || terminals.length > 0;
    } catch {
      // fall back to AIP + synthesized geometry
    }
  })();

  const aipMapPromise = getBrowserGlobalRunways();
  await Promise.all([overpassPromise, aipMapPromise]);
  const aipMap = await aipMapPromise;

  const lookupIdents = [catalog?.icao, icao].filter(Boolean) as string[];
  let aipRunways: DirectAipRunwayEntry[] = [];
  for (const ident of lookupIdents) {
    const found = aipMap.get(ident);
    if (found && found.length > 0) {
      aipRunways = found;
      break;
    }
  }

  const runways = mergeAndAlignRunways(
    osmRunways,
    aipRunways.map((r) => ({
      ref: r.leIdent && r.heIdent ? `${r.leIdent}/${r.heIdent}` : r.leIdent || r.heIdent || undefined,
      leLat: r.leLat,
      leLon: r.leLon,
      heLat: r.heLat,
      heLon: r.heLon,
      widthM: r.widthM,
    })),
  );

  if (runways.length === 0 && catalog) {
    catalog.runways.forEach((r, idx) => {
      const rad = (r.headingDeg * Math.PI) / 180;
      const halfLenDeg = (r.lengthFt / 6076 / 60) * 0.5;
      const cosLat = Math.cos((catalog.lat * Math.PI) / 180);
      const offsetLon = (idx - (catalog.runways.length - 1) / 2) * 0.012;
      const dLat = Math.cos(rad) * halfLenDeg;
      const dLon = (Math.sin(rad) * halfLenDeg) / cosLat;
      const p1: [number, number] = [catalog.lat - dLat, catalog.lon + offsetLon - dLon];
      const p2: [number, number] = [catalog.lat + dLat, catalog.lon + offsetLon + dLon];
      runways.push({
        id: `cat-rwy-${r.ident}`,
        kind: 'runway',
        ref: r.ident,
        widthM: 45,
        coords: [p1, p2],
      });
    });
  }

  if (taxiways.length === 0 && runways.length > 0) {
    runways.forEach((rw, idx) => {
      if (rw.coords.length < 2) return;
      const p1 = rw.coords[0];
      const p2 = rw.coords[rw.coords.length - 1];
      const cosLat = Math.max(0.2, Math.cos((p1[0] * Math.PI) / 180));
      const dLat = p2[0] - p1[0];
      const dLon = (p2[1] - p1[1]) * cosLat;
      const len = Math.max(1e-5, Math.hypot(dLat, dLon));
      const sideSign = idx % 2 === 0 ? 1 : -1;
      const perpLat = (-dLon / len) * 0.0024 * sideSign;
      const perpLon = ((dLat / len) * 0.0024 * sideSign) / cosLat;
      const twyRef = ['A', 'B', 'C', 'L', 'G', 'H'][idx % 6];
      const t1: [number, number] = [p1[0] + perpLat, p1[1] + perpLon];
      const t2: [number, number] = [p2[0] + perpLat, p2[1] + perpLon];
      taxiways.push({
        id: `syn-twy-${rw.id}-par`,
        kind: 'taxiway',
        ref: twyRef,
        widthM: 22,
        coords: [t1, t2],
      });
      [0.08, 0.34, 0.66, 0.92].forEach((frac, cIdx) => {
        const rx = p1[0] + (p2[0] - p1[0]) * frac;
        const ry = p1[1] + (p2[1] - p1[1]) * frac;
        const tx = t1[0] + (t2[0] - t1[0]) * frac;
        const ty = t1[1] + (t2[1] - t1[1]) * frac;
        taxiways.push({
          id: `syn-twy-${rw.id}-ex-${cIdx}`,
          kind: 'taxiway',
          ref: `${twyRef}${cIdx + 1}`,
          widthM: 18,
          coords: [
            [rx, ry],
            [tx, ty],
          ],
        });
      });
    });
  }

  if (aprons.length === 0 && !osmSucceeded) {
    const aLat = catalog?.lat ?? lat;
    const aLon = catalog?.lon ?? lon;
    const box: Array<[number, number]> = [
      [aLat - 0.0025, aLon - 0.0038],
      [aLat + 0.0025, aLon - 0.0038],
      [aLat + 0.0025, aLon + 0.0038],
      [aLat - 0.0025, aLon + 0.0038],
    ];
    aprons.push(box);
    labeledAprons.push({
      id: 'syn-apron-main',
      ref: 'MAIN APRON',
      coords: box,
      center: [aLat, aLon],
    });
  }

  const result: AirfieldSurfaceData = {
    icao: catalog?.icao ?? icao,
    iata: catalog?.iata ?? iata,
    lat,
    lon,
    aprons,
    labeledAprons,
    terminals,
    stands,
    runways,
    taxiways,
    gates,
    source: osmSucceeded ? 'osm-overpass' : 'catalog',
  };
  browserSurfaceCache.set(cacheKey, {ts: Date.now(), data: result});
  return result;
}

async function handleStaticRoute(path: string, params: URLSearchParams): Promise<unknown> {
  if (path === '/api/flights') {
    const lamin = Math.max(-85, Number(params.get('lamin') ?? -85));
    const lomin = Math.max(-180, Number(params.get('lomin') ?? -180));
    const lamax = Math.min(85, Number(params.get('lamax') ?? 85));
    const lomax = Math.min(180, Number(params.get('lomax') ?? 180));
    try {
      const snapshot = await fetch(`./flights/latest.json?ts=${Date.now()}`, {
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      });
      if (snapshot.ok) {
        const payload = await snapshot.json() as FlightsResponse;
        const flights = payload.flights.filter((flight) =>
          flight.lat >= lamin - 2 &&
          flight.lat <= lamax + 2 &&
          flight.lon >= lomin - 2 &&
          flight.lon <= lomax + 2,
        );
        return {
          ...payload,
          flights,
          bounds: {lamin, lomin, lamax, lomax},
          fromServerCache: true,
        };
      }
    } catch {
      // No browser provider fallback is available on static-only hosting.
    }
    return {
      flights: [],
      providers: [{
        provider: 'github-pages-snapshot',
        ok: false,
        count: 0,
        latencyMs: 0,
        note: 'Waiting for next GitHub Actions snapshot',
      }],
      fetchedAt: Date.now(),
      bounds: {lamin, lomin, lamax, lomax},
    };
  }
  if (path === '/api/airports') {
    const lamin = Number(params.get('lamin') ?? -85);
    const lomin = Number(params.get('lomin') ?? -180);
    const lamax = Number(params.get('lamax') ?? 85);
    const lomax = Number(params.get('lomax') ?? 180);
    const zoom = Number(params.get('zoom') ?? 6);
    const maxTier = zoom >= 8.5 ? 3 : zoom >= 5.5 ? 2 : 1;
    const all = await getBrowserGlobalAirports();
    const airports = all
      .filter((a) => a.tier <= maxTier && a.lat >= lamin && a.lat <= lamax && a.lon >= lomin && a.lon <= lomax)
      .sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.icao.localeCompare(b.icao)))
      .slice(0, 180);
    return {airports, maxTier, totalInViewport: airports.length};
  }
  if (path === '/api/flight-detail') {
    return fetchDirectFlightDetail(params);
  }
  if (path === '/api/surface') {
    return fetchDirectSurface(params);
  }
  if (path === '/api/locate') {
    const res = await fetch('https://ipwho.is/', {signal: AbortSignal.timeout(3500)});
    const json = (await res.json()) as {latitude?: number; longitude?: number; city?: string; country?: string};
    return {
      lat: json.latitude,
      lon: json.longitude,
      city: json.city || '',
      country: json.country || '',
      source: 'ipwho.is',
    };
  }
  if (path === '/api/weather/hazards') {
    let rainviewer: RainViewerMeta | null = null;
    try {
      const rv = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
        signal: AbortSignal.timeout(4000),
      });
      if (rv.ok) {
        const rvJson = (await rv.json()) as {
          host?: string;
          radar?: {past?: Array<{time: number; path: string}>; nowcast?: Array<{time: number; path: string}>};
        };
        const frames = [...(rvJson.radar?.past ?? []), ...(rvJson.radar?.nowcast ?? [])].slice(-8);
        if (rvJson.host && frames.length > 0) rainviewer = {host: rvJson.host, frames};
      }
    } catch {
      // optional
    }
    return {sigmets: [], rainviewer, cached: false};
  }
  if (path === '/api/airport-board') {
    return fetchDirectAirportBoard(params);
  }
  if (path === '/api/airport-taxi') {
    const icao = (params.get('icao') ?? 'ZBAA').toUpperCase();
    const spec = AIRPORT_CATALOG.find((a) => a.icao === icao) ?? AIRPORT_CATALOG[0];
    const surf = await fetchDirectSurface(
      new URLSearchParams({icao: spec.icao, lat: String(spec.lat), lon: String(spec.lon)}),
    );
    const nearby = Array.from(browserFlightIndex.values());
    const segments: TaxiwaySegment[] = [...surf.runways, ...surf.taxiways];
    return {
      airport: spec,
      groundTraffic: nearby.filter((f) => f.onGround),
      nearbyAirborne: nearby.filter((f) => !f.onGround),
      segments,
      providers: [],
    };
  }
  if (path === '/api/weather') {
    return fetchDirectWeather(params);
  }
  if (path === '/api/disruptions') return {items: [], sources: [], cached: false};
  if (path === '/api/acars') return {messages: [], sourceStatus: 'Static CORS Relay Mode', cached: false};
  return {};
}

function isKnownStaticHost(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'file:') return true;
  const host = window.location.hostname.toLowerCase();
  return (
    host.endsWith('.github.io') ||
    host.endsWith('.gitlab.io') ||
    host.endsWith('.tiiny.site') ||
    host.endsWith('.tiiny.host') ||
    host.endsWith('.surge.sh') ||
    host.endsWith('.neocities.org')
  );
}

let backendProbePromise: Promise<boolean> | null = null;

async function hasLiveBackend(): Promise<boolean> {
  if (staticHostingDetected || isKnownStaticHost()) {
    staticHostingDetected = true;
    return false;
  }
  if (!backendProbePromise) {
    backendProbePromise = fetch('./api/airports?lamin=39&lomin=115&lamax=41&lomax=117&zoom=6', {
      signal: AbortSignal.timeout(2500),
    })
      .then((res) => {
        const ct = res.headers.get('content-type') ?? '';
        const ok = res.ok && ct.includes('application/json');
        if (!ok) staticHostingDetected = true;
        return ok;
      })
      .catch(() => {
        staticHostingDetected = true;
        return false;
      });
  }
  return backendProbePromise;
}

export async function apiFetchJson<T>(inputUrl: string, signal?: AbortSignal): Promise<T> {
  const parsed = new URL(inputUrl, typeof window !== 'undefined' ? window.location.origin : 'https://skydeck.local');
  const cleanPath = parsed.pathname.replace(/^\/+/, '/');
  const params = parsed.searchParams;

  const customBase = getCustomApiBase();
  if (customBase) {
    try {
      const fetchSig = signal ? AbortSignal.any([signal, AbortSignal.timeout(9000)]) : AbortSignal.timeout(9000);
      const res = await fetch(`${customBase}${cleanPath}${parsed.search}`, {
        signal: fetchSig,
      });
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && ct.includes('application/json')) {
        return (await res.json()) as T;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      // Fall back to direct browser / Cloudflare Worker pipeline
    }
  }

  const backendAvailable = await hasLiveBackend();
  if (!backendAvailable) {
    return (await handleStaticRoute(cleanPath, params)) as T;
  }

  try {
    const relUrl = `.${cleanPath}${parsed.search}`;
    const res = await fetch(relUrl, signal ? {signal} : undefined);
    const ct = res.headers.get('content-type') ?? '';
    if (res.status === 404 || !ct.includes('application/json')) {
      staticHostingDetected = true;
      return (await handleStaticRoute(cleanPath, params)) as T;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof Error && err.message.startsWith('HTTP 5')) {
      throw err;
    }
    staticHostingDetected = true;
    return (await handleStaticRoute(cleanPath, params)) as T;
  }
}
