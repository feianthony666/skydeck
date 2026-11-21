import type {
  AirwaySegmentSpec,
  AtcBoundaryFeature,
  EnrouteChartResponse,
  LiveAtcStation,
  NavWaypointSpec,
  OceanicTrackSpec,
  TimeZoneBoundaryFeature,
  WeatherHazardMarker,
  WeatherLayersResponse,
  WeatherWindPoint,
} from '../types/aviation';

export const OCEANIC_FIX_COORDS: Record<string, [number, number]> = {
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
  GRU: [-23.43, -46.47],
  GIG: [-22.81, -43.25],
  EZE: [-34.82, -58.53],
  SCL: [-33.39, -70.79],
  BOG: [4.7, -74.15],
  LIM: [-12.02, -77.11],
  CCS: [10.6, -66.99],
  UIO: [-0.11, -78.36],
  MAO: [-3.04, -60.05],
  REC: [-8.13, -34.92],
  ASU: [-25.24, -57.52],
  MVD: [-34.84, -56.03],
  JNB: [-26.14, 28.24],
  CPT: [-33.97, 18.6],
  CAI: [30.12, 31.41],
  ADD: [8.98, 38.8],
  NBO: [-1.32, 36.93],
  LOS: [6.58, 3.32],
  CMN: [33.37, -7.59],
  ALG: [36.69, 3.22],
  TUN: [36.85, 10.23],
  DAR: [-6.88, 39.2],
  KRT: [15.59, 32.55],
  ABV: [9.01, 7.26],
  DKR: [14.74, -17.49],
  FIH: [-4.39, 15.44],
  DXB: [25.25, 55.36],
  DOH: [25.27, 51.61],
  RUH: [24.96, 46.7],
  DEL: [28.56, 77.1],
  BOM: [19.09, 72.87],
  BKK: [13.68, 100.75],
  SIN: [1.35, 103.99],
  CGK: [-6.13, 106.66],
  PEK: [40.08, 116.6],
  PVG: [31.14, 121.81],
  SYD: [-33.95, 151.18],
  MEL: [-37.67, 144.84],
  PER: [-31.94, 115.97],
  BNE: [-27.38, 153.12],
  AKL: [-37.01, 174.79],
  NAN: [-17.76, 177.44],
};

