import type {
  AirwaySegmentSpec,
  AtcBoundaryFeature,
  EnrouteChartResponse,
  NavWaypointSpec,
  OceanicTrackSpec,
  TimeZoneBoundaryFeature,
} from '../src/types/aviation';

const USER_AGENT = 'SkyDeck-Radar/3.0 (Aviation Navigation Engine)';

// Comprehensive oceanic entry/exit fixes & high-altitude reporting waypoints
const OCEANIC_FIX_COORDS: Record<string, [number, number]> = {
  // North Atlantic East (Shannon/Prestwick/Reykjavik/Bodo/Santa Maria)
  SUNOT: [57.0, -15.0],
  BILTO: [56.5, -15.0],
  PIKIL: [56.0, -15.0],
  ETARI: [55.5, -15.0],
  RESNO: [55.0, -15.0],
  DOGAL: [54.0, -15.0],
  DINIM: [51.0, -15.0],
  MALOT: [53.0, -15.0],
  LIMRI: [52.0, -15.0],
  GOMUP: [57.0, -10.0],
  ETILO: [55.5, -10.0],
  BEDRA: [49.0, -15.0],
  OMOKO: [48.0, -15.0],
  TUDEP: [50.0, -15.0],
  NIBOG: [55.5, -11.0],
  NERTU: [49.5, -15.0],
  BOBTU: [54.0, -10.0],
  LOMSI: [58.0, -15.0],
  SOORY: [58.5, -15.0],
  BAVPA: [59.0, -15.0],
  RATSU: [61.0, -10.0],
  ATSIX: [61.0, -12.0],
  BALIX: [59.0, -10.0],
  ADODO: [58.0, -10.0],
  ERAKA: [58.5, -10.0],
  TAMEL: [50.0, -14.0],
  LASNO: [51.0, -12.0],
  GISTI: [52.0, -12.0],
  MASIT: [53.0, -12.0],
  EMERU: [56.0, -10.0],
  RIKAL: [58.0, -12.0],
  CRONO: [46.0, -18.0],
  DOTTY: [52.0, -50.0],
  // North Atlantic West (Gander/Moncton/New York Oceanic)
  CUDDY: [55.5, -53.0],
  ENNSO: [55.0, -53.0],
  JANJO: [54.5, -53.0],
  KODIK: [54.0, -53.0],
  MELDI: [53.5, -53.0],
  DENDU: [52.5, -53.0],
  NICSO: [52.0, -53.0],
  RELIC: [51.5, -53.0],
  SUPRY: [51.0, -53.0],
  HOIST: [50.5, -53.0],
  LOACH: [50.0, -53.0],
  OYSTR: [49.5, -53.0],
  STEAM: [49.0, -53.0],
  SCROD: [48.5, -53.0],
  TUSKY: [43.5, -67.0],
  DOVEY: [43.0, -67.0],
  BANCS: [44.0, -64.0],
  VIXUN: [51.0, -51.0],
  PORTI: [47.5, -52.0],
  MUSAK: [57.0, -54.0],
  LUSEN: [57.5, -53.0],
  ELSOX: [56.0, -53.0],
  ALLRY: [50.0, -52.0],
  BUDAR: [49.0, -52.0],
  RIVAK: [48.0, -52.0],
  VEXEN: [53.0, -53.0],
  XETBO: [56.5, -53.0],
  YAY: [51.39, -56.08],
  YQX: [48.94, -54.57],
  YDP: [56.55, -61.68],
  YRI: [47.76, -69.59],
  JEBBY: [42.0, -67.0],
  DANER: [41.5, -65.0],
  SLATN: [39.5, -68.0],
  // North & Central Pacific (PACOT / NOPAC / CEP)
  BEBOP: [37.5, -124.2],
  BAART: [36.8, -125.0],
  DINTY: [37.9, -124.9],
  CLUTS: [35.5, -124.0],
  FICKY: [34.2, -123.5],
  EBONY: [39.0, -125.5],
  CORKY: [33.5, -122.8],
  ONEMU: [23.8, -154.0],
  PADRE: [24.5, -153.5],
  POURR: [25.5, -152.5],
  PUCKS: [23.2, -155.0],
  SMOLT: [22.8, -155.8],
  SYA: [52.71, 174.11],
  AMOTT: [47.5, 165.0],
  NIPPI: [43.5, 155.0],
  NYMPH: [41.0, 150.0],
  OCALA: [38.5, 146.0],
  OMOTO: [36.2, 143.5],
  OPAKE: [35.4, 141.5],
  GARRY: [53.0, -165.0],
  CUTEE: [52.0, -175.0],
  KAGIS: [54.5, -155.0],
  KATCH: [56.0, -142.0],
  TOU: [48.3, -124.6],
  SFO: [37.62, -122.37],
  OAK: [37.73, -122.22],
  PYE: [38.08, -122.87],
  HNL: [21.31, -157.93],
  NRT: [35.78, 140.38],
  ANC: [61.17, -150.0],
  // South America Continental Reporting Fixes
  GRU: [-23.43, -46.47],
  GIG: [-22.81, -43.25],
  EZE: [-34.82, -58.53],
  SCL: [-33.39, -70.79],
  BOG: [4.70, -74.15],
  LIM: [-12.02, -77.11],
  CCS: [10.60, -66.99],
  UIO: [-0.11, -78.36],
  MAO: [-3.04, -60.05],
  REC: [-8.13, -34.92],
  ASU: [-25.24, -57.52],
  MVD: [-34.84, -56.03],
  // Africa Continental Reporting Fixes
  JNB: [-26.14, 28.24],
  CPT: [-33.97, 18.60],
  CAI: [30.12, 31.41],
  ADD: [8.98, 38.80],
  NBO: [-1.32, 36.93],
  LOS: [6.58, 3.32],
  CMN: [33.37, -7.59],
  ALG: [36.69, 3.22],
  TUN: [36.85, 10.23],
  DAR: [-6.88, 39.20],
  KRT: [15.59, 32.55],
  ABV: [9.01, 7.26],
  DKR: [14.74, -17.49],
  FIH: [-4.39, 15.44],
  // Middle East / Asia / Oceania Continental Fixes
  DXB: [25.25, 55.36],
  DOH: [25.27, 51.61],
  RUH: [24.96, 46.70],
  DEL: [28.56, 77.10],
  BOM: [19.09, 72.87],
  BKK: [13.68, 100.75],
  SIN: [1.35, 103.99],
  CGK: [-6.13, 106.66],
  PEK: [40.08, 116.60],
  PVG: [31.14, 121.81],
  SYD: [-33.95, 151.18],
  MEL: [-37.67, 144.84],
  PER: [-31.94, 115.97],
  BNE: [-27.38, 153.12],
  AKL: [-37.01, 174.79],
  NAN: [-17.76, 177.44],
};

