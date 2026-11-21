import type {
  AtcBoundaryFeature,
  EnrouteChartResponse,
  NavWaypointSpec,
  OceanicTrackSpec,
  TimeZoneBoundaryFeature,
} from '../src/types/aviation';
import {
  buildFallbackTimeZones,
  BUILTIN_NAT_FALLBACK,
  BUILTIN_PACOTS,
  computeEnrouteChartForBounds,
  FALLBACK_FIRS,
  OCEANIC_FIX_COORDS,
  parseAtcBoundariesFromVatsim,
  parseNavaidsCsv,
  parseOceanicTracksFromNattrak,
  parseTimeZonesFromGeoJson,
} from '../src/utils/navChartShared';

const USER_AGENT = 'SkyDeck-Radar/3.0 (Aviation Navigation Engine)';

let cachedAtc: {ts: number; data: AtcBoundaryFeature[]} | null = null;
let atcInFlight: Promise<AtcBoundaryFeature[]> | null = null;

let cachedTz: {ts: number; data: TimeZoneBoundaryFeature[]} | null = null;
let tzInFlight: Promise<TimeZoneBoundaryFeature[]> | null = null;

let cachedOceanic: {ts: number; data: OceanicTrackSpec[]} | null = null;
let oceanicInFlight: Promise<OceanicTrackSpec[]> | null = null;

let cachedNavaids: {ts: number; list: NavWaypointSpec[]; byIdent: Map<string, NavWaypointSpec>} | null = null;
let navaidsInFlight: Promise<{list: NavWaypointSpec[]; byIdent: Map<string, NavWaypointSpec>}> | null = null;

const enrouteCache = new Map<string, {ts: number; data: EnrouteChartResponse}>();

export async function getAtcBoundaries(): Promise<AtcBoundaryFeature[]> {
  if (cachedAtc && Date.now() - cachedAtc.ts < 12 * 3600_000) {
    return cachedAtc.data;
  }
  if (atcInFlight) return atcInFlight;

  atcInFlight = (async () => {
    try {
      const [geoRes, datRes] = await Promise.allSettled([
        fetch('https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson', {
          headers: {'User-Agent': USER_AGENT},
          signal: AbortSignal.timeout(12000),
        }),
        fetch('https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat', {
          headers: {'User-Agent': USER_AGENT},
          signal: AbortSignal.timeout(8000),
        }),
      ]);

      const datText =
        datRes.status === 'fulfilled' && datRes.value.ok ? await datRes.value.text() : null;

      if (geoRes.status !== 'fulfilled' || !geoRes.value.ok) {
        return FALLBACK_FIRS;
      }

      const json = (await geoRes.value.json()) as Parameters<typeof parseAtcBoundariesFromVatsim>[0];
      const out = parseAtcBoundariesFromVatsim(json, datText);
      if (out.length > 0) {
        cachedAtc = {ts: Date.now(), data: out};
        return out;
      }
      return FALLBACK_FIRS;
    } catch {
      return FALLBACK_FIRS;
    } finally {
      atcInFlight = null;
    }
  })();

  return atcInFlight;
}