export function simplifyRing(
  ring: Array<[number, number]>,
  minStepDeg = 0.09,
  maxPts = 140,
): Array<[number, number]> {
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

export const FALLBACK_FIRS: AtcBoundaryFeature[] = [
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

export const BUILTIN_PACOTS: OceanicTrackSpec[] = [
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

export const BUILTIN_NAT_FALLBACK: OceanicTrackSpec[] = [
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
];

export function parseAtcBoundariesFromVatsim(
  geojson: {
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
  },
  datText?: string | null,
): AtcBoundaryFeature[] {
  const firNames = new Map<string, string>();
  if (datText) {
    let inFirs = false;
    for (const rawLine of datText.split(/\r?\n/)) {
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

  const out: AtcBoundaryFeature[] = [];
  for (const feat of geojson.features ?? []) {
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

  return out;
}

function parseCoordToken(token: string, hemisphereHint: 'NAT' | 'PACOT'): [number, number] | null {
  const clean = token.trim().toUpperCase();
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
  const dmsMatch = clean.match(/^(\d{2})(\d{2})?([NS])(\d{3})(\d{2})?([EW])$/);
  if (dmsMatch) {
    const lat = (Number(dmsMatch[1]) + (dmsMatch[2] ? Number(dmsMatch[2]) / 60 : 0)) * (dmsMatch[3] === 'S' ? -1 : 1);
    const lon = (Number(dmsMatch[4]) + (dmsMatch[5] ? Number(dmsMatch[5]) / 60 : 0)) * (dmsMatch[6] === 'W' ? -1 : 1);
    return [lat, lon];
  }
  return null;
}

export function parseOceanicTracksFromNattrak(
  raw: Array<{
    identifier?: string;
    active?: boolean;
    last_routeing?: string;
    valid_from?: string;
    valid_to?: string;
    flight_levels?: number[];
    direction?: string;
  }>,
  byIdent: Map<string, NavWaypointSpec>,
): OceanicTrackSpec[] {
  const tracks: OceanicTrackSpec[] = [];
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
  return tracks;
}

function parseCsvLine(line: string): string[] {
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

export function buildBuiltinFixNavaids(): {
  list: NavWaypointSpec[];
  byIdent: Map<string, NavWaypointSpec>;
} {
  const list: NavWaypointSpec[] = [];
  const byIdent = new Map<string, NavWaypointSpec>();
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
    list.push(fix);
    byIdent.set(ident, fix);
  }
  return {list, byIdent};
}

export function parseNavaidsCsv(csv: string): {
  list: NavWaypointSpec[];
  byIdent: Map<string, NavWaypointSpec>;
} {
  const list: NavWaypointSpec[] = [];
  const byIdent = new Map<string, NavWaypointSpec>();
  const lines = csv.split(/\r?\n/);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = parseCsvLine(line);
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

    const kind: NavWaypointSpec['kind'] = rawType.includes('VORTAC')
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

  return {list, byIdent};
}

function approxDistNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const cosLat = Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  const dLat = (lat2 - lat1) * 60;
  const dLon = (lon2 - lon1) * 60 * Math.max(0.2, cosLat);
  return Math.hypot(dLat, dLon);
}

export function buildCleanAirwayGraph(
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

export function computeEnrouteChartForBounds(
  list: NavWaypointSpec[],
  lamin: number,
  lamax: number,
  lomin: number,
  lomax: number,
  zoom: number,
): EnrouteChartResponse {
  const zTier = zoom < 4.5 ? 1 : zoom < 6.5 ? 2 : zoom < 8.8 ? 3 : 4;
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
  const minCellDeg = zTier === 1 ? 2.6 : zTier === 2 ? 1.3 : zTier === 3 ? 0.55 : 0.16;
  const occupied = new Set<string>();
  const waypoints: NavWaypointSpec[] = [];

  const getSector = (n: NavWaypointSpec): number => {
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
      (w) => w.kind !== 'FIX' && (w.usage === 'LO' || w.usage === 'BOTH' || w.power !== 'HIGH'),
    );
    lowAirways = buildCleanAirwayGraph(loNodes, 'LO', 14, 110, 220);
  }

  return {waypoints, highAirways, lowAirways};
}

export function buildFallbackTimeZones(): TimeZoneBoundaryFeature[] {
  const out: TimeZoneBoundaryFeature[] = [];
  for (let h = -11; h <= 12; h++) {
    const lonCenter = h * 15;
    const w = Math.max(-180, lonCenter - 7.5);
    const e = Math.min(180, lonCenter + 7.5);
    const label = h === 0 ? 'UTC' : h > 0 ? `UTC+${h}` : `UTC${h}`;
    out.push({
      id: `tz-${h + 11}-${h}`,
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

export function parseTimeZonesFromGeoJson(json: {
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
}): TimeZoneBoundaryFeature[] {
  const out: TimeZoneBoundaryFeature[] = [];
  for (let idx = 0; idx < (json.features ?? []).length; idx++) {
    const feat = json.features![idx];
    const props = feat.properties ?? {};
    const zoneHrs = Number(props.zone ?? 0);
    const utcLabel = String(
      props.utc_format || (zoneHrs === 0 ? 'UTC' : zoneHrs > 0 ? `UTC+${zoneHrs}` : `UTC${zoneHrs}`),
    )
      .replace('UTC±00:00', 'UTC')
      .replace(':00', '');
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
      id: `tz-${idx}-${props.objectid ?? 'f'}`,
      name: String(props.name || props.places || utcLabel),
      utcOffsetHours: Number.isFinite(zoneHrs) ? zoneHrs : 0,
      utcOffsetSec: Math.round((Number.isFinite(zoneHrs) ? zoneHrs : 0) * 3600),
      label: utcLabel,
      labelLat: cLat,
      labelLon: cLon,
      rings,
    });
  }
  return out;
}

export function parseWeatherLayersPayload(params: {
  omJson: unknown;
  pirepJson: Array<Record<string, unknown>> | null;
  isigmetJson: Array<Record<string, unknown>> | null;
  airsigmetJson: Array<Record<string, unknown>> | null;
  metarJson: Array<Record<string, unknown>> | null;
  sampleLats: number[];
  sampleLons: number[];
  latSpan: number;
  lonSpan: number;
}): WeatherLayersResponse {
  const {omJson, pirepJson, isigmetJson, airsigmetJson, metarJson, sampleLats, sampleLons, latSpan, lonSpan} =
    params;

  const pireps: WeatherHazardMarker[] = [];
  const volcanic: WeatherHazardMarker[] = [];
  const lightning: WeatherHazardMarker[] = [];
  const sigwx: WeatherHazardMarker[] = [];
  const fogZones: WeatherHazardMarker[] = [];
  const windGrid: WeatherWindPoint[] = [];

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
        detail:
          rawOb ||
          [tb && `TURB ${tb}`, ic && `ICE ${ic}`].filter(Boolean).join(' · ') ||
          'Pilot report',
        severity: sev,
      });
    }
  }

  if (Array.isArray(isigmetJson)) {
    for (let i = 0; i < isigmetJson.length; i++) {
      const row = isigmetJson[i];
      const haz = String(row.hazard ?? '').toUpperCase();
      const rawText = String(row.rawSigmet ?? row.rawText ?? '');
      const baseFt = Number.isFinite(Number(row.base)) ? Number(row.base) : null;
      const topFt = Number.isFinite(Number(row.top)) ? Number(row.top) : null;
      const rawCoords = Array.isArray(row.coords)
        ? (row.coords as Array<{lat?: number; lon?: number}>)
        : [];
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
            title: volcNameMatch
              ? `VOLCANO ${volcNameMatch[0].toUpperCase()}`
              : 'Volcanic Ash Advisory',
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

      if (
        ring.length >= 3 &&
        ((topFt !== null && topFt >= 25000) ||
          (baseFt !== null && baseFt >= 24000) ||
          /CB|JET|CAT|TS|SIGWX/i.test(`${haz} ${rawText}`))
      ) {
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

  if (Array.isArray(airsigmetJson)) {
    for (let i = 0; i < airsigmetJson.length; i++) {
      const row = airsigmetJson[i];
      const haz = String(row.hazard ?? '').toUpperCase();
      const rawText = String(row.rawAirSigmet ?? row.rawText ?? '');
      const topFt = Number.isFinite(Number(row.altitudeHi1)) ? Number(row.altitudeHi1) : null;
      const rawCoords = Array.isArray(row.coords)
        ? (row.coords as Array<{lat?: number; lon?: number}>)
        : [];
      const ring: Array<[number, number]> = rawCoords
        .map((c) => [Number(c.lat), Number(c.lon)] as [number, number])
        .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
      if (ring.length < 3) continue;

      if (
        (topFt !== null && topFt >= 25000) ||
        /CONVECTIVE|SIGMET/i.test(String(row.airSigmetType ?? ''))
      ) {
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
          severity:
            /\b(FG|FZFG)\b/.test(wx) || (Number.isFinite(visNum) && visNum < 0.75) ? 'SEV' : 'MOD',
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

  return {
    windGrid,
    pireps: pireps.slice(0, 90),
    volcanic: volcanic.slice(0, 40),
    lightning: lightning.slice(0, 70),
    fogZones: fogZones.slice(0, 60),
    sigwx: sigwx.slice(0, 60),
    fetchedAt: Date.now(),
  };
}

export const LIVEATC_STATIONS: LiveAtcStation[] = [
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

export function sampleReliefElevationM(lat: number, lon: number): number {
  const ridge1 = Math.sin(lat * 0.21 + lon * 0.08) * Math.cos(lon * 0.14 - lat * 0.11);
  const ridge2 = Math.sin(lat * 0.68 - lon * 0.42) * 0.5 + Math.cos(lat * 1.3 + lon * 0.9) * 0.25;
  const isAlps = lat > 44 && lat < 48 && lon > 5 && lon < 16 ? 1900 : 0;
  const isRockies = lat > 32 && lat < 55 && lon > -123 && lon < -104 ? 1650 : 0;
  const isAndes = lat > -50 && lat < 10 && lon > -78 && lon < -66 ? 2400 : 0;
  const isHimalaya = lat > 26 && lat < 38 && lon > 70 && lon < 102 ? 3200 : 0;
  const belt = Math.max(isAlps, isRockies, isAndes, isHimalaya);
  const base =
    belt > 0
      ? belt * Math.max(0.15, ridge1 * 0.5 + 0.5) + Math.max(0, ridge2) * 420
      : Math.max(0, (ridge1 + ridge2) * 180);
  return Math.round(base);
}

export function buildReliefTerrainGrid(
  lat: number,
  lon: number,
  spanDeg: number,
  gridN: number,
) {
  const heightsM: number[] = [];
  for (let r = 0; r < gridN; r++) {
    const rLat = lat - spanDeg * 0.5 + (r / Math.max(1, gridN - 1)) * spanDeg;
    for (let c = 0; c < gridN; c++) {
      const cLon = lon - spanDeg * 0.5 + (c / Math.max(1, gridN - 1)) * spanDeg;
      heightsM.push(sampleReliefElevationM(rLat, cLon));
    }
  }
  return {
    lat,
    lon,
    spanDeg,
    gridN,
    heightsM,
    source: 'relief-model' as const,
    attribution: 'SkyDeck Topographic Relief Model',
  };
}