// Cached state
let cachedAtc: {ts: number; data: AtcBoundaryFeature[]} | null = null;
let atcInFlight: Promise<AtcBoundaryFeature[]> | null = null;

let cachedTz: {ts: number; data: TimeZoneBoundaryFeature[]} | null = null;
let tzInFlight: Promise<TimeZoneBoundaryFeature[]> | null = null;

let cachedOceanic: {ts: number; data: OceanicTrackSpec[]} | null = null;
let oceanicInFlight: Promise<OceanicTrackSpec[]> | null = null;

let cachedNavaids: {ts: number; list: NavWaypointSpec[]; byIdent: Map<string, NavWaypointSpec>} | null = null;
let navaidsInFlight: Promise<{list: NavWaypointSpec[]; byIdent: Map<string, NavWaypointSpec>}> | null = null;

const enrouteCache = new Map<string, {ts: number; data: EnrouteChartResponse}>();

function simplifyRing(ring: Array<[number, number]>, minStepDeg = 0.09, maxPts = 140): Array<[number, number]> {
  if (ring.length <= 6) return ring;
  const out: Array<[number, number]> = [ring[0]];
  let last = ring[0];
  for (let i = 1; i < ring.length - 1; i++) {
    const pt = ring[i];
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= minStepDeg) {
      out.push(pt);
      last = pt;
    }
  }
  out.push(ring[ring.length - 1]);
  if (out.length > maxPts) {
    const stride = Math.ceil(out.length / maxPts);
    const reduced: Array<[number, number]> = [];
    for (let i = 0; i < out.length; i += stride) reduced.push(out[i]);
    if (reduced[reduced.length - 1] !== out[out.length - 1]) reduced.push(out[out.length - 1]);
    return reduced;
  }
  return out;
}

