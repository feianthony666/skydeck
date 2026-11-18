const FR24_URL =
  'https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=85,-85,-180,180&faa=1&mlat=1&flarm=1&adsb=1&gnd=1&air=1&estimated=1&maxage=14400&gliders=1&stats=1';
const ADSB_LOL_URL = 'https://api.adsb.lol/v2/all';

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; SkyDeck snapshot)',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function callSignToAirline(code) {
  const clean = String(code || '').trim().toUpperCase();
  const match = clean.match(/^([A-Z]{3})\d/);
  return match ? match[1] : clean.slice(0, 3);
}

function parseFr24(raw) {
  const nowSec = Math.floor(Date.now() / 1000);
  const flights = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || value.length < 15) continue;
    const icao24 = String(value[0] ?? key).toUpperCase();
    const lat = Number(value[1]);
    const lon = Number(value[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const track = Number(value[3]) || 0;
    const altFt = Number(value[4]) || 0;
    const speedKts = Number(value[5]) || 0;
    const slot7 = String(value[7] ?? '');
    const hasRadarPrefix =
      /^(F-|T-|N\/A|EST|SAT|MLAT|ADSB|GLID|FLARM)/i.test(slot7) || slot7 === '';
    const aircraftType = String((hasRadarPrefix ? value[8] : value[7]) ?? 'A320').toUpperCase();
    const registration = String((hasRadarPrefix ? value[9] : value[8]) ?? '');
    const ts = Number(hasRadarPrefix ? value[10] : value[9]) || nowSec;
    const origin = String((hasRadarPrefix ? value[11] : value[10]) ?? '');
    const destination = String((hasRadarPrefix ? value[12] : value[11]) ?? '');
    const flightNumber = String((hasRadarPrefix ? value[13] : value[12]) ?? '');
    const onGroundVal = Number(hasRadarPrefix ? value[14] : value[13]);
    const vrate = Number(hasRadarPrefix ? value[15] : value[14]) || 0;
    const callsign = String((hasRadarPrefix ? value[16] : value[15]) ?? flightNumber ?? icao24)
      .trim()
      .toUpperCase();
    const airlineIcao = String(value[18] ?? callSignToAirline(callsign)).toUpperCase();
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
      squawk: String(value[6] ?? ''),
      origin,
      destination,
      lastContactEpoch: ts,
      source: 'fr24-github-actions',
      isEstimated: false,
      uncertaintyNm: 0,
    });
  }
  return flights;
}

function parseAdsbLol(raw) {
  const nowSec = Math.floor((raw.now ?? Date.now()) / 1000);
  return (raw.ac ?? [])
    .filter((a) => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)))
    .map((a) => {
      const icao24 = String(a.hex ?? '').toUpperCase();
      const callsign = String(a.flight ?? a.r ?? icao24).trim().toUpperCase();
      const onGround = a.alt_baro === 'ground' || Number(a.alt_baro ?? 0) <= 0;
      const dbFlags = Number(a.dbFlags ?? 0) || 0;
      return {
        id: icao24,
        icao24,
        callsign,
        flightNumber: callsign,
        registration: String(a.r ?? ''),
        airlineIcao: callSignToAirline(callsign),
        airlineName: String(a.ownOp ?? '') || callSignToAirline(callsign),
        aircraftType: String(a.t ?? (onGround ? 'A320' : 'A320')).toUpperCase(),
        lat: Number(a.lat),
        lon: Number(a.lon),
        altitudeFt: onGround ? 0 : Math.max(0, Math.round(Number(a.alt_baro ?? a.alt_geom ?? 0))),
        groundSpeedKts: Math.round(Number(a.gs ?? 0)),
        trueTrackDeg: Math.round(Number(a.track ?? 0)),
        verticalRateFpm: Math.round(Number(a.baro_rate ?? a.geom_rate ?? 0)),
        onGround,
        squawk: String(a.squawk ?? ''),
        origin: '',
        destination: '',
        lastContactEpoch: nowSec - Math.round(Number(a.seen_pos ?? 0)),
        source: 'adsb-lol-github-actions',
        isEstimated: false,
        uncertaintyNm: 0,
        dbFlags,
        isMilitary: (dbFlags & 1) !== 0,
        isPia: (dbFlags & 4) !== 0,
        isLadd: (dbFlags & 8) !== 0,
      };
    });
}

const [fr24Result, adsbResult] = await Promise.allSettled([
  fetchJson(FR24_URL, 20000),
  fetchJson(ADSB_LOL_URL, 20000),
]);

const fr24Flights =
  fr24Result.status === 'fulfilled' ? parseFr24(fr24Result.value) : [];
const adsbFlights =
  adsbResult.status === 'fulfilled' ? parseAdsbLol(adsbResult.value) : [];

const merged = new Map();
for (const flight of [...adsbFlights, ...fr24Flights]) {
  const key = flight.icao24 || flight.callsign || flight.id;
  const existing = merged.get(key);
  if (!existing) {
    merged.set(key, flight);
    continue;
  }
  merged.set(key, {
    ...existing,
    ...flight,
    origin: flight.origin || existing.origin,
    destination: flight.destination || existing.destination,
    registration: flight.registration || existing.registration,
    aircraftType:
      flight.aircraftType && flight.aircraftType !== 'A320'
        ? flight.aircraftType
        : existing.aircraftType || flight.aircraftType,
    dbFlags: (existing.dbFlags ?? 0) | (flight.dbFlags ?? 0),
  });
}

const flights = Array.from(merged.values())
  .filter((flight) => Number.isFinite(flight.lat) && Number.isFinite(flight.lon))
  .slice(0, 30000);

const payload = {
  flights,
  providers: [
    {
      provider: 'fr24-github-snapshot',
      ok: fr24Result.status === 'fulfilled',
      count: fr24Flights.length,
    },
    {
      provider: 'adsb-lol-github-snapshot',
      ok: adsbResult.status === 'fulfilled',
      count: adsbFlights.length,
    },
  ],
  fetchedAt: Date.now(),
  bounds: {lamin: -85, lomin: -180, lamax: 85, lomax: 180},
  source: 'github-actions',
};

await import('node:fs/promises').then((fs) =>
  fs.mkdir('public/flights', {recursive: true}).then(() =>
    fs.writeFile('public/flights/latest.json', JSON.stringify(payload)),
  ),
);

console.log(
  `Wrote ${flights.length} flights (${fr24Flights.length} FR24, ${adsbFlights.length} adsb.lol)`,
);