export async function getOceanicTracks(): Promise<OceanicTrackSpec[]> {
  if (cachedOceanic && Date.now() - cachedOceanic.ts < 15 * 60_000) {
    return cachedOceanic.data;
  }
  if (oceanicInFlight) return oceanicInFlight;

  oceanicInFlight = (async () => {
    const tracks: OceanicTrackSpec[] = [];
    const {byIdent} = await getGlobalNavaids().catch(() => ({
      list: [],
      byIdent: new Map<string, NavWaypointSpec>(),
    }));

    try {
      const res = await fetch('https://nattrak.vatsim.net/api/tracks', {
        headers: {'User-Agent': USER_AGENT},
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const raw = (await res.json()) as Parameters<typeof parseOceanicTracksFromNattrak>[0];
        tracks.push(...parseOceanicTracksFromNattrak(raw, byIdent));
      }
    } catch {
      // Fall through with PACOTs + curated NAT fallback
    }

    if (tracks.length === 0) {
      tracks.push(...BUILTIN_NAT_FALLBACK);
    }

    tracks.push(...BUILTIN_PACOTS);
    cachedOceanic = {ts: Date.now(), data: tracks};
    oceanicInFlight = null;
    return tracks;
  })();

  return oceanicInFlight;
}

export async function getGlobalNavaids(): Promise<{
  list: NavWaypointSpec[];
  byIdent: Map<string, NavWaypointSpec>;
}> {
  if (cachedNavaids && Date.now() - cachedNavaids.ts < 12 * 3600_000) {
    return {list: cachedNavaids.list, byIdent: cachedNavaids.byIdent};
  }
  if (navaidsInFlight) return navaidsInFlight;

  navaidsInFlight = (async () => {
    let parsed: {list: NavWaypointSpec[]; byIdent: Map<string, NavWaypointSpec>} = {
      list: [],
      byIdent: new Map<string, NavWaypointSpec>(),
    };

    try {
      const res = await fetch('https://davidmegginson.github.io/ourairports-data/navaids.csv', {
        headers: {'User-Agent': USER_AGENT},
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const csv = await res.text();
        parsed = parseNavaidsCsv(csv);
      }
    } catch {
      // Fallback fixes only
    }

    if (parsed.list.length === 0) {
      for (const [ident, [lat, lon]] of Object.entries(OCEANIC_FIX_COORDS)) {
        const fix: NavWaypointSpec = {
          ident,
          name: `${ident} Oceanic/Enroute Fix`,
          kind: 'FIX',
          freq: '',
          lat,
          lon,
          usage: 'HI',
          power: 'HIGH',
        };
        parsed.list.push(fix);
        parsed.byIdent.set(ident, fix);
      }
    }

    cachedNavaids = {ts: Date.now(), list: parsed.list, byIdent: parsed.byIdent};
    navaidsInFlight = null;
    return parsed;
  })();

  return navaidsInFlight;
}

export async function getEnrouteChartForBounds(
  lamin: number,
  lamax: number,
  lomin: number,
  lomax: number,
  zoom: number,
): Promise<EnrouteChartResponse> {
  const zTier = zoom < 4.5 ? 1 : zoom < 6.5 ? 2 : zoom < 8.8 ? 3 : 4;
  const cacheKey = `${lamin.toFixed(1)}|${lamax.toFixed(1)}|${lomin.toFixed(1)}|${lomax.toFixed(1)}|${zTier}`;
  const hit = enrouteCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 600_000) {
    return hit.data;
  }

  const {list} = await getGlobalNavaids();
  const data = computeEnrouteChartForBounds(list, lamin, lamax, lomin, lomax, zoom);
  if (enrouteCache.size > 160) {
    const oldest = enrouteCache.keys().next().value;
    if (oldest) enrouteCache.delete(oldest);
  }
  enrouteCache.set(cacheKey, {ts: Date.now(), data});
  return data;
}

export async function getTimeZones(): Promise<TimeZoneBoundaryFeature[]> {
  if (cachedTz && Date.now() - cachedTz.ts < 24 * 3600_000) {
    return cachedTz.data;
  }
  if (tzInFlight) return tzInFlight;

  tzInFlight = (async () => {
    try {
      const res = await fetch(
        'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_time_zones.geojson',
        {
          headers: {'User-Agent': USER_AGENT},
          signal: AbortSignal.timeout(14000),
        },
      );
      if (!res.ok) {
        return buildFallbackTimeZones();
      }

      const json = (await res.json()) as Parameters<typeof parseTimeZonesFromGeoJson>[0];
      const out = parseTimeZonesFromGeoJson(json);
      if (out.length > 0) {
        cachedTz = {ts: Date.now(), data: out};
        return out;
      }
      return buildFallbackTimeZones();
    } catch {
      return buildFallbackTimeZones();
    } finally {
      tzInFlight = null;
    }
  })();

  return tzInFlight;
}