const FALLBACK_FIRS: AtcBoundaryFeature[] = [
  {
    id: 'KZOA',
    name: 'Oakland ARTCC',
    oceanic: false,
    labelLat: 38.2,
    labelLon: -121.4,
    rings: [[[35.5, -124.2], [42.0, -124.5], [42.0, -118.5], [37.2, -117.5], [35.5, -121.0], [35.5, -124.2]]],
  },
  {
    id: 'KZLA',
    name: 'Los Angeles ARTCC',
    oceanic: false,
    labelLat: 34.1,
    labelLon: -117.6,
    rings: [[[32.5, -121.0], [35.5, -121.0], [37.2, -117.5], [35.0, -114.2], [32.5, -114.5], [32.5, -121.0]]],
  },
  {
    id: 'KZNY',
    name: 'New York ARTCC',
    oceanic: false,
    labelLat: 40.7,
    labelLon: -74.0,
    rings: [[[38.8, -77.2], [41.8, -77.0], [42.0, -72.0], [39.0, -70.0], [38.8, -77.2]]],
  },
  {
    id: 'EGGX',
    name: 'Shanwick Oceanic',
    oceanic: true,
    labelLat: 54.0,
    labelLon: -22.0,
    rings: [[[45.0, -30.0], [61.0, -30.0], [61.0, -10.0], [45.0, -8.0], [45.0, -30.0]]],
  },
  {
    id: 'CZQX',
    name: 'Gander Oceanic',
    oceanic: true,
    labelLat: 52.0,
    labelLon: -42.0,
    rings: [[[45.0, -53.0], [61.0, -53.0], [61.0, -30.0], [45.0, -30.0], [45.0, -53.0]]],
  },
  {
    id: 'EGTT',
    name: 'London FIR',
    oceanic: false,
    labelLat: 52.0,
    labelLon: -1.5,
    rings: [[[49.8, -6.0], [55.0, -5.5], [55.0, 2.5], [50.8, 2.0], [49.8, -6.0]]],
  },
];

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

      const firNames = new Map<string, string>();
      if (datRes.status === 'fulfilled' && datRes.value.ok) {
        const text = await datRes.value.text();
        let inFirs = false;
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith(';')) continue;
          if (line.startsWith('[')) {
            inFirs = line.toUpperCase() === '[FIRS]';
            continue;
          }
          if (!inFirs) continue;
          const parts = line.split('|');
          if (parts.length >= 4 && parts[3] && parts[1]) {
            firNames.set(parts[3].trim().toUpperCase(), parts[1].trim());
          }
        }
      }

      if (geoRes.status !== 'fulfilled' || !geoRes.value.ok) {
        return FALLBACK_FIRS;
      }

      const json = (await geoRes.value.json()) as {
        features?: Array<{
          properties?: {
            id?: string;
            oceanic?: string | number | boolean;
            label_lat?: string | number;
            label_lon?: string | number;
          };
          geometry?: {
            type?: string;
            coordinates?: unknown;
          };
        }>;
      };

      const out: AtcBoundaryFeature[] = [];
      for (const feat of json.features ?? []) {
        const id = String(feat.properties?.id ?? '').trim().toUpperCase();
        if (!id) continue;
        const oceanic =
          feat.properties?.oceanic === '1' ||
          feat.properties?.oceanic === 1 ||
          feat.properties?.oceanic === true;
        const labelLat = Number(feat.properties?.label_lat ?? 0);
        const labelLon = Number(feat.properties?.label_lon ?? 0);

        const rings: Array<Array<[number, number]>> = [];
        const gType = feat.geometry?.type;
        const coords = feat.geometry?.coordinates;

        if (gType === 'Polygon' && Array.isArray(coords)) {
          const outer = coords[0];
          if (Array.isArray(outer)) {
            const pts: Array<[number, number]> = [];
            for (const c of outer) {
              if (Array.isArray(c) && c.length >= 2) {
                pts.push([Number(c[1]), Number(c[0])]);
              }
            }
            if (pts.length >= 3) rings.push(simplifyRing(pts));
          }
        } else if (gType === 'MultiPolygon' && Array.isArray(coords)) {
          for (const poly of coords) {
            if (!Array.isArray(poly) || !Array.isArray(poly[0])) continue;
            const pts: Array<[number, number]> = [];
            for (const c of poly[0]) {
              if (Array.isArray(c) && c.length >= 2) {
                pts.push([Number(c[1]), Number(c[0])]);
              }
            }
            if (pts.length >= 3) rings.push(simplifyRing(pts));
          }
        }

        if (rings.length === 0) continue;
        const cLat = Number.isFinite(labelLat) && labelLat !== 0 ? labelLat : rings[0][0][0];
        const cLon = Number.isFinite(labelLon) && labelLon !== 0 ? labelLon : rings[0][0][1];

        out.push({
          id,
          name: firNames.get(id) ?? id,
          oceanic,
          labelLat: cLat,
          labelLon: cLon,
          rings,
        });
      }

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

