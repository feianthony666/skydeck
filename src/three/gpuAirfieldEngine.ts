import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import * as THREE from 'three';
import {AIRPORT_CATALOG} from '../data/aviationCatalog';
import {apiFetchJson} from '../services/directAviationClient';
import type {
  AirfieldSurfaceData,
  TaxiwaySegment,
} from '../types/aviation';
import {
  applyDisplacedThresholds,
  buildCuratedSeedSurface,
  polygonCentroid,
} from '../utils/airfieldGeometry';
import {
  latToMy,
  lonToMx,
  MERCATOR_WORLD_M,
  mercatorScaleAtLat,
} from './gpuTileLayer';

interface AirfieldCacheDb extends DBSchema {
  surfaces: {
    key: string;
    value: {
      icao: string;
      savedAt: number;
      data: AirfieldSurfaceData;
    };
  };
}

const DB_NAME = 'skydeck-gpu-airfields-v2';
let dbPromise: Promise<IDBPDatabase<AirfieldCacheDb>> | null = null;

function getDb() {
  if (!dbPromise && typeof indexedDB !== 'undefined') {
    dbPromise = openDB<AirfieldCacheDb>(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('surfaces')) {
          db.createObjectStore('surfaces', {keyPath: 'icao'});
        }
      },
    });
  }
  return dbPromise;
}

async function loadCachedSurface(icao: string): Promise<AirfieldSurfaceData | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const row = await db.get('surfaces', icao.toUpperCase());
    if (!row) return null;
    const ttl =
      row.data.source === 'osm-overpass' && row.data.taxiways.length > 0 ? 7 * 86400_000 : 120_000;
    if (Date.now() - row.savedAt > ttl) return null;
    return row.data;
  } catch {
    return null;
  }
}

async function saveCachedSurface(icao: string, data: AirfieldSurfaceData): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.put('surfaces', {
      icao: icao.toUpperCase(),
      savedAt: Date.now(),
      data,
    });
  } catch {
    // ignore storage errors
  }
}

function ptKey5(p: [number, number]): string {
  return `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
}

export function mergeTaxiwaySegments(segments: TaxiwaySegment[]): TaxiwaySegment[] {
  const buckets = new Map<string, TaxiwaySegment[]>();
  for (const seg of segments) {
    if (!seg.coords || seg.coords.length < 2) continue;
    const isLane = seg.kind === 'taxilane';
    const rawW = seg.widthM ?? (isLane ? 13 : 22);
    const widthBucket = isLane ? 13 : rawW >= 16 && rawW <= 28 ? 22 : Math.round(rawW / 6) * 6;
    const bucketKey = `${seg.kind}|${widthBucket}`;
    const arr = buckets.get(bucketKey);
    if (arr) arr.push(seg);
    else buckets.set(bucketKey, [seg]);
  }

  const mergedOut: TaxiwaySegment[] = [];
  for (const [, list] of buckets) {
    const remaining = list.map((s) => ({
      ...s,
      coords: [...s.coords] as Array<[number, number]>,
    }));
    const used = new Array<boolean>(remaining.length).fill(false);

    for (let i = 0; i < remaining.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const cur = remaining[i];
      let headKey = ptKey5(cur.coords[0]);
      let tailKey = ptKey5(cur.coords[cur.coords.length - 1]);

      let extended = true;
      while (extended) {
        extended = false;
        for (let j = 0; j < remaining.length; j++) {
          if (used[j]) continue;
          const cand = remaining[j];
          const cHead = ptKey5(cand.coords[0]);
          const cTail = ptKey5(cand.coords[cand.coords.length - 1]);

          if (cHead === tailKey) {
            cur.coords.push(...cand.coords.slice(1));
            tailKey = cTail;
            if (!cur.ref && cand.ref) cur.ref = cand.ref;
            used[j] = true;
            extended = true;
          } else if (cTail === tailKey) {
            const rev = [...cand.coords].reverse();
            cur.coords.push(...rev.slice(1));
            tailKey = cHead;
            if (!cur.ref && cand.ref) cur.ref = cand.ref;
            used[j] = true;
            extended = true;
          } else if (cTail === headKey) {
            cur.coords.unshift(...cand.coords.slice(0, -1));
            headKey = cHead;
            if (!cur.ref && cand.ref) cur.ref = cand.ref;
            used[j] = true;
            extended = true;
          } else if (cHead === headKey) {
            const rev = [...cand.coords].reverse();
            cur.coords.unshift(...rev.slice(0, -1));
            headKey = cTail;
            if (!cur.ref && cand.ref) cur.ref = cand.ref;
            used[j] = true;
            extended = true;
          }
        }
      }
      mergedOut.push(cur);
    }
  }
  return mergedOut;
}

function computeBearingDeg(p1: [number, number], p2: [number, number]): number {
  const toRad = Math.PI / 180;
  const lat1 = p1[0] * toRad;
  const lat2 = p2[0] * toRad;
  const dLon = (p2[1] - p1[1]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function deriveRunwayEndLabels(ref: string | undefined, bearingDeg: number): [string, string] {
  if (ref && ref.includes('/')) {
    const parts = ref.split('/').map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) {
      const m = parts[0].match(/^(\d{1,2})/);
      if (m) {
        const expectedBearing = (parseInt(m[1], 10) % 36) * 10;
        const diff = Math.abs((((bearingDeg - expectedBearing) + 540) % 360) - 180);
        if (diff > 90) return [parts[1], parts[0]];
      }
      return [parts[0], parts[1]];
    }
  }
  const num = Math.max(1, Math.min(36, Math.round(bearingDeg / 10) || 36));
  const opp = num > 18 ? num - 18 : num + 18;
  return [String(num).padStart(2, '0'), String(opp).padStart(2, '0')];
}

function latLonToLocalXZ(
  lat: number,
  lon: number,
  anchorMx: number,
  anchorMy: number,
): [number, number] {
  return [
    (lonToMx(lon) - anchorMx) * MERCATOR_WORLD_M,
    (latToMy(lat) - anchorMy) * MERCATOR_WORLD_M,
  ];
}

function pointToSegDistXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): {perp: number; frac: number} {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-4) return {perp: Math.hypot(wx, wz), frac: 0};
  const frac = (wx * vx + wz * vz) / lenSq;
  const c = Math.max(0, Math.min(1, frac));
  return {perp: Math.hypot(wx - vx * c, wz - vz * c), frac};
}

function appendCircleCapXZ(
  cx: number,
  cz: number,
  radius: number,
  y: number,
  verts: number[],
  segments = 10,
) {
  const step = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    verts.push(
      cx,
      y,
      cz,
      cx + Math.cos(a0) * radius,
      y,
      cz + Math.sin(a0) * radius,
      cx + Math.cos(a1) * radius,
      y,
      cz + Math.sin(a1) * radius,
    );
  }
}

/**
 * Emits clean per-segment rectangular ribbons + rounded circle caps at every vertex.
 * Completely eliminates miter needle spikes & random overlapping lines at taxiway intersections!
 */
function appendSmoothTaxiRibbonXZ(
  pts: Array<[number, number]>,
  halfW: number,
  y: number,
  verts: number[],
  withRoundCaps = true,
) {
  if (pts.length < 2) return;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;

    const l0x = a[0] - nx * halfW;
    const l0z = a[1] - nz * halfW;
    const r0x = a[0] + nx * halfW;
    const r0z = a[1] + nz * halfW;
    const l1x = b[0] - nx * halfW;
    const l1z = b[1] - nz * halfW;
    const r1x = b[0] + nx * halfW;
    const r1z = b[1] + nz * halfW;

    verts.push(
      l0x, y, l0z,
      r0x, y, r0z,
      r1x, y, r1z,
      l0x, y, l0z,
      r1x, y, r1z,
      l1x, y, l1z,
    );
    if (withRoundCaps) {
      appendCircleCapXZ(a[0], a[1], halfW, y, verts, 8);
    }
  }
  if (withRoundCaps) {
    const last = pts[pts.length - 1];
    appendCircleCapXZ(last[0], last[1], halfW, y, verts, 8);
  }
}

function appendRectXZ(
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  rx: number,
  rz: number,
  halfLen: number,
  halfW: number,
  y: number,
  verts: number[],
) {
  const ax = cx - ux * halfLen - rx * halfW;
  const az = cz - uz * halfLen - rz * halfW;
  const bx = cx - ux * halfLen + rx * halfW;
  const bz = cz - uz * halfLen + rz * halfW;
  const cxp = cx + ux * halfLen + rx * halfW;
  const czp = cz + uz * halfLen + rz * halfW;
  const dx = cx + ux * halfLen - rx * halfW;
  const dz = cz + uz * halfLen - rz * halfW;
  verts.push(
    ax, y, az,
    bx, y, bz,
    cxp, y, czp,
    ax, y, az,
    cxp, y, czp,
    dx, y, dz,
  );
}

function createRunwayNumberTexture(label: string, isGreenSfo: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = isGreenSfo ? '#D1FAE5' : '#F8FAFC';
  ctx.strokeStyle = isGreenSfo ? '#064E3B' : '#060910';
  ctx.lineWidth = 10;
  ctx.font = '800 112px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(label, 128, 134);
  ctx.fillText(label, 128, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface AirfieldHudLabel {
  lat: number;
  lon: number;
  text: string;
  kind: 'taxiway' | 'apron' | 'terminal' | 'gate';
}

export interface GpuAirfieldGroupHandle {
  icao: string;
  anchorMx: number;
  anchorMy: number;
  lat: number;
  lon: number;
  group: THREE.Group;
  lightMat: THREE.ShaderMaterial | null;
  taxiwayLabels: AirfieldHudLabel[];
  apronLabels: AirfieldHudLabel[];
  set3DMode: (is3D: boolean) => void;
  setZoom: (zoom: number) => void;
  source: 'osm-overpass' | 'catalog';
  dispose: () => void;
}

const LIGHT_VERTEX_SHADER = `
  attribute vec3 aColor;
  attribute float aMinZoom;
  attribute float aTier;
  attribute float aKind;
  attribute float aPhase;

  uniform float uZoom;
  uniform float uTime;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float spacingCut = uZoom < 11.4 ? 5.0 : uZoom < 12.6 ? 3.0 : uZoom < 13.8 ? 1.0 : 0.0;
    float visible = step(aMinZoom - 0.8, uZoom) * step(spacingCut, aTier);

    float intensity = 0.98;
    // Kind 6 = sequential flashing approach rabbit strobe
    if (aKind > 5.5) {
      float wave = fract(uTime * 1.15);
      float diff = abs(wave - aPhase);
      float wDiff = min(diff, 1.0 - diff);
      intensity = smoothstep(0.16, 0.0, wDiff) * 1.15;
      visible *= step(0.06, intensity);
    }
    // Kind 4 = alternating wig-wag runway guard amber
    else if (aKind > 3.5 && aKind < 4.5) {
      float wig = mod(floor(uTime * 2.4), 2.0);
      float match = 1.0 - abs(wig - aPhase);
      intensity = mix(0.35, 1.08, match);
    }

    vColor = aColor * intensity;
    vAlpha = visible * clamp(intensity, 0.84, 1.0);

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float zoomScale = clamp((uZoom - 9.8) * 0.68, 1.8, 5.8);
    float baseSz = aKind > 2.5 ? 5.6 : 4.2;
    gl_PointSize = visible > 0.5 ? baseSz * zoomScale * uPixelRatio : 0.0;
  }
