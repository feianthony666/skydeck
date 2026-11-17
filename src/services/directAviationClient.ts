import {AIRPORT_CATALOG} from '../data/aviationCatalog';
import type {
  AircraftPhoto,
  AirfieldSurfaceData,
  AirfieldSurfaceGate,
  AirportBoardFlight,
  AirportBoardResponse,
  AirportMarker,
  FlightDetail,
  FlightsResponse,
  LiveFlight,
  ProviderStatus,
  RainViewerMeta,
  TaxiwaySegment,
  TrailPoint,
} from '../types/aviation';

let staticHostingDetected = false;
let globalAirportsPromise: Promise<AirportMarker[]> | null = null;
let cachedGlobalAirports: AirportMarker[] | null = null;
const browserTrailMap = new Map<string, TrailPoint[]>();
const browserFlightIndex = new Map<string, LiveFlight>();
const browserSurfaceCache = new Map<string, {ts: number; data: AirfieldSurfaceData}>();

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
  if (existing.length > 50) existing.shift();
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

async function fetchDirectFlights(params: URLSearchParams): Promise<FlightsResponse> {
  const lamin = Number(params.get('lamin') ?? 18);
  const lomin = Number(params.get('lomin') ?? 98);
  const lamax = Number(params.get('lamax') ?? 43);
  const lomax = Number(params.get('lomax') ?? 126);

  const clampedLatMin = Math.max(-85, lamin);
  const clampedLatMax = Math.min(85, lamax);
  const clampedLonMin = Math.max(-180, lomin);
  const clampedLonMax = Math.min(180, lomax);

  const start = Date.now();
  const providers: ProviderStatus[] = [];
  const flights: LiveFlight[] = [];

  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${clampedLatMin.toFixed(2)}&lomin=${clampedLonMin.toFixed(2)}&lamax=${clampedLatMax.toFixed(2)}&lomax=${clampedLonMax.toFixed(2)}`;
    const res = await fetch(url, {signal: AbortSignal.timeout(6000)});
    if (res.ok) {
      const json = (await res.json()) as {states?: Array<unknown[]>; time?: number};
      const nowSec = json.time ?? Math.floor(Date.now() / 1000);
      for (const s of (json.states ?? []).slice(0, 350)) {
        const lat = Number(s[6]);
        const lon = Number(s[5]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const icao24 = String(s[0] ?? '').toUpperCase();
        const callsign = String(s[1] ?? icao24).trim().toUpperCase();
        const altM = Number(s[7] ?? s[13] ?? 0);
        const velMs = Number(s[9] ?? 0);
        const vrateMs = Number(s[11] ?? 0);
        const flight: LiveFlight = {
          id: icao24,
          icao24,
          callsign: callsign || icao24,
          flightNumber: callsign || icao24,
          registration: '',
          airlineIcao: airlineIcaoFromCallsign(callsign),
          airlineName: airlineIcaoFromCallsign(callsign),
          aircraftType: 'A320',
          lat,
          lon,
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
        recordBrowserBreadcrumb(flight);
        const trail = browserTrailMap.get(icao24);
        if (trail && trail.length > 1) flight.trail = trail.slice(-16);
        flights.push(flight);
      }
      providers.push({
        provider: 'opensky',
        ok: true,
        count: flights.length,
        latencyMs: Date.now() - start,
      });
    } else {
      providers.push({
        provider: 'opensky',
        ok: false,
        count: 0,
        latencyMs: Date.now() - start,
        note: `HTTP ${res.status}`,
      });
    }
  } catch (err) {
    providers.push({
      provider: 'opensky',
      ok: false,
      count: 0,
      latencyMs: Date.now() - start,
      note: err instanceof Error ? err.message : 'Timeout',
    });
  }

  return {
    flights,
    providers,
    fetchedAt: Date.now(),
    bounds: {lamin, lomin, lamax, lomax},
  };
}

async function fetchDirectPhoto(icao24: string, reg: string): Promise<AircraftPhoto | null> {
  // 1. Try Wikimedia Commons high-res full-frame photo by registration
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

  const [hexRes, routeRes] = await Promise.all([
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
  ]);

  const hex = (hexRes ?? {}) as Record<string, string>;
  const resolvedReg = regParam || hex.Registration || '';
  const photo = await fetchDirectPhoto(icao24, resolvedReg);

  const route = ((routeRes as {response?: {flightroute?: Record<string, unknown>}} | null)?.response?.flightroute ??
    {}) as Record<string, unknown>;
  const dbOrig = (route.origin ?? {}) as Record<string, unknown>;
  const dbDest = (route.destination ?? {}) as Record<string, unknown>;
  const dbAirline = (route.airline ?? {}) as Record<string, unknown>;

  const cached = browserFlightIndex.get(icao24);
  const trail = browserTrailMap.get(icao24) ?? [];

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
    source: 'opensky-direct',
  };
}

async function fetchDirectSurface(params: URLSearchParams): Promise<AirfieldSurfaceData> {
  const icao = (params.get('icao') ?? '').toUpperCase();
  const catalog = AIRPORT_CATALOG.find((a) => a.icao === icao || a.iata === icao);
  const lat = Number(params.get('lat') ?? catalog?.lat ?? 0);
  const lon = Number(params.get('lon') ?? catalog?.lon ?? 0);
  const cacheKey = `${icao || `${lat.toFixed(3)},${lon.toFixed(3)}`}`;
  const existing = browserSurfaceCache.get(cacheKey);
  if (existing && Date.now() - existing.ts < 86400000) return existing.data;

  const aprons: Array<Array<[number, number]>> = [];
  const runways: TaxiwaySegment[] = [];
  const taxiways: TaxiwaySegment[] = [];
  const gates: AirfieldSurfaceGate[] = [];

  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
    try {
      const q = `[out:json][timeout:6];(way["aeroway"~"runway|taxiway|taxilane|apron"](${(lat - 0.042).toFixed(4)},${(lon - 0.052).toFixed(4)},${(lat + 0.042).toFixed(4)},${(lon + 0.052).toFixed(4)});node["aeroway"~"gate|parking_position"](${(lat - 0.035).toFixed(4)},${(lon - 0.042).toFixed(4)},${(lat + 0.035).toFixed(4)},${(lon + 0.042).toFixed(4)}););out body;>;out skel qt;`;
      const osmRes = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(6000),
      });
      if (osmRes.ok) {
        const json = (await osmRes.json()) as {
          elements?: Array<{
            type: string;
            id: number;
            lat?: number;
            lon?: number;
            nodes?: number[];
            tags?: Record<string, string>;
          }>;
        };
        const nodes = new Map<number, [number, number]>();
        for (const el of json.elements ?? []) {
          if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
            nodes.set(el.id, [el.lat, el.lon]);
            if (el.tags?.aeroway === 'gate' || el.tags?.aeroway === 'parking_position') {
              const ref = el.tags.ref || el.tags.name;
              if (ref) gates.push({id: `g-${el.id}`, ref, lat: el.lat, lon: el.lon});
            }
          }
        }
        for (const el of json.elements ?? []) {
          if (el.type !== 'way' || !Array.isArray(el.nodes)) continue;
          const coords = el.nodes.map((id) => nodes.get(id)).filter((c): c is [number, number] => Boolean(c));
          if (coords.length < 2) continue;
          const kind = el.tags?.aeroway;
          if (kind === 'apron') {
            if (coords.length >= 3) aprons.push(coords);
          } else if (kind === 'runway') {
            const widthM = Number.parseFloat(el.tags?.width ?? '45') || 45;
            runways.push({id: `rwy-${el.id}`, kind: 'runway', ref: el.tags?.ref, widthM, coords});
          } else if (kind === 'taxiway' || kind === 'taxilane') {
            const widthM = Number.parseFloat(el.tags?.width ?? '22') || 22;
            taxiways.push({id: `twy-${el.id}`, kind: 'taxiway', ref: el.tags?.ref, widthM, coords});
          }
        }
      }
    } catch {
      // fall back below
    }
  }

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

      const perpLat = -Math.sin(rad) * 0.0022;
      const perpLon = (Math.cos(rad) * 0.0022) / cosLat;
      const twyRef = String.fromCharCode(65 + (idx % 6));
      const t1: [number, number] = [p1[0] + perpLat, p1[1] + perpLon];
      const t2: [number, number] = [p2[0] + perpLat, p2[1] + perpLon];
      taxiways.push({
        id: `cat-twy-${r.ident}-par`,
        kind: 'taxiway',
        ref: twyRef,
        widthM: 22,
        coords: [t1, t2],
      });
      [0.12, 0.45, 0.88].forEach((frac, cIdx) => {
        const rx = p1[0] + (p2[0] - p1[0]) * frac;
        const ry = p1[1] + (p2[1] - p1[1]) * frac;
        const tx = t1[0] + (t2[0] - t1[0]) * frac;
        const ty = t1[1] + (t2[1] - t1[1]) * frac;
        taxiways.push({
          id: `cat-twy-${r.ident}-ex-${cIdx}`,
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

    const aLat = catalog.lat;
    const aLon = catalog.lon;
    aprons.push([
      [aLat - 0.004, aLon - 0.006],
      [aLat + 0.004, aLon - 0.006],
      [aLat + 0.004, aLon + 0.006],
      [aLat - 0.004, aLon + 0.006],
    ]);
  }

  const result: AirfieldSurfaceData = {
    icao: catalog?.icao ?? icao,
    iata: catalog?.iata ?? '',
    lat,
    lon,
    aprons,
    runways,
    taxiways,
    gates: gates.slice(0, 80),
    source: taxiways.length > 0 || aprons.length > 0 ? 'osm-overpass' : 'catalog',
  };
  browserSurfaceCache.set(cacheKey, {ts: Date.now(), data: result});
  return result;
}

async function handleStaticRoute(path: string, params: URLSearchParams): Promise<unknown> {
  if (path === '/api/flights') {
    return fetchDirectFlights(params);
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
    const code = (params.get('code') ?? '').toUpperCase();
    const icao = (params.get('icao') ?? '').toUpperCase();
    const all = await getBrowserGlobalAirports();
    const catalog = AIRPORT_CATALOG.find((a) => a.iata === code || a.icao === icao || a.icao === code);
    const dir = all.find((a) => (code && a.iata === code) || a.icao === icao || a.icao === code);
    const iata = catalog?.iata ?? dir?.iata ?? code;
    const resolvedIcao = catalog?.icao ?? dir?.icao ?? (icao || code);
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
    } satisfies AirportBoardResponse;
  }
  if (path === '/api/airport-taxi') {
    const icao = (params.get('icao') ?? 'ZBAA').toUpperCase();
    const spec = AIRPORT_CATALOG.find((a) => a.icao === icao) ?? AIRPORT_CATALOG[0];
    const surf = await fetchDirectSurface(new URLSearchParams({icao: spec.icao, lat: String(spec.lat), lon: String(spec.lon)}));
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
  if (path === '/api/weather') return {airports: [], cached: false};
  if (path === '/api/disruptions') return {items: [], sources: [], cached: false};
  if (path === '/api/acars') return {messages: [], sourceStatus: 'Static host mode', cached: false};
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

export async function apiFetchJson<T>(inputUrl: string): Promise<T> {
  const parsed = new URL(inputUrl, typeof window !== 'undefined' ? window.location.origin : 'https://skydeck.local');
  const cleanPath = parsed.pathname.replace(/^\/+/, '/');
  const params = parsed.searchParams;

  const backendAvailable = await hasLiveBackend();
  if (!backendAvailable) {
    return (await handleStaticRoute(cleanPath, params)) as T;
  }

  try {
    const relUrl = `.${cleanPath}${parsed.search}`;
    const res = await fetch(relUrl);
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
    if (err instanceof Error && err.message.startsWith('HTTP 5')) {
      throw err;
    }
    staticHostingDetected = true;
    return (await handleStaticRoute(cleanPath, params)) as T;
  }
}