function parseCoordToken(token: string, hemisphereHint: 'NAT' | 'PACOT'): [number, number] | null {
  const clean = token.trim().toUpperCase();
  // Format 1: 58/20 or 5730/20 (NAT shorthand)
  const slashMatch = clean.match(/^(\d{2})(\d{2})?\/(\d{2,3})(\d{2})?$/);
  if (slashMatch) {
    const latDeg = Number(slashMatch[1]);
    const latMin = slashMatch[2] ? Number(slashMatch[2]) : 0;
    const lonDeg = Number(slashMatch[3]);
    const lonMin = slashMatch[4] ? Number(slashMatch[4]) : 0;
    const lat = latDeg + latMin / 60;
    const lon = hemisphereHint === 'NAT' ? -(lonDeg + lonMin / 60) : lonDeg + lonMin / 60;
    return [lat, lon];
  }
  // Format 2: 5830N02000W or 40N160W
  const dmsMatch = clean.match(/^(\d{2})(\d{2})?([NS])(\d{3})(\d{2})?([EW])$/);
  if (dmsMatch) {
    const lat = (Number(dmsMatch[1]) + (dmsMatch[2] ? Number(dmsMatch[2]) / 60 : 0)) * (dmsMatch[3] === 'S' ? -1 : 1);
    const lon = (Number(dmsMatch[4]) + (dmsMatch[5] ? Number(dmsMatch[5]) / 60 : 0)) * (dmsMatch[6] === 'W' ? -1 : 1);
    return [lat, lon];
  }
  return null;
}

