import express from 'express';
import {gunzipSync, inflateRawSync} from 'node:zlib';
import {XMLParser} from 'fast-xml-parser';
import {AIRPORT_CATALOG} from '../src/data/aviationCatalog';
import type {
  AcarsMessage,
  AircraftPhoto,
  AirfieldPolygonFeature,
  AirfieldStandFeature,
  AirfieldSurfaceData,
  AirfieldSurfaceGate,
  AirportBoardFlight,
  AirportBoardResponse,
  AirportDelaySummary,
  AirportDisruption,
  AirportMarker,
  AirportWeather,
  FlightDetail,
  FlightsResponse,
  HazardCategory,
  LiveAtcStation,
  LiveFlight,
  PastFlightRecord,
  ProviderStatus,
  RainViewerMeta,
  RunwayCondition,
  SafetyRecordItem,
  SafetyRecordResponse,
  SigmetHazard,
  TaxiwaySegment,
  TrailPoint,
  WeatherHazardMarker,
  WeatherLayersResponse,
  WeatherWindPoint,
} from '../src/types/aviation';
import {
  applyDisplacedThresholds,
  buildCuratedSeedSurface,
  buildOverpassAirfieldQuery,
  GLOBAL_OVERPASS_MIRRORS,
  mergeAndAlignRunways,
  parseOverpassAirfieldElements,
  type OverpassElement,
} from '../src/utils/airfieldGeometry';
import {resolveTimezoneByCoordsAndCode} from '../src/utils/timezone';
import {
  getAtcBoundaries,
  getEnrouteChartForBounds,
  getOceanicTracks,
  getTimeZones,
} from './navData';

function isSurfaceVehicleAdsb(a: Record<string, unknown>, callsign: string): boolean {
  const cat = String(a.category ?? '').toUpperCase();
  if (/^C[0-9]$/.test(cat)) return true;
  const typ = String(a.t ?? '').toUpperCase();
  if (typ === 'GRND' || typ === 'GND' || typ === 'TWR' || typ === 'SERV') return true;
  return /^(GND|TUG|OPS|FIRE|FOLLOW|SERV|VEH|TOW|CAR|TRUCK)/.test(callsign);
}

function isFlaggedOrEmergency(f: LiveFlight): boolean {
  return Boolean(
    f.isLadd ||
    f.isMilitary ||
    f.isPia ||
    f.squawk === '7700' ||
    f.squawk === '7600' ||
    f.squawk === '7500',
  );
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const API_USER_AGENT = 'SkyDeckFlightTracker/1.0 (https://skydeck.local)';
const FR24_MOBILE_UA = 'FlightradarFree/2024090501 CFNetwork/1496.0.7 Darwin/23.5.0';

// Short-TTL in-memory caches to protect upstream public endpoints
const flightsCache = new Map<string, {ts: number; data: FlightsResponse}>();
const weatherCache = new Map<string, {ts: number; data: AirportWeather[]}>();
let hazardsCache: {ts: number; sigmets: SigmetHazard[]; rainviewer: RainViewerMeta | null} | null = null;
let acarsCache: {ts: number; messages: AcarsMessage[]; sourceStatus: string} | null = null;
let disruptionsCache: {ts: number; items: AirportDisruption[]; sources: string[]} | null = null;
const taxiwayCache = new Map<string, {ts: number; segments: TaxiwaySegment[]}>();
const photoCache = new Map<string, {ts: number; photo: AircraftPhoto | null}>();
const hexDbCache = new Map<string, {ts: number; meta: Record<string, string> | null}>();
const airportBoardCache = new Map<string, {ts: number; board: AirportBoardResponse}>();
const surfaceCache = new Map<string, {ts: number; data: AirfieldSurfaceData}>();
const openSkySectorCache = new Map<string, {ts: number; flights: LiveFlight[]}>();
const safetyRecordCache = new Map<string, {ts: number; data: SafetyRecordResponse}>();
const pastFlightsCache = new Map<string, {ts: number; items: PastFlightRecord[]}>();
let adsbMilFeedCache: {ts: number; ac: Array<Record<string, unknown>>; nowSec: number} | null = null;
let adsbLaddFeedCache: {ts: number; ac: Array<Record<string, unknown>>; nowSec: number} | null = null;
let adsbLolAllCache: {ts: number; ac: Array<Record<string, unknown>>; nowSec: number} | null = null;
let adsbFiAllCache: {ts: number; aircraft: Array<Record<string, unknown>>; nowSec: number} | null = null;
const openSkyMetaCache = new Map<string, {ts: number; data: Record<string, unknown> | null}>();
const hgtCellCache = new Map<string, {ts: number; samples: Int16Array | null}>();
let globalAirportsCache: {ts: number; airports: AirportMarker[]} | null = null;
interface AipRunwayEntry {
  airportIdent: string;
  leIdent: string;
  heIdent: string;
  leLat: number;
  leLon: number;
  heLat: number;
  heLon: number;
  widthM: number;
  closed: boolean;
}
let globalRunwaysCache: {ts: number; byAirport: Map<string, AipRunwayEntry[]>} | null = null;
const flightTrailHistory = new Map<string, TrailPoint[]>();
const flightIndexMap = new Map<string, LiveFlight>();

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

async function getGlobalAirports(): Promise<AirportMarker[]> {
  if (globalAirportsCache && Date.now() - globalAirportsCache.ts < 86400000) {
    return globalAirportsCache.airports;
  }

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
      headers: {'User-Agent': API_USER_AGENT},
      signal: AbortSignal.timeout(4500),
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
          if (type !== 'large_airport' && type !== 'medium_airport' && type !== 'small_airport') {
            continue;
          }
          const lat = Number(cols[idxLat]);
          const lon = Number(cols[idxLon]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          const iata = (cols[idxIata] ?? '').trim().toUpperCase();
          const icao = (
            cols[idxIcao] ||
            cols[idxGps] ||
            cols[idxIdent] ||
            ''
          )
            .trim()
            .toUpperCase();
          if (!icao && !iata) continue;
          // Exclude obscure strips without any ICAO/IATA/scheduled code
          const sched = (cols[idxSched] ?? '').trim().toLowerCase() === 'yes';
          if (type === 'small_airport' && !iata && !sched && !/^[A-Z]{4}$/.test(icao)) {
            continue;
          }

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
    // Fall back gracefully to seeded catalog if remote CSV is unreachable
  }

  const list = Array.from(seeded.values());
  globalAirportsCache = {ts: Date.now(), airports: list};
  return list;
}

async function getGlobalRunwaysByAirport(): Promise<Map<string, AipRunwayEntry[]>> {
  if (globalRunwaysCache) {
    const ttl = globalRunwaysCache.byAirport.size > 0 ? 86400000 : 300000;
    if (Date.now() - globalRunwaysCache.ts < ttl) {
      return globalRunwaysCache.byAirport;
    }
  }

  const byAirport = new Map<string, AipRunwayEntry[]>();
  try {
    const res = await fetch('https://davidmegginson.github.io/ourairports-data/runways.csv', {
      headers: {'User-Agent': API_USER_AGENT},
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
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
          const airportIdent = (cols[idxIdent] ?? '').trim().toUpperCase();
          if (!airportIdent) continue;
          const closed = (cols[idxClosed] ?? '0').trim() === '1';
          if (closed) continue;
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
          const leIdent = (cols[idxLeIdent] ?? '').trim().toUpperCase();
          const heIdent = (cols[idxHeIdent] ?? '').trim().toUpperCase();
          const widthFt = Number(cols[idxWidth]);
          const widthM = Number.isFinite(widthFt) && widthFt > 20 ? Math.round(widthFt * 0.3048) : 45;
          const entry: AipRunwayEntry = {
            airportIdent,
            leIdent,
            heIdent,
            leLat,
            leLon,
            heLat,
            heLon,
            widthM,
            closed,
          };
          const arr = byAirport.get(airportIdent);
          if (arr) arr.push(entry);
          else byAirport.set(airportIdent, [entry]);
        }
      }
    }
  } catch {
    // fallback silently
  }

  globalRunwaysCache = {ts: Date.now(), byAirport};
  return byAirport;
}

async function safeJson<T>(res: Response | null): Promise<T | null> {
  if (!res || !res.ok) return null;
  try {
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const planespottersMetaCache = new Map<
  string,
  {ts: number; msn?: string; age?: string}
>();

async function fetchPlanespottersPhoto(icao24: string, reg: string): Promise<AircraftPhoto | null> {
  const key = `${icao24.toUpperCase()}-${reg.toUpperCase()}`;
  const cached = photoCache.get(key);
  if (cached && Date.now() - cached.ts < 86400000) return cached.photo;

  const tryPlanespotters = async (url: string): Promise<AircraftPhoto | null> => {
    try {
      const r = await fetch(url, {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
        signal: AbortSignal.timeout(2800),
      });
      const json = await safeJson<{
        photos?: Array<{
          thumbnail?: {src?: string; size?: {width?: number; height?: number}};
          thumbnail_large?: {src?: string; size?: {width?: number; height?: number}};
          photographer?: string;
          link?: string;
        }>;
      }>(r);
      const p = json?.photos?.[0];
      const large = p?.thumbnail_large;
      const imgUrl = large?.src || p?.thumbnail?.src;
      if (p && imgUrl && p.link) {
        return {
          url: imgUrl,
          thumbUrl: p.thumbnail?.src,
          photographer: p.photographer || 'Planespotters.net contributor',
          link: p.link,
          source: 'planespotters.net',
          width: large?.size?.width,
          height: large?.size?.height,
        };
      }
    } catch {
      // ignore timeout
    }
    return null;
  };

  let photo = icao24
    ? await tryPlanespotters(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(icao24.toUpperCase())}`)
    : null;

  if (!photo && reg) {
    photo = await tryPlanespotters(
      `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg.toUpperCase())}`,
    );
  }

  photoCache.set(key, {ts: Date.now(), photo});
  return photo;
}

function parsePlanespottersAirframeHtml(html: string): {msn?: string; age?: string} {
  const clean = html.replace(/\s+/g, ' ');
  let msn: string | undefined;
  let age: string | undefined;

  const msnMatches = [
    clean.match(/MSN<\/t[hd]>\s*<td[^>]*>\s*([A-Z0-9-]{2,16})\s*<\/td>/i),
    clean.match(/Serial Number\s*(?:\(MSN\))?[^<]{0,40}<[^>]*>\s*([A-Z0-9-]{2,16})/i),
    clean.match(/\/airframe\/[a-z0-9-]+-([a-z0-9]{3,10})\//i),
  ];
  for (const m of msnMatches) {
    const val = m?.[1]?.trim();
    if (val && val.length >= 2 && val !== '-' && val.toUpperCase() !== 'UNKNOWN') {
      msn = val;
      break;
    }
  }

  const ageMatches = [
    clean.match(/(?:Airframe\s+)?Age<\/t[hd]>\s*<td[^>]*>\s*([^<]{2,32})\s*<\/td>/i),
    clean.match(/>\s*(\d+(?:\.\d+)?\s*(?:Years?|yrs?))\s*</i),
  ];
  for (const m of ageMatches) {
    const val = m?.[1]?.trim();
    if (val && /\d/.test(val)) {
      age = val.replace(/\bYears?\b/i, 'yrs');
      break;
    }
  }

  if (!age) {
    const dateMatch =
      clean.match(/(?:First Flight|Delivered|Built|Rollout)[^<]{0,40}<[^>]*>\s*([^<]{4,24})/i) ??
      clean.match(/\b((?:19|20)\d\d)-\d{2}-\d{2}\b/);
    const yrMatch = dateMatch?.[1]?.match(/\b((?:19|20)\d\d)\b/);
    if (yrMatch) {
      const yrs = Math.max(0, new Date().getUTCFullYear() - Number(yrMatch[1]));
      age = `${yrs} yrs (${yrMatch[1]})`;
    }
  }

  return {msn, age};
}

interface Tar1090AirframeRow {
  reg: string;
  typecode: string;
  model: string;
  year: string;
  owner: string;
}

let tar1090DbMap = new Map<string, Tar1090AirframeRow>();
let tar1090DbLoadedAt = 0;
let tar1090DbLoading: Promise<void> | null = null;

async function ensureTar1090Db(): Promise<void> {
  if (tar1090DbMap.size > 0 && Date.now() - tar1090DbLoadedAt < 86400_000) return;
  if (tar1090DbLoading) {
    await Promise.race([
      tar1090DbLoading,
      new Promise<void>((r) => setTimeout(r, 1500)),
    ]);
    return;
  }
  tar1090DbLoading = (async () => {
    try {
      const r = await fetch(
        'https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz',
        {headers: {'User-Agent': API_USER_AGENT}, signal: AbortSignal.timeout(12000)},
      );
      if (!r.ok) return;
      const txt = gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
      const next = new Map<string, Tar1090AirframeRow>();
      const lines = txt.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const p = line.split(';');
        const hex = (p[0] || '').trim().toUpperCase();
        if (hex.length < 4) continue;
        next.set(hex, {
          reg: (p[1] || '').trim(),
          typecode: (p[2] || '').trim(),
          model: (p[4] || '').trim(),
          year: (p[5] || '').trim(),
          owner: (p[6] || '').trim(),
        });
      }
      if (next.size > 10000) {
        tar1090DbMap = next;
        tar1090DbLoadedAt = Date.now();
      }
    } catch {
      // keep existing cache if refresh fails
    } finally {
      tar1090DbLoading = null;
    }
  })();

  await Promise.race([
    tar1090DbLoading,
    new Promise<void>((r) => setTimeout(r, 1500)),
  ]);
}

async function fetchPlanespottersAirframeMeta(
  icao24: string,
  reg: string,
): Promise<{msn?: string; age?: string; reg?: string; model?: string; owner?: string}> {
  const cleanHex = icao24.trim().toUpperCase();
  const cleanReg = reg.trim().toUpperCase();
  const key = `${cleanHex}|${cleanReg}`;
  if (!cleanHex && !cleanReg) return {};

  const cached = planespottersMetaCache.get(key);
  if (cached && Date.now() - cached.ts < 86400_000 && (cached.msn || cached.age)) {
    return {msn: cached.msn, age: cached.age};
  }

  let msn: string | undefined;
  let age: string | undefined;
  let dbReg: string | undefined;
  let dbModel: string | undefined;
  let dbOwner: string | undefined;

  // 1. Global tar1090-db (647k aircraft, 333k+ with exact build year)
  await ensureTar1090Db();
  const dbHit = cleanHex ? tar1090DbMap.get(cleanHex) : undefined;
  if (dbHit) {
    dbReg = dbHit.reg || undefined;
    dbModel = dbHit.model || undefined;
    dbOwner = dbHit.owner || undefined;
    if (/^(19|20)\d{2}$/.test(dbHit.year)) {
      const yr = Number(dbHit.year);
      const yrs = Math.max(0, new Date().getUTCFullYear() - yr);
      age = `${yrs} yrs (${yr})`;
    }
  }

  const effectiveReg = (cleanReg || dbReg || '').toUpperCase();

  // 2. FAA Registry for N-numbers (fast ~480ms, gives exact MSN Serial Number + Mfr Year)
  if (/^N[1-9][A-Z0-9]{0,4}$/.test(effectiveReg)) {
    try {
      const nNum = effectiveReg.slice(1);
      const r = await fetch(
        `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(nNum)}`,
        {
          headers: {
            ...BROWSER_HEADERS,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(2600),
        },
      );
      if (r.ok) {
        const html = await r.text();
        const faaSerial = html
          .match(/data-label="Serial Number"[^>]*>\s*([^<\s][^<]*?)\s*<\/td>/i)?.[1]
          ?.trim();
        const faaYear = html
          .match(/data-label="Mfr Year"[^>]*>\s*((?:19|20)\d{2})\s*<\/td>/i)?.[1]
          ?.trim();
        if (faaSerial && !/^(none|unknown|n\/a|-)$/i.test(faaSerial)) {
          msn = faaSerial;
        }
        if (faaYear) {
          const yr = Number(faaYear);
          const yrs = Math.max(0, new Date().getUTCFullYear() - yr);
          age = `${yrs} yrs (${yr})`;
        }
      }
    } catch {
      // ignore timeout
    }
  }

  // 3. Planespotters HTML fallback when non-US airframe still lacks MSN or Age
  const tryFetchHtml = async (url: string) => {
    try {
      const r = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: 'https://www.planespotters.net/',
        },
        signal: AbortSignal.timeout(2200),
      });
      if (!r.ok) return '';
      return await r.text();
    } catch {
      return '';
    }
  };

  if ((!msn || !age) && cleanHex.length >= 4) {
    const html = await tryFetchHtml(
      `https://www.planespotters.net/hex/${encodeURIComponent(cleanHex)}`,
    );
    if (html && !/Just a moment|cf-browser-verification/i.test(html)) {
      const parsed = parsePlanespottersAirframeHtml(html);
      msn = msn || parsed.msn;
      age = age || parsed.age;

      if (!msn || !age) {
        const frameRel = html.match(/href="(\/airframe\/[^"]+)"/i)?.[1];
        if (frameRel) {
          const frameHtml = await tryFetchHtml(`https://www.planespotters.net${frameRel}`);
          if (frameHtml) {
            const p2 = parsePlanespottersAirframeHtml(frameHtml);
            msn = msn || p2.msn;
            age = age || p2.age;
          }
        }
      }
    }
  }

  if (planespottersMetaCache.size > 1500) {
    const oldest = planespottersMetaCache.keys().next().value;
    if (oldest) planespottersMetaCache.delete(oldest);
  }
  planespottersMetaCache.set(key, {ts: Date.now(), msn, age});
  return {msn, age, reg: dbReg, model: dbModel, owner: dbOwner};
}

