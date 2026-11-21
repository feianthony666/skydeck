import type {
  AirfieldHoldingPosition,
  AirfieldPolygonFeature,
  AirfieldStandFeature,
  AirfieldSurfaceGate,
  TaxiwaySegment,
} from '../types/aviation';

export interface OverpassGeomPoint {
  lat: number;
  lon: number;
}

export interface OverpassRelationMember {
  type: string;
  role?: string;
  geometry?: OverpassGeomPoint[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation' | string;
  id: number;
  lat?: number;
  lon?: number;
  geometry?: OverpassGeomPoint[];
  members?: OverpassRelationMember[];
  tags?: Record<string, string>;
}

export interface AipRunwaySimple {
  ref?: string;
  leLat: number;
  leLon: number;
  heLat: number;
  heLon: number;
  widthM: number;
}

export const GLOBAL_OVERPASS_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export function buildOverpassAirfieldQuery(lat: number, lon: number, timeoutSec = 14): string {
  const s = (lat - 0.055).toFixed(4);
  const w = (lon - 0.080).toFixed(4);
  const n = (lat + 0.055).toFixed(4);
  const e = (lon + 0.080).toFixed(4);
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:${timeoutSec}];(way["aeroway"~"^(runway|taxiway|taxilane|apron|terminal|parking_position|holding_position|displaced_threshold|stopway)$"](${bbox});relation["aeroway"~"^(apron|terminal)$"](${bbox});way["building"="terminal"](${bbox});relation["building"="terminal"](${bbox});node["aeroway"~"^(gate|parking_position|terminal|holding_position|displaced_threshold)$"](${bbox}););out geom qt;`;
}

function cleanTaxiwayRef(raw?: string): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  s = s.replace(/^(taxiway|taxilane|twy)\s+/i, '').trim();
  return s || undefined;
}

export function polygonCentroid(coords: Array<[number, number]>): [number, number] {
  if (coords.length === 0) return [0, 0];
  let sumLat = 0;
  let sumLon = 0;
  const count =
    coords.length > 2 &&
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1]
      ? coords.length - 1
      : coords.length;
  for (let i = 0; i < count; i++) {
    sumLat += coords[i][0];
    sumLon += coords[i][1];
  }
  return [sumLat / Math.max(1, count), sumLon / Math.max(1, count)];
}

function stitchOuterRings(members: OverpassRelationMember[]): Array<Array<[number, number]>> {
  const rawSegs: Array<Array<[number, number]>> = [];
  for (const m of members) {
    if (m.role && m.role !== 'outer') continue;
    if (!Array.isArray(m.geometry) || m.geometry.length < 2) continue;
    const pts: Array<[number, number]> = m.geometry
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => [p.lat, p.lon]);
    if (pts.length >= 2) rawSegs.push(pts);
  }
  if (rawSegs.length === 0) return [];

  const rings: Array<Array<[number, number]>> = [];
  const used = new Array(rawSegs.length).fill(false);
  const closeEnough = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;

  for (let i = 0; i < rawSegs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [...rawSegs[i]];
    let extended = true;
    while (extended && !closeEnough(chain[0], chain[chain.length - 1])) {
      extended = false;
      const tail = chain[chain.length - 1];
      for (let j = 0; j < rawSegs.length; j++) {
        if (used[j]) continue;
        const cand = rawSegs[j];
        if (closeEnough(tail, cand[0])) {
          chain.push(...cand.slice(1));
          used[j] = true;
          extended = true;
          break;
        }
        if (closeEnough(tail, cand[cand.length - 1])) {
          chain.push(...[...cand].reverse().slice(1));
          used[j] = true;
          extended = true;
          break;
        }
      }
    }
    if (chain.length >= 3) {
      rings.push(chain);
    }
  }
  return rings;
}

function bearingDeg(p1: [number, number], p2: [number, number]): number {
  const toRad = Math.PI / 180;
  const lat1 = p1[0] * toRad;
  const lat2 = p2[0] * toRad;
  const dLon = (p2[1] - p1[1]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function axisDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

export function mergeAndAlignRunways(
  osmRunways: TaxiwaySegment[],
  aipRunways: AipRunwaySimple[],
): TaxiwaySegment[] {
  // 1. Merge collinear end-to-end OSM runway ways (e.g., displaced thresholds / stopways)
  const working: TaxiwaySegment[] = osmRunways
    .filter((r) => r.coords.length >= 2)
    .map((r) => ({...r, coords: [...r.coords]}));

  const endpointNear = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.00055;

  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    for (let i = 0; i < working.length; i++) {
      const a = working[i];
      const brgA = bearingDeg(a.coords[0], a.coords[a.coords.length - 1]);
      for (let j = i + 1; j < working.length; j++) {
        const b = working[j];
        const brgB = bearingDeg(b.coords[0], b.coords[b.coords.length - 1]);
        if (axisDiffDeg(brgA, brgB) > 4.5) continue;

        const a0 = a.coords[0];
        const a1 = a.coords[a.coords.length - 1];
        const b0 = b.coords[0];
        const b1 = b.coords[b.coords.length - 1];

        let combined: Array<[number, number]> | null = null;
        if (endpointNear(a1, b0)) {
          combined = [...a.coords, ...b.coords.slice(1)];
        } else if (endpointNear(a1, b1)) {
          combined = [...a.coords, ...[...b.coords].reverse().slice(1)];
        } else if (endpointNear(a0, b1)) {
          combined = [...b.coords, ...a.coords.slice(1)];
        } else if (endpointNear(a0, b0)) {
          combined = [...[...b.coords].reverse(), ...a.coords.slice(1)];
        }

        if (combined) {
          const bestRef =
            a.ref && a.ref.includes('/')
              ? a.ref
              : b.ref && b.ref.includes('/')
                ? b.ref
                : a.ref || b.ref;
          working[i] = {
            ...a,
            ref: bestRef,
            widthM: Math.max(a.widthM ?? 45, b.widthM ?? 45),
            coords: combined,
          };
          working.splice(j, 1);
          mergedAny = true;
          break;
        }
      }
      if (mergedAny) break;
    }
  }

  if (working.length > 0) {
    // 2. Keep exact OSM runway coordinates (100% aligned with OSM taxiways/aprons/basemap)
    //    and enrich missing designator refs or widths from AIP data.
    const usedAip = new Set<number>();
    for (const osm of working) {
      const oA = osm.coords[0];
      const oB = osm.coords[osm.coords.length - 1];
      const oMidLat = (oA[0] + oB[0]) * 0.5;
      const oMidLon = (oA[1] + oB[1]) * 0.5;
      const oBrg = bearingDeg(oA, oB);

      let bestIdx = -1;
      let bestDist = Infinity;
      for (let k = 0; k < aipRunways.length; k++) {
        const aip = aipRunways[k];
        const aMidLat = (aip.leLat + aip.heLat) * 0.5;
        const aMidLon = (aip.leLon + aip.heLon) * 0.5;
        const aBrg = bearingDeg([aip.leLat, aip.leLon], [aip.heLat, aip.heLon]);
        if (axisDiffDeg(oBrg, aBrg) > 12) continue;
        const d = Math.hypot(oMidLat - aMidLat, oMidLon - aMidLon);
        if (d < 0.0055 && d < bestDist) {
          bestDist = d;
          bestIdx = k;
        }
      }

      if (bestIdx >= 0) {
        usedAip.add(bestIdx);
        const match = aipRunways[bestIdx];
        if ((!osm.ref || !osm.ref.includes('/')) && match.ref) {
          osm.ref = match.ref;
        }
        if (!osm.widthM || osm.widthM === 45) {
          osm.widthM = match.widthM;
        }
      }
    }

    // 3. Append any AIP runway not covered by OSM (e.g., crosswind or brand-new runway)
    aipRunways.forEach((aip, idx) => {
      if (usedAip.has(idx)) return;
      const aMidLat = (aip.leLat + aip.heLat) * 0.5;
      const aMidLon = (aip.leLon + aip.heLon) * 0.5;
      const covered = working.some((osm) => {
        const oA = osm.coords[0];
        const oB = osm.coords[osm.coords.length - 1];
        const oMidLat = (oA[0] + oB[0]) * 0.5;
        const oMidLon = (oA[1] + oB[1]) * 0.5;
        return Math.hypot(oMidLat - aMidLat, oMidLon - aMidLon) < 0.0038;
      });
      if (!covered) {
        working.push({
          id: `aip-rwy-${idx}`,
          kind: 'runway',
          ref: aip.ref,
          widthM: aip.widthM,
          coords: [
            [aip.leLat, aip.leLon],
            [aip.heLat, aip.heLon],
          ],
        });
      }
    });

    return working;
  }

  return aipRunways.map((r, idx) => ({
    id: `aip-rwy-${idx}`,
    kind: 'runway' as const,
    ref: r.ref,
    widthM: r.widthM,
    coords: [
      [r.leLat, r.leLon],
      [r.heLat, r.heLon],
    ],
  }));
}

export function parseOverpassAirfieldElements(elements: OverpassElement[]): {
  osmRunways: TaxiwaySegment[];
  taxiways: TaxiwaySegment[];
  aprons: Array<Array<[number, number]>>;
  labeledAprons: AirfieldPolygonFeature[];
  terminals: AirfieldPolygonFeature[];
  stands: AirfieldStandFeature[];
  holdingPositions: AirfieldHoldingPosition[];
  gates: AirfieldSurfaceGate[];
} {
  const osmRunways: TaxiwaySegment[] = [];
  const taxiways: TaxiwaySegment[] = [];
  const aprons: Array<Array<[number, number]>> = [];
  const labeledAprons: AirfieldPolygonFeature[] = [];
  const terminals: AirfieldPolygonFeature[] = [];
  const stands: AirfieldStandFeature[] = [];
  const holdingPositions: AirfieldHoldingPosition[] = [];
  const dispNodes: Array<{lat: number; lon: number; ref?: string}> = [];
  const dispWays: Array<{coords: Array<[number, number]>; ref?: string}> = [];
  const standDedupe = new Set<string>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    const aw = tags.aeroway;
    const bld = tags.building;

    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      if (aw === 'holding_position') {
        holdingPositions.push({
          id: `hold-node-${el.id}`,
          lat: el.lat!,
          lon: el.lon!,
          ref: (tags.ref || tags.name || '').trim() || undefined,
        });
      } else if (aw === 'displaced_threshold') {
        dispNodes.push({
          lat: el.lat!,
          lon: el.lon!,
          ref: (tags.ref || tags.name || '').trim() || undefined,
        });
      } else if (aw === 'gate' || aw === 'parking_position') {
        const ref = (tags.ref || tags.name || '').trim();
        if (ref) {
          const key = `${ref}-${Math.round(el.lat! * 2500)}-${Math.round(el.lon! * 2500)}`;
          if (!standDedupe.has(key)) {
            standDedupe.add(key);
            stands.push({
              id: `stand-${el.id}`,
              ref,
              kind: aw === 'parking_position' ? 'parking_position' : 'gate',
              lat: el.lat!,
              lon: el.lon!,
            });
          }
        }
      } else if (aw === 'terminal') {
        const name = (tags.name || tags.ref || '').trim();
        if (name) {
          const d = 0.00028;
          terminals.push({
            id: `term-node-${el.id}`,
            name,
            ref: tags.ref,
            coords: [
              [el.lat! - d, el.lon!],
              [el.lat!, el.lon! + d],
              [el.lat! + d, el.lon!],
              [el.lat!, el.lon! - d],
            ],
            center: [el.lat!, el.lon!],
          });
        }
      }
      continue;
    }

    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const coords: Array<[number, number]> = el.geometry
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .map((p) => [p.lat, p.lon]);
      if (coords.length < 2) continue;

      if (aw === 'runway') {
        const widthM = Number.parseFloat(tags.width ?? '45') || 45;
        const rawDisp1 = Number.parseFloat(tags['displaced_threshold:1'] ?? tags['displaced_threshold'] ?? '');
        const rawDisp2 = Number.parseFloat(tags['displaced_threshold:2'] ?? '');
        osmRunways.push({
          id: `rwy-${el.id}`,
          kind: 'runway',
          ref: tags.ref,
          widthM,
          coords,
          dispStartM: Number.isFinite(rawDisp1) && rawDisp1 > 5 ? rawDisp1 : undefined,
          dispEndM: Number.isFinite(rawDisp2) && rawDisp2 > 5 ? rawDisp2 : undefined,
        });
      } else if (aw === 'displaced_threshold') {
        dispWays.push({coords, ref: (tags.ref || tags.name || '').trim() || undefined});
      } else if (aw === 'taxiway' || aw === 'taxilane') {
        const widthM = Number.parseFloat(tags.width ?? (aw === 'taxilane' ? '14' : '22')) || 22;
        taxiways.push({
          id: `twy-${el.id}`,
          kind: aw === 'taxilane' ? 'taxilane' : 'taxiway',
          ref: cleanTaxiwayRef(tags.ref || tags.name),
          widthM,
          coords,
        });
      } else if (aw === 'parking_position') {
        const ref = (tags.ref || tags.name || '').trim();
        const mid = coords[Math.floor(coords.length / 2)];
        if (ref) {
          const key = `${ref}-${Math.round(mid[0] * 2500)}-${Math.round(mid[1] * 2500)}`;
          standDedupe.add(key);
        }
        stands.push({
          id: `stand-way-${el.id}`,
          ref,
          kind: 'parking_position',
          lat: mid[0],
          lon: mid[1],
          coords,
        });
      } else if (aw === 'holding_position') {
        const mid = coords[Math.floor(coords.length / 2)];
        holdingPositions.push({
          id: `hold-way-${el.id}`,
          lat: mid[0],
          lon: mid[1],
          ref: (tags.ref || tags.name || '').trim() || undefined,
          coords,
        });
      } else if (aw === 'apron' && coords.length >= 3) {
        aprons.push(coords);
        labeledAprons.push({
          id: `apron-${el.id}`,
          ref: tags.ref?.trim() || undefined,
          name: tags.name?.trim() || undefined,
          coords,
          center: polygonCentroid(coords),
        });
      } else if ((aw === 'terminal' || bld === 'terminal') && coords.length >= 3) {
        terminals.push({
          id: `term-${el.id}`,
          ref: tags.ref?.trim() || undefined,
          name: (tags.name || tags.ref || '').trim() || undefined,
          coords,
          center: polygonCentroid(coords),
        });
      }
      continue;
    }

    if (el.type === 'relation' && Array.isArray(el.members)) {
      const rings = stitchOuterRings(el.members);
      if (rings.length === 0) continue;
      if (aw === 'apron') {
        rings.forEach((ring, idx) => {
          aprons.push(ring);
          labeledAprons.push({
            id: `apron-rel-${el.id}-${idx}`,
            ref: tags.ref?.trim() || undefined,
            name: tags.name?.trim() || undefined,
            coords: ring,
            center: polygonCentroid(ring),
          });
        });
      } else if (aw === 'terminal' || bld === 'terminal') {
        rings.forEach((ring, idx) => {
          terminals.push({
            id: `term-rel-${el.id}-${idx}`,
            ref: tags.ref?.trim() || undefined,
            name: (tags.name || tags.ref || '').trim() || undefined,
            coords: ring,
            center: polygonCentroid(ring),
          });
        });
      }
    }
  }

  // Project OSM displaced_threshold nodes/ways onto nearby runway ends
  const metersBetween = (a: [number, number], b: [number, number]) => {
    const cosLat = Math.max(0.2, Math.cos(((a[0] + b[0]) * 0.5 * Math.PI) / 180));
    return Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * cosLat);
  };
  const projectAlongRunway = (
    p: [number, number],
    a: [number, number],
    b: [number, number],
  ): {t: number; perpM: number; totalM: number} => {
    const cosLat = Math.max(0.2, Math.cos(((a[0] + b[0]) * 0.5 * Math.PI) / 180));
    const ax = a[1] * 111320 * cosLat;
    const ay = a[0] * 111320;
    const bx = b[1] * 111320 * cosLat;
    const by = b[0] * 111320;
    const px = p[1] * 111320 * cosLat;
    const py = p[0] * 111320;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const totalM = Math.sqrt(lenSq);
    if (lenSq < 100) return {t: -1, perpM: 9999, totalM};
    const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    return {t, perpM: Math.hypot(px - projX, py - projY), totalM};
  };

  for (const rwy of osmRunways) {
    if (rwy.coords.length < 2) continue;
    const a = rwy.coords[0];
    const b = rwy.coords[rwy.coords.length - 1];
    const totalLen = metersBetween(a, b);
    if (totalLen < 400) continue;
    for (const dn of dispNodes) {
      const pr = projectAlongRunway([dn.lat, dn.lon], a, b);
      if (pr.perpM <= Math.max(40, (rwy.widthM ?? 45) * 0.9)) {
        const dFromA = pr.t * pr.totalM;
        const dFromB = (1 - pr.t) * pr.totalM;
        if (dFromA > 20 && dFromA < 900) {
          rwy.dispStartM = Math.max(rwy.dispStartM ?? 0, Math.round(dFromA));
        } else if (dFromB > 20 && dFromB < 900) {
          rwy.dispEndM = Math.max(rwy.dispEndM ?? 0, Math.round(dFromB));
        }
      }
    }
    for (const dw of dispWays) {
      const mid = dw.coords[Math.floor(dw.coords.length / 2)];
      const pr = projectAlongRunway(mid, a, b);
      if (pr.perpM <= Math.max(45, (rwy.widthM ?? 45) * 1.0)) {
        const dFromA = pr.t * pr.totalM;
        const dFromB = (1 - pr.t) * pr.totalM;
        if (dFromA > 20 && dFromA < 950) {
          rwy.dispStartM = Math.max(rwy.dispStartM ?? 0, Math.round(dFromA));
        } else if (dFromB > 20 && dFromB < 950) {
          rwy.dispEndM = Math.max(rwy.dispEndM ?? 0, Math.round(dFromB));
        }
      }
    }
  }

  // Drop synthetic node terminals if an actual terminal polygon exists nearby
  const polyTerminals = terminals.filter((t) => !t.id.startsWith('term-node-'));
  const finalTerminals =
    polyTerminals.length > 0
      ? [
          ...polyTerminals,
          ...terminals.filter(
            (t) =>
              t.id.startsWith('term-node-') &&
              !polyTerminals.some(
                (p) => Math.hypot(p.center[0] - t.center[0], p.center[1] - t.center[1]) < 0.003,
              ),
          ),
        ]
      : terminals;

  const gates: AirfieldSurfaceGate[] = stands
    .filter((s) => Boolean(s.ref))
    .slice(0, 260)
    .map((s) => ({id: s.id, ref: s.ref, lat: s.lat, lon: s.lon}));

  return {
    osmRunways,
    taxiways,
    aprons,
    labeledAprons,
    terminals: finalTerminals,
    stands,
    holdingPositions,
    gates,
  };
}

/**
 * Curated AIP Displaced Threshold lengths in meters keyed by Airport ICAO -> Runway End Designator.
 * Accurately matches each runway end using its numeric heading vs actual way geometry direction.
 */
export const DISPLACED_THRESHOLD_DB: Record<string, Record<string, number>> = {
  KSFO: {'28R': 91, '10L': 549, '10R': 274, '19L': 85, '01L': 46},
  KLAX: {'24L': 117, '24R': 88, '25L': 274, '25R': 450, '06L': 102, '07R': 152},
  KJFK: {'04L': 210, '22R': 765, '13L': 91, '31R': 1030, '31L': 1168},
  EGLL: {'27R': 307, '27L': 307, '09L': 306, '09R': 306},
  KORD: {'10C': 152, '28C': 152, '09R': 244, '27R': 305},
  KATL: {'08L': 152, '26R': 152, '09L': 244},
  EDDF: {'07C': 320, '25R': 180, '07R': 210},
  VHHH: {'07L': 360, '25R': 360, '07R': 240},
  ZSPD: {'17R': 200, '35L': 200, '16L': 180},
  ZBAA: {'36R': 200, '18L': 200},
  ZGSZ: {'15': 180, '33': 180},
  RJTT: {'34R': 150, '16L': 200, '05': 120},
  WSSS: {'02L': 300, '20R': 740, '02C': 250},
  OMDB: {'12L': 180, '30R': 240, '12R': 320},
};

function endDesignatorHeadingDeg(ident: string): number | null {
  const m = ident.trim().toUpperCase().match(/^(\d{2})/);
  if (!m) return null;
  return (Number(m[1]) * 10) % 360;
}

export function applyDisplacedThresholds(icao: string, runways: TaxiwaySegment[]): TaxiwaySegment[] {
  const db = DISPLACED_THRESHOLD_DB[icao.toUpperCase()];
  if (!db) return runways;
  return runways.map((rwy) => {
    if (rwy.coords.length < 2) return rwy;
    const parts = (rwy.ref || '')
      .split('/')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (parts.length === 0) return rwy;

    const brgAtoB = bearingDeg(rwy.coords[0], rwy.coords[rwy.coords.length - 1]);
    let dispStartM = rwy.dispStartM ?? 0;
    let dispEndM = rwy.dispEndM ?? 0;

    for (const ident of parts) {
      const dbVal = db[ident];
      if (!dbVal || dbVal <= 0) continue;
      const hdg = endDesignatorHeadingDeg(ident);
      if (hdg === null) continue;
      // Landing in direction `hdg` means coords[0] is the threshold when brgAtoB aligns with hdg;
      // otherwise coords[last] (where landing direction brgBtoA aligns with hdg) is the threshold.
      const diffA = Math.abs((((hdg - brgAtoB + 540) % 360) - 180));
      const diffB = Math.abs((((hdg - ((brgAtoB + 180) % 360) + 540) % 360) - 180));
      if (diffA <= diffB && diffA <= 45) {
        dispStartM = Math.max(dispStartM, dbVal);
      } else if (diffB <= 45) {
        dispEndM = Math.max(dispEndM, dbVal);
      }
    }

    return {
      ...rwy,
      ...(dispStartM > 0 ? {dispStartM} : {}),
      ...(dispEndM > 0 ? {dispEndM} : {}),
    };
  });
}

export interface CuratedHubSeed {
  icao: string;
  iata: string;
  lat: number;
  lon: number;
  runways: Array<{
    id: string;
    ref: string;
    widthM: number;
    coords: Array<[number, number]>;
  }>;
}

/**
 * Exact WGS-84 runway endpoints for major hubs so Frame-0 rendering before Overpass
 * completes is aligned directly on real satellite/basemap runways instead of synthetic offsets.
 */
export const CURATED_HUB_AIRFIELDS: Record<string, CuratedHubSeed> = {
  KSFO: {
    icao: 'KSFO',
    iata: 'SFO',
    lat: 37.6213,
    lon: -122.379,
    runways: [
      {id: 'cur-ksfo-28r', ref: '10L/28R', widthM: 61, coords: [[37.62875, -122.39337], [37.61354, -122.35714]]},
      {id: 'cur-ksfo-28l', ref: '10R/28L', widthM: 61, coords: [[37.62670, -122.39410], [37.61190, -122.35870]]},
      {id: 'cur-ksfo-19l', ref: '19L/01R', widthM: 61, coords: [[37.63050, -122.36940], [37.60810, -122.37920]]},
      {id: 'cur-ksfo-19r', ref: '19R/01L', widthM: 61, coords: [[37.63020, -122.37210], [37.61040, -122.38080]]},
    ],
  },
  KLAX: {
    icao: 'KLAX',
    iata: 'LAX',
    lat: 33.9416,
    lon: -118.4085,
    runways: [
      {id: 'cur-klax-24r', ref: '06L/24R', widthM: 46, coords: [[33.9467, -118.4312], [33.9522, -118.4021]]},
      {id: 'cur-klax-24l', ref: '06R/24L', widthM: 46, coords: [[33.9444, -118.4342], [33.9506, -118.4017]]},
      {id: 'cur-klax-25r', ref: '07L/25R', widthM: 61, coords: [[33.9317, -118.4278], [33.9388, -118.3902]]},
      {id: 'cur-klax-25l', ref: '07R/25L', widthM: 61, coords: [[33.9299, -118.4241], [33.9367, -118.3886]]},
    ],
  },
  KJFK: {
    icao: 'KJFK',
    iata: 'JFK',
    lat: 40.6413,
    lon: -73.7781,
    runways: [
      {id: 'cur-kjfk-13r', ref: '13R/31L', widthM: 61, coords: [[40.6512, -73.8162], [40.6254, -73.7634]]},
      {id: 'cur-kjfk-13l', ref: '13L/31R', widthM: 46, coords: [[40.6579, -73.7905], [40.6383, -73.7510]]},
      {id: 'cur-kjfk-04l', ref: '04L/22R', widthM: 61, coords: [[40.6258, -73.7885], [40.6572, -73.7695]]},
      {id: 'cur-kjfk-04r', ref: '04R/22L', widthM: 61, coords: [[40.6223, -73.7764], [40.6468, -73.7615]]},
    ],
  },
  EGLL: {
    icao: 'EGLL',
    iata: 'LHR',
    lat: 51.4700,
    lon: -0.4543,
    runways: [
      {id: 'cur-egll-27r', ref: '09L/27R', widthM: 50, coords: [[51.4775, -0.4898], [51.4777, -0.4337]]},
      {id: 'cur-egll-27l', ref: '09R/27L', widthM: 50, coords: [[51.4648, -0.4864], [51.4650, -0.4339]]},
    ],
  },
  ZBAA: {
    icao: 'ZBAA',
    iata: 'PEK',
    lat: 40.0799,
    lon: 116.6031,
    runways: [
      {id: 'cur-zbaa-36l', ref: '18R/36L', widthM: 50, coords: [[40.0972, 116.5784], [40.0686, 116.5825]]},
      {id: 'cur-zbaa-36r', ref: '18L/36R', widthM: 60, coords: [[40.0942, 116.6062], [40.0604, 116.6110]]},
      {id: 'cur-zbaa-01', ref: '01/19', widthM: 60, coords: [[40.0548, 116.6305], [40.0886, 116.6257]]},
    ],
  },
  ZSPD: {
    icao: 'ZSPD',
    iata: 'PVG',
    lat: 31.1443,
    lon: 121.8083,
    runways: [
      {id: 'cur-zspd-17r', ref: '17R/35L', widthM: 60, coords: [[31.1605, 121.7712], [31.1296, 121.7848]]},
      {id: 'cur-zspd-17l', ref: '17L/35R', widthM: 60, coords: [[31.1636, 121.7755], [31.1286, 121.7909]]},
      {id: 'cur-zspd-16r', ref: '16R/34L', widthM: 60, coords: [[31.1586, 121.8168], [31.1277, 121.8304]]},
      {id: 'cur-zspd-16l', ref: '16L/34R', widthM: 60, coords: [[31.1604, 121.8214], [31.1296, 121.8350]]},
    ],
  },
  ZGSZ: {
    icao: 'ZGSZ',
    iata: 'SZX',
    lat: 22.6393,
    lon: 113.8107,
    runways: [
      {id: 'cur-zgsz-15', ref: '15/33', widthM: 45, coords: [[22.6540, 113.7972], [22.6264, 113.8147]]},
      {id: 'cur-zgsz-16', ref: '16/34', widthM: 60, coords: [[22.6425, 113.7885], [22.6138, 113.8067]]},
    ],
  },
  VHHH: {
    icao: 'VHHH',
    iata: 'HKG',
    lat: 22.3080,
    lon: 113.9185,
    runways: [
      {id: 'cur-vhhh-07l', ref: '07L/25R', widthM: 60, coords: [[22.3204, 113.8895], [22.3316, 113.9245]]},
      {id: 'cur-vhhh-07c', ref: '07C/25C', widthM: 60, coords: [[22.3095, 113.8973], [22.3208, 113.9324]]},
      {id: 'cur-vhhh-07r', ref: '07R/25L', widthM: 60, coords: [[22.2958, 113.9022], [22.3071, 113.9373]]},
    ],
  },
  RJTT: {
    icao: 'RJTT',
    iata: 'HND',
    lat: 35.5494,
    lon: 139.7798,
    runways: [
      {id: 'cur-rjtt-34l', ref: '16R/34L', widthM: 60, coords: [[35.5596, 139.7610], [35.5356, 139.7745]]},
      {id: 'cur-rjtt-34r', ref: '16L/34R', widthM: 60, coords: [[35.5656, 139.7841], [35.5446, 139.7960]]},
      {id: 'cur-rjtt-05', ref: '05/23', widthM: 60, coords: [[35.5245, 139.7834], [35.5396, 139.8056]]},
    ],
  },
  WSSS: {
    icao: 'WSSS',
    iata: 'SIN',
    lat: 1.3644,
    lon: 103.9915,
    runways: [
      {id: 'cur-wsss-02l', ref: '02L/20R', widthM: 60, coords: [[1.3458, 103.9788], [1.3788, 103.9926]]},
      {id: 'cur-wsss-02c', ref: '02C/20C', widthM: 60, coords: [[1.3374, 103.9912], [1.3704, 104.0050]]},
    ],
  },
  EDDF: {
    icao: 'EDDF',
    iata: 'FRA',
    lat: 50.0379,
    lon: 8.5622,
    runways: [
      {id: 'cur-eddf-07c', ref: '07C/25C', widthM: 60, coords: [[50.0298, 8.5345], [50.0451, 8.5868]]},
      {id: 'cur-eddf-07r', ref: '07R/25L', widthM: 45, coords: [[50.0252, 8.5364], [50.0405, 8.5887]]},
      {id: 'cur-eddf-07l', ref: '07L/25R', widthM: 45, coords: [[50.0394, 8.4972], [50.0504, 8.5348]]},
      {id: 'cur-eddf-18', ref: '18/36', widthM: 45, coords: [[50.0342, 8.5262], [49.9983, 8.5256]]},
    ],
  },
};

export function buildCuratedSeedSurface(icao: string): TaxiwaySegment[] {
  const seed = CURATED_HUB_AIRFIELDS[icao.toUpperCase()];
  if (!seed) return [];
  return applyDisplacedThresholds(
    seed.icao,
    seed.runways.map((r) => ({
      id: r.id,
      kind: 'runway' as const,
      ref: r.ref,
      widthM: r.widthM,
      coords: r.coords,
    })),
  );
}