const BUILTIN_PACOTS: OceanicTrackSpec[] = [
  {
    id: 'PACOT-A',
    system: 'PACOT',
    direction: 'west',
    flightLevels: [34000, 36000, 38000, 40000],
    routeString: 'BEBOP 38N130W 40N140W 42N150W 42N160W 41N170W 40N180E 38N170E 37N160E 36N150E OPAKE',
    points: [
      {ident: 'BEBOP', lat: 37.5, lon: -124.2},
      {ident: '38/30W', lat: 38.0, lon: -130.0},
      {ident: '40/40W', lat: 40.0, lon: -140.0},
      {ident: '42/50W', lat: 42.0, lon: -150.0},
      {ident: '42/60W', lat: 42.0, lon: -160.0},
      {ident: '41/70W', lat: 41.0, lon: -170.0},
      {ident: '40/80E', lat: 40.0, lon: 180.0},
      {ident: '38/70E', lat: 38.0, lon: 170.0},
      {ident: '37/60E', lat: 37.0, lon: 160.0},
      {ident: '36/50E', lat: 36.0, lon: 150.0},
      {ident: 'OPAKE', lat: 35.4, lon: 141.5},
    ],
  },
  {
    id: 'PACOT-E',
    system: 'PACOT',
    direction: 'east',
    flightLevels: [33000, 35000, 37000, 39000],
    routeString: 'OMOTO 36N150E 38N160E 40N170E 41N180E 41N170W 40N160W 39N150W 38N140W DINTY',
    points: [
      {ident: 'OMOTO', lat: 36.2, lon: 143.5},
      {ident: '36/50E', lat: 36.0, lon: 150.0},
      {ident: '38/60E', lat: 38.0, lon: 160.0},
      {ident: '40/70E', lat: 40.0, lon: 170.0},
      {ident: '41/80E', lat: 41.0, lon: 180.0},
      {ident: '41/70W', lat: 41.0, lon: -170.0},
      {ident: '40/60W', lat: 40.0, lon: -160.0},
      {ident: '39/50W', lat: 39.0, lon: -150.0},
      {ident: '38/40W', lat: 38.0, lon: -140.0},
      {ident: 'DINTY', lat: 37.9, lon: -124.9},
    ],
  },
  {
    id: 'NOPAC-R220',
    system: 'PACOT',
    direction: 'both',
    flightLevels: [32000, 34000, 36000, 38000, 40000],
    routeString: 'KATCH GARRY CUTEE SYA AMOTT NIPPI NYMPH OCALA',
    points: [
      {ident: 'KATCH', lat: 56.0, lon: -142.0},
      {ident: 'GARRY', lat: 53.0, lon: -165.0},
      {ident: 'CUTEE', lat: 52.0, lon: -175.0},
      {ident: 'SYA', lat: 52.71, lon: 174.11},
      {ident: 'AMOTT', lat: 47.5, lon: 165.0},
      {ident: 'NIPPI', lat: 43.5, lon: 155.0},
      {ident: 'NYMPH', lat: 41.0, lon: 150.0},
      {ident: 'OCALA', lat: 38.5, lon: 146.0},
    ],
  },
  {
    id: 'CEP-HNL',
    system: 'PACOT',
    direction: 'both',
    flightLevels: [34000, 36000, 38000, 40000],
    routeString: 'CLUTS 33N130W 30N138W 27N146W ONEMU HNL',
    points: [
      {ident: 'CLUTS', lat: 35.5, lon: -124.0},
      {ident: '33/30W', lat: 33.0, lon: -130.0},
      {ident: '30/38W', lat: 30.0, lon: -138.0},
      {ident: '27/46W', lat: 27.0, lon: -146.0},
      {ident: 'ONEMU', lat: 23.8, lon: -154.0},
      {ident: 'HNL', lat: 21.31, lon: -157.93},
    ],
  },
];

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
        const raw = (await res.json()) as Array<{
          identifier?: string;
          active?: boolean;
          last_routeing?: string;
          valid_from?: string;
          valid_to?: string;
          flight_levels?: number[];
          direction?: string;
        }>;
        for (const item of raw) {
          if (!item.identifier || !item.last_routeing) continue;
          const tokens = item.last_routeing.trim().split(/\s+/);
          const points: Array<{ident: string; lat: number; lon: number}> = [];
          for (const tok of tokens) {
            const coord = parseCoordToken(tok, 'NAT');
            if (coord) {
              points.push({ident: tok, lat: coord[0], lon: coord[1]});
              continue;
            }
            const up = tok.toUpperCase();
            const known = OCEANIC_FIX_COORDS[up];
            if (known) {
              points.push({ident: up, lat: known[0], lon: known[1]});
              continue;
            }
            const nav = byIdent.get(up);
            if (nav) {
              points.push({ident: up, lat: nav.lat, lon: nav.lon});
            }
          }
          if (points.length >= 2) {
            tracks.push({
              id: `NAT-${item.identifier}`,
              system: 'NAT',
              direction: item.direction === 'east' ? 'east' : item.direction === 'west' ? 'west' : 'both',
              flightLevels: item.flight_levels ?? [34000, 36000, 38000, 40000],
              validFrom: item.valid_from,
              validTo: item.valid_to,
              routeString: item.last_routeing,
              points,
            });
          }
        }
      }
    } catch {
      // Fall through with PACOTs + curated NAT fallback
    }

    if (tracks.length === 0) {
      tracks.push(
        {
          id: 'NAT-A',
          system: 'NAT',
          direction: 'west',
          flightLevels: [34000, 36000, 38000, 40000],
          routeString: 'SUNOT 58/20 59/30 59/40 58/50 CUDDY',
          points: [
            {ident: 'SUNOT', lat: 57.0, lon: -15.0},
            {ident: '58/20', lat: 58.0, lon: -20.0},
            {ident: '59/30', lat: 59.0, lon: -30.0},
            {ident: '59/40', lat: 59.0, lon: -40.0},
            {ident: '58/50', lat: 58.0, lon: -50.0},
            {ident: 'CUDDY', lat: 55.5, lon: -53.0},
          ],
        },
        {
          id: 'NAT-U',
          system: 'NAT',
          direction: 'east',
          flightLevels: [35000, 37000, 39000],
          routeString: 'STEAM 50/50 51/40 52/30 52/20 LIMRI',
          points: [
            {ident: 'STEAM', lat: 49.0, lon: -53.0},
            {ident: '50/50', lat: 50.0, lon: -50.0},
            {ident: '51/40', lat: 51.0, lon: -40.0},
            {ident: '52/30', lat: 52.0, lon: -30.0},
            {ident: '52/20', lat: 52.0, lon: -20.0},
            {ident: 'LIMRI', lat: 52.0, lon: -15.0},
          ],
        },
      );
    }

    tracks.push(...BUILTIN_PACOTS);
    cachedOceanic = {ts: Date.now(), data: tracks};
    oceanicInFlight = null;
    return tracks;
  })();

  return oceanicInFlight;
}