`;

const LIGHT_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.01) discard;
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float halo = exp(-r * r * 6.5);
    float core = smoothstep(0.28, 0.05, r);
    vec3 col = mix(vColor * 1.25, vec3(1.0), core * 0.72);
    gl_FragColor = vec4(col, vAlpha * max(halo, core));
  }
`;

export function buildGpuAirfieldGroup(
  surface: AirfieldSurfaceData,
  isDark: boolean,
): GpuAirfieldGroupHandle {
  const group = new THREE.Group();
  const terminalFlatGroup = new THREE.Group();
  const terminal3DGroup = new THREE.Group();
  terminal3DGroup.visible = false;
  const thinLinesGroup = new THREE.Group();
  group.add(terminalFlatGroup, terminal3DGroup, thinLinesGroup);

  const disposables: Array<{dispose: () => void}> = [];

  const anchorLat = surface.lat;
  const anchorLon = surface.lon;
  const anchorMx = lonToMx(anchorLon);
  const anchorMy = latToMy(anchorLat);
  const mercScale = mercatorScaleAtLat(anchorLat);
  const isSfo =
    surface.icao.toUpperCase() === 'KSFO' || surface.iata.toUpperCase() === 'SFO';

  // Vertex buffers batched by layer (Zero Z-fighting via depthTest: false + strict renderOrder!)
  const apronVerts: number[] = [];
  const apronEdgeSegs: number[] = [];
  const termFlatVerts: number[] = [];
  const termFlatEdgeSegs: number[] = [];
  const terminal3DVerts: number[] = [];
  const terminal3DEdgeSegs: number[] = [];

  const twyHaloVerts: number[] = [];
  const twyDeckVerts: number[] = [];
  const twyLineVerts: number[] = [];
  const twyThinLineSegs: number[] = [];

  const rwyShoulderVerts: number[] = [];
  const rwyBlastPadVerts: number[] = [];
  const rwyDeckVerts: number[] = [];
  const rwyWhiteMarkVerts: number[] = [];
  const rwyDispArrowVerts: number[] = [];
  const rwyApproachSegs: number[] = [];
  const rwyApproachRailsVerts: number[] = [];

  // Light attributes + spatial grid deduplication to prevent light bunching at curved nodes
  const lPos: number[] = [];
  const lCol: number[] = [];
  const lMinZoom: number[] = [];
  const lTier: number[] = [];
  const lKind: number[] = [];
  const lPhase: number[] = [];
  const lightCellSeen = new Set<string>();
  const stopBarSeen = new Set<string>();

  const pushLight = (
    x: number,
    z: number,
    rgb: [number, number, number],
    minZoom: number,
    tier: number,
    kind: number,
    phase = 0,
    dedupSpacingM = 0,
  ) => {
    if (dedupSpacingM > 0) {
      const cellMerc = dedupSpacingM * mercScale;
      const gx = Math.round(x / cellMerc);
      const gz = Math.round(z / cellMerc);
      const key = `${kind}|${gx}|${gz}`;
      if (lightCellSeen.has(key)) return;
      lightCellSeen.add(key);
    }
    lPos.push(x, 0.4, z);
    lCol.push(rgb[0], rgb[1], rgb[2]);
    lMinZoom.push(minZoom);
    lTier.push(tier);
    lKind.push(kind);
    lPhase.push(phase);
  };

  // HUD labels extracted once during airfield build
  const taxiwayLabels: AirfieldHudLabel[] = [];
  const apronLabels: AirfieldHudLabel[] = [];

  // 1. Aprons + Apron Labels
  for (const poly of surface.aprons) {
    if (poly.length < 3) continue;
    const shape = new THREE.Shape();
    const xzPts: Array<[number, number]> = [];
    poly.forEach(([lat, lon], idx) => {
      const [x, z] = latLonToLocalXZ(lat, lon, anchorMx, anchorMy);
      xzPts.push([x, z]);
      if (idx === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const sGeo = new THREE.ShapeGeometry(shape);
    sGeo.rotateX(-Math.PI / 2);
    const nonIdx = sGeo.index ? sGeo.toNonIndexed() : sGeo;
    const pos = nonIdx.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      apronVerts.push(pos.getX(i), 0, pos.getZ(i));
    }
    if (nonIdx !== sGeo) nonIdx.dispose();
    sGeo.dispose();

    for (let i = 0; i < xzPts.length; i++) {
      const a = xzPts[i];
      const b = xzPts[(i + 1) % xzPts.length];
      apronEdgeSegs.push(a[0], 0, a[1], b[0], 0, b[1]);
    }
  }

  for (const ap of surface.labeledAprons ?? []) {
    const label = (ap.ref || ap.name || '').trim();
    if (!label || !ap.center) continue;
    apronLabels.push({
      lat: ap.center[0],
      lon: ap.center[1],
      text: label.slice(0, 18),
      kind: 'apron',
    });
  }

  // 2. Terminals: crisp flat 2D footprints (NEVER cover 2D airplanes!) + 3D extruded concourses & ATC tower
  let firstTermPt: [number, number] | null = null;
  for (const term of surface.terminals ?? []) {
    if (term.coords.length < 3) continue;
    const shape = new THREE.Shape();
    const xzPts: Array<[number, number]> = [];
    term.coords.forEach(([lat, lon], idx) => {
      const [x, z] = latLonToLocalXZ(lat, lon, anchorMx, anchorMy);
      if (!firstTermPt) firstTermPt = [x, z];
      xzPts.push([x, z]);
      if (idx === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();

    // Flat 2D Terminal Footprint
    const flatGeo = new THREE.ShapeGeometry(shape);
    flatGeo.rotateX(-Math.PI / 2);
    const flatNonIdx = flatGeo.index ? flatGeo.toNonIndexed() : flatGeo;
    const fPos = flatNonIdx.getAttribute('position');
    for (let i = 0; i < fPos.count; i++) {
      termFlatVerts.push(fPos.getX(i), 0, fPos.getZ(i));
    }
    if (flatNonIdx !== flatGeo) flatNonIdx.dispose();
    flatGeo.dispose();

    for (let i = 0; i < xzPts.length; i++) {
      const a = xzPts[i];
      const b = xzPts[(i + 1) % xzPts.length];
      termFlatEdgeSegs.push(a[0], 0, a[1], b[0], 0, b[1]);
    }

    // 3D Extruded Terminal Building (visible only in 3D tilted view)
    const ext = new THREE.ExtrudeGeometry(shape, {depth: 15 * mercScale, bevelEnabled: false});
    ext.rotateX(-Math.PI / 2);
    const nonIdx = ext.index ? ext.toNonIndexed() : ext;
    const pos = nonIdx.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      terminal3DVerts.push(pos.getX(i), pos.getY(i) + 0.15, pos.getZ(i));
    }
    if (nonIdx !== ext) nonIdx.dispose();
    ext.dispose();

    for (let i = 0; i < xzPts.length; i++) {
      const a = xzPts[i];
      const b = xzPts[(i + 1) % xzPts.length];
      terminal3DEdgeSegs.push(a[0], 15.2 * mercScale, a[1], b[0], 15.2 * mercScale, b[1]);
    }

    const tLabel = (term.name || term.ref || '').trim();
    if (tLabel && term.center) {
      apronLabels.push({
        lat: term.center[0],
        lon: term.center[1],
        text: tLabel.slice(0, 18),
        kind: 'terminal',
      });
    }
  }

  for (const gate of surface.gates ?? []) {
    if (!gate.ref) continue;
    apronLabels.push({
      lat: gate.lat,
      lon: gate.lon,
      text: gate.ref.slice(0, 8),
      kind: 'gate',
    });
  }

  // Build Procedural 3D ATC Control Tower next to terminal/anchor inside terminal3DGroup
  const towerX = firstTermPt ? firstTermPt[0] + 45 * mercScale : 120 * mercScale;
  const towerZ = firstTermPt ? firstTermPt[1] - 45 * mercScale : -120 * mercScale;
  const shaftGeo = new THREE.CylinderGeometry(5.5 * mercScale, 7.5 * mercScale, 54 * mercScale, 12);
  const shaftMat = new THREE.MeshStandardMaterial({color: '#64748B', roughness: 0.55, metalness: 0.25});
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.set(towerX, 27 * mercScale, towerZ);
  const cabGeo = new THREE.CylinderGeometry(12.5 * mercScale, 8 * mercScale, 11 * mercScale, 8);
  const cabMat = new THREE.MeshStandardMaterial({color: '#0EA5E9', roughness: 0.12, metalness: 0.4});
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(towerX, 58 * mercScale, towerZ);
  const capGeo = new THREE.CylinderGeometry(3 * mercScale, 13 * mercScale, 4.5 * mercScale, 8);
  const capMat = new THREE.MeshStandardMaterial({color: '#1E293B', roughness: 0.5, metalness: 0.3});
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.set(towerX, 65.5 * mercScale, towerZ);
  const beaconGeo = new THREE.SphereGeometry(2.2 * mercScale, 8, 8);
  const beaconMat = new THREE.MeshBasicMaterial({color: '#EF4444'});
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.set(towerX, 69 * mercScale, towerZ);
  terminal3DGroup.add(shaft, cab, cap, beacon);
  disposables.push(shaftGeo, shaftMat, cabGeo, cabMat, capGeo, capMat, beaconGeo, beaconMat);

  // 3. Collect True Runway Centerline Geometry First (strict hold-short exclusion!)
  const runways = applyDisplacedThresholds(surface.icao, surface.runways);
  const runwayXZList: Array<{
    pts: Array<[number, number]>;
    halfW: number;
    brgDeg: number;
  }> = [];

  for (const rwy of runways) {
    if (rwy.coords.length < 2) continue;
    const ptsXZ = rwy.coords.map(([lat, lon]) => latLonToLocalXZ(lat, lon, anchorMx, anchorMy));
    const widthMerc = (rwy.widthM ?? 45) * mercScale;
    const halfW = widthMerc * 0.5;
    const brgDeg = computeBearingDeg(rwy.coords[0], rwy.coords[rwy.coords.length - 1]);
    runwayXZList.push({pts: ptsXZ, halfW, brgDeg});
  }

  const isInsideAnyRunway = (px: number, pz: number, extraMarginM = 8): boolean => {
    const margin = extraMarginM * mercScale;
    for (const rwy of runwayXZList) {
      for (let i = 0; i < rwy.pts.length - 1; i++) {
        const {perp, frac} = pointToSegDistXZ(
          px,
          pz,
          rwy.pts[i][0],
          rwy.pts[i][1],
          rwy.pts[i + 1][0],
          rwy.pts[i + 1][1],
        );
        if (frac >= -0.02 && frac <= 1.02 && perp < rwy.halfW + margin) {
          return true;
        }
      }
    }
    return false;
  };

  // 4. Merged Seamless Flightdeck Taxiways + Taxilanes (Round Joint Caps + Bold Opaque Borders!)
  const mergedTwys = mergeTaxiwaySegments(surface.taxiways);
  const placedTwyLabels: Array<{ref: string; x: number; z: number}> = [];

  for (const twy of mergedTwys) {
    if (twy.coords.length < 2) continue;
    const isLane = twy.kind === 'taxilane';
    const wMerc = (twy.widthM ?? (isLane ? 13 : 22)) * mercScale;
    const ptsXZ = twy.coords.map(([lat, lon]) => latLonToLocalXZ(lat, lon, anchorMx, anchorMy));

    // Bold Opaque Amber Outline Border + Asphalt Deck + Yellow Centerline (NO sharp miter spikes!)
    appendSmoothTaxiRibbonXZ(ptsXZ, wMerc * 0.68, 0, twyHaloVerts, true);
    appendSmoothTaxiRibbonXZ(ptsXZ, wMerc * 0.45, 0, twyDeckVerts, true);
    appendSmoothTaxiRibbonXZ(ptsXZ, Math.max(0.55 * mercScale, wMerc * 0.055), 0, twyLineVerts, true);

    for (let i = 0; i < ptsXZ.length - 1; i++) {
      const a = ptsXZ[i];
      const b = ptsXZ[i + 1];
      twyThinLineSegs.push(a[0], 0, a[1], b[0], 0, b[1]);
    }

    // Deduplicated Taxiway Ref Labels (`A`, `B`, `K`...)
    const cleanRef = (twy.ref || '').trim();
    if (!isLane && cleanRef && cleanRef.length <= 6) {
      const midIdx = Math.floor(twy.coords.length / 2);
      const midLL = twy.coords[midIdx];
      const [lx, lz] = ptsXZ[midIdx];
      const minSpacing = 125 * mercScale;
      const tooClose = placedTwyLabels.some(
        (p) => Math.hypot(p.x - lx, p.z - lz) < (p.ref === cleanRef ? minSpacing * 1.4 : 42 * mercScale),
      );
      if (!tooClose && !isInsideAnyRunway(lx, lz, 4)) {
        placedTwyLabels.push({ref: cleanRef, x: lx, z: lz});
        taxiwayLabels.push({
          lat: midLL[0],
          lon: midLL[1],
          text: cleanRef,
          kind: 'taxiway',
        });
      }
    }

    // Taxiway Green Centerline & Blue Edge Lights (uniform arc-length spacing + deduplicated!) + Hold-Short Red Stop Bars
    const clStepM = isLane ? 46 : 38;
    const edgeStepM = 46;
    let nextClDistM = 12;
    let nextEdgeDistM = 14;
    let clCount = 0;
    let edgeCount = 0;
    let cumDistM = 0;

    for (let i = 0; i < ptsXZ.length - 1; i++) {
      const a = ptsXZ[i];
      const b = ptsXZ[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const segMercLen = Math.hypot(dx, dz);
      if (segMercLen < 0.8) continue;
      const ux = dx / segMercLen;
      const uz = dz / segMercLen;
      const rx = -uz;
      const rz = ux;
      const segRealLen = segMercLen / mercScale;
      const twyBrg = computeBearingDeg(twy.coords[i], twy.coords[i + 1]);

      const segEndDistM = cumDistM + segRealLen;
      while (nextClDistM <= segEndDistM) {
        const localFrac = (nextClDistM - cumDistM) / segRealLen;
        const px = a[0] + dx * localFrac;
        const pz = a[1] + dz * localFrac;
        const tier = clCount % 3 === 0 ? 5 : clCount % 2 === 0 ? 3 : 1;
        clCount++;
        if (!isInsideAnyRunway(px, pz, 2)) {
          pushLight(px, pz, [0.15, 1.0, 0.45], isLane ? 13.6 : 12.2, tier, 1, 0, 34);
        }
        nextClDistM += clStepM;
      }

      if (!isLane) {
        while (nextEdgeDistM <= segEndDistM) {
          const localFrac = (nextEdgeDistM - cumDistM) / segRealLen;
          const px = a[0] + dx * localFrac;
          const pz = a[1] + dz * localFrac;
          const tier = edgeCount % 3 === 0 ? 5 : edgeCount % 2 === 0 ? 3 : 1;
          edgeCount++;
          if (!isInsideAnyRunway(px, pz, 6)) {
            const edgeOffset = wMerc * 0.48;
            pushLight(px + rx * edgeOffset, pz + rz * edgeOffset, [0.18, 0.72, 1.0], 12.8, tier, 2, 0, 38);
            pushLight(px - rx * edgeOffset, pz - rz * edgeOffset, [0.18, 0.72, 1.0], 12.8, tier, 2, 0, 38);
          }
          nextEdgeDistM += edgeStepM;
        }
      }

      cumDistM = segEndDistM;

      // Hold-short red stop bar ONLY where taxiway meets runway at >=22 deg angle AND outside runway
      if (!isLane) {
        for (const ptIdx of [i, i + 1]) {
          const pt = ptsXZ[ptIdx];
          if (isInsideAnyRunway(pt[0], pt[1], 10)) continue;
          const barCell = `${Math.round(pt[0] / (28 * mercScale))}|${Math.round(pt[1] / (28 * mercScale))}`;
          if (stopBarSeen.has(barCell)) continue;

          for (const rwy of runwayXZList) {
            const angDiff = Math.abs((((twyBrg - rwy.brgDeg) % 180) + 180) % 180);
            const crossAngle = Math.min(angDiff, 180 - angDiff);
            if (crossAngle < 22) continue;
            let nearRwy = false;
            for (let r = 0; r < rwy.pts.length - 1; r++) {
              const {perp, frac} = pointToSegDistXZ(
                pt[0],
                pt[1],
                rwy.pts[r][0],
                rwy.pts[r][1],
                rwy.pts[r + 1][0],
                rwy.pts[r + 1][1],
              );
              const distFromEdge = perp - rwy.halfW;
              if (frac >= -0.02 && frac <= 1.02 && distFromEdge >= 10 * mercScale && distFromEdge <= 38 * mercScale) {
                nearRwy = true;
                break;
              }
            }
            if (nearRwy) {
              stopBarSeen.add(barCell);
              const spanW = wMerc * 0.44;
              for (const sFrac of [-0.9, -0.45, 0, 0.45, 0.9]) {
                pushLight(
                  pt[0] + rx * spanW * sFrac,
                  pt[1] + rz * spanW * sFrac,
                  [1.0, 0.22, 0.22],
                  12.8,
                  4,
                  3,
                );
              }
              pushLight(pt[0] + rx * (spanW + 2.5 * mercScale), pt[1] + rz * (spanW + 2.5 * mercScale), [1.0, 0.78, 0.08], 13.0, 4, 4, 0);
              pushLight(pt[0] - rx * (spanW + 2.5 * mercScale), pt[1] - rz * (spanW + 2.5 * mercScale), [1.0, 0.78, 0.08], 13.0, 4, 4, 1);
              break;
            }
          }
        }
      }
    }
  }

  // Stand lead-in golden taxilines
  for (const st of surface.stands ?? []) {
    if (!st.coords || st.coords.length < 2) continue;
    const ptsXZ = st.coords.map(([lat, lon]) => latLonToLocalXZ(lat, lon, anchorMx, anchorMy));
    appendSmoothTaxiRibbonXZ(ptsXZ, 1.05 * mercScale, 0, twyLineVerts, false);
  }

  // 5. Complete True-Scale Runways (Blast Pads, Displaced Thresholds, Piano Keys, Numbers, TDZ, Aiming Point, Edge Stripes, RCL, TDZL, PAPI, ALSF-II, SFO Green)
  for (const rwy of runways) {
    if (rwy.coords.length < 2) continue;
    const pA = latLonToLocalXZ(rwy.coords[0][0], rwy.coords[0][1], anchorMx, anchorMy);
    const pB = latLonToLocalXZ(
      rwy.coords[rwy.coords.length - 1][0],
      rwy.coords[rwy.coords.length - 1][1],
      anchorMx,
      anchorMy,
    );
    const ptsXZ = rwy.coords.map(([lat, lon]) => latLonToLocalXZ(lat, lon, anchorMx, anchorMy));

    const rwyW = (rwy.widthM ?? 45) * mercScale;
    const halfW = rwyW * 0.5;
    const dx = pB[0] - pA[0];
    const dz = pB[1] - pA[1];
    const totalMercLen = Math.hypot(dx, dz);
    if (totalMercLen < 120) continue;
    const ux = dx / totalMercLen;
    const uz = dz / totalMercLen;
    const rx = -uz;
    const rz = ux;
    const realLenM = totalMercLen / mercScale;

    // Pavement & shoulder (true geographic scale)
    appendSmoothTaxiRibbonXZ(ptsXZ, halfW + 7 * mercScale, 0, rwyShoulderVerts, false);
    appendSmoothTaxiRibbonXZ(ptsXZ, halfW, 0, rwyDeckVerts, false);

    // Blast Pads / Stopways (65m behind each threshold with yellow chevron stripes)
    const blastLen = 65 * mercScale;
    for (const endSpec of [
      {pt: pA, outX: -ux, outZ: -uz},
      {pt: pB, outX: ux, outZ: uz},
    ]) {
      const bx = endSpec.pt[0] + endSpec.outX * (blastLen * 0.5);
      const bz = endSpec.pt[1] + endSpec.outZ * (blastLen * 0.5);
      appendRectXZ(bx, bz, endSpec.outX, endSpec.outZ, rx, rz, blastLen * 0.5, halfW * 0.94, 0, rwyBlastPadVerts);
      // Yellow chevron stripes across blast pad
      for (const frac of [0.28, 0.65]) {
        const cx = endSpec.pt[0] + endSpec.outX * (blastLen * frac);
        const cz = endSpec.pt[1] + endSpec.outZ * (blastLen * frac);
        for (const sgn of [-1, 1]) {
          const cux = (endSpec.outX * 0.72 + rx * sgn * 0.68);
          const cuz = (endSpec.outZ * 0.72 + rz * sgn * 0.68);
          const crx = -cuz;
          const crz = cux;
          appendRectXZ(
            cx + rx * sgn * (halfW * 0.36),
            cz + rz * sgn * (halfW * 0.36),
            cux,
            cuz,
            crx,
            crz,
            halfW * 0.42,
            1.15 * mercScale,
            0,
            rwyDispArrowVerts,
          );
        }
      }
    }

    // Runway Edge Stripes (true scale)
    for (const side of [-1, 1]) {
      appendRectXZ(
        pA[0] + ux * (totalMercLen * 0.5) + rx * (halfW * 0.92 * side),
        pA[1] + uz * (totalMercLen * 0.5) + rz * (halfW * 0.92 * side),
        ux,
        uz,
        rx,
        rz,
        totalMercLen * 0.5,
        Math.max(0.75 * mercScale, rwyW * 0.022),
        0,
        rwyWhiteMarkVerts,
      );
    }

    const dispA = Math.min(realLenM * 0.34, Math.max(0, rwy.dispStartM ?? 0)) * mercScale;
    const dispB = Math.min(realLenM * 0.34, Math.max(0, rwy.dispEndM ?? 0)) * mercScale;

    // Displaced threshold lead-in arrows & transverse white threshold bar
    const drawDisplacedEnd = (
      endPt: [number, number],
      inUx: number,
      inUz: number,
      dispMerc: number,
    ) => {
      if (dispMerc < 15 * mercScale) return;
      const barX = endPt[0] + inUx * dispMerc;
      const barZ = endPt[1] + inUz * dispMerc;
      appendRectXZ(barX, barZ, inUx, inUz, rx, rz, 1.9 * mercScale, halfW * 0.92, 0, rwyWhiteMarkVerts);
      const steps = Math.max(1, Math.min(8, Math.floor(dispMerc / (45 * mercScale))));
      for (let k = 0; k < steps; k++) {
        const d = (k + 0.5) * (dispMerc / steps);
        appendRectXZ(
          endPt[0] + inUx * d,
          endPt[1] + inUz * d,
          inUx,
          inUz,
          rx,
          rz,
          10 * mercScale,
          1.45 * mercScale,
          0,
          rwyDispArrowVerts,
        );
      }
      const edgeSteps = Math.max(2, Math.floor(dispMerc / (45 * mercScale)));
      for (let k = 0; k <= edgeSteps; k++) {
        const d = (k / edgeSteps) * dispMerc;
        pushLight(endPt[0] + inUx * d + rx * (halfW * 1.03), endPt[1] + inUz * d + rz * (halfW * 1.03), [0.95, 0.24, 0.24], 12.8, 3, 0);
        pushLight(endPt[0] + inUx * d - rx * (halfW * 1.03), endPt[1] + inUz * d - rz * (halfW * 1.03), [0.95, 0.24, 0.24], 12.8, 3, 0);
      }
    };

    drawDisplacedEnd(pA, ux, uz, dispA);
    drawDisplacedEnd(pB, -ux, -uz, dispB);

    // Centerline white dashes strictly between displaced thresholds
    const usableStart = dispA + 95 * mercScale;
    const usableEnd = totalMercLen - dispB - 95 * mercScale;
    const dashStep = 54 * mercScale;
    for (let d = usableStart; d < usableEnd; d += dashStep) {
      appendRectXZ(
        pA[0] + ux * (d + 14 * mercScale),
        pA[1] + uz * (d + 14 * mercScale),
        ux,
        uz,
        rx,
        rz,
        14 * mercScale,
        1.1 * mercScale,
        0,
        rwyWhiteMarkVerts,
      );
    }

    // Piano keys + Runway Designator + Aiming Point + Full TDZ Bars + TDZL + PAPI + ALSF-II Approach per threshold
    const brg = computeBearingDeg(rwy.coords[0], rwy.coords[rwy.coords.length - 1]);
    const [aLbl, bLbl] = deriveRunwayEndLabels(rwy.ref, brg);
    const ends = [
      {pt: pA, inUx: ux, inUz: uz, disp: dispA, label: aLbl, headingDeg: brg},
      {pt: pB, inUx: -ux, inUz: -uz, disp: dispB, label: bLbl, headingDeg: (brg + 180) % 360},
    ];

    for (const end of ends) {
      const threshX = end.pt[0] + end.inUx * end.disp;
      const threshZ = end.pt[1] + end.inUz * end.disp;
      const endRx = -end.inUz;
      const endRz = end.inUx;

      // Piano Key Threshold Bars (10 crisp bars scaled inside runway width)
      const halfBars = rwyW / mercScale >= 50 ? 6 : 4;
      for (let sideIdx = -halfBars; sideIdx <= halfBars; sideIdx++) {
        if (sideIdx === 0) continue;
        const latOff = (sideIdx / (halfBars + 0.5)) * (halfW * 0.84);
        appendRectXZ(
          threshX + end.inUx * (22 * mercScale) + endRx * latOff,
          threshZ + end.inUz * (22 * mercScale) + endRz * latOff,
          end.inUx,
          end.inUz,
          endRx,
          endRz,
          15 * mercScale,
          Math.max(0.75 * mercScale, rwyW * 0.026),
          0,
          rwyWhiteMarkVerts,
        );
      }

      // Aiming point blocks (~300m past threshold)
      if (realLenM > 1400) {
        for (const sgn of [-1, 1]) {
          appendRectXZ(
            threshX + end.inUx * (300 * mercScale) + endRx * (halfW * 0.36 * sgn),
            threshZ + end.inUz * (300 * mercScale) + endRz * (halfW * 0.36 * sgn),
            end.inUx,
            end.inUz,
            endRx,
            endRz,
            24 * mercScale,
            Math.max(1.5 * mercScale, rwyW * 0.06),
            0,
            rwyWhiteMarkVerts,
          );
        }
      }

      // Touchdown Zone (TDZ) Markings + TDZL White Light Bars (150m .. 750m on precision runways)
      if (realLenM > 1900) {
        const tdzStations = [
          {distM: 150, bars: 3},
          {distM: 450, bars: 2},
          {distM: 600, bars: 2},
          {distM: 750, bars: 1},
          {distM: 900, bars: 1},
        ];
        for (const st of tdzStations) {
          if (st.distM * 2.4 > realLenM) continue;
          for (const sgn of [-1, 1]) {
            for (let b = 0; b < st.bars; b++) {
              const latOff = (halfW * 0.28 + b * (rwyW * 0.055)) * sgn;
              appendRectXZ(
                threshX + end.inUx * (st.distM * mercScale) + endRx * latOff,
                threshZ + end.inUz * (st.distM * mercScale) + endRz * latOff,
                end.inUx,
                end.inUz,
                endRx,
                endRz,
                11 * mercScale,
                Math.max(0.65 * mercScale, rwyW * 0.02),
                0,
                rwyWhiteMarkVerts,
              );
              // TDZL crisp white LED bar
              pushLight(
                threshX + end.inUx * (st.distM * mercScale) + endRx * latOff,
                threshZ + end.inUz * (st.distM * mercScale) + endRz * latOff,
                [0.95, 0.96, 1.0],
                14.2,
                4,
                0,
              );
            }
          }
        }
      }

      // High-Res Rotating Runway Designation Number painted right on pavement
      const numTex = createRunwayNumberTexture(end.label, isSfo);
      const numMat = new THREE.MeshBasicMaterial({
        map: numTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const numSize = rwyW * 0.62;
      const numGeo = new THREE.PlaneGeometry(numSize, numSize);
      numGeo.rotateX(-Math.PI / 2);
      const numMesh = new THREE.Mesh(numGeo, numMat);
      numMesh.position.set(
        threshX + end.inUx * (62 * mercScale),
        0,
        threshZ + end.inUz * (62 * mercScale),
      );
      numMesh.rotation.y = -THREE.MathUtils.degToRad(end.headingDeg);
      numMesh.renderOrder = -12;
      group.add(numMesh);
      disposables.push(numTex, numMat, numGeo);

      // Extended Approach Corridor Rails (2800m) + ILS Dash Centerline (8500m)
      const appDist = 2800 * mercScale;
      const farDist = 8500 * mercScale;
      const outUx = -end.inUx;
      const outUz = -end.inUz;
      const appEndX = threshX + outUx * appDist;
      const appEndZ = threshZ + outUz * appDist;
      const farEndX = threshX + outUx * farDist;
      const farEndZ = threshZ + outUz * farDist;

      appendSmoothTaxiRibbonXZ(
        [
          [threshX, threshZ],
          [appEndX, appEndZ],
        ],
        Math.max(3.0 * mercScale, rwyW * 0.08),
        0,
        rwyApproachRailsVerts,
        false,
      );
      rwyApproachSegs.push(appEndX, 0, appEndZ, farEndX, 0, farEndZ);

      // Threshold Green Lights + Runway End Red Lights + PAPI 4-Light Left Side + ALSF-II Rabbit Strobes
      for (let tIdx = -4; tIdx <= 4; tIdx++) {
        pushLight(
          threshX + endRx * (halfW * 0.22 * tIdx),
          threshZ + endRz * (halfW * 0.22 * tIdx),
          [0.24, 0.92, 0.45],
          12.6,
          4,
          0,
        );
        // Runway physical end red lights
        pushLight(
          end.pt[0] + endRx * (halfW * 0.22 * tIdx),
          end.pt[1] + endRz * (halfW * 0.22 * tIdx),
          [0.95, 0.22, 0.22],
          13.0,
          4,
          0,
        );
      }
      for (let p = 0; p < 4; p++) {
        const pCol: [number, number, number] = p < 2 ? [0.95, 0.22, 0.22] : [0.96, 0.96, 0.96];
        pushLight(
          threshX + end.inUx * (310 * mercScale) - endRx * (halfW + (16 + p * 7) * mercScale),
          threshZ + end.inUz * (310 * mercScale) - endRz * (halfW + (16 + p * 7) * mercScale),
          pCol,
          13.6,
          5,
          5,
        );
      }
      for (let s = 0; s < 10; s++) {
        const d = (80 + s * 65) * mercScale;
        pushLight(
          threshX + outUx * d,
          threshZ + outUz * d,
          [0.96, 0.96, 0.98],
          12.8,
          5,
          6,
          (9 - s) / 10,
        );
      }
    }

    // High-Intensity Runway Edge Lights + Centerline RCL Lights (White -> Red/White -> Red)
    const rwyEdgeSteps = Math.max(8, Math.floor(realLenM / 68));
    for (let k = 0; k <= rwyEdgeSteps; k++) {
      const f = k / rwyEdgeSteps;
      const distFromA = f * totalMercLen;
      if (distFromA < dispA || distFromA > totalMercLen - dispB) continue;
      const px = pA[0] + dx * f;
      const pz = pA[1] + dz * f;
      const distToEndM = Math.min(distFromA - dispA, totalMercLen - dispB - distFromA) / mercScale;
      const isCaution = distToEndM < 600;
      const edgeCol: [number, number, number] = isCaution ? [1.0, 0.72, 0.1] : [1.0, 1.0, 1.0];
      const tier = k % 3 === 0 ? 5 : k % 2 === 0 ? 3 : 1;
      pushLight(px + rx * (halfW * 1.04), pz + rz * (halfW * 1.04), edgeCol, 11.4, tier, 0, 0, 52);
      pushLight(px - rx * (halfW * 1.04), pz - rz * (halfW * 1.04), edgeCol, 11.4, tier, 0, 0, 52);

      // Runway Centerline Lights (RCL: red last 300m, alt red/white 300-900m, white middle)
      const rclCol: [number, number, number] =
        distToEndM < 300
          ? [1.0, 0.22, 0.22]
          : distToEndM < 900 && k % 2 === 0
            ? [1.0, 0.22, 0.22]
            : [1.0, 1.0, 1.0];
      pushLight(px, pz, rclCol, 12.6, tier, 0, 0, 44);
    }
  }

  // Build GPU Meshes (EVERY flat surface sets depthTest: false & depthWrite: false for ZERO shaking/Z-fighting!)
  const makeTriMesh = (
    targetGroup: THREE.Group,
    verts: number[],
    mat: THREE.Material,
    renderOrder: number,
  ) => {
    if (verts.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    targetGroup.add(mesh);
    disposables.push(geo, mat);
  };

  const makeLines = (
    targetGroup: THREE.Group,
    verts: number[],
    color: string,
    opacity: number,
    dashed: boolean,
    renderOrder: number,
    useDepthTest = false,
  ) => {
    if (verts.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = dashed
      ? new THREE.LineDashedMaterial({
          color,
          transparent: true,
          opacity,
          dashSize: 180 * mercScale,
          gapSize: 150 * mercScale,
          depthTest: useDepthTest,
          depthWrite: false,
        })
      : new THREE.LineBasicMaterial({
          color,
          transparent: opacity < 0.99,
          opacity,
          depthTest: useDepthTest,
          depthWrite: false,
        });
    const lines = new THREE.LineSegments(geo, mat);
    if (dashed) lines.computeLineDistances();
    lines.renderOrder = renderOrder;
    lines.frustumCulled = false;
    targetGroup.add(lines);
    disposables.push(geo, mat);
  };

  makeTriMesh(
    group,
    apronVerts,
    new THREE.MeshBasicMaterial({
      color: isDark ? '#0f1624' : '#314056',
      transparent: true,
      opacity: isDark ? 0.85 : 0.72,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -30,
  );
  makeLines(group, apronEdgeSegs, '#D97706', 0.65, false, -29);

  // Flat 2D Terminal Footprints (NEVER overlap 2D airplanes!)
  makeTriMesh(
    terminalFlatGroup,
    termFlatVerts,
    new THREE.MeshBasicMaterial({
      color: isDark ? '#1e293b' : '#475569',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -28,
  );
  makeLines(terminalFlatGroup, termFlatEdgeSegs, '#38BDF8', 0.85, false, -27);

  // 3D Extruded Terminal Concourses (only visible in 3D tilted view!)
  makeTriMesh(
    terminal3DGroup,
    terminal3DVerts,
    new THREE.MeshStandardMaterial({
      color: isDark ? '#1e293b' : '#475569',
      roughness: 0.55,
      metalness: 0.25,
      side: THREE.DoubleSide,
    }),
    5,
  );
  makeLines(terminal3DGroup, terminal3DEdgeSegs, '#38BDF8', 0.8, false, 6, true);

  // Bold SOLID OPAQUE Taxiway Outline Borders (never transparent!)
  makeTriMesh(
    group,
    twyHaloVerts,
    new THREE.MeshBasicMaterial({
      color: isDark ? '#D97706' : '#B45309',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -24,
  );
  makeTriMesh(
    group,
    twyDeckVerts,
    new THREE.MeshBasicMaterial({
      color: isDark ? '#0B101B' : '#1E293B',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -23,
  );
  makeTriMesh(
    group,
    twyLineVerts,
    new THREE.MeshBasicMaterial({
      color: '#FDE047',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -22,
  );
  // Crisp WebGL continuous line ONLY for wide/regional zoom (< 12.2) so close intersections have zero extra lines!
  makeLines(thinLinesGroup, twyThinLineSegs, '#FACC15', 0.92, false, -21);

  // Runways (Special Green Overlay for KSFO!)
  makeTriMesh(
    group,
    rwyShoulderVerts,
    new THREE.MeshBasicMaterial({
      color: isSfo ? '#10B981' : '#334155',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -17,
  );
  makeTriMesh(
    group,
    rwyBlastPadVerts,
    new THREE.MeshBasicMaterial({
      color: '#0F172A',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -16,
  );
  makeTriMesh(
    group,
    rwyDeckVerts,
    new THREE.MeshBasicMaterial({
      color: isSfo ? '#064E3B' : '#060910',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -15,
  );
  makeTriMesh(
    group,
    rwyWhiteMarkVerts,
    new THREE.MeshBasicMaterial({
      color: isSfo ? '#A7F3D0' : '#F8FAFC',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -14,
  );
  makeTriMesh(
    group,
    rwyDispArrowVerts,
    new THREE.MeshBasicMaterial({
      color: '#FACC15',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -13,
  );
  makeTriMesh(
    group,
    rwyApproachRailsVerts,
    new THREE.MeshBasicMaterial({
      color: isSfo ? '#34D399' : '#94A3B8',
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    -18,
  );
  makeLines(group, rwyApproachSegs, isSfo ? '#6EE7B7' : '#CBD5E1', 0.5, true, -18);

  // Calibrated Realistic Airfield LEDs (NormalBlending = sharp realistic intensity!)
  let lightMat: THREE.ShaderMaterial | null = null;
  if (lPos.length > 0) {
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.Float32BufferAttribute(lPos, 3));
    lGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(lCol, 3));
    lGeo.setAttribute('aMinZoom', new THREE.Float32BufferAttribute(lMinZoom, 1));
    lGeo.setAttribute('aTier', new THREE.Float32BufferAttribute(lTier, 1));
    lGeo.setAttribute('aKind', new THREE.Float32BufferAttribute(lKind, 1));
    lGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(lPhase, 1));

    lightMat = new THREE.ShaderMaterial({
      vertexShader: LIGHT_VERTEX_SHADER,
      fragmentShader: LIGHT_FRAGMENT_SHADER,
      uniforms: {
        uZoom: {value: 12},
        uTime: {value: 0},
        uPixelRatio: {value: Math.min(2, window.devicePixelRatio || 1)},
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const pts = new THREE.Points(lGeo, lightMat);
    pts.renderOrder = -10;
    pts.frustumCulled = false;
    group.add(pts);
    disposables.push(lGeo, lightMat);
  }

  return {
    icao: surface.icao,
    anchorMx,
    anchorMy,
    lat: surface.lat,
    lon: surface.lon,
    group,
    lightMat,
    taxiwayLabels,
    apronLabels,
    set3DMode: (is3D: boolean) => {
      terminal3DGroup.visible = is3D;
      terminalFlatGroup.visible = !is3D;
    },
    setZoom: (zoom: number) => {
      thinLinesGroup.visible = zoom < 12.2;
    },
    source: surface.source,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Persistent Airfield Surface Loader:
 * 1) Instant synchronous curated/memory seed (Frame-0 availability, never unloads!)
 * 2) IndexedDB persisted cache lookup for ALL catalog airports on site entry
 * 3) Sequential/prioritized background `/api/surface` fetch + upgrade
 */
export class PersistentAirfieldStore {
  private memCache = new Map<string, AirfieldSurfaceData>();
  private inFlight = new Set<string>();
  private preloadStarted = false;
  private onUpdated: () => void;

  constructor(onUpdated: () => void) {
    this.onUpdated = onUpdated;
  }

  public getInstant(icao: string, lat: number, lon: number): AirfieldSurfaceData | null {
    const key = icao.toUpperCase();
    const hit = this.memCache.get(key);
    if (hit) return hit;

    const curatedRunways = buildCuratedSeedSurface(key);
    const cat = AIRPORT_CATALOG.find((a) => a.icao.toUpperCase() === key);
    if (curatedRunways.length > 0) {
      const seed: AirfieldSurfaceData = {
        icao: key,
        iata: cat?.iata ?? key,
        lat: cat?.lat ?? lat,
        lon: cat?.lon ?? lon,
        aprons: [],
        runways: curatedRunways,
        taxiways: [],
        gates: [],
        source: 'catalog',
      };
      this.memCache.set(key, seed);
      return seed;
    }
    return null;
  }

  public preloadCatalogAirfields(priorityLat: number, priorityLon: number): void {
    if (this.preloadStarted) return;
    this.preloadStarted = true;

    const sorted = [...AIRPORT_CATALOG].sort(
      (a, b) =>
        Math.hypot(a.lat - priorityLat, a.lon - priorityLon) -
        Math.hypot(b.lat - priorityLat, b.lon - priorityLon),
    );

    // 1) Seed all catalog airports immediately in memory & hydrate IndexedDB hits immediately
    for (const ap of sorted) {
      this.getInstant(ap.icao, ap.lat, ap.lon);
    }

    // 2) Hydrate IndexedDB cache for all catalog hubs, then smoothly fetch missing OSM surfaces (concurrency=2)
    void (async () => {
      const missing: typeof sorted = [];
      await Promise.all(
        sorted.map(async (ap) => {
          const hit = await loadCachedSurface(ap.icao);
          if (hit && (hit.runways.length > 0 || hit.taxiways.length > 0)) {
            this.memCache.set(ap.icao.toUpperCase(), {
              ...hit,
              runways: applyDisplacedThresholds(ap.icao, hit.runways),
            });
          } else {
            missing.push(ap);
          }
        }),
      );
      this.onUpdated();

      // Priority warm first 18 major hubs politely without flooding Overpass
      const queue = missing.slice(0, 18);
      const workers = [0, 1].map(async () => {
        while (queue.length > 0) {
          const ap = queue.shift();
          if (!ap) break;
          await this.ensureLoaded(ap.icao, ap.iata, ap.lat, ap.lon);
          await new Promise((r) => setTimeout(r, 120));
        }
      });
      await Promise.all(workers);
    })();
  }

  public async ensureLoaded(icao: string, iata: string, lat: number, lon: number): Promise<void> {
    const key = (icao || iata).toUpperCase();
    const existing = this.memCache.get(key);
    if (existing && existing.source === 'osm-overpass' && existing.taxiways.length > 0) return;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);

    try {
      const idbHit = await loadCachedSurface(key);
      if (idbHit && (idbHit.runways.length > 0 || idbHit.taxiways.length > 0)) {
        this.memCache.set(key, {
          ...idbHit,
          runways: applyDisplacedThresholds(key, idbHit.runways),
        });
        this.onUpdated();
        if (idbHit.source === 'osm-overpass' && idbHit.taxiways.length > 0) {
          return;
        }
      }

      const qs = new URLSearchParams({
        icao: key,
        lat: lat.toFixed(4),
        lon: lon.toFixed(4),
      });
      const fetched = await apiFetchJson<AirfieldSurfaceData>(`/api/surface?${qs.toString()}`);
      if (fetched && (fetched.runways.length > 0 || fetched.taxiways.length > 0)) {
        const cleanData: AirfieldSurfaceData = {
          ...fetched,
          runways: applyDisplacedThresholds(key, fetched.runways),
          aprons:
            fetched.aprons.length > 0
              ? fetched.aprons
              : (fetched.labeledAprons ?? []).map((a) => a.coords),
        };
        if (cleanData.aprons.length === 0 && cleanData.labeledAprons?.length) {
          cleanData.aprons = cleanData.labeledAprons.map((a) => a.coords);
        }
        if (!Number.isFinite(cleanData.lat) || !Number.isFinite(cleanData.lon)) {
          const pts = cleanData.runways[0]?.coords ?? [];
          const c = polygonCentroid(pts);
          cleanData.lat = c[0] || lat;
          cleanData.lon = c[1] || lon;
        }
        this.memCache.set(key, cleanData);
        await saveCachedSurface(key, cleanData);
        this.onUpdated();
      }
    } catch {
      // Retain seed geometry if offline or timed out
    } finally {
      this.inFlight.delete(key);
    }
  }

  public getAllLoaded(): AirfieldSurfaceData[] {
    return Array.from(this.memCache.values());
  }
}