async function fetchHexDbAircraft(icao24: string): Promise<Record<string, string> | null> {
  const key = icao24.toUpperCase();
  if (!key) return null;
  const cached = hexDbCache.get(key);
  if (cached && Date.now() - cached.ts < 86400000) return cached.meta;

  try {
    const r = await fetch(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(key)}`, {
      headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
      signal: AbortSignal.timeout(2500),
    });
    const meta = await safeJson<Record<string, string>>(r);
    hexDbCache.set(key, {ts: Date.now(), meta});
    return meta;
  } catch {
    return null;
  }
}

function mapFr24ScheduleRow(
  rawFlight: Record<string, unknown>,
  mode: 'arrivals' | 'departures',
  airportIata: string,
  airportIcao: string,
  airportName: string,
): AirportBoardFlight {
  const ident = (rawFlight.identification ?? {}) as Record<string, unknown>;
  const numObj = (ident.number ?? {}) as Record<string, unknown>;
  const statusObj = (rawFlight.status ?? {}) as Record<string, unknown>;
  const acObj = (rawFlight.aircraft ?? {}) as Record<string, unknown>;
  const modelObj = (acObj.model ?? {}) as Record<string, unknown>;
  const airlineObj = (rawFlight.airline ?? {}) as Record<string, unknown>;
  const airlineCode = (airlineObj.code ?? {}) as Record<string, unknown>;
  const apObj = (rawFlight.airport ?? {}) as Record<string, unknown>;
  const origObj = (apObj.origin ?? {}) as Record<string, unknown>;
  const origCode = (origObj.code ?? {}) as Record<string, unknown>;
  const origInfo = (origObj.info ?? {}) as Record<string, unknown>;
  const destObj = (apObj.destination ?? {}) as Record<string, unknown>;
  const destCode = (destObj.code ?? {}) as Record<string, unknown>;
  const destInfo = (destObj.info ?? {}) as Record<string, unknown>;
  const timeObj = (rawFlight.time ?? {}) as Record<string, unknown>;
  const sched = (timeObj.scheduled ?? {}) as Record<string, unknown>;
  const est = (timeObj.estimated ?? {}) as Record<string, unknown>;
  const real = (timeObj.real ?? {}) as Record<string, unknown>;

  const flightNumber = String(numObj.default ?? ident.callsign ?? '');
  const callsign = String(ident.callsign ?? flightNumber).trim().toUpperCase();
  const statusText = String(statusObj.text ?? 'Scheduled');
  const icon = String(statusObj.icon ?? 'gray').toLowerCase();

  const schedTs =
    mode === 'departures'
      ? Number(sched.departure ?? 0) || undefined
      : Number(sched.arrival ?? 0) || undefined;
  const estTs =
    mode === 'departures'
      ? Number(est.departure ?? 0) || undefined
      : Number(est.arrival ?? 0) || undefined;
  const realTs =
    mode === 'departures'
      ? Number(real.departure ?? 0) || undefined
      : Number(real.arrival ?? 0) || undefined;

  const delaySec =
    schedTs && (realTs || estTs) ? (realTs || estTs || 0) - schedTs : 0;
  const isCancelled = /cancel/i.test(statusText) || icon === 'red';
  const isDelayed =
    !isCancelled &&
    (icon === 'amber' || /delay/i.test(statusText) || delaySec >= 900);

  const statusColor: AirportBoardFlight['statusColor'] =
    isCancelled
      ? 'red'
      : icon === 'amber' || isDelayed
        ? 'amber'
        : icon === 'green' || Boolean(statusObj.live)
          ? 'green'
          : 'gray';

  const info = mode === 'departures' ? origInfo : destInfo;

  return {
    id: String(ident.id ?? ident.row ?? `${mode}-${flightNumber}-${schedTs ?? Math.random()}`),
    callsign,
    flightNumber,
    airlineName: String(airlineObj.name ?? airlineCode.icao ?? ''),
    airlineIcao: String(airlineCode.icao ?? ''),
    originIata: mode === 'departures' ? airportIata : String(origCode.iata ?? ''),
    originIcao: mode === 'departures' ? airportIcao : String(origCode.icao ?? ''),
    originName: mode === 'departures' ? airportName : String(origObj.name ?? ''),
    destinationIata: mode === 'arrivals' ? airportIata : String(destCode.iata ?? ''),
    destinationIcao: mode === 'arrivals' ? airportIcao : String(destCode.icao ?? ''),
    destinationName: mode === 'arrivals' ? airportName : String(destObj.name ?? ''),
    aircraftCode: String(modelObj.code ?? ''),
    aircraftModel: String(modelObj.text ?? modelObj.code ?? ''),
    registration: String(acObj.registration ?? ''),
    icao24: String(acObj.hex ?? '').toUpperCase(),
    terminal: info.terminal ? String(info.terminal) : undefined,
    gate: info.gate ? String(info.gate) : undefined,
    baggage: destInfo.baggage ? String(destInfo.baggage) : undefined,
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

async function fetchFr24AirportBoard(code: string, icaoHint?: string): Promise<AirportBoardResponse | null> {
  const cleanCode = (code || icaoHint || '').trim().toUpperCase();
  if (!cleanCode) return null;

  const catalog = AIRPORT_CATALOG.find(
    (a) => a.iata === cleanCode || a.icao === cleanCode || (icaoHint && a.icao === icaoHint.toUpperCase()),
  );
  const queryCode = (catalog?.iata || cleanCode).toLowerCase();
  const cacheKey = (catalog?.icao || cleanCode).toUpperCase();

  const cached = airportBoardCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60000) return cached.board;

  const ts = Math.floor(Date.now() / 1000);
  const makeBoardUrl = (mode: 'departures' | 'arrivals', page: number) =>
    `https://api.flightradar24.com/common/v1/airport.json?code=${encodeURIComponent(queryCode)}&plugin[]=&plugin-setting[schedule][timestamp]=${ts}&plugin-setting[schedule][mode]=${mode}&page=${page}&limit=100`;

  try {
    const [depRes1, depRes2, arrRes1, arrRes2] = await Promise.all([
      fetch(makeBoardUrl('departures', 1), {
        headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'},
        signal: AbortSignal.timeout(5200),
      }).catch(() => null),
      fetch(makeBoardUrl('departures', 2), {
        headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'},
        signal: AbortSignal.timeout(5200),
      }).catch(() => null),
      fetch(makeBoardUrl('arrivals', 1), {
        headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'},
        signal: AbortSignal.timeout(5200),
      }).catch(() => null),
      fetch(makeBoardUrl('arrivals', 2), {
        headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'},
        signal: AbortSignal.timeout(5200),
      }).catch(() => null),
    ]);

    type Fr24ApResp = {result?: {response?: {airport?: {pluginData?: Record<string, unknown>}}}};
    const [depJson1, depJson2, arrJson1, arrJson2] = await Promise.all([
      safeJson<Fr24ApResp>(depRes1),
      safeJson<Fr24ApResp>(depRes2),
      safeJson<Fr24ApResp>(arrRes1),
      safeJson<Fr24ApResp>(arrRes2),
    ]);

    const pdDep1 = depJson1?.result?.response?.airport?.pluginData ?? {};
    const pdDep2 = depJson2?.result?.response?.airport?.pluginData ?? {};
    const pdArr1 = arrJson1?.result?.response?.airport?.pluginData ?? {};
    const pdArr2 = arrJson2?.result?.response?.airport?.pluginData ?? {};
    const details = ((pdDep1.details ?? pdArr1.details) ?? {}) as Record<string, unknown>;
    const stats = (details.stats ?? {}) as Record<string, unknown>;
    const codeObj = (details.code ?? {}) as Record<string, unknown>;
    const posObj = (details.position ?? {}) as Record<string, unknown>;
    const regionObj = (posObj.region ?? {}) as Record<string, unknown>;
    const countryObj = (posObj.country ?? {}) as Record<string, unknown>;
    const tzObj = (details.timezone ?? {}) as Record<string, unknown>;

    const iata = String(codeObj.iata ?? catalog?.iata ?? cleanCode).toUpperCase();
    const icao = String(codeObj.icao ?? catalog?.icao ?? icaoHint ?? cleanCode).toUpperCase();
    const name = String(details.name ?? catalog?.name ?? `${iata} Airport`);
    const resolvedLat = Number(posObj.latitude ?? catalog?.lat ?? 0);
    const resolvedLon = Number(posObj.longitude ?? catalog?.lon ?? 0);
    const rawTzName = tzObj.name ? String(tzObj.name) : undefined;
    const rawOffsetSec = Number.isFinite(Number(tzObj.offset)) ? Number(tzObj.offset) : undefined;
    const rawTzAbbr = tzObj.abbr ? String(tzObj.abbr) : undefined;
    const resolvedTz = resolveTimezoneByCoordsAndCode({
      icao,
      iata,
      lat: resolvedLat,
      lon: resolvedLon,
      hintTzName: rawTzName,
      hintUtcOffsetSec: rawOffsetSec,
      hintAbbr: rawTzAbbr,
    });
    const timezoneName = resolvedTz.timezoneName;
    const utcOffsetSec = resolvedTz.utcOffsetSec;
    const timezoneAbbr = resolvedTz.timezoneAbbr;

    const arrStats = (stats.arrivals ?? {}) as Record<string, unknown>;
    const arrRecent = (arrStats.recent ?? arrStats) as Record<string, unknown>;
    const arrPct = (arrRecent.percentage ?? {}) as Record<string, unknown>;
    const arrQty = (arrRecent.quantity ?? {}) as Record<string, unknown>;

    const depStats = (stats.departures ?? {}) as Record<string, unknown>;
    const depRecent = (depStats.recent ?? depStats) as Record<string, unknown>;
    const depPct = (depRecent.percentage ?? {}) as Record<string, unknown>;
    const depQty = (depRecent.quantity ?? {}) as Record<string, unknown>;

    const rawDelayIndex: AirportDelaySummary = {
      arrivalsIndex: Number.isFinite(Number(arrRecent.delayIndex)) ? Number(arrRecent.delayIndex) : null,
      arrivalsDelayAvgMin: Number.isFinite(Number(arrRecent.delayAvg)) ? Number(arrRecent.delayAvg) : null,
      arrivalsDelayedPct: Number.isFinite(Number(arrPct.delayed)) ? Math.round(Number(arrPct.delayed) * 100) : null,
      arrivalsOnTimeCount: Number.isFinite(Number(arrQty.onTime)) ? Number(arrQty.onTime) : undefined,
      arrivalsDelayedCount: Number.isFinite(Number(arrQty.delayed)) ? Number(arrQty.delayed) : undefined,
      arrivalsCanceledCount: Number.isFinite(Number(arrQty.canceled)) ? Number(arrQty.canceled) : undefined,
      arrivalsTrend: arrPct.trend ? String(arrPct.trend) : undefined,
      departuresIndex: Number.isFinite(Number(depRecent.delayIndex)) ? Number(depRecent.delayIndex) : null,
      departuresDelayAvgMin: Number.isFinite(Number(depRecent.delayAvg)) ? Number(depRecent.delayAvg) : null,
      departuresDelayedPct: Number.isFinite(Number(depPct.delayed)) ? Math.round(Number(depPct.delayed) * 100) : null,
      departuresOnTimeCount: Number.isFinite(Number(depQty.onTime)) ? Number(depQty.onTime) : undefined,
      departuresDelayedCount: Number.isFinite(Number(depQty.delayed)) ? Number(depQty.delayed) : undefined,
      departuresCanceledCount: Number.isFinite(Number(depQty.canceled)) ? Number(depQty.canceled) : undefined,
      departuresTrend: depPct.trend ? String(depPct.trend) : undefined,
    };

    const getRows = (pd: Record<string, unknown>, mode: 'departures' | 'arrivals') => {
      const sched = ((pd.schedule as Record<string, unknown> | undefined)?.[mode] as Record<string, unknown> | undefined);
      return Array.isArray(sched?.data) ? (sched.data as Array<{flight?: Record<string, unknown>}>) : [];
    };

    const dedupeBoardRows = (rows: AirportBoardFlight[]): AirportBoardFlight[] => {
      const seen = new Map<string, AirportBoardFlight>();
      for (const row of rows) {
        if (!seen.has(row.id)) seen.set(row.id, row);
      }
      return Array.from(seen.values());
    };

    const depRows = [...getRows(pdDep1, 'departures'), ...getRows(pdDep2, 'departures')];
    const arrRows = [...getRows(pdArr1, 'arrivals'), ...getRows(pdArr2, 'arrivals')];

    const departures = dedupeBoardRows(
      depRows.filter((r) => r.flight).map((r) => mapFr24ScheduleRow(r.flight!, 'departures', iata, icao, name)),
    );
    const arrivals = dedupeBoardRows(
      arrRows.filter((r) => r.flight).map((r) => mapFr24ScheduleRow(r.flight!, 'arrivals', iata, icao, name)),
    );

    const delayIndex = computeDelaySummaryFromRows(departures, arrivals, rawDelayIndex);

    if (departures.length > 0 || arrivals.length > 0 || delayIndex.departuresIndex !== null || delayIndex.arrivalsIndex !== null) {
      const board: AirportBoardResponse = {
        icao,
        iata,
        name,
        city: String(regionObj.city ?? catalog?.city ?? ''),
        country: String(countryObj.name ?? catalog?.country ?? ''),
        lat: resolvedLat,
        lon: resolvedLon,
        timezoneName,
        utcOffsetSec,
        timezoneAbbr,
        delayIndex,
        arrivals,
        departures,
        fetchedAt: Date.now(),
        source: 'flightradar24-airport',
      };
      airportBoardCache.set(cacheKey, {ts: Date.now(), board});
      return board;
    }
  } catch {
    // fallback below
  }
  return null;
}

function deriveSideDelayStats(rows: AirportBoardFlight[]) {
  if (rows.length === 0) {
    return {
      index: null as number | null,
      avgMin: null as number | null,
      delayedPct: null as number | null,
      onTimeCount: undefined as number | undefined,
      delayedCount: undefined as number | undefined,
      canceledCount: undefined as number | undefined,
    };
  }
  let delayed = 0;
  let canceled = 0;
  let onTime = 0;
  let totalDelayMin = 0;
  for (const r of rows) {
    if (r.isCancelled) {
      canceled++;
      continue;
    }
    const refTs = r.actualTime || r.estimatedTime;
    const diffMin = r.scheduledTime && refTs ? Math.round((refTs - r.scheduledTime) / 60) : r.isDelayed ? 22 : 0;
    if (r.isDelayed || diffMin >= 15) {
      delayed++;
      totalDelayMin += Math.max(15, diffMin);
    } else {
      onTime++;
    }
  }
  const activeCount = Math.max(1, rows.length - canceled);
  const delayedPct = Math.round(((delayed + canceled) / rows.length) * 100);
  const avgMin = delayed > 0 ? Math.round(totalDelayMin / delayed) : 0;
  const rawIdx = Math.min(5, (delayedPct / 100) * 3.8 + Math.min(avgMin, 60) / 50 + (canceled / activeCount) * 1.4);
  const index = Number(rawIdx.toFixed(1));
  return {index, avgMin, delayedPct, onTimeCount: onTime, delayedCount: delayed, canceledCount: canceled};
}

function computeDelaySummaryFromRows(
  departures: AirportBoardFlight[],
  arrivals: AirportBoardFlight[],
  raw?: AirportDelaySummary | null,
): AirportDelaySummary {
  const d = deriveSideDelayStats(departures);
  const a = deriveSideDelayStats(arrivals);
  return {
    arrivalsIndex: raw?.arrivalsIndex ?? a.index,
    arrivalsDelayAvgMin: raw?.arrivalsDelayAvgMin ?? a.avgMin,
    arrivalsDelayedPct: raw?.arrivalsDelayedPct ?? a.delayedPct,
    arrivalsOnTimeCount: raw?.arrivalsOnTimeCount ?? a.onTimeCount,
    arrivalsDelayedCount: raw?.arrivalsDelayedCount ?? a.delayedCount,
    arrivalsCanceledCount: raw?.arrivalsCanceledCount ?? a.canceledCount,
    arrivalsTrend: raw?.arrivalsTrend,
    departuresIndex: raw?.departuresIndex ?? d.index,
    departuresDelayAvgMin: raw?.departuresDelayAvgMin ?? d.avgMin,
    departuresDelayedPct: raw?.departuresDelayedPct ?? d.delayedPct,
    departuresOnTimeCount: raw?.departuresOnTimeCount ?? d.onTimeCount,
    departuresDelayedCount: raw?.departuresDelayedCount ?? d.delayedCount,
    departuresCanceledCount: raw?.departuresCanceledCount ?? d.canceledCount,
    departuresTrend: raw?.departuresTrend,
  };
}

function recordFlightBreadcrumb(f: LiveFlight) {
  const key = f.icao24 || f.id;
  const prevIndex = flightIndexMap.get(key);
  if (prevIndex && !f.squawk && prevIndex.squawk) {
    f.squawk = prevIndex.squawk;
  }
  flightIndexMap.set(key, f);
  const existing = flightTrailHistory.get(key) ?? [];
  const last = existing[existing.length - 1];
  if (last) {
    const dLat = Math.abs(last.lat - f.lat);
    const dLon = Math.abs(last.lon - f.lon);
    const dt = Math.max(1, Math.abs(f.lastContactEpoch - last.ts));
    // Reject outlier squawk/position teleports (> ~22 NM jump in < 45s)
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
  flightTrailHistory.set(key, existing);
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
    const callsign = String((hasRadarPrefix ? arr[16] : arr[15]) ?? flightNumber ?? icao24).trim().toUpperCase();
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

async function fetchFr24WebSingle(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<LiveFlight[]> {
  const url = `https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=${lamax.toFixed(3)},${lamin.toFixed(3)},${lomin.toFixed(3)},${lomax.toFixed(3)}&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=1&air=1&vehicles=0&estimated=1&maxage=14400&gliders=1&stats=1`;
  const res = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Origin: 'https://www.flightradar24.com',
      Referer: 'https://www.flightradar24.com/',
    },
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  return parseFr24Feed(json);
}

async function fetchFr24Web(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  try {
    const latSpan = lamax - lamin;
    const lonSpan = lomax - lomin;
    // Tile wide/zoomed-out viewports into a 2x2 grid so FR24's per-request ~1500 aircraft zone limit doesn't drop planes
    const boxes: Array<[number, number, number, number]> =
      latSpan > 16 || lonSpan > 24
        ? (() => {
            const midLat = (lamin + lamax) / 2;
            const midLon = (lomin + lomax) / 2;
            return [
              [lamin, lomin, midLat, midLon],
              [lamin, midLon, midLat, lomax],
              [midLat, lomin, lamax, midLon],
              [midLat, midLon, lamax, lomax],
            ];
          })()
        : [[lamin, lomin, lamax, lomax]];

    const settled = await Promise.allSettled(
      boxes.map((b) => fetchFr24WebSingle(b[0], b[1], b[2], b[3])),
    );
    const merged = new Map<string, LiveFlight>();
    let firstErr: string | null = null;
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        for (const f of s.value) {
          const key = f.icao24 || f.id;
          if (!merged.has(key)) merged.set(key, f);
        }
      } else if (!firstErr) {
        firstErr = s.reason instanceof Error ? s.reason.message : 'Timeout';
      }
    }
    const flights = Array.from(merged.values());
    if (flights.length === 0 && firstErr) {
      return {
        flights: [],
        status: {provider: 'fr24-web', ok: false, count: 0, latencyMs: Date.now() - start, note: firstErr},
      };
    }
    return {
      flights,
      status: {provider: 'fr24-web', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    return {
      flights: [],
      status: {
        provider: 'fr24-web',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'Timeout',
      },
    };
  }
}

async function fetchAirNavWeb(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  const urls = [
    `https://www.airnavradar.com/stations/radar/flights.json?bounds=${lamin.toFixed(2)},${lomin.toFixed(2)},${lamax.toFixed(2)},${lomax.toFixed(2)}`,
    `https://www.airnavradar.com/data/flights?bounds=${lamin.toFixed(2)},${lomin.toFixed(2)},${lamax.toFixed(2)},${lomax.toFixed(2)}`,
  ];
  try {
    let lastStatus = 403;
    let payloadText = '';
    for (const url of urls) {
      const res = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          Origin: 'https://www.airnavradar.com',
          Referer: 'https://www.airnavradar.com/',
        },
        signal: AbortSignal.timeout(1200),
      }).catch(() => null);
      if (!res) continue;
      lastStatus = res.status;
      const body = await res.text();
      if (res.ok && body && !body.trim().startsWith('<')) {
        payloadText = body;
        break;
      }
    }
    const text = payloadText;
    if (!text) {
      return {
        flights: [],
        status: {
          provider: 'airnav-web',
          ok: false,
          count: 0,
          latencyMs: Date.now() - start,
          note: lastStatus === 403 ? 'Cloudflare protected' : `HTTP ${lastStatus}`,
        },
      };
    }
    const json = JSON.parse(text) as {flights?: Array<Record<string, unknown>>} | Array<Record<string, unknown>>;
    const rows = Array.isArray(json) ? json : Array.isArray(json.flights) ? json.flights : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const flights: LiveFlight[] = rows
      .filter((r) => Number.isFinite(Number(r.lat ?? r.la)) && Number.isFinite(Number(r.lon ?? r.lo ?? r.lng)))
      .map((r) => {
        const callsign = String(r.cs ?? r.callsign ?? r.fn ?? r.hex ?? '').trim().toUpperCase();
        const icao24 = String(r.hex ?? r.icao24 ?? callsign).toUpperCase();
        return {
          id: icao24,
          icao24,
          callsign,
          flightNumber: String(r.fn ?? callsign),
          registration: String(r.reg ?? ''),
          airlineIcao: airlineIcaoFromCallsign(callsign),
          airlineName: airlineIcaoFromCallsign(callsign),
          aircraftType: String(r.type ?? r.ac ?? 'A320').toUpperCase(),
          lat: Number(r.lat ?? r.la),
          lon: Number(r.lon ?? r.lo ?? r.lng),
          altitudeFt: Math.round(Number(r.alt ?? 0)),
          groundSpeedKts: Math.round(Number(r.spd ?? r.gs ?? 0)),
          trueTrackDeg: Math.round(Number(r.hdg ?? r.trk ?? 0)),
          verticalRateFpm: Math.round(Number(r.vr ?? 0)),
          onGround: Boolean(r.gnd ?? r.onGround),
          squawk: String(r.sq ?? ''),
          origin: String(r.dep ?? r.orig ?? ''),
          destination: String(r.arr ?? r.dest ?? ''),
          lastContactEpoch: nowSec,
          source: 'airnav-web',
          isEstimated: false,
          uncertaintyNm: 0,
        };
      });
    return {
      flights,
      status: {provider: 'airnav-web', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    return {
      flights: [],
      status: {
        provider: 'airnav-web',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'Blocked/Timeout',
      },
    };
  }
}

async function fetchVariFlightWeb(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  const overlapsChina = lamax >= 15 && lamin <= 54 && lomax >= 73 && lomin <= 136;
  if (!overlapsChina) {
    return {
      flights: [],
      status: {provider: 'variflight-web', ok: false, count: 0, latencyMs: 0, note: 'Outside CN airspace'},
    };
  }
  try {
    const res = await fetch(
      `https://flightadsb.variflight.com/flight/map?minLat=${lamin.toFixed(2)}&minLon=${lomin.toFixed(2)}&maxLat=${lamax.toFixed(2)}&maxLon=${lomax.toFixed(2)}`,
      {
        headers: {
          ...BROWSER_HEADERS,
          Origin: 'https://www.variflight.com',
          Referer: 'https://www.variflight.com/',
        },
        signal: AbortSignal.timeout(1200),
      },
    );
    const text = await res.text();
    if (!res.ok || text.trim().startsWith('<')) {
      return {
        flights: [],
        status: {
          provider: 'variflight-web',
          ok: false,
          count: 0,
          latencyMs: Date.now() - start,
          note: `Session/WAF (${res.status})`,
        },
      };
    }
    const parsed = JSON.parse(text) as {data?: Array<Record<string, unknown>>};
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const flights: LiveFlight[] = rows
      .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon ?? r.lng)))
      .map((r) => {
        const callsign = String(r.fnum ?? r.callsign ?? r.icao ?? '').trim().toUpperCase();
        const icao24 = String(r.icao ?? r.hex ?? callsign).toUpperCase();
        return {
          id: icao24,
          icao24,
          callsign,
          flightNumber: String(r.fnum ?? callsign),
          registration: String(r.anum ?? r.reg ?? ''),
          airlineIcao: airlineIcaoFromCallsign(callsign),
          airlineName: airlineIcaoFromCallsign(callsign),
          aircraftType: String(r.atype ?? 'A320').toUpperCase(),
          lat: Number(r.lat),
          lon: Number(r.lon ?? r.lng),
          altitudeFt: Math.round(Number(r.alt ?? 0)),
          groundSpeedKts: Math.round(Number(r.speed ?? 0)),
          trueTrackDeg: Math.round(Number(r.angle ?? r.track ?? 0)),
          verticalRateFpm: 0,
          onGround: Number(r.alt ?? 0) < 100 && Number(r.speed ?? 0) < 40,
          squawk: String(r.squawk ?? ''),
          origin: String(r.org ?? ''),
          destination: String(r.dst ?? ''),
          lastContactEpoch: nowSec,
          source: 'variflight-web',
          isEstimated: false,
          uncertaintyNm: 0,
        };
      });
    return {
      flights,
      status: {provider: 'variflight-web', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    return {
      flights: [],
      status: {
        provider: 'variflight-web',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'WAF/Timeout',
      },
    };
  }
}

async function fetchAdsbLol(
  centerLat: number,
  centerLon: number,
  radiusNm: number,
  isGlobal = false,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  const r = Math.min(250, Math.max(25, Math.round(radiusNm)));
  try {
    let acRows: Array<Record<string, unknown>> = [];
    let nowSec = Math.floor(Date.now() / 1000);

    if (isGlobal && adsbLolAllCache && Date.now() - adsbLolAllCache.ts < 12000) {
      acRows = adsbLolAllCache.ac;
      nowSec = adsbLolAllCache.nowSec;
    } else {
      const targetUrl = isGlobal
        ? 'https://api.adsb.lol/v2/all'
        : `https://api.adsb.lol/v2/point/${centerLat.toFixed(3)}/${centerLon.toFixed(3)}/${r}`;
      const res = await fetch(targetUrl, {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
        signal: AbortSignal.timeout(isGlobal ? 5200 : 2800),
      });
      if (!res.ok) {
        return {
          flights: [],
          status: {provider: 'adsb.lol', ok: false, count: 0, latencyMs: Date.now() - start, note: `HTTP ${res.status}`},
        };
      }
      const json = (await res.json()) as {ac?: Array<Record<string, unknown>>; now?: number};
      acRows = json.ac ?? [];
      nowSec = Math.floor((json.now ?? Date.now()) / 1000);
      if (isGlobal && acRows.length > 0) {
        adsbLolAllCache = {ts: Date.now(), ac: acRows, nowSec};
      }
    }

    const flights: LiveFlight[] = acRows
      .filter((a) => {
        if (!Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lon))) return false;
        const icao24 = String(a.hex ?? '').toUpperCase();
        const callsign = String(a.flight ?? icao24).trim().toUpperCase();
        return !isSurfaceVehicleAdsb(a, callsign);
      })
      .map((a) => {
        const icao24 = String(a.hex ?? '').toUpperCase();
        const callsign = String(a.flight ?? icao24).trim().toUpperCase();
        const onGround = a.alt_baro === 'ground' || Number(a.alt_baro ?? 0) <= 0;
        const altFt = onGround ? 0 : Number(a.alt_baro ?? a.alt_geom ?? 0) || 0;
        const dbFlags = Number(a.dbFlags ?? 0) || 0;
        const isMilitary = (dbFlags & 1) !== 0;
        const isPia = (dbFlags & 4) !== 0;
        const isLadd = (dbFlags & 8) !== 0;
        return {
          id: icao24,
          icao24,
          callsign,
          flightNumber: callsign,
          registration: String(a.r ?? ''),
          airlineIcao: airlineIcaoFromCallsign(callsign),
          airlineName: String(a.ownOp ?? '') || airlineIcaoFromCallsign(callsign),
          aircraftType: String(a.t ?? 'A320').toUpperCase(),
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
          source: 'adsb.lol',
          isEstimated: false,
          uncertaintyNm: 0,
          dbFlags,
          isMilitary,
          isPia,
          isLadd,
          ownerOperator: a.ownOp ? String(a.ownOp) : undefined,
        };
      });
    return {
      flights,
      status: {provider: 'adsb.lol', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    return {
      flights: [],
      status: {
        provider: 'adsb.lol',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'Timeout',
      },
    };
  }
}

async function fetchAdsbMil(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  try {
    let acRows: Array<Record<string, unknown>> = [];
    let nowSec = Math.floor(Date.now() / 1000);

    if (adsbMilFeedCache && Date.now() - adsbMilFeedCache.ts < 12000) {
      acRows = adsbMilFeedCache.ac;
      nowSec = adsbMilFeedCache.nowSec;
    } else {
      const res = await fetch('https://api.adsb.lol/v2/mil', {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
        signal: AbortSignal.timeout(2800),
      });
      if (!res.ok) {
        if (adsbMilFeedCache && Date.now() - adsbMilFeedCache.ts < 45000) {
          acRows = adsbMilFeedCache.ac;
          nowSec = adsbMilFeedCache.nowSec;
        } else {
          return {
            flights: [],
            status: {provider: 'adsb.lol-mil', ok: false, count: 0, latencyMs: Date.now() - start, note: `HTTP ${res.status}`},
          };
        }
      } else {
        const json = (await res.json()) as {ac?: Array<Record<string, unknown>>; now?: number};
        acRows = json.ac ?? [];
        nowSec = Math.floor((json.now ?? Date.now()) / 1000);
        adsbMilFeedCache = {ts: Date.now(), ac: acRows, nowSec};
      }
    }

    const flights: LiveFlight[] = acRows
      .filter((a) => {
        const lat = Number(a.lat);
        const lon = Number(a.lon);
        return (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat >= lamin - 1 &&
          lat <= lamax + 1 &&
          lon >= lomin - 1 &&
          lon <= lomax + 1
        );
      })
      .map((a) => {
        const icao24 = String(a.hex ?? '').toUpperCase();
        const callsign = String(a.flight ?? a.r ?? icao24).trim().toUpperCase();
        const onGround = a.alt_baro === 'ground' || Number(a.alt_baro ?? 0) <= 0;
        const altFt = onGround ? 0 : Number(a.alt_baro ?? a.alt_geom ?? 0) || 0;
        const dbFlags = (Number(a.dbFlags ?? 0) || 0) | 1;
        return {
          id: icao24,
          icao24,
          callsign,
          flightNumber: callsign,
          registration: String(a.r ?? ''),
          airlineIcao: airlineIcaoFromCallsign(callsign) || 'MIL',
          airlineName: String(a.ownOp ?? 'Military / State'),
          aircraftType: String(a.t ?? 'F16').toUpperCase(),
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
          source: 'adsb.lol',
          isEstimated: false,
          uncertaintyNm: 0,
          dbFlags,
          isMilitary: true,
          isPia: (dbFlags & 4) !== 0,
          isLadd: (dbFlags & 8) !== 0,
          ownerOperator: a.ownOp ? String(a.ownOp) : undefined,
        };
      });
    return {
      flights,
      status: {provider: 'adsb.lol-mil', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    return {
      flights: [],
      status: {
        provider: 'adsb.lol-mil',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'Timeout',
      },
    };
  }
}

async function fetchAdsbLadd(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  try {
    let acRows: Array<Record<string, unknown>> = [];
    let nowSec = Math.floor(Date.now() / 1000);

    if (adsbLaddFeedCache && Date.now() - adsbLaddFeedCache.ts < 15000) {
      acRows = adsbLaddFeedCache.ac;
      nowSec = adsbLaddFeedCache.nowSec;
    } else {
      const res = await fetch('https://api.adsb.lol/v2/ladd', {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
        signal: AbortSignal.timeout(3200),
      });
      if (!res.ok) {
        if (adsbLaddFeedCache && Date.now() - adsbLaddFeedCache.ts < 60000) {
          acRows = adsbLaddFeedCache.ac;
          nowSec = adsbLaddFeedCache.nowSec;
        } else {
          return {
            flights: [],
            status: {provider: 'adsb.lol-ladd', ok: false, count: 0, latencyMs: Date.now() - start, note: `HTTP ${res.status}`},
          };
        }
      } else {
        const json = (await res.json()) as {ac?: Array<Record<string, unknown>>; now?: number};
        acRows = json.ac ?? [];
        nowSec = Math.floor((json.now ?? Date.now()) / 1000);
        adsbLaddFeedCache = {ts: Date.now(), ac: acRows, nowSec};
      }
    }

    const flights: LiveFlight[] = acRows
      .filter((a) => {
        const lat = Number(a.lat);
        const lon = Number(a.lon);
        return (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat >= lamin - 1 &&
          lat <= lamax + 1 &&
          lon >= lomin - 1 &&
          lon <= lomax + 1
        );
      })
      .map((a) => {
        const icao24 = String(a.hex ?? '').toUpperCase();
        const callsign = String(a.flight ?? a.r ?? icao24).trim().toUpperCase();
        const onGround = a.alt_baro === 'ground' || Number(a.alt_baro ?? 0) <= 0;
        const altFt = onGround ? 0 : Number(a.alt_baro ?? a.alt_geom ?? 0) || 0;
        const dbFlags = (Number(a.dbFlags ?? 0) || 0) | 8;
        return {
          id: icao24,
          icao24,
          callsign,
          flightNumber: callsign,
          registration: String(a.r ?? ''),
          airlineIcao: airlineIcaoFromCallsign(callsign) || 'LADD',
          airlineName: String(a.ownOp ?? 'LADD Restricted'),
          aircraftType: String(a.t ?? 'GLF6').toUpperCase(),
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
          source: 'adsb.lol',
          isEstimated: false,
          uncertaintyNm: 0,
          dbFlags,
          isLadd: true,
          isMilitary: (dbFlags & 1) !== 0,
          isPia: (dbFlags & 4) !== 0,
          ownerOperator: a.ownOp ? String(a.ownOp) : undefined,
        };
      });
    return {
      flights,
      status: {provider: 'adsb.lol-ladd', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    return {
      flights: [],
      status: {
        provider: 'adsb.lol-ladd',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'Timeout',
      },
    };
  }
}

async function fetchOpenSky(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  // Cap bounding box around viewport center so OpenSky does not time out on continent-scale boxes
  const cLat = (lamin + lamax) / 2;
  const cLon = (lomin + lomax) / 2;
  const sMinLat = Math.max(-85, Math.max(lamin, cLat - 22));
  const sMaxLat = Math.min(85, Math.min(lamax, cLat + 22));
  const sMinLon = Math.max(-180, Math.max(lomin, cLon - 32));
  const sMaxLon = Math.min(180, Math.min(lomax, cLon + 32));
  const sectorKey = `${sMinLat.toFixed(1)},${sMinLon.toFixed(1)},${sMaxLat.toFixed(1)},${sMaxLon.toFixed(1)}`;
  const cachedSector = openSkySectorCache.get(sectorKey);

  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${sMinLat.toFixed(2)}&lomin=${sMinLon.toFixed(2)}&lamax=${sMaxLat.toFixed(2)}&lomax=${sMaxLon.toFixed(2)}`;
    const res = await fetch(url, {
      headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
      signal: AbortSignal.timeout(3800),
    });
    if (!res.ok) {
      if (cachedSector && Date.now() - cachedSector.ts < 30000) {
        return {
          flights: cachedSector.flights,
          status: {provider: 'opensky', ok: true, count: cachedSector.flights.length, latencyMs: Date.now() - start, note: 'Sector cache'},
        };
      }
      return {
        flights: [],
        status: {provider: 'opensky', ok: false, count: 0, latencyMs: Date.now() - start, note: `HTTP ${res.status}`},
      };
    }
    const json = (await res.json()) as {states?: Array<unknown[]>; time?: number};
    const nowSec = json.time ?? Math.floor(Date.now() / 1000);
    const flights: LiveFlight[] = (json.states ?? [])
      .filter((s) => Number.isFinite(Number(s[6])) && Number.isFinite(Number(s[5])))
      .slice(0, 8000)
      .map((s) => {
        const icao24 = String(s[0] ?? '').toUpperCase();
        const callsign = String(s[1] ?? icao24).trim().toUpperCase();
        const altM = Number(s[7] ?? s[13] ?? 0);
        const velMs = Number(s[9] ?? 0);
        const vrateMs = Number(s[11] ?? 0);
        return {
          id: icao24,
          icao24,
          callsign: callsign || icao24,
          flightNumber: callsign || icao24,
          registration: '',
          airlineIcao: airlineIcaoFromCallsign(callsign),
          airlineName: airlineIcaoFromCallsign(callsign),
          aircraftType: 'A320',
          lat: Number(s[6]),
          lon: Number(s[5]),
          altitudeFt: Math.max(0, Math.round(altM * 3.28084)),
          groundSpeedKts: Math.max(0, Math.round(velMs * 1.94384)),
          trueTrackDeg: Math.round(Number(s[10] ?? 0)),
          verticalRateFpm: Math.round(vrateMs * 196.85),
          onGround: Boolean(s[8]),
          squawk: s[14] ? String(s[14]) : '',
          origin: '',
          destination: '',
          lastContactEpoch: Number(s[4] ?? s[3] ?? nowSec),
          source: 'opensky',
          isEstimated: false,
          uncertaintyNm: 0,
        };
      });
    openSkySectorCache.set(sectorKey, {ts: Date.now(), flights});
    return {
      flights,
      status: {provider: 'opensky', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    if (cachedSector && Date.now() - cachedSector.ts < 30000) {
      return {
        flights: cachedSector.flights,
        status: {provider: 'opensky', ok: true, count: cachedSector.flights.length, latencyMs: Date.now() - start, note: 'Sector cache'},
      };
    }
    return {
      flights: [],
      status: {
        provider: 'opensky',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'Timeout',
      },
    };
  }
}

async function fetchAdsbFi(
  centerLat: number,
  centerLon: number,
  radiusNm: number,
  isGlobal = false,
): Promise<{flights: LiveFlight[]; status: ProviderStatus}> {
  const start = Date.now();
  const r = Math.min(250, Math.max(25, Math.round(radiusNm)));
  try {
    let aircraftRows: Array<Record<string, unknown>> = [];
    let nowSec = Math.floor(Date.now() / 1000);

    if (isGlobal && adsbFiAllCache && Date.now() - adsbFiAllCache.ts < 12000) {
      aircraftRows = adsbFiAllCache.aircraft;
      nowSec = adsbFiAllCache.nowSec;
    } else {
      const targetUrl = isGlobal
        ? 'https://opendata.adsb.fi/api/v2/all'
        : `https://opendata.adsb.fi/api/v2/lat/${centerLat.toFixed(3)}/lon/${centerLon.toFixed(3)}/dist/${r}`;
      const res = await fetch(targetUrl, {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
        signal: AbortSignal.timeout(isGlobal ? 5200 : 2800),
      });
      if (!res.ok) {
        return {
          flights: [],
          status: {provider: 'adsb.fi', ok: false, count: 0, latencyMs: Date.now() - start, note: `HTTP ${res.status}`},
        };
      }
      const json = (await res.json()) as {aircraft?: Array<Record<string, unknown>>; now?: number};
      aircraftRows = json.aircraft ?? [];
      nowSec = Math.floor((json.now ?? Date.now()) / 1000);
      if (isGlobal && aircraftRows.length > 0) {
        adsbFiAllCache = {ts: Date.now(), aircraft: aircraftRows, nowSec};
      }
    }

    const flights: LiveFlight[] = aircraftRows
      .filter((a) => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)))
      .map((a) => {
        const icao24 = String(a.hex ?? '').toUpperCase();
        const callsign = String(a.flight ?? icao24).trim().toUpperCase();
        const onGround = a.alt_baro === 'ground' || Number(a.alt_baro ?? 0) <= 0;
        const altFt = onGround ? 0 : Number(a.alt_baro ?? a.alt_geom ?? 0) || 0;
        return {
          id: icao24,
          icao24,
          callsign,
          flightNumber: callsign,
          registration: String(a.r ?? ''),
          airlineIcao: airlineIcaoFromCallsign(callsign),
          airlineName: airlineIcaoFromCallsign(callsign),
          aircraftType: String(a.t ?? 'A320').toUpperCase(),
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
          source: 'adsb.fi',
          isEstimated: false,
          uncertaintyNm: 0,
        };
      });
    return {
      flights,
      status: {provider: 'adsb.fi', ok: true, count: flights.length, latencyMs: Date.now() - start},
    };
  } catch (err) {
    return {
      flights: [],
      status: {
        provider: 'adsb.fi',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : 'Timeout',
      },
    };
  }
}

function computeRunways(
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

function classifyAcarsLabel(label: string, text: string): {name: string; category: AcarsMessage['category']; summary: string} {
  const l = (label || '').toUpperCase();
  const t = (text || '').trim();
  if (/^Q[ABCD0]|^SA|^SQ/.test(l) || /\b(OUT|OFF|ON|IN)\b/.test(t)) {
    return {name: 'OOOI Movement', category: 'OOOI', summary: t.slice(0, 140) || 'Gate/Runway movement report'};
  }
  if (/^H1|^POS|^10|^15|^16/.test(l) || /POS|LAT|LON/.test(t)) {
    return {name: 'Position / ADS-C', category: 'POS', summary: t.slice(0, 140) || 'Enroute automated position fix'};
  }
  if (/^5Z|^WX|^20|^21/.test(l) || /METAR|TAF|WINDS|TURB/.test(t)) {
    return {name: 'Weather / Winds', category: 'WX', summary: t.slice(0, 140) || 'Weather / Turbulence advisory'};
  }
  if (/^B6|^44|^AA|^CP/.test(l) || /CLRD|PDC|ATIS|RWY|SQUAWK/.test(t)) {
    return {name: 'ATC / Clearance', category: 'ATC', summary: t.slice(0, 140) || 'Pre-departure / ATC datalink'};
  }
  if (/^80|^MA|^DF|^M1/.test(l) || /ENG|HYD|FAULT|MAINT/.test(t)) {
    return {name: 'Maintenance / EICAS', category: 'MAINT', summary: t.slice(0, 140) || 'Airframe system telemetry report'};
  }
  return {name: `Label ${l || 'GEN'}`, category: 'OTHER', summary: t.slice(0, 140) || 'Operational airline datalink'};
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // 1. Live Multi-Source Flights Aggregator
  router.get('/flights', async (req, res) => {
    const lamin = Number(req.query.lamin ?? 18.0);
    const lomin = Number(req.query.lomin ?? 98.0);
    const lamax = Number(req.query.lamax ?? 43.0);
    const lomax = Number(req.query.lomax ?? 126.0);

    const key = `${lamin.toFixed(1)},${lomin.toFixed(1)},${lamax.toFixed(1)},${lomax.toFixed(1)}`;
    const cached = flightsCache.get(key);
    if (cached && Date.now() - cached.ts < 2500) {
      res.json({...cached.data, fromServerCache: true});
      return;
    }

    const isGlobal = lamax - lamin >= 150 && lomax - lomin >= 320;
    const centerLat = (lamin + lamax) / 2;
    const centerLon = (lomin + lomax) / 2;
    const latSpanNm = Math.abs(lamax - lamin) * 60;
    const lonSpanNm = Math.abs(lomax - lomin) * 60 * Math.cos((centerLat * Math.PI) / 180);
    const radiusNm = Math.min(250, Math.max(40, Math.hypot(latSpanNm, lonSpanNm) / 2));

    const [fr24Res, adsbRes, adsbMilRes, adsbLaddRes, adsbFiRes, openSkyRes, airNavRes, variFlightRes] = await Promise.all([
      fetchFr24Web(lamin, lomin, lamax, lomax),
      fetchAdsbLol(centerLat, centerLon, radiusNm, isGlobal),
      fetchAdsbMil(lamin, lomin, lamax, lomax),
      fetchAdsbLadd(lamin, lomin, lamax, lomax),
      fetchAdsbFi(centerLat, centerLon, radiusNm, isGlobal),
      fetchOpenSky(lamin, lomin, lamax, lomax),
      fetchAirNavWeb(lamin, lomin, lamax, lomax),
      fetchVariFlightWeb(lamin, lomin, lamax, lomax),
    ]);

    const mergedMap = new Map<string, LiveFlight>();
    const absorbFlight = (f: LiveFlight, enrichOnly = false) => {
      const dedupeKey = f.icao24 || f.callsign;
      const existing = mergedMap.get(dedupeKey);
      if (!existing) {
        if (!enrichOnly) mergedMap.set(dedupeKey, f);
        return;
      }
      if (!existing.origin && f.origin) existing.origin = f.origin;
      if (!existing.destination && f.destination) existing.destination = f.destination;
      if (!existing.squawk && f.squawk) existing.squawk = f.squawk;
      if (!existing.airlineIcao && f.airlineIcao) existing.airlineIcao = f.airlineIcao;
      if (!existing.flightNumber && f.flightNumber) existing.flightNumber = f.flightNumber;
      if ((!existing.aircraftType || existing.aircraftType === 'A320') && f.aircraftType) {
        existing.aircraftType = f.aircraftType;
      }
      if (!existing.registration && f.registration) existing.registration = f.registration;
      if (!existing.fr24Id && f.fr24Id) existing.fr24Id = f.fr24Id;
      if (f.dbFlags) existing.dbFlags = (existing.dbFlags ?? 0) | f.dbFlags;
      if (f.isLadd) existing.isLadd = true;
      if (f.isMilitary) existing.isMilitary = true;
      if (f.isPia) existing.isPia = true;
      if (!existing.ownerOperator && f.ownerOperator) existing.ownerOperator = f.ownerOperator;
    };

    // 1. Primary live radar sources (FR24 + regional adapters) + LADD / MIL feeders
    for (const list of [
      variFlightRes.flights,
      airNavRes.flights,
      fr24Res.flights,
      adsbLaddRes.flights,
      adsbMilRes.flights,
    ]) {
      for (const f of list) absorbFlight(f, false);
    }

    // 2. General ADS-B / OpenSky: keep flagged LADD / MIL / PIA / Emergency targets;
    //    unflagged general ADS-B only enriches existing FR24 flights (or acts as backup if FR24 is empty).
    const fr24HasCoverage = fr24Res.flights.length > 0;
    for (const list of [adsbRes.flights, adsbFiRes.flights, openSkyRes.flights]) {
      for (const f of list) {
        const allowStandalone = !fr24HasCoverage || isFlaggedOrEmergency(f);
        absorbFlight(f, !allowStandalone);
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
      .slice(0, 50000);

    for (const f of flights) {
      recordFlightBreadcrumb(f);
      const history = flightTrailHistory.get(f.icao24 || f.id);
      if (history && history.length > 1) {
        f.trail = history.slice(-40);
      }
    }

    const providers: ProviderStatus[] = [
      fr24Res.status,
      adsbLaddRes.status,
      adsbMilRes.status,
      adsbFiRes.status,
      adsbRes.status,
      variFlightRes.status,
      airNavRes.status,
      openSkyRes.status,
    ];

    const payload: FlightsResponse = {
      flights,
      providers,
      fetchedAt: Date.now(),
      bounds: {lamin, lomin, lamax, lomax},
    };

    if (flights.length > 0) {
      flightsCache.set(key, {ts: Date.now(), data: payload});
    } else if (cached) {
      res.json({...cached.data, providers, fromServerCache: true});
      return;
    }

    res.json(payload);
  });

  // 1b. Approximate IP Geolocation Fallback
  router.get('/locate', async (req, res) => {
    try {
      const netlifyIp = String(req.headers['x-nf-client-connection-ip'] ?? '').trim();
      const fwd = netlifyIp || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      const target =
        fwd && !fwd.startsWith('127.') && !fwd.startsWith('10.') && !fwd.startsWith('::1')
          ? `https://ipwho.is/${encodeURIComponent(fwd)}`
          : 'https://ipwho.is/';
      const r = await fetch(target, {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
        signal: AbortSignal.timeout(2600),
      });
      const json = await safeJson<{success?: boolean; latitude?: number; longitude?: number; city?: string; country?: string}>(r);
      if (json && Number.isFinite(json.latitude) && Number.isFinite(json.longitude)) {
        res.json({
          lat: json.latitude,
          lon: json.longitude,
          city: json.city || '',
          country: json.country || '',
          source: 'ipwho.is',
        });
        return;
      }
    } catch {
      // ignore
    }
    res.status(204).end();
  });

  // 2. Live Flight Detail, Full Playback Trail, Departure/Arrival Terminal & Gate, Planespotters Photo & HexDB
  router.get('/flight-detail', async (req, res) => {
    const fr24Id = String(req.query.fr24Id ?? '');
    const icao24 = String(req.query.icao24 ?? '').toLowerCase();
    const callsign = String(req.query.callsign ?? '');
    const regParam = String(req.query.reg ?? '');
    const fnumParam = String(req.query.fnum ?? '');
    const origParam = String(req.query.orig ?? '');

    const icaoKey = icao24.toUpperCase();
    const cachedFlight = flightIndexMap.get(icaoKey) ?? flightIndexMap.get(fr24Id);
    const knownReg = regParam || cachedFlight?.registration || '';
    const knownFnum = fnumParam || cachedFlight?.flightNumber || '';
    const knownOrig = origParam || cachedFlight?.origin || '';

    const photoPromise = fetchPlanespottersPhoto(icao24, knownReg);
    const hexDbPromise = fetchHexDbAircraft(icao24);

    // 2a. FR24 Mobile Playback + Flight List + ADSBDB Callsign Lookup in parallel
    const playbackPromise = fr24Id
      ? fetch(`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${encodeURIComponent(fr24Id)}`, {
          headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'},
          signal: AbortSignal.timeout(2900),
        })
          .then((r) => safeJson<{result?: {response?: {data?: {flight?: Record<string, unknown>}}}}>(r))
          .catch(() => null)
      : Promise.resolve(null);

    const listQuery = knownFnum && knownFnum !== icaoKey ? knownFnum : knownReg;
    const listFetchBy = knownFnum && knownFnum !== icaoKey ? 'flight' : 'reg';
    const flightListPromise = listQuery
      ? fetch(
          `https://api.flightradar24.com/common/v1/flight/list.json?query=${encodeURIComponent(listQuery)}&fetchBy=${listFetchBy}&limit=6`,
          {
            headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'},
            signal: AbortSignal.timeout(2800),
          },
        )
          .then((r) => safeJson<{result?: {response?: {data?: Array<Record<string, unknown>>}}}>(r))
          .catch(() => null)
      : Promise.resolve(null);

    const adsbdbPromise =
      callsign && callsign !== icaoKey
        ? fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
            headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
            signal: AbortSignal.timeout(2500),
          })
            .then((r) => safeJson<{response?: {flightroute?: Record<string, unknown>}}>(r))
            .catch(() => null)
        : Promise.resolve(null);

    const recordedTrail = flightTrailHistory.get(icaoKey) ?? [];
    const adsbLolPromise = icao24
      ? fetch(`https://api.adsb.lol/v2/hex/${encodeURIComponent(icao24)}`, {
          headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
          signal: AbortSignal.timeout(2200),
        })
          .then((r) => safeJson<{ac?: Array<Record<string, unknown>>}>(r))
          .catch(() => null)
      : Promise.resolve(null);

    const adsbFiHexPromise = icao24
      ? fetch(`https://opendata.adsb.fi/api/v2/icao/${encodeURIComponent(icao24)}`, {
          headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
          signal: AbortSignal.timeout(2200),
        })
          .then((r) => safeJson<{ac?: Array<Record<string, unknown>>; aircraft?: Array<Record<string, unknown>>}>(r))
          .catch(() => null)
      : Promise.resolve(null);

    const fetchOpenSkyMeta = async (hex: string): Promise<Record<string, unknown> | null> => {
      if (!hex || hex.length < 4) return null;
      const hit = openSkyMetaCache.get(hex);
      if (hit && Date.now() - hit.ts < 86400_000) return hit.data;
      try {
        const r = await fetch(`https://opensky-network.org/api/metadata/aircraft/icao/${encodeURIComponent(hex)}`, {
          headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
          signal: AbortSignal.timeout(2200),
        });
        const j = r.ok ? ((await r.json()) as Record<string, unknown>) : null;
        if (openSkyMetaCache.size > 2000) {
          const oldest = openSkyMetaCache.keys().next().value;
          if (oldest) openSkyMetaCache.delete(oldest);
        }
        openSkyMetaCache.set(hex, {ts: Date.now(), data: j});
        return j;
      } catch {
        return null;
      }
    };

    const [pbJson, listJson, adsbdbJson, adsbJson, adsbFiJson, photo, hexDb, openSkyMeta, atcBoundaries, psMeta] = await Promise.all([
      playbackPromise,
      flightListPromise,
      adsbdbPromise,
      adsbLolPromise,
      adsbFiHexPromise,
      photoPromise,
      hexDbPromise,
      fetchOpenSkyMeta(icao24),
      getAtcBoundaries().catch(() => []),
      fetchPlanespottersAirframeMeta(icao24, knownReg).catch(() => ({})),
    ]);

    const pbFlight = pbJson?.result?.response?.data?.flight;
    const listItems = Array.isArray(listJson?.result?.response?.data) ? listJson.result.response.data : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const matchedListItem =
      listItems.find((item) => {
        const idObj = (item.identification ?? {}) as Record<string, unknown>;
        return fr24Id && String(idObj.id ?? '') === fr24Id;
      }) ??
      listItems.find((item) => Boolean((item.status as Record<string, unknown> | undefined)?.live)) ??
      listItems.find((item) => {
        const t = (item.time as Record<string, unknown> | undefined)?.scheduled as Record<string, unknown> | undefined;
        const dep = Number(t?.departure ?? 0);
        return dep > 0 && Math.abs(nowSec - dep) < 43200;
      }) ??
      listItems[0];

    const pbTrackRaw = Array.isArray(pbFlight?.track) ? (pbFlight.track as Array<Record<string, unknown>>) : [];
    const playbackTrail: TrailPoint[] = pbTrackRaw
      .filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
      .map((p) => ({
        lat: Number(p.latitude),
        lon: Number(p.longitude),
        altFt: Number((p.altitude as Record<string, unknown> | undefined)?.feet ?? 0),
        speedKts: Number((p.speed as Record<string, unknown> | undefined)?.kts ?? 0),
        trackDeg: Number(p.heading ?? 0),
        ts: Number(p.timestamp ?? 0),
      }));

    // Parse origin / destination / terminal / gate / times across FR24 playback + list + adsbdb
    const pbAp = (pbFlight?.airport ?? {}) as Record<string, unknown>;
    const pbOrig = (pbAp.origin ?? {}) as Record<string, unknown>;
    const pbOrigCode = (pbOrig.code ?? {}) as Record<string, unknown>;
    const pbOrigInfo = (pbOrig.info ?? {}) as Record<string, unknown>;
    const pbDest = (pbAp.destination ?? {}) as Record<string, unknown>;
    const pbDestCode = (pbDest.code ?? {}) as Record<string, unknown>;
    const pbDestInfo = (pbDest.info ?? {}) as Record<string, unknown>;

    const listAp = (matchedListItem?.airport ?? {}) as Record<string, unknown>;
    const listOrig = (listAp.origin ?? {}) as Record<string, unknown>;
    const listOrigCode = (listOrig.code ?? {}) as Record<string, unknown>;
    const listOrigInfo = (listOrig.info ?? {}) as Record<string, unknown>;
    const listDest = (listAp.destination ?? {}) as Record<string, unknown>;
    const listDestCode = (listDest.code ?? {}) as Record<string, unknown>;
    const listDestInfo = (listDest.info ?? {}) as Record<string, unknown>;

    const frRoute = (adsbdbJson?.response?.flightroute ?? {}) as Record<string, unknown>;
    const dbOrig = (frRoute.origin ?? {}) as Record<string, unknown>;
    const dbDest = (frRoute.destination ?? {}) as Record<string, unknown>;
    const dbAirline = (frRoute.airline ?? {}) as Record<string, unknown>;

    const pbIdent = (pbFlight?.identification ?? {}) as Record<string, unknown>;
    const pbNum = (pbIdent.number ?? {}) as Record<string, unknown>;
    const pbAc = (pbFlight?.aircraft ?? {}) as Record<string, unknown>;
    const pbAcModel = (pbAc.model ?? {}) as Record<string, unknown>;
    const pbAcIdent = (pbAc.identification ?? {}) as Record<string, unknown>;
    const pbAirline = (pbFlight?.airline ?? {}) as Record<string, unknown>;
    const pbAirlineCode = (pbAirline.code ?? {}) as Record<string, unknown>;
    const pbStatus = (pbFlight?.status ?? {}) as Record<string, unknown>;

    const listAc = (matchedListItem?.aircraft ?? {}) as Record<string, unknown>;
    const listTime = (matchedListItem?.time ?? {}) as Record<string, unknown>;
    const listSched = (listTime.scheduled ?? {}) as Record<string, unknown>;
    const listReal = (listTime.real ?? {}) as Record<string, unknown>;
    const listEst = (listTime.estimated ?? {}) as Record<string, unknown>;
    const listStatus = (matchedListItem?.status ?? {}) as Record<string, unknown>;

    const originIata = String(pbOrigCode.iata ?? listOrigCode.iata ?? dbOrig.iata_code ?? knownOrig ?? '');
    const destIata = String(pbDestCode.iata ?? listDestCode.iata ?? dbDest.iata_code ?? cachedFlight?.destination ?? '');
    const originCatalog = AIRPORT_CATALOG.find((a) => a.iata === originIata || a.icao === originIata);
    const destCatalog = AIRPORT_CATALOG.find((a) => a.iata === destIata || a.icao === destIata);

    let originTerminal = String(pbOrigInfo.terminal ?? listOrigInfo.terminal ?? '') || undefined;
    let originGate = String(pbOrigInfo.gate ?? listOrigInfo.gate ?? '') || undefined;
    let destTerminal = String(pbDestInfo.terminal ?? listDestInfo.terminal ?? '') || undefined;
    let destGate = String(pbDestInfo.gate ?? listDestInfo.gate ?? '') || undefined;
    let destBaggage = String(pbDestInfo.baggage ?? listDestInfo.baggage ?? '') || undefined;
    let scheduledDep = Number(listSched.departure ?? 0) || undefined;
    let actualDep = Number(listReal.departure ?? 0) || undefined;
    let scheduledArr = Number(listSched.arrival ?? 0) || undefined;
    let estimatedArr = Number(listEst.arrival ?? 0) || undefined;

    // Enrich missing departure terminal/gate directly from origin airport's live schedule board
    if (originIata && (!originTerminal || !originGate)) {
      const originBoard = await fetchFr24AirportBoard(originIata).catch(() => null);
      if (originBoard) {
        const upperFnum = (knownFnum || String(pbNum.default ?? '')).toUpperCase();
        const upperReg = knownReg.toUpperCase();
        const matchDep = originBoard.departures.find(
          (d) =>
            (upperFnum && d.flightNumber.toUpperCase() === upperFnum) ||
            (upperReg && d.registration.toUpperCase() === upperReg) ||
            (icaoKey && d.icao24 === icaoKey),
        );
        if (matchDep) {
          if (!originTerminal && matchDep.terminal) originTerminal = matchDep.terminal;
          if (!originGate && matchDep.gate) originGate = matchDep.gate;
          if (!scheduledDep && matchDep.scheduledTime) scheduledDep = matchDep.scheduledTime;
          if (!actualDep && (matchDep.actualTime || matchDep.estimatedTime)) {
            actualDep = matchDep.actualTime ?? matchDep.estimatedTime;
          }
        }
      }
    }

    const adsbMeta = adsbJson?.ac?.[0] ?? adsbFiJson?.ac?.[0] ?? adsbFiJson?.aircraft?.[0] ?? null;
    const resolvedSquawk = String(adsbMeta?.squawk ?? cachedFlight?.squawk ?? '') || undefined;
    if (resolvedSquawk && cachedFlight && !cachedFlight.squawk) {
      cachedFlight.squawk = resolvedSquawk;
    }
    const bestTrail = playbackTrail.length >= recordedTrail.length ? playbackTrail : recordedTrail;
    const resolvedReg = String(pbAcIdent.registration ?? listAc.registration ?? adsbMeta?.r ?? hexDb?.Registration ?? knownReg);
    const ageText =
      (psMeta && 'age' in psMeta ? psMeta.age : undefined) ||
      (listAc.age && typeof listAc.age === 'object' && (listAc.age as Record<string, unknown>).availability === false
        ? undefined
        : typeof listAc.age === 'string' || typeof listAc.age === 'number'
          ? String(listAc.age)
          : openSkyMeta?.built
            ? `${Math.max(0, new Date().getUTCFullYear() - Number(String(openSkyMeta.built).slice(0, 4)))} yrs`
            : undefined);

    const acCode = String(
      pbAcModel.code ?? adsbMeta?.t ?? hexDb?.ICAOTypeCode ?? openSkyMeta?.typecode ?? cachedFlight?.aircraftType ?? '',
    ).toUpperCase();
    const serialNumber =
      String(
        (psMeta && 'msn' in psMeta ? psMeta.msn : undefined) ??
          (listAc.msn as string) ??
          (pbAcIdent.serialNo as string) ??
          (openSkyMeta?.serialnumber as string) ??
          (hexDb?.SerialNumber as string) ??
          '',
      ).trim() || undefined;

    const adsbCatCode = String(adsbMeta?.category ?? openSkyMeta?.categoryDescription ?? '').toUpperCase();
    const derivedCategory = (() => {
      if (adsbCatCode === 'A7' || acCode.startsWith('EC') || acCode.startsWith('H60') || acCode === 'R44' || acCode === 'B06' || acCode === 'S76') {
        return 'Helicopter';
      }
      if (cachedFlight?.isMilitary || /C17|C130|KC135|KC46|F16|F15|F35|F22|P8|E3|B52|TYPH|A400/.test(acCode)) {
        return 'Military';
      }
      if (/F$|FR|74F|77F|76F|MD11|A306/.test(acCode) || /CARGO|FREIGHT|FEDEX|UPS|DHL|ATLAS/.test(String(pbAirline.name ?? cachedFlight?.airlineName ?? '').toUpperCase())) {
        return 'Cargo';
      }
      if (/GLEX|GLF|GL7T|C56X|C680|CL35|CL60|E55P|FA7X|FA8X|PC12|PC24|LJ|HDJT/.test(acCode)) {
        return 'Business Jet';
      }
      if (adsbCatCode === 'A5') return 'Heavy Passenger';
      if (adsbCatCode === 'A4') return 'High Vortex Large';
      if (adsbCatCode === 'A3' || acCode) return 'Passenger';
      if (adsbCatCode === 'A2') return 'Regional / Small';
      if (adsbCatCode === 'A1') return 'Light Aircraft';
      return 'Passenger';
    })();

    const countryFromReg = (reg: string): string | undefined => {
      const r = reg.toUpperCase();
      if (/^N[0-9]/.test(r)) return 'United States';
      if (/^C-/.test(r)) return 'Canada';
      if (/^G-/.test(r)) return 'United Kingdom';
      if (/^D-/.test(r)) return 'Germany';
      if (/^F-/.test(r)) return 'France';
      if (/^B-/.test(r)) return 'China / Taiwan';
      if (/^JA/.test(r)) return 'Japan';
      if (/^HL/.test(r)) return 'South Korea';
      if (/^VH-/.test(r)) return 'Australia';
      if (/^ZK-/.test(r)) return 'New Zealand';
      if (/^VT-/.test(r)) return 'India';
      if (/^A6-/.test(r)) return 'United Arab Emirates';
      if (/^A7-/.test(r)) return 'Qatar';
      if (/^9V-/.test(r)) return 'Singapore';
      if (/^TC-/.test(r)) return 'Turkey';
      if (/^PH-/.test(r)) return 'Netherlands';
      if (/^HB-/.test(r)) return 'Switzerland';
      if (/^EI-/.test(r)) return 'Ireland';
      if (/^EC-/.test(r)) return 'Spain';
      if (/^I-/.test(r)) return 'Italy';
      if (/^SE-/.test(r)) return 'Sweden';
      if (/^LN-/.test(r)) return 'Norway';
      if (/^OY-/.test(r)) return 'Denmark';
      if (/^OH-/.test(r)) return 'Finland';
      if (/^SP-/.test(r)) return 'Poland';
      if (/^PR-|^PP-|^PT-/.test(r)) return 'Brazil';
      if (/^XA-|^XB-|^XC-/.test(r)) return 'Mexico';
      if (/^9M-/.test(r)) return 'Malaysia';
      if (/^HS-/.test(r)) return 'Thailand';
      if (/^PK-/.test(r)) return 'Indonesia';
      if (/^ZS-/.test(r)) return 'South Africa';
      if (/^HZ-/.test(r)) return 'Saudi Arabia';
      if (/^4X-/.test(r)) return 'Israel';
      return undefined;
    };

    const countryOfReg =
      String((pbAcIdent.country as string) ?? (openSkyMeta?.country as string) ?? '').trim() ||
      countryFromReg(resolvedReg);

    const rawBaro = adsbMeta?.alt_baro;
    const altBaroFt =
      rawBaro === 'ground'
        ? 0
        : Number.isFinite(Number(rawBaro))
          ? Math.round(Number(rawBaro))
          : cachedFlight?.altitudeFt;
    const altGeomFt = Number.isFinite(Number(adsbMeta?.alt_geom))
      ? Math.round(Number(adsbMeta?.alt_geom))
      : altBaroFt !== undefined && altBaroFt > 0
        ? Math.round(altBaroFt + 280)
        : altBaroFt;
    const verticalRateFpm = Number.isFinite(Number(adsbMeta?.baro_rate ?? adsbMeta?.geom_rate))
      ? Math.round(Number(adsbMeta?.baro_rate ?? adsbMeta?.geom_rate))
      : cachedFlight?.verticalRateFpm;
    const trackDeg = Number.isFinite(Number(adsbMeta?.track))
      ? Math.round(Number(adsbMeta?.track))
      : cachedFlight?.trueTrackDeg;
    const groundSpeedKts = Number.isFinite(Number(adsbMeta?.gs))
      ? Math.round(Number(adsbMeta?.gs))
      : cachedFlight?.groundSpeedKts;

    const altM = Math.max(0, (altBaroFt ?? 0) * 0.3048);
    const tempK = Math.max(216.65, 288.15 - 0.0065 * Math.min(11000, altM));
    const speedOfSoundKts = 661.47 * Math.sqrt(tempK / 288.15);
    const densityRatio = Math.pow(tempK / 288.15, 4.256) * (288.15 / tempK);

    const tasKts = Number.isFinite(Number(adsbMeta?.tas))
      ? Math.round(Number(adsbMeta?.tas))
      : groundSpeedKts !== undefined
        ? Math.round(groundSpeedKts)
        : undefined;
    const iasKts = Number.isFinite(Number(adsbMeta?.ias))
      ? Math.round(Number(adsbMeta?.ias))
      : tasKts !== undefined
        ? Math.round(tasKts * Math.sqrt(Math.max(0.18, densityRatio)))
        : undefined;
    const mach = Number.isFinite(Number(adsbMeta?.mach))
      ? Number(Number(adsbMeta?.mach).toFixed(3))
      : tasKts !== undefined && (altBaroFt ?? 0) > 10000
        ? Number((tasKts / speedOfSoundKts).toFixed(3))
        : undefined;

    const fLat = Number(adsbMeta?.lat ?? cachedFlight?.lat);
    const fLon = Number(adsbMeta?.lon ?? cachedFlight?.lon);
    let firUir: string | undefined;
    if (Number.isFinite(fLat) && Number.isFinite(fLon) && Array.isArray(atcBoundaries)) {
      const pointInRing = (lat: number, lon: number, ring: Array<[number, number]>) => {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const yi = ring[i][0], xi = ring[i][1];
          const yj = ring[j][0], xj = ring[j][1];
          if (Math.abs(xi - xj) > 180) continue;
          const intersect = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-9) + xi;
          if (intersect) inside = !inside;
        }
        return inside;
      };
      const hitFir = atcBoundaries.find((fir) => fir.rings.some((ring) => pointInRing(fLat, fLon, ring)));
      if (hitFir) {
        firUir = `${hitFir.id} (${hitFir.name})`;
      }
    }

    res.json({
      id: fr24Id || icaoKey || callsign,
      callsign: String(pbIdent.callsign ?? adsbMeta?.flight ?? cachedFlight?.callsign ?? callsign).trim().toUpperCase(),
      flightNumber: String(pbNum.default ?? frRoute.callsign_iata ?? cachedFlight?.flightNumber ?? callsign),
      registration: resolvedReg,
      squawk: resolvedSquawk,
      aircraftModel: String(pbAcModel.text ?? adsbMeta?.desc ?? hexDb?.Type ?? openSkyMeta?.model ?? pbAcModel.code ?? cachedFlight?.aircraftType ?? ''),
      aircraftCode: acCode,
      manufacturer: String(hexDb?.Manufacturer ?? openSkyMeta?.manufacturerName ?? '') || undefined,
      registeredOwner: String(adsbMeta?.ownOp ?? hexDb?.RegisteredOwners ?? openSkyMeta?.owner ?? openSkyMeta?.operator ?? '') || undefined,
      aircraftAge: ageText,
      serialNumber,
      category: derivedCategory,
      countryOfReg,
      altBaroFt,
      altGeomFt,
      verticalRateFpm,
      trackDeg,
      groundSpeedKts,
      tasKts,
      iasKts,
      mach,
      firUir,
      airlineName: String(pbAirline.name ?? dbAirline.name ?? adsbMeta?.ownOp ?? hexDb?.RegisteredOwners ?? openSkyMeta?.operator ?? cachedFlight?.airlineName ?? ''),
      airlineIcao: String(pbAirlineCode.icao ?? dbAirline.icao ?? cachedFlight?.airlineIcao ?? airlineIcaoFromCallsign(callsign)),
      airlineLogo: undefined,
      originIata,
      originIcao: String(pbOrigCode.icao ?? listOrigCode.icao ?? dbOrig.icao_code ?? originCatalog?.icao ?? ''),
      originName: String(pbOrig.name ?? listOrig.name ?? dbOrig.name ?? originCatalog?.name ?? (originIata ? `${originIata} Airport` : '')),
      originTerminal,
      originGate,
      destinationIata: destIata,
      destinationIcao: String(pbDestCode.icao ?? listDestCode.icao ?? dbDest.icao_code ?? destCatalog?.icao ?? ''),
      destinationName: String(pbDest.name ?? listDest.name ?? dbDest.name ?? destCatalog?.name ?? (destIata ? `${destIata} Airport` : '')),
      destTerminal,
      destGate,
      destBaggage,
      scheduledDep,
      actualDep,
      scheduledArr,
      estimatedArr,
      statusText: String(pbStatus.text ?? listStatus.text ?? (cachedFlight?.onGround ? 'SURFACE TAXI' : 'ENROUTE LIVE')),
      photo,
      trail: bestTrail,
      source: playbackTrail.length > 0 ? 'fr24-playback' : cachedFlight?.source ?? 'adsb',
    } satisfies FlightDetail);
  });

  // 2b. Live Airport Arrivals, Departures & Delay Index Board
  router.get('/airport-board', async (req, res) => {
    const code = String(req.query.code ?? '').trim().toUpperCase();
    const icao = String(req.query.icao ?? '').trim().toUpperCase();
    if (!code && !icao) {
      res.status(400).json({error: 'Missing airport code or icao'});
      return;
    }

    const board = await fetchFr24AirportBoard(code || icao, icao);
    if (board) {
      res.json(board);
      return;
    }

    // Fallback to global directory / catalog + live ADS-B traffic index
    const catalog = AIRPORT_CATALOG.find((a) => a.iata === code || a.icao === icao || a.icao === code);
    const allAirports = await getGlobalAirports();
    const dirMatch = allAirports.find(
      (a) => (iataMatch(a.iata, code) || a.icao === icao || a.icao === code),
    );
    const iata = catalog?.iata ?? dirMatch?.iata ?? code;
    const resolvedIcao = catalog?.icao ?? dirMatch?.icao ?? (icao || code);

    function iataMatch(aIata: string, target: string) {
      return Boolean(target && aIata && aIata === target);
    }

    const nearbyFlights = Array.from(flightIndexMap.values());
    const arrivals: AirportBoardFlight[] = nearbyFlights
      .filter((f) => (iata && f.destination === iata) || f.destination === resolvedIcao)
      .slice(0, 60)
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
        destinationName: catalog?.name ?? dirMatch?.name ?? (iata || resolvedIcao),
        aircraftCode: f.aircraftType,
        aircraftModel: f.aircraftType,
        registration: f.registration,
        icao24: f.icao24,
        statusText: f.onGround ? 'Arrived' : 'Enroute Inbound',
        statusColor: 'green',
        isDelayed: false,
        isLive: true,
      }));
    const departures: AirportBoardFlight[] = nearbyFlights
      .filter((f) => (iata && f.origin === iata) || f.origin === resolvedIcao)
      .slice(0, 60)
      .map((f) => ({
        id: f.id,
        callsign: f.callsign,
        flightNumber: f.flightNumber,
        airlineName: f.airlineName,
        airlineIcao: f.airlineIcao,
        originIata: iata,
        originIcao: resolvedIcao,
        originName: catalog?.name ?? dirMatch?.name ?? (iata || resolvedIcao),
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

    const fallbackLat = catalog?.lat ?? dirMatch?.lat ?? 0;
    const fallbackLon = catalog?.lon ?? dirMatch?.lon ?? 0;
    const resolvedTz = resolveTimezoneByCoordsAndCode({
      icao: resolvedIcao,
      iata,
      lat: fallbackLat,
      lon: fallbackLon,
    });

    res.json({
      icao: resolvedIcao,
      iata,
      name: catalog?.name ?? dirMatch?.name ?? `${iata || resolvedIcao} Airport`,
      city: catalog?.city ?? dirMatch?.city ?? '',
      country: catalog?.country ?? dirMatch?.country ?? '',
      lat: fallbackLat,
      lon: fallbackLon,
      timezoneName: resolvedTz.timezoneName,
      utcOffsetSec: resolvedTz.utcOffsetSec,
      timezoneAbbr: resolvedTz.timezoneAbbr,
      delayIndex: computeDelaySummaryFromRows(departures, arrivals, null),
      arrivals,
      departures,
      fetchedAt: Date.now(),
      source: 'adsb-fallback',
    } satisfies AirportBoardResponse);
  });

  // 2e. Aviation Safety Network (ASN) Registration Incident & Accident Records
  router.get('/safety-record', async (req, res) => {
    const registration = String(req.query.registration ?? req.query.reg ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');
    if (!registration) {
      res.status(400).json({error: 'Missing registration'});
      return;
    }

    const searchUrl = `https://aviation-safety.net/database/registration/regsearch.php?regi=${encodeURIComponent(registration)}`;
    const cached = safetyRecordCache.get(registration);
    if (cached && Date.now() - cached.ts < 3600000) {
      res.json(cached.data);
      return;
    }

    const stripTags = (s: string) =>
      s
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
        .replace(/\s+/g, ' ')
        .trim();

    const items: SafetyRecordItem[] = [];
    let note: string | undefined;

    try {
      const asnRes = await fetch(searchUrl, {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: 'https://aviation-safety.net/database/registration/',
        },
        signal: AbortSignal.timeout(5500),
      });
      if (!asnRes.ok) {
        note = `ASN HTTP ${asnRes.status}`;
      } else {
        const html = await asnRes.text();
        if (/just a moment|cloudflare|cf-challenge/i.test(html) && !html.includes('wikibase') && !html.includes('<table')) {
          note = 'ASN browser verification active — click View ASN Record';
        } else {
          const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let m: RegExpExecArray | null;
          while ((m = rowRegex.exec(html)) !== null) {
            const rowHtml = m[1];
            if (/<th\b/i.test(rowHtml)) continue;
            const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]);
            if (cells.length < 4) continue;
            const hrefMatch = rowHtml.match(/href=["']([^"']*(?:wikibase|database\/record)[^"']*)["']/i);
            const hrefRaw = hrefMatch ? hrefMatch[1] : '';
            const href = hrefRaw
              ? hrefRaw.startsWith('http')
                ? hrefRaw
                : `https://aviation-safety.net${hrefRaw.startsWith('/') ? '' : '/'}${hrefRaw}`
              : searchUrl;
            const dateText = stripTags(cells[0]);
            if (!dateText || !/\d{4}/.test(dateText)) continue;
            items.push({
              date: dateText,
              type: stripTags(cells[1] ?? ''),
              operator: stripTags(cells[3] ?? cells[2] ?? ''),
              fatalities: stripTags(cells[4] ?? '0'),
              location: stripTags(cells[5] ?? ''),
              damage: stripTags(cells[7] ?? cells[6] ?? ''),
              href,
            });
          }
        }
      }
    } catch (err) {
      note = err instanceof Error ? err.message : 'ASN lookup timeout';
    }

    const payload: SafetyRecordResponse = {
      registration,
      items: items.slice(0, 30),
      searchUrl,
      source: 'aviation-safety.net',
      fetchedAt: Date.now(),
      note,
    };
    safetyRecordCache.set(registration, {ts: Date.now(), data: payload});
    res.json(payload);
  });

  // 2f. Past Flights Lookup by Flight Number or Aircraft Tail Registration
  router.get('/past-flights', async (req, res) => {
    const rawQuery = String(req.query.query ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const icao24Param = String(req.query.icao24 ?? '').trim().toUpperCase();
    if (!rawQuery && !icao24Param) {
      res.status(400).json({error: 'Missing query'});
      return;
    }

    const cacheKey = `${rawQuery}|${icao24Param}`;
    const cached = pastFlightsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 120000) {
      res.json({query: rawQuery, items: cached.items, fetchedAt: Date.now(), cached: true});
      return;
    }

    const isReg = /-/.test(rawQuery) || /^[BNVGDF][A-Z0-9]{3,}$/.test(rawQuery);
    const items: PastFlightRecord[] = [];
    const seen = new Set<string>();

    const fr24Promise = (async () => {
      if (!rawQuery) return;
      const modes = isReg ? ['reg', 'flight'] : ['flight', 'reg'];
      for (const fetchBy of modes) {
        try {
          const url = `https://api.flightradar24.com/common/v1/flight/list.json?fetchBy=${fetchBy}&page=1&limit=16&query=${encodeURIComponent(rawQuery)}`;
          const r = await fetch(url, {
            headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'},
            signal: AbortSignal.timeout(4800),
          });
          const json = await safeJson<{result?: {response?: {data?: Array<Record<string, unknown>>}}}>(r);
          const rows = json?.result?.response?.data ?? [];
          for (const row of rows) {
            const ident = (row.identification ?? {}) as Record<string, unknown>;
            const num = (ident.number ?? {}) as Record<string, unknown>;
            const ap = (row.airport ?? {}) as Record<string, unknown>;
            const orig = (ap.origin ?? {}) as Record<string, unknown>;
            const dest = (ap.destination ?? {}) as Record<string, unknown>;
            const origCode = (orig.code ?? {}) as Record<string, unknown>;
            const destCode = (dest.code ?? {}) as Record<string, unknown>;
            const ac = (row.aircraft ?? {}) as Record<string, unknown>;
            const acModel = (ac.model ?? {}) as Record<string, unknown>;
            const timeObj = (row.time ?? {}) as Record<string, unknown>;
            const sched = (timeObj.scheduled ?? {}) as Record<string, unknown>;
            const real = (timeObj.real ?? {}) as Record<string, unknown>;
            const statusObj = (row.status ?? {}) as Record<string, unknown>;
            const fnum = String(num.default ?? ident.callsign ?? rawQuery).toUpperCase();
            const depTs = Number(real.departure ?? sched.departure ?? 0) || undefined;
            const id = String(ident.id ?? `${fnum}-${depTs ?? items.length}`);
            if (seen.has(id)) continue;
            seen.add(id);
            items.push({
              id,
              flightNumber: fnum,
              callsign: String(ident.callsign ?? fnum).toUpperCase(),
              registration: String(ac.registration ?? (isReg ? rawQuery : '')),
              originIata: String(origCode.iata ?? '').toUpperCase(),
              originIcao: String(origCode.icao ?? '').toUpperCase(),
              originName: String(orig.name ?? ''),
              destinationIata: String(destCode.iata ?? '').toUpperCase(),
              destinationIcao: String(destCode.icao ?? '').toUpperCase(),
              destinationName: String(dest.name ?? ''),
              scheduledDep: Number(sched.departure ?? 0) || undefined,
              actualDep: Number(real.departure ?? 0) || undefined,
              scheduledArr: Number(sched.arrival ?? 0) || undefined,
              actualArr: Number(real.arrival ?? 0) || undefined,
              statusText: String(statusObj.text ?? 'Completed'),
              aircraftCode: String(acModel.code ?? ''),
              source: 'fr24-history',
            });
          }
          if (items.length > 0) break;
        } catch {
          // continue
        }
      }
    })();

    const openSkyPromise = (async () => {
      let hex = icao24Param.toLowerCase();
      if (!hex && rawQuery) {
        const match = Array.from(flightIndexMap.values()).find(
          (f) =>
            f.registration.toUpperCase() === rawQuery ||
            f.callsign.toUpperCase() === rawQuery ||
            f.flightNumber.toUpperCase() === rawQuery,
        );
        if (match?.icao24) hex = match.icao24.toLowerCase();
      }
      if (!hex) return;
      try {
        const endSec = Math.floor(Date.now() / 1000);
        const beginSec = endSec - 7 * 86400;
        const r = await fetch(
          `https://opensky-network.org/api/flights/aircraft?icao24=${encodeURIComponent(hex)}&begin=${beginSec}&end=${endSec}`,
          {headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'}, signal: AbortSignal.timeout(4500)},
        );
        const rows = (await safeJson<Array<Record<string, unknown>>>(r)) ?? [];
        for (const row of rows.slice(0, 12)) {
          const cs = String(row.callsign ?? hex).trim().toUpperCase();
          const firstSeen = Number(row.firstSeen ?? 0) || undefined;
          const lastSeen = Number(row.lastSeen ?? 0) || undefined;
          const id = `os-${hex}-${firstSeen ?? items.length}`;
          if (seen.has(id)) continue;
          seen.add(id);
          items.push({
            id,
            flightNumber: cs,
            callsign: cs,
            registration: isReg ? rawQuery : '',
            originIata: '',
            originIcao: String(row.estDepartureAirport ?? '').toUpperCase(),
            originName: String(row.estDepartureAirport ?? ''),
            destinationIata: '',
            destinationIcao: String(row.estArrivalAirport ?? '').toUpperCase(),
            destinationName: String(row.estArrivalAirport ?? ''),
            scheduledDep: firstSeen,
            actualDep: firstSeen,
            scheduledArr: lastSeen,
            actualArr: lastSeen,
            statusText: 'Recorded Track',
            aircraftCode: '',
            source: 'opensky-log',
          });
        }
      } catch {
        // optional
      }
    })();

    await Promise.all([fr24Promise, openSkyPromise]);
    items.sort((a, b) => (b.actualDep ?? b.scheduledDep ?? 0) - (a.actualDep ?? a.scheduledDep ?? 0));
    pastFlightsCache.set(cacheKey, {ts: Date.now(), items});
    res.json({query: rawQuery || icao24Param, items: items.slice(0, 24), fetchedAt: Date.now()});
  });

  // 2g. Flight Playback Track for Historical Flights
  router.get('/flight-playback', async (req, res) => {
    const flightId = String(req.query.flightId ?? '').trim();
    const icao24 = String(req.query.icao24 ?? '').trim().toLowerCase();
    const timeSec = Number.parseInt(String(req.query.time ?? '0'), 10) || 0;
    const trail: TrailPoint[] = [];
    let source = 'unavailable';

    if (flightId && !flightId.startsWith('os-') && !flightId.startsWith('live-')) {
      try {
        const r = await fetch(
          `https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${encodeURIComponent(flightId)}`,
          {headers: {'User-Agent': FR24_MOBILE_UA, Accept: 'application/json'}, signal: AbortSignal.timeout(6500)},
        );
        const json = await safeJson<{
          result?: {
            response?: {
              data?: {
                flight?: {
                  track?: Array<{
                    latitude?: number;
                    longitude?: number;
                    altitude?: {feet?: number};
                    speed?: {kts?: number};
                    heading?: number;
                    timestamp?: number;
                  }>;
                };
              };
            };
          };
        }>(r);
        const pts = json?.result?.response?.data?.flight?.track ?? [];
        for (const p of pts) {
          if (!Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))) continue;
          trail.push({
            lat: Number(p.latitude),
            lon: Number(p.longitude),
            altFt: Math.max(0, Math.round(Number(p.altitude?.feet ?? 0) || 0)),
            speedKts: Math.max(0, Math.round(Number(p.speed?.kts ?? 0) || 0)),
            trackDeg: Math.round(Number(p.heading ?? 0) || 0),
            ts: Number(p.timestamp ?? 0) || 0,
          });
        }
        if (trail.length > 0) source = 'fr24-playback';
      } catch {
        // fallback below
      }
    }

    if (trail.length === 0 && icao24) {
      try {
        const r = await fetch(
          `https://opensky-network.org/api/tracks/all?icao24=${encodeURIComponent(icao24)}&time=${timeSec || 0}`,
          {headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'}, signal: AbortSignal.timeout(5500)},
        );
        const json = await safeJson<{
          path?: Array<[number, number | null, number | null, number | null, number | null, boolean?]>;
        }>(r);
        for (const wp of json?.path ?? []) {
          if (wp[1] == null || wp[2] == null) continue;
          trail.push({
            lat: wp[1],
            lon: wp[2],
            altFt: Math.max(0, Math.round((wp[3] ?? 0) * 3.28084)),
            speedKts: 0,
            trackDeg: Math.round(wp[4] ?? 0),
            ts: wp[0] ?? 0,
          });
        }
        if (trail.length > 0) source = 'opensky-track';
      } catch {
        // unavailable
      }
    }

    res.json({flightId: flightId || icao24, trail, source});
  });

  // 2c. Global Airports within Radar Viewport (All Airports)
  router.get('/airports', async (req, res) => {
    const lamin = Number(req.query.lamin ?? -85);
    const lomin = Number(req.query.lomin ?? -180);
    const lamax = Number(req.query.lamax ?? 85);
    const lomax = Number(req.query.lomax ?? 180);
    const zoom = Number(req.query.zoom ?? 6);
    const maxTier = zoom >= 8.2 ? 3 : zoom >= 5.2 ? 2 : 1;
    const cLat = (lamin + lamax) * 0.5;
    const cLon = (lomin + lomax) * 0.5;

    const all = await getGlobalAirports();
    const inBox = all
      .filter(
        (a) =>
          a.tier <= maxTier &&
          a.lat >= lamin &&
          a.lat <= lamax &&
          a.lon >= lomin &&
          a.lon <= lomax,
      )
      .sort((a, b) => {
        if (zoom >= 7.5) {
          const scoreA = a.tier * 0.35 + Math.hypot(a.lat - cLat, a.lon - cLon);
          const scoreB = b.tier * 0.35 + Math.hypot(b.lat - cLat, b.lon - cLon);
          if (Math.abs(scoreA - scoreB) > 1e-4) return scoreA - scoreB;
        } else if (a.tier !== b.tier) {
          return a.tier - b.tier;
        }
        if (Boolean(a.iata) !== Boolean(b.iata)) return a.iata ? -1 : 1;
        return a.icao.localeCompare(b.icao);
      })
      .slice(0, 1500);

    res.json({airports: inBox, maxTier, totalInViewport: inBox.length});
  });

  const surfaceInFlight = new Map<string, Promise<AirfieldSurfaceData>>();
  let overpassActiveCount = 0;
  const overpassWaitQueue: Array<() => void> = [];
  const acquireOverpassSlot = async () => {
    if (overpassActiveCount < 2) {
      overpassActiveCount++;
      return;
    }
    await new Promise<void>((resolve) => overpassWaitQueue.push(resolve));
    overpassActiveCount++;
  };
  const releaseOverpassSlot = () => {
    overpassActiveCount = Math.max(0, overpassActiveCount - 1);
    const next = overpassWaitQueue.shift();
    if (next) next();
  };
  let serverOverpassCursor = 0;
  const serverMirrorCooldowns = new Map<string, number>();

  // 2d. Detailed Vectorized Airfield Surface (OSM Terminals, Aprons, Stands & Taxiways + Collinear Runway Alignment)
  router.get('/surface', async (req, res) => {
    const rawCode = String(req.query.icao ?? '').trim().toUpperCase();
    const catalog = AIRPORT_CATALOG.find((a) => a.icao === rawCode || a.iata === rawCode);
    let lat = Number(req.query.lat ?? catalog?.lat ?? 0);
    let lon = Number(req.query.lon ?? catalog?.lon ?? 0);
    let icao = catalog?.icao ?? rawCode;
    let iata = catalog?.iata ?? '';

    if ((!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) && rawCode) {
      const allAirports = await getGlobalAirports();
      const dirMatch = allAirports.find(
        (a) => a.icao.toUpperCase() === rawCode || (Boolean(a.iata) && a.iata.toUpperCase() === rawCode),
      );
      if (dirMatch) {
        lat = dirMatch.lat;
        lon = dirMatch.lon;
        icao = dirMatch.icao;
        iata = dirMatch.iata;
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
      res.status(400).json({error: 'Missing coordinates or airport ICAO'});
      return;
    }

    const cacheKey = icao || `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const cached = surfaceCache.get(cacheKey);
    const hasOsmContent =
      cached &&
      cached.data.source === 'osm-overpass' &&
      (cached.data.taxiways.length > 0 ||
        cached.data.runways.length > 0 ||
        cached.data.aprons.length > 0 ||
        (cached.data.terminals?.length ?? 0) > 0);
    const cacheTtlMs = hasOsmContent ? 86400000 : 12000;
    if (cached && Date.now() - cached.ts < cacheTtlMs) {
      res.json(cached.data);
      return;
    }

    const existingFlight = surfaceInFlight.get(cacheKey);
    if (existingFlight) {
      res.json(await existingFlight);
      return;
    }

    const jobPromise = (async (): Promise<AirfieldSurfaceData> => {
      let aprons: Array<Array<[number, number]>> = [];
      let labeledAprons: AirfieldPolygonFeature[] = [];
      let terminals: AirfieldPolygonFeature[] = [];
      let stands: AirfieldStandFeature[] = [];
      let holdingPositions: NonNullable<AirfieldSurfaceData['holdingPositions']> = [];
      let osmRunways: TaxiwaySegment[] = [];
      let taxiways: TaxiwaySegment[] = [];
      let gates: AirfieldSurfaceGate[] = [];
      let osmSucceeded = false;

      const osmPromise = (async () => {
        const q = buildOverpassAirfieldQuery(lat, lon);
        await acquireOverpassSlot();
        try {
          const total = GLOBAL_OVERPASS_MIRRORS.length;
          const startIdx = serverOverpassCursor++ % total;
          for (let attempt = 0; attempt < total; attempt++) {
            const endpoint = GLOBAL_OVERPASS_MIRRORS[(startIdx + attempt) % total];
            const cooldownUntil = serverMirrorCooldowns.get(endpoint) ?? 0;
            if (Date.now() < cooldownUntil) continue;
            try {
              const osmRes = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Accept: 'application/json',
                  'User-Agent': API_USER_AGENT,
                },
                body: `data=${encodeURIComponent(q)}`,
                signal: AbortSignal.timeout(9500),
              });
              if (osmRes.status === 429 || osmRes.status === 504) {
                serverMirrorCooldowns.set(endpoint, Date.now() + 25_000);
                continue;
              }
              if (!osmRes.ok) continue;
              const parsedJson = (await osmRes.json()) as {elements?: OverpassElement[]};
              if (!Array.isArray(parsedJson.elements) || parsedJson.elements.length === 0) {
                continue;
              }
              const parsed = parseOverpassAirfieldElements(parsedJson.elements);
              osmRunways = parsed.osmRunways;
              taxiways = parsed.taxiways.slice(0, 6500);
              aprons = parsed.aprons;
              labeledAprons = parsed.labeledAprons;
              terminals = parsed.terminals;
              stands = parsed.stands;
              holdingPositions = parsed.holdingPositions;
              gates = parsed.gates;
              osmSucceeded =
                osmRunways.length > 0 || taxiways.length > 0 || aprons.length > 0 || terminals.length > 0;
              if (osmSucceeded) break;
            } catch {
              // rotate cleanly to next mirror
            }
          }
        } finally {
          releaseOverpassSlot();
        }
      })();

      // Warm global runways CSV asynchronously; never block OSM response for 4.5s
      const aipWarmPromise = getGlobalRunwaysByAirport().catch(() => new Map<string, AipRunwayEntry[]>());
      await osmPromise;
      let aipMap = globalRunwaysCache?.byAirport;
      if (!aipMap || aipMap.size === 0) {
        if (osmRunways.length === 0) {
          aipMap = await Promise.race([
            aipWarmPromise,
            new Promise<Map<string, AipRunwayEntry[]>>((resolve) =>
              setTimeout(() => resolve(new Map()), 900),
            ),
          ]);
        } else {
          aipMap = new Map<string, AipRunwayEntry[]>();
        }
      }

      const lookupIdents = [catalog?.icao, icao].filter(Boolean) as string[];
      let aipRunways: AipRunwayEntry[] = [];
      for (const ident of lookupIdents) {
        const found = aipMap.get(ident);
        if (found && found.length > 0) {
          aipRunways = found;
          break;
        }
      }

      let runways = mergeAndAlignRunways(
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

      if (runways.length === 0) {
        const curated = buildCuratedSeedSurface(catalog?.icao ?? icao);
        if (curated.length > 0) {
          runways = curated;
        } else if (catalog) {
          catalog.runways.forEach((r, idx) => {
            const rad = (r.headingDeg * Math.PI) / 180;
            const halfLenDeg = (r.lengthFt / 6076 / 60) * 0.5;
            const cosLat = Math.cos((catalog.lat * Math.PI) / 180);
            const offsetLon = (idx - (catalog.runways.length - 1) / 2) * 0.0024;
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
      }

      runways = applyDisplacedThresholds(catalog?.icao ?? icao, runways);

      const result: AirfieldSurfaceData = {
        icao: catalog?.icao ?? icao,
        iata: catalog?.iata ?? iata,
        lat,
        lon,
        aprons,
        labeledAprons,
        terminals,
        stands,
        holdingPositions,
        runways,
        taxiways,
        gates,
        source: osmSucceeded ? 'osm-overpass' : 'catalog',
      };
      if (osmSucceeded || !cached || cached.data.source !== 'osm-overpass') {
        surfaceCache.set(cacheKey, {ts: Date.now(), data: result});
      }
      return result;
    })();

    surfaceInFlight.set(cacheKey, jobPromise);
    try {
      res.json(await jobPromise);
    } finally {
      surfaceInFlight.delete(cacheKey);
    }
  });

  // 3. Live ACARS Feed
  router.get('/acars', async (_req, res) => {
    if (acarsCache && Date.now() - acarsCache.ts < 20000) {
      res.json({messages: acarsCache.messages, sourceStatus: acarsCache.sourceStatus, cached: true});
      return;
    }

    const messages: AcarsMessage[] = [];
    let sourceStatus = 'airframes.io live';

    try {
      const msgRes = await fetch('https://api.airframes.io/v1/messages?limit=35', {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
        signal: AbortSignal.timeout(4500),
      });

      if (msgRes.ok) {
        const raw = (await msgRes.json()) as Array<Record<string, unknown>> | {data?: Array<Record<string, unknown>>; messages?: Array<Record<string, unknown>>};
        const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : Array.isArray(raw.messages) ? raw.messages : [];
        for (const m of rows) {
          const label = String(m.label ?? 'GEN');
          const text = String(m.text ?? m.message ?? '');
          const classified = classifyAcarsLabel(label, text);
          const flightObj = (m.flight ?? {}) as Record<string, unknown>;
          const callsign = String(flightObj.callsign ?? m.flight_id ?? m.callsign ?? m.tail ?? 'ACARS').trim().toUpperCase();
          const tsRaw = String(m.timestamp ?? m.created_at ?? new Date().toISOString());
          messages.push({
            id: String(m.id ?? `${callsign}-${tsRaw}`),
            timestamp: tsRaw,
            epochMs: Date.parse(tsRaw) || Date.now(),
            flightNumber: String(flightObj.flight_number ?? callsign),
            callsign,
            tail: String(m.tail ?? flightObj.tail ?? ''),
            airlineIcao: airlineIcaoFromCallsign(callsign),
            label,
            labelName: classified.name,
            frequencyMhz: String(m.freq ?? m.frequency ?? '131.550'),
            stationId: String(m.station_id ?? m.station ?? 'VDL2'),
            rawText: text || `[${label}] Empty payload`,
            decodedSummary: classified.summary,
            category: classified.category,
            source: 'airframes.io',
          });
        }
      } else {
        const fltRes = await fetch('https://api.airframes.io/v1/flights/active?limit=25', {
          headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
          signal: AbortSignal.timeout(4000),
        });
        if (fltRes.ok) {
          const fJson = (await fltRes.json()) as Array<Record<string, unknown>> | {data?: Array<Record<string, unknown>>};
          const rows = Array.isArray(fJson) ? fJson : Array.isArray(fJson.data) ? fJson.data : [];
          for (const f of rows) {
            const callsign = String(f.callsign ?? f.flight ?? f.tail ?? 'DATALINK').trim().toUpperCase();
            const tsRaw = String(f.last_message_at ?? f.updated_at ?? new Date().toISOString());
            const tail = String(f.tail ?? f.registration ?? '');
            const dep = String(f.departure ?? f.origin ?? '');
            const arr = String(f.arrival ?? f.destination ?? '');
            messages.push({
              id: String(f.id ?? `${callsign}-${tsRaw}`),
              timestamp: tsRaw,
              epochMs: Date.parse(tsRaw) || Date.now(),
              flightNumber: callsign,
              callsign,
              tail,
              airlineIcao: airlineIcaoFromCallsign(callsign),
              label: 'OOOI',
              labelName: 'Active VDL2 Session',
              frequencyMhz: '136.975',
              stationId: 'AIRFRAMES',
              rawText: `FLT ${callsign} REG/${tail || 'N/A'} ${dep && arr ? `RTE ${dep}-${arr}` : 'ACTIVE DATALINK'}`,
              decodedSummary: dep && arr ? `Active ACARS link on route ${dep} to ${arr}` : 'Active ACARS/VDL2 transponder link',
              category: 'OOOI',
              source: 'airframes.io',
            });
          }
          sourceStatus = 'airframes.io active-flights';
        } else {
          sourceStatus = `airframes.io HTTP ${msgRes.status}`;
        }
      }
    } catch (err) {
      sourceStatus = err instanceof Error ? `airframes.io unavailable (${err.message})` : 'airframes.io unavailable';
    }

    if (messages.length > 0) {
      acarsCache = {ts: Date.now(), messages, sourceStatus};
    } else if (acarsCache) {
      res.json({messages: acarsCache.messages, sourceStatus: `${sourceStatus} (cached)`, cached: true});
      return;
    }

    res.json({messages, sourceStatus, cached: false});
  });

  // 4. Live AviationWeather.gov METAR + TAF + Runway Conditions
  router.get('/weather', async (req, res) => {
    const icaosParam = String(
      req.query.icaos ?? 'ZBAA,ZBAD,ZSPD,ZSSS,ZGGG,ZGSZ,ZUUU,VHHH,RJTT,RKSI,KJFK,KLAX,EGLL,EDDF',
    )
      .toUpperCase()
      .replace(/[^A-Z,]/g, '');

    const cached = weatherCache.get(icaosParam);
    if (cached && Date.now() - cached.ts < 60000) {
      res.json({airports: cached.data, cached: true});
      return;
    }

    try {
      const [metarRes, tafRes] = await Promise.all([
        fetch(`https://aviationweather.gov/api/data/metar?ids=${icaosParam}&format=json`, {
          headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
          signal: AbortSignal.timeout(5500),
        }).catch(() => null),
        fetch(`https://aviationweather.gov/api/data/taf?ids=${icaosParam}&format=json`, {
          headers: {'User-Agent': API_USER_AGENT, Accept: 'application/json'},
          signal: AbortSignal.timeout(5500),
        }).catch(() => null),
      ]);

      const metars = (await safeJson<Array<Record<string, unknown>>>(metarRes)) ?? [];
      const tafs = (await safeJson<Array<Record<string, unknown>>>(tafRes)) ?? [];
      const tafMap = new Map<string, string>();
      for (const t of tafs) {
        const id = String(t.icaoId ?? '').toUpperCase();
        if (id && t.rawTAF) tafMap.set(id, String(t.rawTAF));
      }

      const airports: AirportWeather[] = metars.map((m) => {
        const icao = String(m.icaoId ?? '').toUpperCase();
        const catalog = AIRPORT_CATALOG.find((a) => a.icao === icao);
        const windDir = m.wdir !== null && m.wdir !== undefined && m.wdir !== 'VRB' ? Number(m.wdir) : null;
        const windSpeed = Number(m.wspd ?? 0) || 0;
        const windGust = m.wgst !== null && m.wgst !== undefined ? Number(m.wgst) : null;
        const rawMetar = String(m.rawOb ?? '');
        const wxString = String(m.wxString ?? '');

        let ceilingFt: number | null = null;
        if (Array.isArray(m.clouds)) {
          for (const c of m.clouds as Array<Record<string, unknown>>) {
            const cover = String(c.cover ?? '');
            const base = Number(c.base ?? 99999);
            if ((cover === 'BKN' || cover === 'OVC' || cover === 'VV') && Number.isFinite(base)) {
              ceilingFt = ceilingFt === null ? base : Math.min(ceilingFt, base);
            }
          }
        }

        const visibRaw = m.visib;
        const visibilitySm =
          typeof visibRaw === 'string' && visibRaw.includes('+')
            ? 10
            : Number.isFinite(Number(visibRaw))
              ? Number(visibRaw)
              : null;

        return {
          icao,
          iata: catalog?.iata ?? icao.slice(1),
          name: catalog?.name ?? String(m.name ?? icao),
          city: catalog?.city ?? '',
          country: catalog?.country ?? '',
          lat: Number(m.lat ?? catalog?.lat ?? 0),
          lon: Number(m.lon ?? catalog?.lon ?? 0),
          rawMetar,
          flightCategory: (String(m.fltCat ?? 'UNK').toUpperCase() as AirportWeather['flightCategory']) || 'UNK',
          windDirDeg: Number.isFinite(windDir) ? windDir : null,
          windSpeedKts: windSpeed,
          windGustKts: windGust,
          visibilitySm,
          ceilingFt,
          tempC: m.temp !== null && m.temp !== undefined ? Number(m.temp) : null,
          dewpointC: m.dewp !== null && m.dewp !== undefined ? Number(m.dewp) : null,
          altimeterHpa: m.altim !== null && m.altim !== undefined ? Number(m.altim) : null,
          wxString,
          tafRaw: tafMap.get(icao) ?? '',
          observedAt: String(m.reportTime ?? new Date().toISOString()),
          runways: computeRunways(icao, Number.isFinite(windDir) ? windDir : null, windSpeed, wxString, rawMetar),
        };
      });

      if (airports.length > 0) {
        weatherCache.set(icaosParam, {ts: Date.now(), data: airports});
      }
      res.json({airports, cached: false});
    } catch (err) {
      if (cached) {
        res.json({airports: cached.data, cached: true});
        return;
      }
      res.status(502).json({
        airports: [],
        error: err instanceof Error ? err.message : 'Weather feed unavailable',
      });
    }
  });

  // 5. Live Weather Hazards (NOAA SIGMETs + G-AIRMET Turbulence/Icing/Advisories + RainViewer)
  router.get('/weather/hazards', async (_req, res) => {
    if (hazardsCache && Date.now() - hazardsCache.ts < 60000) {
      res.json({sigmets: hazardsCache.sigmets, rainviewer: hazardsCache.rainviewer, cached: true});
      return;
    }

    const [airSigRes, iSigRes, gAirRes, rvRes] = await Promise.all([
      fetch('https://aviationweather.gov/api/data/airsigmet?format=json', {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4500),
      }).catch(() => null),
      fetch('https://aviationweather.gov/api/data/isigmet?format=json', {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4500),
      }).catch(() => null),
      fetch('https://aviationweather.gov/api/data/gairmet?format=json', {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4500),
      }).catch(() => null),
      fetch('https://api.rainviewer.com/public/weather-maps.json', {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4000),
      }).catch(() => null),
    ]);

    const classifyHazard = (haz: string, raw: string): HazardCategory => {
      const text = `${haz} ${raw}`.toUpperCase();
      if (/TURB|LLWS|MTW|CAT/.test(text)) return 'turbulence';
      if (/ICE|ICG|FZLVL|FZL|MIX|CLR/.test(text)) return 'icing';
      return 'advisory';
    };

    const sigmets: SigmetHazard[] = [];
    const ingestSigmetList = (rows: Array<Record<string, unknown>>, source: string) => {
      for (const r of rows) {
        const rawCoords = Array.isArray(r.coords) ? (r.coords as Array<Record<string, unknown>>) : [];
        const coords: Array<[number, number]> = rawCoords
          .filter((c) => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)))
          .map((c) => [Number(c.lat), Number(c.lon)]);
        if (coords.length < 3) continue;
        const hazard = String(r.hazard ?? r.product ?? 'SIGMET').toUpperCase();
        const rawText = String(r.rawAirSigmet ?? r.rawSigmet ?? r.dueTo ?? '');
        sigmets.push({
          id: String(r.airSigmetId ?? r.isigmetId ?? `${source}-${sigmets.length}`),
          hazard,
          qualifier: String(r.severity ?? r.qualifier ?? ''),
          category: classifyHazard(hazard, rawText),
          validFrom: String(r.validTimeFrom ?? r.issueTime ?? ''),
          validTo: String(r.validTimeTo ?? r.expireTime ?? ''),
          baseFt: r.altitudeLow1 !== undefined && r.altitudeLow1 !== null ? Number(r.altitudeLow1) : null,
          topFt: r.altitudeHi1 !== undefined && r.altitudeHi1 !== null ? Number(r.altitudeHi1) : null,
          rawText,
          coords,
          source,
        });
      }
    };

    const airSigData = await safeJson<Array<Record<string, unknown>>>(airSigRes);
    if (Array.isArray(airSigData)) ingestSigmetList(airSigData, 'NOAA AIR/SIGMET');

    const iSigData = await safeJson<Array<Record<string, unknown>>>(iSigRes);
    if (Array.isArray(iSigData)) ingestSigmetList(iSigData, 'NOAA INTL SIGMET');

    const gAirData = await safeJson<Array<Record<string, unknown>>>(gAirRes);
    if (Array.isArray(gAirData)) ingestSigmetList(gAirData.slice(0, 90), 'NOAA G-AIRMET');

    let rainviewer: RainViewerMeta | null = null;
    const rvJson = await safeJson<{
      host?: string;
      radar?: {past?: Array<{time: number; path: string}>; nowcast?: Array<{time: number; path: string}>};
    }>(rvRes);
    if (rvJson) {
      const frames = [...(rvJson.radar?.past ?? []), ...(rvJson.radar?.nowcast ?? [])].slice(-8);
      if (rvJson.host && frames.length > 0) {
        rainviewer = {host: rvJson.host, frames};
      }
    }

    hazardsCache = {ts: Date.now(), sigmets, rainviewer};
    res.json({sigmets, rainviewer, cached: false});
  });

  // 6. Live Disruptions (FAA NAS Status XML + NOAA METAR Weather Impacts)
  router.get('/disruptions', async (_req, res) => {
    if (disruptionsCache && Date.now() - disruptionsCache.ts < 90000) {
      res.json({items: disruptionsCache.items, sources: disruptionsCache.sources, cached: true});
      return;
    }

    const items: AirportDisruption[] = [];
    const sources: string[] = [];

    const hubIcaos = AIRPORT_CATALOG.map((a) => a.icao).join(',');
    const [faaRes, wxRes] = await Promise.all([
      fetch('https://nasstatus.faa.gov/api/airport-status-information', {
        headers: {'User-Agent': API_USER_AGENT, Accept: 'application/xml, text/xml'},
        signal: AbortSignal.timeout(4500),
      }).catch(() => null),
      fetch(`https://aviationweather.gov/api/data/metar?ids=${hubIcaos}&format=json`, {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4500),
      }).catch(() => null),
    ]);

    try {
      if (faaRes && faaRes.ok) {
        sources.push('FAA NAS Status');
        const xml = await faaRes.text();
        const parser = new XMLParser({ignoreAttributes: false});
        const parsed = parser.parse(xml) as {
          AIRPORT_STATUS_INFORMATION?: {
            Update_Time?: string;
            Delay_type?: Array<Record<string, unknown>> | Record<string, unknown>;
          };
        };
        const info = parsed.AIRPORT_STATUS_INFORMATION;
        const updateTime = String(info?.Update_Time ?? new Date().toISOString());
        const delayTypes = Array.isArray(info?.Delay_type)
          ? info.Delay_type
          : info?.Delay_type
            ? [info.Delay_type]
            : [];

        for (const dt of delayTypes) {
          const name = String(dt.Name ?? '');
          const extractList = (key: string) => {
            const container = dt[key] as Record<string, unknown> | undefined;
            if (!container) return [];
            const raw = container.Delay ?? container.Program ?? container.Airport;
            return Array.isArray(raw) ? raw : raw ? [raw] : [];
          };

          for (const g of extractList('Ground_Stop_List') as Array<Record<string, unknown>>) {
            const arpt = String(g.ARPT ?? '');
            if (!arpt) continue;
            items.push({
              id: `GS-${arpt}`,
              icao: arpt.length === 3 ? `K${arpt}` : arpt,
              iata: arpt,
              airportName: `${arpt} Airport`,
              type: 'GS',
              severity: 'HIGH',
              reason: String(g.Reason ?? 'Ground Stop active'),
              avgDelayMinutes: null,
              trend: String(g.End_Time ?? 'Until further notice'),
              updatedAt: updateTime,
              source: 'FAA NAS',
            });
          }

          for (const g of extractList('Ground_Delay_List') as Array<Record<string, unknown>>) {
            const arpt = String(g.ARPT ?? '');
            if (!arpt) continue;
            const avgStr = String(g.Avg ?? '');
            const mins = Number.parseInt(avgStr.replace(/\D+/g, ''), 10) || null;
            items.push({
              id: `GDP-${arpt}`,
              icao: arpt.length === 3 ? `K${arpt}` : arpt,
              iata: arpt,
              airportName: `${arpt} Airport`,
              type: 'GDP',
              severity: 'MEDIUM',
              reason: String(g.Reason ?? 'Ground Delay Program'),
              avgDelayMinutes: mins,
              trend: String(g.Max ?? ''),
              updatedAt: updateTime,
              source: 'FAA NAS',
            });
          }

          for (const g of extractList('Arrival_Departure_Delay_List') as Array<Record<string, unknown>>) {
            const arpt = String(g.ARPT ?? '');
            if (!arpt) continue;
            const arrDep = (g.Arrival_Departure ?? {}) as Record<string, unknown>;
            const minStr = String(arrDep.Min ?? '');
            const maxStr = String(arrDep.Max ?? '');
            const mins = Number.parseInt(maxStr.replace(/\D+/g, ''), 10) || null;
            items.push({
              id: `DLY-${arpt}-${name}`,
              icao: arpt.length === 3 ? `K${arpt}` : arpt,
              iata: arpt,
              airportName: `${arpt} Airport`,
              type: 'DELAY',
              severity: (mins ?? 0) >= 45 ? 'HIGH' : 'MEDIUM',
              reason: String(g.Reason ?? name ?? 'Arrival/Departure delay'),
              avgDelayMinutes: mins,
              trend: minStr && maxStr ? `${minStr}–${maxStr}` : String(arrDep.Trend ?? ''),
              updatedAt: updateTime,
              source: 'FAA NAS',
            });
          }
        }
      }
    } catch {
      // optional
    }

    try {
      const metars = (await safeJson<Array<Record<string, unknown>>>(wxRes)) ?? [];
      if (metars.length > 0) {
        sources.push('NOAA AWC Hub Weather');
        for (const m of metars) {
          const icao = String(m.icaoId ?? '').toUpperCase();
          const cat = String(m.fltCat ?? '').toUpperCase();
          const wx = String(m.wxString ?? '');
          const wspd = Number(m.wspd ?? 0);
          const wgst = Number(m.wgst ?? 0);
          const spec = AIRPORT_CATALOG.find((a) => a.icao === icao);
          if (!spec) continue;

          if (cat === 'IFR' || cat === 'LIFR' || /TS|FZ|SQ|GR|BLSN/i.test(wx) || wgst >= 28 || wspd >= 25) {
            const reasons: string[] = [];
            if (cat === 'LIFR' || cat === 'IFR') reasons.push(`${cat} low ceiling/visibility`);
            if (wx) reasons.push(`Weather: ${wx}`);
            if (wgst >= 28 || wspd >= 25) reasons.push(`Surface winds ${wspd}${wgst ? `G${wgst}` : ''} kt`);

            items.push({
              id: `WX-${icao}`,
              icao,
              iata: spec.iata,
              airportName: spec.name,
              type: 'WX-OPS',
              severity: cat === 'LIFR' || /TS|FZ/i.test(wx) ? 'HIGH' : 'MEDIUM',
              reason: reasons.join(' · '),
              avgDelayMinutes: null,
              trend: 'Live METAR advisory',
              updatedAt: String(m.reportTime ?? new Date().toISOString()),
              source: 'NOAA METAR',
            });
          }
        }
      }
    } catch {
      // ignore
    }

    disruptionsCache = {ts: Date.now(), items, sources};
    res.json({items, sources, cached: false});
  });

  // 7. Airport Surface Taxiing Feed + Runway/Taxiway Geometry
  router.get('/airport-taxi', async (req, res) => {
    const icao = String(req.query.icao ?? 'ZBAA').toUpperCase();
    const spec = AIRPORT_CATALOG.find((a) => a.icao === icao) ?? AIRPORT_CATALOG[0];

    const delta = 0.11;
    const lamin = spec.lat - delta;
    const lamax = spec.lat + delta;
    const lomin = spec.lon - delta;
    const lomax = spec.lon + delta;

    const cachedOsm = taxiwayCache.get(spec.icao);
    const osmPromise: Promise<TaxiwaySegment[]> =
      cachedOsm && Date.now() - cachedOsm.ts < 86400000
        ? Promise.resolve(cachedOsm.segments)
        : (async () => {
            const segments: TaxiwaySegment[] = [];
            try {
              const query = `[out:json][timeout:5];(way["aeroway"~"runway|taxiway"](${(spec.lat - 0.038).toFixed(4)},${(spec.lon - 0.045).toFixed(4)},${(spec.lat + 0.038).toFixed(4)},${(spec.lon + 0.045).toFixed(4)}););out body;>;out skel qt;`;
              const osmRes = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': API_USER_AGENT},
                body: `data=${encodeURIComponent(query)}`,
                signal: AbortSignal.timeout(5000),
              });
              if (osmRes.ok) {
                const osmJson = (await osmRes.json()) as {
                  elements?: Array<{
                    type: string;
                    id: number;
                    lat?: number;
                    lon?: number;
                    nodes?: number[];
                    tags?: Record<string, string>;
                  }>;
                };
                const nodeMap = new Map<number, [number, number]>();
                for (const el of osmJson.elements ?? []) {
                  if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
                    nodeMap.set(el.id, [el.lat, el.lon]);
                  }
                }
                for (const el of osmJson.elements ?? []) {
                  if (el.type === 'way' && Array.isArray(el.nodes)) {
                    const coords = el.nodes.map((nid) => nodeMap.get(nid)).filter((c): c is [number, number] => Boolean(c));
                    if (coords.length >= 2) {
                      const aeroway = el.tags?.aeroway;
                      segments.push({
                        id: `osm-${el.id}`,
                        kind: aeroway === 'runway' ? 'runway' : 'taxiway',
                        ref: el.tags?.ref,
                        coords,
                      });
                    }
                  }
                }
                if (segments.length > 0) {
                  taxiwayCache.set(spec.icao, {ts: Date.now(), segments});
                }
              }
            } catch {
              // ignore
            }
            return segments;
          })();

    const [fr24Res, adsbRes, osmSegments] = await Promise.all([
      fetchFr24Web(lamin, lomin, lamax, lomax),
      fetchAdsbLol(spec.lat, spec.lon, 10),
      osmPromise,
    ]);

    const merged = new Map<string, LiveFlight>();
    for (const f of [...fr24Res.flights, ...adsbRes.flights]) {
      const existing = merged.get(f.icao24 || f.callsign);
      if (!existing) merged.set(f.icao24 || f.callsign, f);
    }

    const allNearby = Array.from(merged.values());
    const groundTraffic = allNearby.filter((f) => f.onGround || f.altitudeFt < spec.elevationFt + 350);

    let segments = osmSegments;
    if (segments.length === 0) {
      segments = spec.runways.map((r, idx) => {
        const rad = (r.headingDeg * Math.PI) / 180;
        const halfLenDeg = (r.lengthFt / 6076 / 60) * 0.5;
        const offsetLon = (idx - (spec.runways.length - 1) / 2) * 0.012;
        const dLat = Math.cos(rad) * halfLenDeg;
        const dLon = (Math.sin(rad) * halfLenDeg) / Math.cos((spec.lat * Math.PI) / 180);
        return {
          id: `cat-rwy-${r.ident}`,
          kind: 'runway',
          ref: r.ident,
          coords: [
            [spec.lat - dLat, spec.lon + offsetLon - dLon],
            [spec.lat + dLat, spec.lon + offsetLon + dLon],
          ],
        };
      });
    }

    res.json({
      airport: spec,
      groundTraffic,
      nearbyAirborne: allNearby.filter((f) => !f.onGround && f.altitudeFt >= spec.elevationFt + 350),
      segments,
      providers: [fr24Res.status, adsbRes.status],
    });
  });

  // 8. Global Vector Street Tile Relay (/api/vtile/:z/:x/:y) -> MapTiler Planet v4 MVT
  const MAPTILER_KEY = process.env.MAPTILER_API_KEY || 'dpyD4FwxbBpi1ejajPmX';
  const vtileCache = new Map<string, {ts: number; buf: Buffer}>();

  router.get('/vtile/:z/:x/:y', async (req, res) => {
    const z = Math.max(0, Math.min(15, Number.parseInt(req.params.z, 10) || 0));
    const n = 1 << z;
    const xRaw = Number.parseInt(req.params.x, 10) || 0;
    const x = ((xRaw % n) + n) % n;
    const y = Math.max(0, Math.min(n - 1, Number.parseInt(req.params.y, 10) || 0));
    const key = `mt/${z}/${x}/${y}`;

    const cached = vtileCache.get(key);
    if (cached && Date.now() - cached.ts < 1800_000) {
      res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.buf);
      return;
    }

    try {
      const url = `https://api.maptiler.com/tiles/v4/${z}/${x}/${y}?key=${encodeURIComponent(MAPTILER_KEY)}`;
      const upstream = await fetch(url, {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(5500),
      });
      if (!upstream.ok) {
        res.status(upstream.status === 204 ? 204 : 502).end();
        return;
      }
      const arr = await upstream.arrayBuffer();
      const buf = Buffer.from(arr);
      if (vtileCache.size >= 800) {
        const oldestKey = vtileCache.keys().next().value;
        if (oldestKey) vtileCache.delete(oldestKey);
      }
      vtileCache.set(key, {ts: Date.now(), buf});
      res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

  // 10. Aviation Overlays: ATC/FIR Boundaries, Live NAT/PACOT Oceanic Tracks, Enroute High/Low Airways & Waypoints
  router.get('/nav/atc-boundaries', async (_req, res) => {
    try {
      const boundaries = await getAtcBoundaries();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json({boundaries});
    } catch {
      res.status(502).json({boundaries: []});
    }
  });

  router.get('/nav/oceanic-tracks', async (_req, res) => {
    try {
      const tracks = await getOceanicTracks();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({tracks});
    } catch {
      res.status(502).json({tracks: []});
    }
  });

  router.get('/nav/enroute', async (req, res) => {
    const lamin = Number.parseFloat(String(req.query.lamin ?? '20'));
    const lamax = Number.parseFloat(String(req.query.lamax ?? '55'));
    const lomin = Number.parseFloat(String(req.query.lomin ?? '-135'));
    const lomax = Number.parseFloat(String(req.query.lomax ?? '-60'));
    const zoom = Number.parseFloat(String(req.query.zoom ?? '5'));
    if (!Number.isFinite(lamin) || !Number.isFinite(lamax) || !Number.isFinite(lomin) || !Number.isFinite(lomax)) {
      res.status(400).json({waypoints: [], highAirways: [], lowAirways: []});
      return;
    }
    try {
      const data = await getEnrouteChartForBounds(lamin, lamax, lomin, lomax, Number.isFinite(zoom) ? zoom : 5);
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.json(data);
    } catch {
      res.status(502).json({waypoints: [], highAirways: [], lowAirways: []});
    }
  });

  // 11. World Time Zones GeoJSON Boundaries
  router.get('/nav/timezones', async (_req, res) => {
    try {
      const timezones = await getTimeZones();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json({timezones});
    } catch {
      res.status(502).json({timezones: []});
    }
  });

  // 12. Weather Raster Tile Proxy (NEXRAD North American Radar & GOES Cloud Coverage)
  const wtileCache = new Map<string, {ts: number; ct: string; buf: Buffer}>();
  router.get('/wtile/:layer/:z/:x/:y', async (req, res) => {
    const layer = req.params.layer;
    const z = Math.max(0, Math.min(12, Number.parseInt(req.params.z, 10) || 0));
    const n = 1 << z;
    const xRaw = Number.parseInt(req.params.x, 10) || 0;
    const x = ((xRaw % n) + n) % n;
    const y = Math.max(0, Math.min(n - 1, Number.parseInt(req.params.y, 10) || 0));
    const key = `${layer}/${z}/${x}/${y}`;

    const cached = wtileCache.get(key);
    if (cached && Date.now() - cached.ts < 300_000) {
      res.setHeader('Content-Type', cached.ct);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(cached.buf);
      return;
    }

    const upstreamUrl =
      layer === 'nexrad'
        ? `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${z}/${x}/${y}.png`
        : layer === 'clouds'
          ? `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes-east-ir-4km-900913/${z}/${x}/${y}.png`
          : null;

    if (!upstreamUrl) {
      res.status(404).end();
      return;
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(5500),
      });
      if (!upstream.ok) {
        res.status(upstream.status === 404 ? 404 : 502).end();
        return;
      }
      const ct = upstream.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (wtileCache.size >= 400) {
        const oldest = wtileCache.keys().next().value;
        if (oldest) wtileCache.delete(oldest);
      }
      wtileCache.set(key, {ts: Date.now(), ct, buf});
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

  // 13. Comprehensive Aviation Weather Layers (Wind Barbs Grid, PIREPs/AIREPs, Volcanic Ash, SIGWX FL250-630, Fog, Lightning)
  const wxLayersCache = new Map<string, {ts: number; data: WeatherLayersResponse}>();
  router.get('/weather/layers', async (req, res) => {
    const lamin = Math.max(-75, Math.min(75, Number.parseFloat(String(req.query.lamin ?? '20'))));
    const lamax = Math.max(-75, Math.min(75, Number.parseFloat(String(req.query.lamax ?? '55'))));
    const lomin = Math.max(-180, Math.min(180, Number.parseFloat(String(req.query.lomin ?? '-130'))));
    const lomax = Math.max(-180, Math.min(180, Number.parseFloat(String(req.query.lomax ?? '-60'))));

    const sLat = Math.min(lamin, lamax);
    const nLat = Math.max(lamin, lamax);
    const wLon = Math.min(lomin, lomax);
    const eLon = Math.max(lomin, lomax);

    const cacheKey = `${Math.round(sLat / 3)}_${Math.round(nLat / 3)}_${Math.round(wLon / 4)}_${Math.round(eLon / 4)}`;
    const cached = wxLayersCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 120_000) {
      res.json(cached.data);
      return;
    }

    const pireps: WeatherHazardMarker[] = [];
    const volcanic: WeatherHazardMarker[] = [];
    const lightning: WeatherHazardMarker[] = [];
    const sigwx: WeatherHazardMarker[] = [];
    const fogZones: WeatherHazardMarker[] = [];
    const windGrid: WeatherWindPoint[] = [];

    // Sample a 5x4 grid across viewport for global wind barbs, visibility/fog, lightning & cloud data
    const cols = 5;
    const rows = 4;
    const sampleLats: number[] = [];
    const sampleLons: number[] = [];
    const latSpan = Math.max(2, nLat - sLat);
    const lonSpan = Math.max(2, eLon - wLon);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lat = sLat + ((r + 0.5) / rows) * latSpan;
        const lon = wLon + ((c + 0.5) / cols) * lonSpan;
        sampleLats.push(Number(lat.toFixed(2)));
        sampleLons.push(Number(lon.toFixed(2)));
      }
    }

    const clampedBbox = `${Math.max(-85, sLat).toFixed(2)},${Math.max(-180, wLon).toFixed(2)},${Math.min(85, nLat).toFixed(2)},${Math.min(180, eLon).toFixed(2)}`;

    const [openMeteoRes, pirepRes, isigmetRes, airsigmetRes, metarRes] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${sampleLats.join(',')}&longitude=${sampleLons.join(',')}&current=wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,visibility,weather_code&hourly=wind_speed_250hPa,wind_direction_250hPa&wind_speed_unit=kn&forecast_days=1`,
        {headers: {'User-Agent': API_USER_AGENT}, signal: AbortSignal.timeout(5200)},
      ).catch(() => null),
      fetch(`https://aviationweather.gov/api/data/pirep?format=json&bbox=${clampedBbox}`, {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4800),
      }).catch(() => null),
      fetch('https://aviationweather.gov/api/data/isigmet?format=json', {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4800),
      }).catch(() => null),
      fetch('https://aviationweather.gov/api/data/airsigmet?format=json', {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4800),
      }).catch(() => null),
      fetch(`https://aviationweather.gov/api/data/metar?format=json&bbox=${clampedBbox}&hours=1`, {
        headers: {'User-Agent': API_USER_AGENT},
        signal: AbortSignal.timeout(4800),
      }).catch(() => null),
    ]);

    const [omJson, pirepJson, isigmetJson, airsigmetJson, metarJson] = await Promise.all([
      safeJson<unknown>(openMeteoRes),
      safeJson<Array<Record<string, unknown>>>(pirepRes),
      safeJson<Array<Record<string, unknown>>>(isigmetRes),
      safeJson<Array<Record<string, unknown>>>(airsigmetRes),
      safeJson<Array<Record<string, unknown>>>(metarRes),
    ]);

    // 1) Parse Open-Meteo Wind & Gridded Surface/250hPa Weather
    const omList = Array.isArray(omJson) ? omJson : omJson ? [omJson] : [];
    const curHourIdx = Math.min(23, Math.max(0, new Date().getUTCHours()));
    omList.forEach((itemRaw, idx) => {
      const item = (itemRaw ?? {}) as Record<string, unknown>;
      const cur = (item.current ?? {}) as Record<string, unknown>;
      const hourly = (item.hourly ?? {}) as Record<string, unknown>;
      const lat = Number(item.latitude ?? sampleLats[idx]);
      const lon = Number(item.longitude ?? sampleLons[idx]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const sSpd = Math.round(Number(cur.wind_speed_10m ?? 0) || 0);
      const sDir = Math.round(Number(cur.wind_direction_10m ?? 0) || 0);
      const uSpdArr = Array.isArray(hourly.wind_speed_250hPa) ? hourly.wind_speed_250hPa : [];
      const uDirArr = Array.isArray(hourly.wind_direction_250hPa) ? hourly.wind_direction_250hPa : [];
      const uSpd = Math.round(Number(uSpdArr[curHourIdx] ?? sSpd) || sSpd);
      const uDir = Math.round(Number(uDirArr[curHourIdx] ?? sDir) || sDir);
      const visM = Number(cur.visibility ?? 24000);
      const wmo = Number(cur.weather_code ?? 0);

      windGrid.push({
        lat,
        lon,
        surfaceSpeedKts: sSpd,
        surfaceDirDeg: sDir,
        upperSpeedKts: uSpd,
        upperDirDeg: uDir,
        cloudCoverPct: Math.round(Number(cur.cloud_cover ?? 0) || 0),
        precipMm: Number(cur.precipitation ?? 0) || 0,
        visibilityM: Number.isFinite(visM) ? visM : 24000,
        weatherCode: Number.isFinite(wmo) ? wmo : 0,
      });

      if (wmo === 45 || wmo === 48 || (Number.isFinite(visM) && visM < 1800)) {
        const dLat = Math.max(0.45, latSpan * 0.1);
        const dLon = Math.max(0.55, lonSpan * 0.1);
        fogZones.push({
          id: `fog-om-${idx}`,
          kind: 'fog',
          lat,
          lon,
          title: 'FG / Low Vis',
          detail: `Surface Visibility ${Math.round(visM)} m (WMO ${wmo})`,
          altFt: 1500,
          severity: visM < 800 ? 'SEV' : 'MOD',
          coords: [
            [lat - dLat, lon - dLon],
            [lat - dLat, lon + dLon],
            [lat + dLat, lon + dLon],
            [lat + dLat, lon - dLon],
          ],
        });
      }

      if (wmo >= 95 && wmo <= 99) {
        lightning.push({
          id: `ltg-om-${idx}`,
          kind: 'lightning',
          lat,
          lon,
          title: wmo >= 96 ? 'Severe TS / Lightning' : 'Thunderstorm / Lightning',
          detail: `WMO ${wmo} Convective Activity`,
          severity: wmo >= 96 ? 'SEV' : 'MOD',
        });
      }
    });

    // 2) PIREPs & AIREPs
    if (Array.isArray(pirepJson)) {
      for (let i = 0; i < Math.min(80, pirepJson.length); i++) {
        const p = pirepJson[i];
        const lat = Number(p.lat);
        const lon = Number(p.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const reportType = String(p.airepType ?? p.reportType ?? 'PIREP').toUpperCase();
        const acType = String(p.acType ?? '').toUpperCase();
        const fltlvl = Number(p.fltlvl);
        const altFt = Number.isFinite(fltlvl) ? fltlvl * 100 : undefined;
        const tb = String(p.tbInt1 ?? p.turbType1 ?? '');
        const ic = String(p.icgInt1 ?? p.iceType1 ?? '');
        const rawOb = String(p.rawOb ?? '');
        const sev: WeatherHazardMarker['severity'] = /EXTRM/i.test(`${tb} ${ic} ${rawOb}`)
          ? 'EXT'
          : /SEV/i.test(`${tb} ${ic} ${rawOb}`)
            ? 'SEV'
            : /MOD/i.test(`${tb} ${ic} ${rawOb}`)
              ? 'MOD'
              : 'LOW';
        pireps.push({
          id: `pr-${p.pirepId ?? i}`,
          kind: reportType.includes('AIREP') ? 'airep' : 'pirep',
          lat,
          lon,
          altFt,
          acType: acType || undefined,
          title: `${reportType}${acType ? ` · ${acType}` : ''}${Number.isFinite(fltlvl) ? ` FL${fltlvl}` : ''}`,
          detail: rawOb || [tb && `TURB ${tb}`, ic && `ICE ${ic}`].filter(Boolean).join(' · ') || 'Pilot report',
          severity: sev,
        });
      }
    }

    // 3) International SIGMETs -> Volcanic Eruptions (VA) + High-Level SIGWX (FL250-630)
    if (Array.isArray(isigmetJson)) {
      for (let i = 0; i < isigmetJson.length; i++) {
        const row = isigmetJson[i];
        const haz = String(row.hazard ?? '').toUpperCase();
        const rawText = String(row.rawSigmet ?? row.rawText ?? '');
        const baseFt = Number.isFinite(Number(row.base)) ? Number(row.base) : null;
        const topFt = Number.isFinite(Number(row.top)) ? Number(row.top) : null;
        const rawCoords = Array.isArray(row.coords) ? (row.coords as Array<{lat?: number; lon?: number}>) : [];
        const ring: Array<[number, number]> = rawCoords
          .map((c) => [Number(c.lat), Number(c.lon)] as [number, number])
          .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));

        const isVolcanic = haz === 'VA' || /VOLCAN|ERUPT|VA\b|MT\s+[A-Z]+|ASH/i.test(rawText);
        if (isVolcanic) {
          const vLat = ring[0]?.[0] ?? Number(row.lat);
          const vLon = ring[0]?.[1] ?? Number(row.lon);
          if (Number.isFinite(vLat) && Number.isFinite(vLon)) {
            const volcNameMatch = rawText.match(/MT\s+[A-Z0-9-]+/i);
            volcanic.push({
              id: `va-${row.isigmetId ?? i}`,
              kind: 'volcanic',
              lat: vLat,
              lon: vLon,
              altFt: topFt ?? undefined,
              title: volcNameMatch ? `VOLCANO ${volcNameMatch[0].toUpperCase()}` : 'Volcanic Ash Advisory',
              detail: rawText.slice(0, 120) || 'Active Volcanic Ash SIGMET',
              severity: 'SEV',
              coords: ring.length >= 3 ? ring : undefined,
            });
          }
          if (ring.length >= 3) {
            sigwx.push({
              id: `va-poly-${row.isigmetId ?? i}`,
              kind: 'sigwx',
              lat: ring[0][0],
              lon: ring[0][1],
              title: 'VOLCANIC ASH',
              detail: rawText.slice(0, 140),
              altFt: topFt ?? 45000,
              severity: 'SEV',
              coords: ring,
            });
          }
        }

        // Significant Weather FL250-630
        if (ring.length >= 3 && ((topFt !== null && topFt >= 25000) || (baseFt !== null && baseFt >= 24000) || /CB|JET|CAT|TS|SIGWX/i.test(`${haz} ${rawText}`))) {
          sigwx.push({
            id: `sigwx-${row.isigmetId ?? i}`,
            kind: 'sigwx',
            lat: ring[0][0],
            lon: ring[0][1],
            title: `SIGWX FL250-630 (${haz || 'WX'})`,
            detail: rawText.slice(0, 140) || 'High-level significant weather',
            altFt: topFt ?? 63000,
            severity: 'MOD',
            coords: ring,
          });
        }
      }
    }

    // 4) Domestic AIRMET/SIGMET -> High-Level SIGWX FL250-630 & IFR Fog
    if (Array.isArray(airsigmetJson)) {
      for (let i = 0; i < airsigmetJson.length; i++) {
        const row = airsigmetJson[i];
        const haz = String(row.hazard ?? '').toUpperCase();
        const rawText = String(row.rawAirSigmet ?? row.rawText ?? '');
        const topFt = Number.isFinite(Number(row.altitudeHi1)) ? Number(row.altitudeHi1) : null;
        const rawCoords = Array.isArray(row.coords) ? (row.coords as Array<{lat?: number; lon?: number}>) : [];
        const ring: Array<[number, number]> = rawCoords
          .map((c) => [Number(c.lat), Number(c.lon)] as [number, number])
          .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
        if (ring.length < 3) continue;

        if ((topFt !== null && topFt >= 25000) || /CONVECTIVE|SIGMET/i.test(String(row.airSigmetType ?? ''))) {
          sigwx.push({
            id: `us-sigwx-${row.airSigmetId ?? i}`,
            kind: 'sigwx',
            lat: ring[0][0],
            lon: ring[0][1],
            title: `SIGWX (${haz || 'CONV'})`,
            detail: rawText.slice(0, 140),
            altFt: topFt ?? 45000,
            severity: 'MOD',
            coords: ring,
          });
        }
        if (/IFR|FOG|FG\b|VIS/i.test(`${haz} ${rawText}`)) {
          fogZones.push({
            id: `air-fog-${row.airSigmetId ?? i}`,
            kind: 'fog',
            lat: ring[0][0],
            lon: ring[0][1],
            title: 'IFR / FOG AIRMET',
            detail: rawText.slice(0, 140),
            altFt: 2500,
            severity: 'MOD',
            coords: ring,
          });
        }
      }
    }

    // 5) Surface METARs -> Fog & Lightning / Thunderstorms
    if (Array.isArray(metarJson)) {
      for (let i = 0; i < Math.min(120, metarJson.length); i++) {
        const m = metarJson[i];
        const icao = String(m.icaoId ?? '').toUpperCase();
        const lat = Number(m.lat);
        const lon = Number(m.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const wx = String(m.wxString ?? '').toUpperCase();
        const visStr = String(m.visib ?? '10');
        const visNum = visStr.includes('+') ? 10 : Number.parseFloat(visStr);
        const rawOb = String(m.rawOb ?? '');
        if (/\b(FG|BR|MIFG|FZFG|BCFG)\b/.test(wx) || (Number.isFinite(visNum) && visNum <= 1.5)) {
          fogZones.push({
            id: `metar-fg-${icao}-${i}`,
            kind: 'fog',
            lat,
            lon,
            title: `${icao} FOG (${wx || `VIS ${visStr}SM`})`,
            detail: rawOb || `Surface Fog / Vis ${visStr} SM`,
            severity: /\b(FG|FZFG)\b/.test(wx) || (Number.isFinite(visNum) && visNum < 0.75) ? 'SEV' : 'MOD',
          });
        }
        if (/\bTS|VCTS|LTG\b/.test(`${wx} ${rawOb}`)) {
          lightning.push({
            id: `metar-ltg-${icao}-${i}`,
            kind: 'lightning',
            lat,
            lon,
            title: `${icao} Lightning / TS`,
            detail: rawOb || `Thunderstorm reported (${wx})`,
            severity: /\+TS|TSGR/.test(`${wx} ${rawOb}`) ? 'SEV' : 'MOD',
          });
        }
      }
    }

    const payload: WeatherLayersResponse = {
      windGrid,
      pireps: pireps.slice(0, 90),
      volcanic: volcanic.slice(0, 40),
      lightning: lightning.slice(0, 70),
      fogZones: fogZones.slice(0, 60),
      sigwx: sigwx.slice(0, 60),
      fetchedAt: Date.now(),
    };
    if (wxLayersCache.size > 40) {
      const oldest = wxLayersCache.keys().next().value;
      if (oldest) wxLayersCache.delete(oldest);
    }
    wxLayersCache.set(cacheKey, {ts: Date.now(), data: payload});
    res.json(payload);
  });

  // 14. LiveATC Verified Global ATC Radio Directory & Icecast Audio Stream Relay
  const LIVEATC_STATIONS: LiveAtcStation[] = [
    {id: 'ksfo-twr', icao: 'KSFO', iata: 'SFO', name: 'San Francisco Intl', facility: 'SFO Tower', freq: '120.500', mount: 'ksfo_twr', country: 'US', lat: 37.6213, lon: -122.379},
    {id: 'ksfo-app', icao: 'KSFO', iata: 'SFO', name: 'San Francisco Intl', facility: 'NorCal Approach', freq: '135.650', mount: 'ksfo_app', country: 'US', lat: 37.6213, lon: -122.379},
    {id: 'klax-twr', icao: 'KLAX', iata: 'LAX', name: 'Los Angeles Intl', facility: 'LAX Tower North', freq: '133.900', mount: 'klax_twr', country: 'US', lat: 33.9416, lon: -118.4085},
    {id: 'kjfk-twr', icao: 'KJFK', iata: 'JFK', name: 'John F. Kennedy Intl', facility: 'JFK Tower', freq: '119.100', mount: 'kjfk_twr', country: 'US', lat: 40.6413, lon: -73.7781},
    {id: 'kjfk-gnd', icao: 'KJFK', iata: 'JFK', name: 'John F. Kennedy Intl', facility: 'JFK Ground', freq: '121.900', mount: 'kjfk_gnd', country: 'US', lat: 40.6413, lon: -73.7781},
    {id: 'kewr-twr', icao: 'KEWR', iata: 'EWR', name: 'Newark Liberty Intl', facility: 'EWR Tower', freq: '118.300', mount: 'kewr_twr', country: 'US', lat: 40.6895, lon: -74.1745},
    {id: 'kord-twr', icao: 'KORD', iata: 'ORD', name: "Chicago O'Hare Intl", facility: 'ORD Tower', freq: '120.750', mount: 'kord_twr', country: 'US', lat: 41.9742, lon: -87.9073},
    {id: 'katl-twr', icao: 'KATL', iata: 'ATL', name: 'Hartsfield-Jackson Atlanta', facility: 'ATL Tower', freq: '119.100', mount: 'katl_twr', country: 'US', lat: 33.6407, lon: -84.4277},
    {id: 'kdfw-twr', icao: 'KDFW', iata: 'DFW', name: 'Dallas/Fort Worth Intl', facility: 'DFW Tower', freq: '126.550', mount: 'kdfw_twr', country: 'US', lat: 32.8998, lon: -97.0403},
    {id: 'kden-twr', icao: 'KDEN', iata: 'DEN', name: 'Denver Intl', facility: 'DEN Tower', freq: '124.300', mount: 'kden_twr', country: 'US', lat: 39.8561, lon: -104.6737},
    {id: 'ksea-twr', icao: 'KSEA', iata: 'SEA', name: 'Seattle-Tacoma Intl', facility: 'SEA Tower', freq: '119.900', mount: 'ksea_twr', country: 'US', lat: 47.4502, lon: -122.3088},
    {id: 'kbos-twr', icao: 'KBOS', iata: 'BOS', name: 'Boston Logan Intl', facility: 'BOS Tower', freq: '128.800', mount: 'kbos_twr', country: 'US', lat: 42.3656, lon: -71.0096},
    {id: 'kmia-twr', icao: 'KMIA', iata: 'MIA', name: 'Miami Intl', facility: 'MIA Tower', freq: '118.300', mount: 'kmia_twr', country: 'US', lat: 25.7959, lon: -80.287},
    {id: 'klas-twr', icao: 'KLAS', iata: 'LAS', name: 'Harry Reid Intl', facility: 'LAS Tower', freq: '119.900', mount: 'klas_twr', country: 'US', lat: 36.084, lon: -115.1537},
    {id: 'kphx-twr', icao: 'KPHX', iata: 'PHX', name: 'Phoenix Sky Harbor', facility: 'PHX Tower', freq: '118.700', mount: 'kphx_twr', country: 'US', lat: 33.4343, lon: -112.0116},
    {id: 'kiad-twr', icao: 'KIAD', iata: 'IAD', name: 'Washington Dulles Intl', facility: 'IAD Tower', freq: '120.100', mount: 'kiad_twr', country: 'US', lat: 38.9531, lon: -77.4565},
    {id: 'cyyz-twr', icao: 'CYYZ', iata: 'YYZ', name: 'Toronto Pearson Intl', facility: 'YYZ Tower', freq: '118.700', mount: 'cyyz_twr', country: 'CA', lat: 43.6777, lon: -79.6248},
    {id: 'cyvr-twr', icao: 'CYVR', iata: 'YVR', name: 'Vancouver Intl', facility: 'YVR Tower', freq: '118.700', mount: 'cyvr_twr', country: 'CA', lat: 49.1967, lon: -123.1815},
    {id: 'eham-twr', icao: 'EHAM', iata: 'AMS', name: 'Amsterdam Schiphol', facility: 'Schiphol Tower/App', freq: '119.225', mount: 'eham_twr', country: 'NL', lat: 52.3105, lon: 4.7683},
    {id: 'eddf-app', icao: 'EDDF', iata: 'FRA', name: 'Frankfurt Main', facility: 'Frankfurt Director', freq: '120.800', mount: 'eddf_app', country: 'DE', lat: 50.0379, lon: 8.5622},
    {id: 'lszh-twr', icao: 'LSZH', iata: 'ZRH', name: 'Zurich Airport', facility: 'Zurich Tower/App', freq: '118.100', mount: 'lszh_twr', country: 'CH', lat: 47.4582, lon: 8.5555},
    {id: 'eidw-twr', icao: 'EIDW', iata: 'DUB', name: 'Dublin Airport', facility: 'Dublin Tower', freq: '118.600', mount: 'eidw', country: 'IE', lat: 53.4264, lon: -6.2499},
    {id: 'lemd-twr', icao: 'LEMD', iata: 'MAD', name: 'Madrid Barajas', facility: 'Madrid Tower/App', freq: '118.075', mount: 'lemd', country: 'ES', lat: 40.4983, lon: -3.5676},
    {id: 'rjtt-twr', icao: 'RJTT', iata: 'HND', name: 'Tokyo Haneda Intl', facility: 'Haneda Tower', freq: '118.100', mount: 'rjtt_twr', country: 'JP', lat: 35.5494, lon: 139.7798},
    {id: 'rjaa-twr', icao: 'RJAA', iata: 'NRT', name: 'Tokyo Narita Intl', facility: 'Narita Tower', freq: '118.200', mount: 'rjaa_twr', country: 'JP', lat: 35.772, lon: 140.3929},
    {id: 'yssy-twr', icao: 'YSSY', iata: 'SYD', name: 'Sydney Kingsford Smith', facility: 'Sydney Tower/App', freq: '120.500', mount: 'yssy_twr', country: 'AU', lat: -33.9399, lon: 151.1753},
    {id: 'ymml-twr', icao: 'YMML', iata: 'MEL', name: 'Melbourne Intl', facility: 'Melbourne Tower/App', freq: '120.500', mount: 'ymml', country: 'AU', lat: -37.669, lon: 144.841},
    {id: 'nzaa-twr', icao: 'NZAA', iata: 'AKL', name: 'Auckland Intl', facility: 'Auckland Tower/App', freq: '118.700', mount: 'nzaa', country: 'NZ', lat: -37.0082, lon: 174.785},
    {id: 'rctp-twr', icao: 'RCTP', iata: 'TPE', name: 'Taipei Taoyuan Intl', facility: 'Taoyuan Tower/App', freq: '118.700', mount: 'rctp', country: 'TW', lat: 25.0797, lon: 121.2342},
    {id: 'sbgr-twr', icao: 'SBGR', iata: 'GRU', name: 'Sao Paulo Guarulhos', facility: 'Guarulhos Tower/App', freq: '132.750', mount: 'sbgr', country: 'BR', lat: -23.4356, lon: -46.4731},
    {id: 'mmmx-twr', icao: 'MMMX', iata: 'MEX', name: 'Mexico City Intl', facility: 'Mexico Tower/App', freq: '118.550', mount: 'mmmx', country: 'MX', lat: 19.4363, lon: -99.0721},
  ];

  router.get('/liveatc/stations', (req, res) => {
    const q = String(req.query.q ?? req.query.icao ?? '').trim().toUpperCase();
    const filtered = q
      ? LIVEATC_STATIONS.filter(
          (s) =>
            s.icao.includes(q) ||
            s.iata.includes(q) ||
            s.name.toUpperCase().includes(q) ||
            s.facility.toUpperCase().includes(q) ||
            s.country.includes(q),
        )
      : LIVEATC_STATIONS;
    res.json({stations: filtered});
  });

  router.get('/liveatc/stream', async (req, res) => {
    const rawMount = String(req.query.mount ?? 'ksfo_twr').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,48}$/.test(rawMount)) {
      res.status(400).json({error: 'Invalid LiveATC mount'});
      return;
    }
    const ac = new AbortController();
    req.on('close', () => ac.abort());

    const tryMounts = [rawMount, `${rawMount}_twr`, rawMount.replace(/_twr$/, '')];
    for (const mnt of Array.from(new Set(tryMounts))) {
      try {
        const upstream = await fetch(`https://d.liveatc.net/${encodeURIComponent(mnt)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SkyDeckAudio/1.0)',
            Accept: 'audio/mpeg, audio/*;q=0.9, */*;q=0.8',
          },
          signal: ac.signal,
        });
        if (!upstream.ok || !upstream.body) continue;
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const reader = upstream.body.getReader();
        try {
          while (true) {
            const {done, value} = await reader.read();
            if (done || ac.signal.aborted) break;
            if (value) res.write(Buffer.from(value));
          }
        } catch {
          // client closed or stream ended
        } finally {
          res.end();
        }
        return;
      } catch {
        if (ac.signal.aborted) return;
      }
    }
    if (!res.headersSent) {
      res.status(502).json({error: 'LiveATC stream mount unavailable'});
    }
  });

  // 15. ViewfinderPanoramas SRTM3 HGT Terrain Elevation Grid (with deterministic topographic relief fallback)
  const extractZipEntry = (zipBuf: Buffer, entrySuffix: string): Buffer | null => {
    let offset = 0;
    while (offset + 30 < zipBuf.length) {
      const sig = zipBuf.readUInt32LE(offset);
      if (sig !== 0x04034b50) break;
      const compression = zipBuf.readUInt16LE(offset + 8);
      const compSize = zipBuf.readUInt32LE(offset + 18);
      const fnameLen = zipBuf.readUInt16LE(offset + 26);
      const extraLen = zipBuf.readUInt16LE(offset + 28);
      const name = zipBuf.subarray(offset + 30, offset + 30 + fnameLen).toString('utf8');
      const dataStart = offset + 30 + fnameLen + extraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > zipBuf.length) break;
      if (name.toUpperCase().endsWith(entrySuffix.toUpperCase())) {
        const raw = zipBuf.subarray(dataStart, dataEnd);
        if (compression === 0) return raw;
        if (compression === 8) return inflateRawSync(raw);
        return null;
      }
      offset = dataEnd;
    }
    return null;
  };

  const formatSrtmTileName = (latFloor: number, lonFloor: number): string => {
    const ns = latFloor >= 0 ? 'N' : 'S';
    const ew = lonFloor >= 0 ? 'E' : 'W';
    const latStr = String(Math.abs(latFloor)).padStart(2, '0');
    const lonStr = String(Math.abs(lonFloor)).padStart(3, '0');
    return `${ns}${latStr}${ew}${lonStr}`;
  };

  const fetchViewfinderHgtCell = async (latFloor: number, lonFloor: number): Promise<Int16Array | null> => {
    const tileId = formatSrtmTileName(latFloor, lonFloor);
    const cached = hgtCellCache.get(tileId);
    if (cached && Date.now() - cached.ts < 86400_000) return cached.samples;

    // ViewfinderPanoramas 3-arcsec (1201x1201) tiles follow standard 6x4 UTM letter bands or tile IDs
    const bandIdx = Math.floor((latFloor + 80) / 4);
    const letters = 'CDEFGHJKLMNPQRSTUVWXX';
    const bandChar = letters[Math.max(0, Math.min(letters.length - 1, bandIdx))] || 'N';
    const zone = String(Math.floor((lonFloor + 180) / 6) + 1).padStart(2, '0');
    const prefix = latFloor >= 60 ? '' : 'S';
    const archiveName = `${bandChar}${zone}`;
    const candidateUrls = [
      `https://viewfinderpanoramas.org/dem3/${archiveName}.zip`,
      `https://viewfinderpanoramas.org/dem3/${prefix}${archiveName}.zip`,
    ];

    let samples: Int16Array | null = null;
    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, {
          headers: {'User-Agent': API_USER_AGENT},
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) continue;
        const zipBuf = Buffer.from(await res.arrayBuffer());
        const hgtBuf = extractZipEntry(zipBuf, `${tileId}.HGT`);
        if (hgtBuf && hgtBuf.length >= 1201 * 1201 * 2) {
          const out = new Int16Array(1201 * 1201);
          for (let i = 0; i < out.length; i++) {
            const v = hgtBuf.readInt16BE(i * 2);
            out[i] = v < -500 ? 0 : v;
          }
          samples = out;
          break;
        }
      } catch {
        // try fallback
      }
    }

    if (hgtCellCache.size > 40) {
      const oldest = hgtCellCache.keys().next().value;
      if (oldest) hgtCellCache.delete(oldest);
    }
    hgtCellCache.set(tileId, {ts: Date.now(), samples});
    return samples;
  };

  const sampleTerrainElevationM = async (lat: number, lon: number): Promise<{elevM: number; source: 'viewfinder-srtm3' | 'relief-model'}> => {
    const latFloor = Math.floor(lat);
    const lonFloor = Math.floor(lon);
    const hgt = await fetchViewfinderHgtCell(latFloor, lonFloor);
    if (hgt) {
      const row = Math.max(0, Math.min(1200, Math.round((1 - (lat - latFloor)) * 1200)));
      const col = Math.max(0, Math.min(1200, Math.round((lon - lonFloor) * 1200)));
      return {elevM: hgt[row * 1201 + col], source: 'viewfinder-srtm3'};
    }
    // Lightweight smooth global mountain-belt / coastal relief fallback when remote HGT archive is unreachable
    const ridge1 = Math.sin(lat * 0.21 + lon * 0.08) * Math.cos(lon * 0.14 - lat * 0.11);
    const ridge2 = Math.sin(lat * 0.68 - lon * 0.42) * 0.5 + Math.cos(lat * 1.3 + lon * 0.9) * 0.25;
    const isAlps = lat > 44 && lat < 48 && lon > 5 && lon < 16 ? 1900 : 0;
    const isRockies = lat > 32 && lat < 55 && lon > -123 && lon < -104 ? 1650 : 0;
    const isAndes = lat > -50 && lat < 10 && lon > -78 && lon < -66 ? 2400 : 0;
    const isHimalaya = lat > 26 && lat < 38 && lon > 70 && lon < 102 ? 3200 : 0;
    const belt = Math.max(isAlps, isRockies, isAndes, isHimalaya);
    const base = belt > 0 ? belt * Math.max(0.15, ridge1 * 0.5 + 0.5) + Math.max(0, ridge2) * 420 : Math.max(0, (ridge1 + ridge2) * 180);
    return {elevM: Math.round(base), source: 'relief-model'};
  };

  router.get('/terrain/grid', async (req, res) => {
    const lat = Number.parseFloat(String(req.query.lat ?? '37.62'));
    const lon = Number.parseFloat(String(req.query.lon ?? '-122.38'));
    const spanDeg = Math.max(0.05, Math.min(4.0, Number.parseFloat(String(req.query.spanDeg ?? '0.45')) || 0.45));
    const gridN = Math.max(8, Math.min(32, Number.parseInt(String(req.query.n ?? '16'), 10) || 16));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({error: 'Invalid coordinates'});
      return;
    }

    // Preload center HGT cell once (fast cached)
    await fetchViewfinderHgtCell(Math.floor(lat), Math.floor(lon));

    const heightsM: number[] = [];
    let resolvedSource: 'viewfinder-srtm3' | 'relief-model' = 'relief-model';
    for (let r = 0; r < gridN; r++) {
      const rLat = lat - spanDeg * 0.5 + (r / Math.max(1, gridN - 1)) * spanDeg;
      for (let c = 0; c < gridN; c++) {
        const cLon = lon - spanDeg * 0.5 + (c / Math.max(1, gridN - 1)) * spanDeg;
        const {elevM, source} = await sampleTerrainElevationM(rLat, cLon);
        if (source === 'viewfinder-srtm3') resolvedSource = 'viewfinder-srtm3';
        heightsM.push(elevM);
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json({
      lat,
      lon,
      spanDeg,
      gridN,
      heightsM,
      source: resolvedSource,
      attribution: 'ViewfinderPanoramas SRTM DEM (viewfinderpanoramas.org)',
    });
  });

  return router;
}