function parseCsvRow(line: string): string[] {
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

export async function getGlobalNavaids(): Promise<{
  list: NavWaypointSpec[];
  byIdent: Map<string, NavWaypointSpec>;
}> {
  if (cachedNavaids && Date.now() - cachedNavaids.ts < 12 * 3600_000) {
    return {list: cachedNavaids.list, byIdent: cachedNavaids.byIdent};
  }
  if (navaidsInFlight) return navaidsInFlight;

  navaidsInFlight = (async () => {
    const list: NavWaypointSpec[] = [];
    const byIdent = new Map<string, NavWaypointSpec>();

    try {
      const res = await fetch('https://davidmegginson.github.io/ourairports-data/navaids.csv', {
        headers: {'User-Agent': USER_AGENT},
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const csv = await res.text();
        const lines = csv.split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const c = parseCsvRow(line);
          if (c.length < 19) continue;
          const ident = (c[2] || '').trim().toUpperCase();
          const name = (c[3] || '').trim();
          const rawType = (c[4] || '').trim().toUpperCase();
          const freqKhz = Number(c[5] || 0);
          const lat = Number(c[6]);
          const lon = Number(c[7]);
          const usageRaw = (c[17] || '').trim().toUpperCase();
          const powerRaw = (c[18] || '').trim().toUpperCase();
          if (!ident || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          const kind: NavWaypointSpec['kind'] =
            rawType.includes('VORTAC')
              ? 'VORTAC'
              : rawType.includes('VOR')
                ? 'VOR'
                : rawType.includes('TACAN')
                  ? 'TACAN'
                  : rawType.includes('NDB')
                    ? 'NDB'
                    : 'DME';
          const freq =
            kind === 'NDB'
              ? freqKhz > 0
                ? `${Math.round(freqKhz)}`
                : ''
              : freqKhz > 0
                ? (freqKhz / 1000).toFixed(2)
                : '';
          const usage: NavWaypointSpec['usage'] =
            usageRaw === 'HI' ? 'HI' : usageRaw === 'LO' ? 'LO' : 'BOTH';
          const power: NavWaypointSpec['power'] =
            powerRaw === 'HIGH' ? 'HIGH' : powerRaw === 'MEDIUM' ? 'MEDIUM' : 'LOW';

          const spec: NavWaypointSpec = {
            ident,
            name,
            kind,
            freq,
            lat,
            lon,
            usage,
            power,
          };
          list.push(spec);
          if (!byIdent.has(ident) || power === 'HIGH') {
            byIdent.set(ident, spec);
          }
        }
      }
    } catch {
      // Fallback fixes only
    }

    // Add major oceanic & RNAV gateway fixes
    for (const [ident, [lat, lon]] of Object.entries(OCEANIC_FIX_COORDS)) {
      if (!byIdent.has(ident)) {
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
        list.push(fix);
        byIdent.set(ident, fix);
      }
    }

    cachedNavaids = {ts: Date.now(), list, byIdent};
    navaidsInFlight = null;
    return {list, byIdent};
  })();

  return navaidsInFlight;
}

function approxDistNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const cosLat = Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  const dLat = (lat2 - lat1) * 60;
  const dLon = (lon2 - lon1) * 60 * Math.max(0.2, cosLat);
  return Math.hypot(dLat, dLon);
}

/**
 * Constructs a clean Relative Neighborhood Graph (RNG) airway network over real navaids
 * so airways look like authentic Jet (J/Q/UL) and Victor (V/T/L) enroute charts without messy hairballs.
 */
function buildCleanAirwayGraph(
  nodes: NavWaypointSpec[],
  level: 'HI' | 'LO',
  minDistNm: number,
  maxDistNm: number,
  maxEdges: number,
): AirwaySegmentSpec[] {
  if (nodes.length < 2) return [];
  const candidates: Array<{i: number; j: number; d: number}> = [];
  const capNodes = nodes.slice(0, 260);
  for (let i = 0; i < capNodes.length; i++) {
    const a = capNodes[i];
    for (let j = i + 1; j < capNodes.length; j++) {
      const b = capNodes[j];
      const d = approxDistNm(a.lat, a.lon, b.lat, b.lon);
      if (d < minDistNm || d > maxDistNm) continue;

      // RNG criterion: keep edge (a,b) iff no third node c is closer to BOTH a and b than d(a,b)
      let blocked = false;
      for (let k = 0; k < capNodes.length; k++) {
        if (k === i || k === j) continue;
        const c = capNodes[k];
        const dac = approxDistNm(a.lat, a.lon, c.lat, c.lon);
        if (dac >= d) continue;
        const dbc = approxDistNm(b.lat, b.lon, c.lat, c.lon);
        if (dbc < d) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        candidates.push({i, j, d});
      }
    }
  }

  candidates.sort((x, y) => x.d - y.d);
  const degree = new Int32Array(capNodes.length);
  const segs: AirwaySegmentSpec[] = [];
  for (const e of candidates) {
    if (segs.length >= maxEdges) break;
    if (degree[e.i] >= 4 || degree[e.j] >= 4) continue;
    degree[e.i]++;
    degree[e.j]++;
    const a = capNodes[e.i];
    const b = capNodes[e.j];
    const hash = Math.abs((a.ident.charCodeAt(0) * 31 + b.ident.charCodeAt(0) * 17 + Math.round(e.d)) % 180) + 1;
    const prefix =
      level === 'HI'
        ? a.lon < -30
          ? 'J'
          : a.lon < 55
            ? 'UL'
            : 'A'
        : a.lon < -30
          ? 'V'
          : a.lon < 55
            ? 'L'
            : 'W';
    segs.push({
      id: `${level}-${a.ident}-${b.ident}`,
      name: `${prefix}${hash}`,
      level,
      fromIdent: a.ident,
      toIdent: b.ident,
      fromLat: a.lat,
      fromLon: a.lon,
      toLat: b.lat,
      toLon: b.lon,
    });
  }
  return segs;
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
  const padLat = Math.max(2, (lamax - lamin) * 0.25);
  const padLon = Math.max(3, (lomax - lomin) * 0.25);
  const sLat = Math.max(-85, lamin - padLat);
  const nLat = Math.min(85, lamax + padLat);
  const wLon = lomin - padLon;
  const eLon = lomax + padLon;

  const inBox = list.filter((n) => {
    if (n.lat < sLat || n.lat > nLat) return false;
    if (wLon <= eLon && eLon - wLon < 340) {
      return n.lon >= wLon && n.lon <= eLon;
    }
    return true;
  });

  // Prioritize high-power VORTAC / VOR / FIX stations cleanly
  const score = (n: NavWaypointSpec): number => {
    let sc = 0;
    if (n.kind === 'VORTAC') sc += 40;
    else if (n.kind === 'VOR') sc += 32;
    else if (n.kind === 'FIX') sc += 26;
    else if (n.kind === 'DME') sc += 14;
    else sc += 8;
    if (n.power === 'HIGH') sc += 30;
    else if (n.power === 'MEDIUM') sc += 15;
    if (n.usage === 'HI' || n.usage === 'BOTH') sc += 12;
    return sc;
  };

  inBox.sort((a, b) => score(b) - score(a));

  const maxWp = zTier === 1 ? 260 : zTier === 2 ? 320 : zTier === 3 ? 420 : 520;
  // Spatial grid thin-out + continental sector quota balancing so ALL continents (including Africa, South America, Oceania) are represented!
  const minCellDeg = zTier === 1 ? 2.6 : zTier === 2 ? 1.3 : zTier === 3 ? 0.55 : 0.16;
  const occupied = new Set<string>();
  const waypoints: NavWaypointSpec[] = [];

  const getSector = (n: NavWaypointSpec): number => {
    // 0: N.America, 1: S.America, 2: Europe, 3: Africa, 4: MidEast/Asia, 5: Oceania
    if (n.lon < -30) return n.lat >= 14 ? 0 : 1;
    if (n.lon < 52) return n.lat >= 36 ? 2 : 3;
    return n.lat >= -10 ? 4 : 5;
  };

  if (zTier <= 2 && Math.abs(eLon - wLon) > 45) {
    const sectorBuckets: NavWaypointSpec[][] = [[], [], [], [], [], []];
    for (const wp of inBox) {
      sectorBuckets[getSector(wp)].push(wp);
    }
    const perSectorCap = Math.max(24, Math.floor(maxWp / 6));
    for (const bucket of sectorBuckets) {
      let picked = 0;
      for (const wp of bucket) {
        if (picked >= perSectorCap || waypoints.length >= maxWp) break;
        const cell = `${Math.round(wp.lat / minCellDeg)},${Math.round(wp.lon / minCellDeg)}`;
        if (occupied.has(cell)) continue;
        occupied.add(cell);
        waypoints.push(wp);
        picked++;
      }
    }
  }

  for (const wp of inBox) {
    if (waypoints.length >= maxWp) break;
    const cell = `${Math.round(wp.lat / minCellDeg)},${Math.round(wp.lon / minCellDeg)}`;
    if (occupied.has(cell)) continue;
    occupied.add(cell);
    waypoints.push(wp);
  }

  const hiNodes = waypoints.filter(
    (w) =>
      (w.kind === 'VORTAC' || w.kind === 'VOR' || w.kind === 'FIX') &&
      (w.usage === 'HI' || w.usage === 'BOTH' || w.power === 'HIGH'),
  );
  const highAirways = buildCleanAirwayGraph(
    hiNodes,
    'HI',
    zTier === 1 ? 110 : 45,
    zTier === 1 ? 560 : 340,
    zTier === 1 ? 210 : 260,
  );

  let lowAirways: AirwaySegmentSpec[] = [];
  if (zoom >= 5.2) {
    const loNodes = waypoints.filter(
      (w) =>
        w.kind !== 'FIX' &&
        (w.usage === 'LO' || w.usage === 'BOTH' || w.power !== 'HIGH'),
    );
    lowAirways = buildCleanAirwayGraph(loNodes, 'LO', 14, 110, 220);
  }

  const data: EnrouteChartResponse = {waypoints, highAirways, lowAirways};
  if (enrouteCache.size > 160) {
    const oldest = enrouteCache.keys().next().value;
    if (oldest) enrouteCache.delete(oldest);
  }
  enrouteCache.set(cacheKey, {ts: Date.now(), data});
  return data;
}

function buildFallbackTimeZones(): TimeZoneBoundaryFeature[] {
  const out: TimeZoneBoundaryFeature[] = [];
  for (let h = -11; h <= 12; h++) {
    const lonCenter = h * 15;
    const w = Math.max(-180, lonCenter - 7.5);
    const e = Math.min(180, lonCenter + 7.5);
    const label = h === 0 ? 'UTC' : h > 0 ? `UTC+${h}` : `UTC${h}`;
    out.push({
      id: `tz-${h}`,
      name: label,
      utcOffsetHours: h,
      utcOffsetSec: h * 3600,
      label,
      labelLat: 12,
      labelLon: lonCenter,
      rings: [[[-72, w], [78, w], [78, e], [-72, e], [-72, w]]],
    });
  }
  return out;
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

      const json = (await res.json()) as {
        features?: Array<{
          properties?: {
            objectid?: string | number;
            name?: string;
            zone?: number;
            utc_format?: string;
            places?: string;
          };
          geometry?: {
            type?: string;
            coordinates?: unknown;
          };
        }>;
      };

      const out: TimeZoneBoundaryFeature[] = [];
      for (let idx = 0; idx < (json.features ?? []).length; idx++) {
        const feat = json.features![idx];
        const props = feat.properties ?? {};
        const zoneHrs = Number(props.zone ?? 0);
        const utcLabel = String(props.utc_format || (zoneHrs === 0 ? 'UTC' : zoneHrs > 0 ? `UTC+${zoneHrs}` : `UTC${zoneHrs}`)).replace('UTC±00:00', 'UTC').replace(':00', '');
        const rings: Array<Array<[number, number]>> = [];
        const gType = feat.geometry?.type;
        const coords = feat.geometry?.coordinates;

        let sumLat = 0;
        let sumLon = 0;
        let cnt = 0;

        if (gType === 'Polygon' && Array.isArray(coords) && Array.isArray(coords[0])) {
          const pts: Array<[number, number]> = [];
          for (const c of coords[0]) {
            if (Array.isArray(c) && c.length >= 2) {
              const lat = Number(c[1]);
              const lon = Number(c[0]);
              pts.push([lat, lon]);
              sumLat += lat;
              sumLon += lon;
              cnt++;
            }
          }
          if (pts.length >= 3) rings.push(simplifyRing(pts, 0.35, 90));
        } else if (gType === 'MultiPolygon' && Array.isArray(coords)) {
          for (const poly of coords) {
            if (!Array.isArray(poly) || !Array.isArray(poly[0])) continue;
            const pts: Array<[number, number]> = [];
            for (const c of poly[0]) {
              if (Array.isArray(c) && c.length >= 2) {
                const lat = Number(c[1]);
                const lon = Number(c[0]);
                pts.push([lat, lon]);
                sumLat += lat;
                sumLon += lon;
                cnt++;
              }
            }
            if (pts.length >= 3) rings.push(simplifyRing(pts, 0.35, 70));
          }
        }

        if (rings.length === 0) continue;
        const cLat = cnt > 0 ? sumLat / cnt : rings[0][0][0];
        const cLon = cnt > 0 ? sumLon / cnt : rings[0][0][1];

        out.push({
          id: `tz-${props.objectid ?? idx}`,
          name: String(props.name || props.places || utcLabel),
          utcOffsetHours: Number.isFinite(zoneHrs) ? zoneHrs : 0,
          utcOffsetSec: Math.round((Number.isFinite(zoneHrs) ? zoneHrs : 0) * 3600),
          label: utcLabel,
          labelLat: cLat,
          labelLon: cLon,
          rings,
        });
      }

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

