import * as THREE from 'three';
import type {
  AirwaySegmentSpec,
  AtcBoundaryFeature,
  EnrouteChartResponse,
  NavWaypointSpec,
  OceanicTrackSpec,
  TimeZoneBoundaryFeature,
  WeatherLayersResponse,
  WeatherOverlaySettings,
} from '../types/aviation';
import {latToMy, lonToMx, MERCATOR_WORLD_M} from './gpuTileLayer';

export interface AviationHudLabel {
  id: string;
  lat: number;
  lon: number;
  text: string;
  kind: 'fir' | 'oceanic-fir' | 'nat' | 'airway-hi' | 'airway-lo' | 'waypoint' | 'timezone' | 'wx-volc' | 'wx-pirep' | 'wx-ltg' | 'wx-fog';
  direction?: 'west' | 'east' | 'both';
}

function disposeGroupChildren(grp: THREE.Group) {
  while (grp.children.length > 0) {
    const ch = grp.children[grp.children.length - 1];
    grp.remove(ch);
    ch.traverse((node) => {
      const m = node as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
        else m.material.dispose();
      }
    });
  }
}

/**
 * Computes subsolar latitude (declination) & subsolar longitude for any UTC Date.
 */
function computeSolarSubpoint(now = new Date()): {subLatDeg: number; subLonDeg: number} {
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0);
  const dayOfYear = (now.getTime() - startOfYear) / 86400_000 + 1;
  const utcHours =
    now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;

  // Fractional year gamma (radians)
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  // Solar declination (radians, accurate within ~0.03 deg)
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // Equation of time (minutes)
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const subLonDeg = (((12 - utcHours - eqTime / 60) * 15 + 540) % 360) - 180;
  const subLatDeg = (decl * 180) / Math.PI;
  return {subLatDeg, subLonDeg};
}

function createWaypointSymbolAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);

  // Cell 0 (x 0..64): VOR / VOR-DME hexagon + center dot
  ctx.save();
  ctx.translate(32, 32);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const px = Math.cos(a) * 20;
    const py = Math.sin(a) * 20;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Cell 1 (x 64..128): VORTAC (hexagon + 3 solid lobes)
  ctx.save();
  ctx.translate(96, 32);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 3.8;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const px = Math.cos(a) * 15;
    const py = Math.sin(a) * 15;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  for (const angDeg of [-90, 30, 150]) {
    const a = (angDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 19, Math.sin(a) * 19, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Cell 2 (x 128..192): NDB dotted ring + center dot
  ctx.save();
  ctx.translate(160, 32);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI * 2) / 10;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 18, Math.sin(a) * 18, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Cell 3 (x 192..256): Enroute FIX / Oceanic Intersection triangle
  ctx.save();
  ctx.translate(224, 32);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -19);
  ctx.lineTo(17, 15);
  ctx.lineTo(-17, 15);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 3, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class AviationOverlaysManager {
  public readonly root = new THREE.Group();
  private dayNightGroup = new THREE.Group();
  private timezoneGroup = new THREE.Group();
  private atcGroup = new THREE.Group();
  private oceanicGroup = new THREE.Group();
  private airwaysGroup = new THREE.Group();
  private waypointsGroup = new THREE.Group();
  private wxGroup = new THREE.Group();

  private symbolAtlas: THREE.CanvasTexture;

  private atcData: AtcBoundaryFeature[] = [];
  private timezoneData: TimeZoneBoundaryFeature[] = [];
  private oceanicData: OceanicTrackSpec[] = [];
  private enrouteData: EnrouteChartResponse = {waypoints: [], highAirways: [], lowAirways: []};
  private wxLayersData: WeatherLayersResponse | null = null;

  private hudFirLabels: AviationHudLabel[] = [];
  private hudTimezoneLabels: AviationHudLabel[] = [];
  private hudOceanicLabels: AviationHudLabel[] = [];
  private hudAirwayLabels: AviationHudLabel[] = [];
  private hudWaypointLabels: AviationHudLabel[] = [];
  private hudWxLabels: AviationHudLabel[] = [];

  constructor() {
    this.symbolAtlas = createWaypointSymbolAtlas();
    this.root.add(
      this.dayNightGroup,
      this.timezoneGroup,
      this.atcGroup,
      this.oceanicGroup,
      this.airwaysGroup,
      this.waypointsGroup,
      this.wxGroup,
    );
  }

  public setAtcBoundaries(data: AtcBoundaryFeature[] | null | undefined) {
    this.atcData = Array.isArray(data) ? data : [];
  }

  public setTimeZones(data: TimeZoneBoundaryFeature[] | null | undefined) {
    this.timezoneData = Array.isArray(data) ? data : [];
  }

  public setOceanicTracks(data: OceanicTrackSpec[] | null | undefined) {
    this.oceanicData = Array.isArray(data) ? data : [];
  }

  public setEnrouteData(data: Partial<EnrouteChartResponse> | null | undefined) {
    this.enrouteData = {
      waypoints: Array.isArray(data?.waypoints) ? data.waypoints : [],
      highAirways: Array.isArray(data?.highAirways) ? data.highAirways : [],
      lowAirways: Array.isArray(data?.lowAirways) ? data.lowAirways : [],
    };
  }

  public setWeatherLayers(data: Partial<WeatherLayersResponse> | null | undefined) {
    if (!data) {
      this.wxLayersData = null;
      return;
    }
    this.wxLayersData = {
      windGrid: Array.isArray(data.windGrid) ? data.windGrid : [],
      pireps: Array.isArray(data.pireps) ? data.pireps : [],
      volcanic: Array.isArray(data.volcanic) ? data.volcanic : [],
      lightning: Array.isArray(data.lightning) ? data.lightning : [],
      fogZones: Array.isArray(data.fogZones) ? data.fogZones : [],
      sigwx: Array.isArray(data.sigwx) ? data.sigwx : [],
      fetchedAt: Number(data.fetchedAt ?? Date.now()),
    };
  }

  public getHudLabels(opts: {
    showAtcBoundaries: boolean;
    showTimeZones: boolean;
    showOceanicTracks: boolean;
    showHighAirways: boolean;
    showLowAirways: boolean;
    showWaypoints: boolean;
    zoom: number;
  }): AviationHudLabel[] {
    const out: AviationHudLabel[] = [];
    if (opts.showTimeZones && opts.zoom <= 7.8) {
      out.push(...this.hudTimezoneLabels);
    }
    if (opts.showAtcBoundaries && opts.zoom <= 9.8) {
      out.push(...this.hudFirLabels);
    }
    if (opts.showOceanicTracks && opts.zoom <= 9.2) {
      out.push(...this.hudOceanicLabels);
    }
    if ((opts.showHighAirways || opts.showLowAirways) && opts.zoom >= 4.2 && opts.zoom <= 11.5) {
      for (const lbl of this.hudAirwayLabels) {
        if (lbl.kind === 'airway-hi' && opts.showHighAirways) out.push(lbl);
        if (lbl.kind === 'airway-lo' && opts.showLowAirways && opts.zoom >= 5.6) out.push(lbl);
      }
    }
    if (opts.showWaypoints && opts.zoom >= 3.2 && opts.zoom <= 13.0) {
      out.push(...this.hudWaypointLabels);
    }
    if (this.hudWxLabels.length > 0) {
      out.push(...this.hudWxLabels);
    }
    const seenIds = new Set<string>();
    return out.filter((lbl) => {
      if (seenIds.has(lbl.id)) return false;
      seenIds.add(lbl.id);
      return true;
    });
  }

  public rebuildDayNight(anchorMx: number, anchorMy: number, enabled: boolean) {
    disposeGroupChildren(this.dayNightGroup);
    this.dayNightGroup.visible = enabled;
    if (!enabled) return;

    const {subLatDeg, subLonDeg} = computeSolarSubpoint(new Date());
    const declRad = THREE.MathUtils.degToRad(Math.abs(subLatDeg) < 0.25 ? (subLatDeg >= 0 ? 0.25 : -0.25) : subLatDeg);
    const tanDecl = Math.tan(declRad);
    const nightPoleLat = subLatDeg >= 0 ? -84.5 : 84.5;
    const nightDir = nightPoleLat < 0 ? -1 : 1; // direction toward night pole in latitude
    const nightPoleMy = latToMy(nightPoleLat);

    // Smooth twilight gradient strips (deg offset from solar terminator toward night)
    // alpha ramps smoothly 0.0 (day edge) -> 0.07 (civil) -> 0.16 (nautical) -> 0.25 (astro) -> 0.30 (deep night)
    const bands: Array<{degShift: number; alpha: number}> = [
      {degShift: -5.5, alpha: 0.0},
      {degShift: -1.5, alpha: 0.055},
      {degShift: 2.5, alpha: 0.135},
      {degShift: 7.0, alpha: 0.225},
      {degShift: 13.0, alpha: 0.285},
    ];

    const lineVerts: number[] = [];
    const shadowVerts: number[] = [];
    const shadowAlphas: number[] = [];

    const clampLat = (v: number) => THREE.MathUtils.clamp(v, -84.5, 84.5);

    for (const wrapOffset of [-1, 0, 1]) {
      const bandPts: Array<Array<[number, number]>> = bands.map(() => []);
      const termPts: Array<[number, number]> = [];
      const poleZ = (nightPoleMy - anchorMy) * MERCATOR_WORLD_M;

      for (let lon = -180; lon <= 180; lon += 3) {
        const dLonRad = THREE.MathUtils.degToRad(lon - subLonDeg);
        const latRad = Math.atan(-Math.cos(dLonRad) / tanDecl);
        const termLat = THREE.MathUtils.radToDeg(latRad);
        const wx = (lonToMx(lon) + wrapOffset - anchorMx) * MERCATOR_WORLD_M;

        termPts.push([wx, (latToMy(clampLat(termLat)) - anchorMy) * MERCATOR_WORLD_M]);
        for (let b = 0; b < bands.length; b++) {
          const bLat = clampLat(termLat + nightDir * bands[b].degShift);
          bandPts[b].push([wx, (latToMy(bLat) - anchorMy) * MERCATOR_WORLD_M]);
        }
      }

      for (let i = 0; i < termPts.length - 1; i++) {
        lineVerts.push(termPts[i][0], 0.45, termPts[i][1], termPts[i + 1][0], 0.45, termPts[i + 1][1]);

        // Smooth twilight gradient strips
        for (let b = 0; b < bands.length - 1; b++) {
          const a0 = bandPts[b][i];
          const b0 = bandPts[b][i + 1];
          const a1 = bandPts[b + 1][i];
          const b1 = bandPts[b + 1][i + 1];
          const al0 = bands[b].alpha;
          const al1 = bands[b + 1].alpha;

          shadowVerts.push(a0[0], 0.2, a0[1], b0[0], 0.2, b0[1], b1[0], 0.2, b1[1]);
          shadowAlphas.push(al0, al0, al1);

          shadowVerts.push(a0[0], 0.2, a0[1], b1[0], 0.2, b1[1], a1[0], 0.2, a1[1]);
          shadowAlphas.push(al0, al1, al1);
        }

        // Solid night umbra from deepest twilight band to night pole
        const lastPts = bandPts[bands.length - 1];
        const lastAlpha = bands[bands.length - 1].alpha;
        const ua = lastPts[i];
        const ub = lastPts[i + 1];
        shadowVerts.push(ua[0], 0.2, ua[1], ub[0], 0.2, ub[1], ub[0], 0.2, poleZ);
        shadowAlphas.push(lastAlpha, lastAlpha, lastAlpha);
        shadowVerts.push(ua[0], 0.2, ua[1], ub[0], 0.2, poleZ, ua[0], 0.2, poleZ);
        shadowAlphas.push(lastAlpha, lastAlpha, lastAlpha);
      }
    }

    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute(shadowVerts, 3));
    sGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(shadowAlphas, 1));
    const sMat = new THREE.ShaderMaterial({
      uniforms: {
        uNightColor: {value: new THREE.Color('#040B1A')},
      },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uNightColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.004) discard;
          gl_FragColor = vec4(uNightColor, vAlpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const sMesh = new THREE.Mesh(sGeo, sMat);
    sMesh.renderOrder = -19;
    sMesh.frustumCulled = false;

    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    const lMat = new THREE.LineBasicMaterial({
      color: '#F59E0B',
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    });
    const lSegs = new THREE.LineSegments(lGeo, lMat);
    lSegs.renderOrder = -18;
    lSegs.frustumCulled = false;

    this.dayNightGroup.add(sMesh, lSegs);
  }

  public rebuildAtcBoundaries(anchorMx: number, anchorMy: number, enabled: boolean, isNightTerrain: boolean) {
    disposeGroupChildren(this.atcGroup);
    this.hudFirLabels = [];
    this.atcGroup.visible = enabled;
    if (!enabled || this.atcData.length === 0) return;

    const domesticVerts: number[] = [];
    const oceanicVerts: number[] = [];

    for (const fir of this.atcData) {
      const target = fir.oceanic ? oceanicVerts : domesticVerts;
      for (const ring of fir.rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lat0, lon0] = ring[i];
          const [lat1, lon1] = ring[i + 1];
          // Skip antimeridian jump lines
          if (Math.abs(lon1 - lon0) > 180) continue;
          const x0 = (lonToMx(lon0) - anchorMx) * MERCATOR_WORLD_M;
          const z0 = (latToMy(lat0) - anchorMy) * MERCATOR_WORLD_M;
          const x1 = (lonToMx(lon1) - anchorMx) * MERCATOR_WORLD_M;
          const z1 = (latToMy(lat1) - anchorMy) * MERCATOR_WORLD_M;
          target.push(x0, 0.35, z0, x1, 0.35, z1);
        }
      }
      this.hudFirLabels.push({
        id: `fir-${fir.id}`,
        lat: fir.labelLat,
        lon: fir.labelLon,
        text: fir.id,
        kind: fir.oceanic ? 'oceanic-fir' : 'fir',
      });
    }

    if (domesticVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(domesticVerts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: isNightTerrain ? '#38BDF8' : '#0369A1',
        transparent: true,
        opacity: isNightTerrain ? 0.56 : 0.62,
        depthTest: false,
        depthWrite: false,
      });
      const segs = new THREE.LineSegments(geo, mat);
      segs.renderOrder = -17;
      segs.frustumCulled = false;
      this.atcGroup.add(segs);
    }

    if (oceanicVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(oceanicVerts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: isNightTerrain ? '#22D3EE' : '#0284C7',
        transparent: true,
        opacity: 0.48,
        depthTest: false,
        depthWrite: false,
      });
      const segs = new THREE.LineSegments(geo, mat);
      segs.renderOrder = -17;
      segs.frustumCulled = false;
      this.atcGroup.add(segs);
    }
  }

  public rebuildOceanicTracks(anchorMx: number, anchorMy: number, enabled: boolean) {
    disposeGroupChildren(this.oceanicGroup);
    this.hudOceanicLabels = [];
    this.oceanicGroup.visible = enabled;
    if (!enabled || this.oceanicData.length === 0) return;

    const westVerts: number[] = [];
    const eastVerts: number[] = [];
    const bothVerts: number[] = [];
    const nodePositions: number[] = [];

    for (const trk of this.oceanicData) {
      const target =
        trk.direction === 'east' ? eastVerts : trk.direction === 'west' ? westVerts : bothVerts;
      for (let i = 0; i < trk.points.length; i++) {
        const pt = trk.points[i];
        const wx = (lonToMx(pt.lon) - anchorMx) * MERCATOR_WORLD_M;
        const wz = (latToMy(pt.lat) - anchorMy) * MERCATOR_WORLD_M;
        nodePositions.push(wx, 0.55, wz);

        if (i < trk.points.length - 1) {
          const nxt = trk.points[i + 1];
          // Split across antimeridian cleanly for PACOT tracks
          let lon1 = nxt.lon;
          if (Math.abs(lon1 - pt.lon) > 180) {
            lon1 = lon1 > pt.lon ? lon1 - 360 : lon1 + 360;
          }
          const nx = (lonToMx(lon1) - anchorMx) * MERCATOR_WORLD_M;
          const nz = (latToMy(nxt.lat) - anchorMy) * MERCATOR_WORLD_M;
          target.push(wx, 0.5, wz, nx, 0.5, nz);
        }
      }

      const mid = trk.points[Math.floor(trk.points.length / 2)];
      if (mid) {
        const arrow = trk.direction === 'west' ? ' ←' : trk.direction === 'east' ? ' →' : ' ↔';
        this.hudOceanicLabels.push({
          id: `nat-${trk.id}`,
          lat: mid.lat,
          lon: mid.lon,
          text: `${trk.id}${arrow}`,
          kind: 'nat',
          direction: trk.direction,
        });
      }
    }

    const addTrackLayer = (verts: number[], color: string) => {
      if (verts.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      });
      const segs = new THREE.LineSegments(geo, mat);
      segs.renderOrder = -15;
      segs.frustumCulled = false;
      this.oceanicGroup.add(segs);
    };

    addTrackLayer(westVerts, '#06B6D4');
    addTrackLayer(eastVerts, '#D946EF');
    addTrackLayer(bothVerts, '#F59E0B');

    if (nodePositions.length > 0) {
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodePositions, 3));
      const pMat = new THREE.PointsMaterial({
        color: '#F8FAFC',
        size: 5,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      });
      const pts = new THREE.Points(pGeo, pMat);
      pts.renderOrder = -14;
      pts.frustumCulled = false;
      this.oceanicGroup.add(pts);
    }
  }

  public rebuildEnrouteCharts(
    anchorMx: number,
    anchorMy: number,
    opts: {
      showHighAirways: boolean;
      showLowAirways: boolean;
      showWaypoints: boolean;
      zoom: number;
      isNightTerrain: boolean;
    },
  ) {
    disposeGroupChildren(this.airwaysGroup);
    disposeGroupChildren(this.waypointsGroup);
    this.hudAirwayLabels = [];
    this.hudWaypointLabels = [];

    const highAirways = this.enrouteData?.highAirways ?? [];
    const lowAirways = this.enrouteData?.lowAirways ?? [];
    const waypoints = this.enrouteData?.waypoints ?? [];

    // 1. High & Low Airways
    if (opts.showHighAirways && highAirways.length > 0) {
      const verts: number[] = [];
      for (const seg of highAirways) {
        if (Math.abs(seg.toLon - seg.fromLon) > 180) continue;
        verts.push(
          (lonToMx(seg.fromLon) - anchorMx) * MERCATOR_WORLD_M,
          0.4,
          (latToMy(seg.fromLat) - anchorMy) * MERCATOR_WORLD_M,
          (lonToMx(seg.toLon) - anchorMx) * MERCATOR_WORLD_M,
          0.4,
          (latToMy(seg.toLat) - anchorMy) * MERCATOR_WORLD_M,
        );
        if (this.hudAirwayLabels.length < 28) {
          this.hudAirwayLabels.push({
            id: `awy-${seg.id}`,
            lat: (seg.fromLat + seg.toLat) * 0.5,
            lon: (seg.fromLon + seg.toLon) * 0.5,
            text: seg.name,
            kind: 'airway-hi',
          });
        }
      }
      if (verts.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        const mat = new THREE.LineBasicMaterial({
          color: opts.isNightTerrain ? '#60A5FA' : '#1D4ED8',
          transparent: true,
          opacity: opts.isNightTerrain ? 0.52 : 0.48,
          depthTest: false,
          depthWrite: false,
        });
        const segs = new THREE.LineSegments(geo, mat);
        segs.renderOrder = -16;
        segs.frustumCulled = false;
        this.airwaysGroup.add(segs);
      }
    }

    if (opts.showLowAirways && opts.zoom >= 5.2 && lowAirways.length > 0) {
      const verts: number[] = [];
      for (const seg of lowAirways) {
        if (Math.abs(seg.toLon - seg.fromLon) > 180) continue;
        verts.push(
          (lonToMx(seg.fromLon) - anchorMx) * MERCATOR_WORLD_M,
          0.42,
          (latToMy(seg.fromLat) - anchorMy) * MERCATOR_WORLD_M,
          (lonToMx(seg.toLon) - anchorMx) * MERCATOR_WORLD_M,
          0.42,
          (latToMy(seg.toLat) - anchorMy) * MERCATOR_WORLD_M,
        );
        if (this.hudAirwayLabels.length < 44) {
          this.hudAirwayLabels.push({
            id: `awy-${seg.id}`,
            lat: (seg.fromLat + seg.toLat) * 0.5,
            lon: (seg.fromLon + seg.toLon) * 0.5,
            text: seg.name,
            kind: 'airway-lo',
          });
        }
      }
      if (verts.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        const mat = new THREE.LineBasicMaterial({
          color: opts.isNightTerrain ? '#34D399' : '#047857',
          transparent: true,
          opacity: opts.isNightTerrain ? 0.5 : 0.45,
          depthTest: false,
          depthWrite: false,
        });
        const segs = new THREE.LineSegments(geo, mat);
        segs.renderOrder = -15;
        segs.frustumCulled = false;
        this.airwaysGroup.add(segs);
      }
    }

    // 2. Navigational Waypoints (Single Atlas Shader Draw Call!)
    if (opts.showWaypoints && waypoints.length > 0) {
      const pos: number[] = [];
      const col: number[] = [];
      const sym: number[] = [];
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const wx = (lonToMx(wp.lon) - anchorMx) * MERCATOR_WORLD_M;
        const wz = (latToMy(wp.lat) - anchorMy) * MERCATOR_WORLD_M;
        pos.push(wx, 0.55, wz);

        const symIdx =
          wp.kind === 'VORTAC' || wp.kind === 'TACAN'
            ? 1
            : wp.kind === 'NDB'
              ? 2
              : wp.kind === 'FIX'
                ? 3
                : 0;
        sym.push(symIdx);

        if (wp.kind === 'NDB') {
          col.push(0.75, 0.25, 0.65);
        } else if (wp.kind === 'FIX') {
          col.push(0.05, 0.65, 0.91);
        } else if (wp.usage === 'LO') {
          col.push(0.06, 0.72, 0.5);
        } else {
          col.push(0.11, 0.31, 0.85);
        }

        if (this.hudWaypointLabels.length < 48) {
          this.hudWaypointLabels.push({
            id: `wp-${wp.ident}-${i}`,
            lat: wp.lat,
            lon: wp.lon,
            text: wp.freq ? `${wp.ident} ${wp.freq}` : wp.ident,
            kind: 'waypoint',
          });
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('aSymbol', new THREE.Float32BufferAttribute(sym, 1));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: {value: this.symbolAtlas},
          uSize: {value: Math.min(20, Math.max(11, opts.zoom * 1.45)) * Math.min(1.5, window.devicePixelRatio || 1)},
        },
        vertexShader: `
          attribute vec3 aColor;
          attribute float aSymbol;
          uniform float uSize;
          varying vec3 vColor;
          varying float vSymbol;
          void main() {
            vColor = aColor;
            vSymbol = aSymbol;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize;
          }
        `,
        fragmentShader: `
          uniform sampler2D uAtlas;
          varying vec3 vColor;
          varying float vSymbol;
          void main() {
            float cell = floor(vSymbol + 0.5);
            vec2 uv = vec2((cell + gl_PointCoord.x) * 0.25, 1.0 - gl_PointCoord.y);
            vec4 texel = texture2D(uAtlas, uv);
            if (texel.a < 0.12) discard;
            gl_FragColor = vec4(vColor * texel.rgb, texel.a * 0.95);
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = -13;
      pts.frustumCulled = false;
      this.waypointsGroup.add(pts);
    }
  }

  public rebuildTimeZones(anchorMx: number, anchorMy: number, enabled: boolean, isNightTerrain: boolean) {
    disposeGroupChildren(this.timezoneGroup);
    this.hudTimezoneLabels = [];
    this.timezoneGroup.visible = enabled;
    if (!enabled || this.timezoneData.length === 0) return;

    const verts: number[] = [];
    const seenLabels = new Set<string>();
    const seenIds = new Set<string>();
    for (let idx = 0; idx < this.timezoneData.length; idx++) {
      const tz = this.timezoneData[idx];
      for (const ring of tz.rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lat0, lon0] = ring[i];
          const [lat1, lon1] = ring[i + 1];
          if (Math.abs(lon1 - lon0) > 180) continue;
          const x0 = (lonToMx(lon0) - anchorMx) * MERCATOR_WORLD_M;
          const z0 = (latToMy(lat0) - anchorMy) * MERCATOR_WORLD_M;
          const x1 = (lonToMx(lon1) - anchorMx) * MERCATOR_WORLD_M;
          const z1 = (latToMy(lat1) - anchorMy) * MERCATOR_WORLD_M;
          verts.push(x0, 0.28, z0, x1, 0.28, z1);
        }
      }
      const lblKey = `${tz.name}|${Math.round(tz.labelLat / 12)}`;
      const uniqueId = `tz-${idx}-${String(tz.id).replace(/^tz-/, '')}`;
      if (!seenLabels.has(lblKey) && !seenIds.has(uniqueId) && this.hudTimezoneLabels.length < 32) {
        seenLabels.add(lblKey);
        seenIds.add(uniqueId);
        this.hudTimezoneLabels.push({
          id: uniqueId,
          lat: tz.labelLat,
          lon: tz.labelLon,
          text: tz.name,
          kind: 'timezone',
        });
      }
    }

    if (verts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: isNightTerrain ? '#FBBF24' : '#B45309',
        transparent: true,
        opacity: isNightTerrain ? 0.38 : 0.42,
        depthTest: false,
        depthWrite: false,
      });
      const segs = new THREE.LineSegments(geo, mat);
      segs.renderOrder = -18;
      segs.frustumCulled = false;
      this.timezoneGroup.add(segs);
    }
  }

  public rebuildWeatherLayers(
    anchorMx: number,
    anchorMy: number,
    opts: {wxLayers: WeatherOverlaySettings; zoom: number; isNightTerrain: boolean},
  ) {
    disposeGroupChildren(this.wxGroup);
    this.hudWxLabels = [];
    const data = this.wxLayersData;
    const {wxLayers, zoom, isNightTerrain} = opts;
    if (!data) return;

    const drawPolyRing = (coords: Array<[number, number]>, color: string, opacity: number, y: number) => {
      if (coords.length < 2) return;
      const verts: number[] = [];
      for (let i = 0; i < coords.length; i++) {
        const a = coords[i];
        const b = coords[(i + 1) % coords.length];
        if (Math.abs(b[1] - a[1]) > 180) continue;
        verts.push(
          (lonToMx(a[1]) - anchorMx) * MERCATOR_WORLD_M,
          y,
          (latToMy(a[0]) - anchorMy) * MERCATOR_WORLD_M,
          (lonToMx(b[1]) - anchorMx) * MERCATOR_WORLD_M,
          y,
          (latToMy(b[0]) - anchorMy) * MERCATOR_WORLD_M,
        );
      }
      if (verts.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      });
      const segs = new THREE.LineSegments(geo, mat);
      segs.renderOrder = -8;
      segs.frustumCulled = false;
      this.wxGroup.add(segs);
    };

    // 1. Fog Zones & Mist Patches
    const fogZones = data.fogZones ?? [];
    if (wxLayers.fog && fogZones.length > 0) {
      for (const fz of fogZones) {
        if (fz.coords && fz.coords.length >= 2) {
          drawPolyRing(fz.coords, isNightTerrain ? '#CBD5E1' : '#64748B', 0.72, 0.65);
          if (fz.coords.length >= 3) {
            const shapePts = fz.coords.map(
              ([la, lo]) =>
                new THREE.Vector2(
                  (lonToMx(lo) - anchorMx) * MERCATOR_WORLD_M,
                  -(latToMy(la) - anchorMy) * MERCATOR_WORLD_M,
                ),
            );
            try {
              const shape = new THREE.Shape(shapePts);
              const geo = new THREE.ShapeGeometry(shape);
              geo.rotateX(-Math.PI / 2);
              const mat = new THREE.MeshBasicMaterial({
                color: '#94A3B8',
                transparent: true,
                opacity: 0.28,
                side: THREE.DoubleSide,
                depthTest: false,
                depthWrite: false,
              });
              const mesh = new THREE.Mesh(geo, mat);
              mesh.position.y = 0.52;
              mesh.renderOrder = -9;
              this.wxGroup.add(mesh);
            } catch {
              // ignore degenerate polygon
            }
          }
        }
      }
    }

    // 2. Significant Weather FL250-630 & Volcanic Ash Plumes
    for (const poly of data.sigwx ?? []) {
      if (!poly.coords || poly.coords.length < 3) continue;
      const isVa = /VOLCAN/i.test(poly.title + ' ' + poly.detail);
      if (isVa && wxLayers.volcanic) {
        drawPolyRing(poly.coords, '#F97316', 0.92, 0.75);
      } else if (!isVa && wxLayers.sigwx) {
        drawPolyRing(poly.coords, '#E879F9', 0.78, 0.68);
      }
    }

    // 3. Wind Barbs (World-space staff + speed pennants/feathers, always crisp at any zoom)
    const windGrid = data.windGrid ?? [];
    if (wxLayers.windBarbs && windGrid.length > 0) {
      const barbVerts: number[] = [];
      const pxToM = MERCATOR_WORLD_M / (256 * Math.pow(2, zoom));
      const staffLen = 28 * pxToM;
      const tickLen = 9 * pxToM;
      for (const wp of windGrid) {
        const useUpper = zoom < 6.5;
        const spd = useUpper && wp.upperSpeedKts > 0 ? wp.upperSpeedKts : wp.surfaceSpeedKts;
        const dirDeg = useUpper && wp.upperSpeedKts > 0 ? wp.upperDirDeg : wp.surfaceDirDeg;
        if (spd <= 2) continue;

        const cx = (lonToMx(wp.lon) - anchorMx) * MERCATOR_WORLD_M;
        const cz = (latToMy(wp.lat) - anchorMy) * MERCATOR_WORLD_M;
        const ang = THREE.MathUtils.degToRad(dirDeg);
        // Wind barb staff points INTO the wind (direction from)
        const dx = Math.sin(ang);
        const dz = -Math.cos(ang);
        // Feather perpendicular to staff
        const px = Math.cos(ang);
        const pz = Math.sin(ang);

        const ex = cx + dx * staffLen;
        const ez = cz + dz * staffLen;
        barbVerts.push(cx, 0.85, cz, ex, 0.85, ez);

        let rem = Math.round(spd / 5) * 5;
        let frac = 1.0;
        while (rem >= 50 && frac > 0.2) {
          const bx = cx + dx * staffLen * frac;
          const bz = cz + dz * staffLen * frac;
          const tx = bx + px * tickLen * 1.15 - dx * staffLen * 0.14;
          const tz = bz + pz * tickLen * 1.15 - dz * staffLen * 0.14;
          const nx = cx + dx * staffLen * (frac - 0.18);
          const nz = cz + dz * staffLen * (frac - 0.18);
          barbVerts.push(bx, 0.85, bz, tx, 0.85, tz, tx, 0.85, tz, nx, 0.85, nz);
          rem -= 50;
          frac -= 0.24;
        }
        while (rem >= 10 && frac > 0.15) {
          const bx = cx + dx * staffLen * frac;
          const bz = cz + dz * staffLen * frac;
          const tx = bx + px * tickLen + dx * staffLen * 0.08;
          const tz = bz + pz * tickLen + dz * staffLen * 0.08;
          barbVerts.push(bx, 0.85, bz, tx, 0.85, tz);
          rem -= 10;
          frac -= 0.14;
        }
        if (rem >= 5 && frac > 0.1) {
          const bx = cx + dx * staffLen * frac;
          const bz = cz + dz * staffLen * frac;
          const tx = bx + px * tickLen * 0.55 + dx * staffLen * 0.04;
          const tz = bz + pz * tickLen * 0.55 + dz * staffLen * 0.04;
          barbVerts.push(bx, 0.85, bz, tx, 0.85, tz);
        }
      }
      if (barbVerts.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(barbVerts, 3));
        const mat = new THREE.LineBasicMaterial({
          color: isNightTerrain ? '#38BDF8' : '#0F172A',
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
        });
        const segs = new THREE.LineSegments(geo, mat);
        segs.renderOrder = -6;
        segs.frustumCulled = false;
        this.wxGroup.add(segs);
      }
    }

    // 4. Hazard Point Markers (Volcanic Eruptions, PIREPs/AIREPs, Lightning, METAR Fog)
    const ptGroups: Array<{
      enabled: boolean;
      items: WeatherLayersResponse['pireps'];
      color: string;
      size: number;
      hudKind: AviationHudLabel['kind'];
    }> = [
      {enabled: wxLayers.volcanic, items: data.volcanic ?? [], color: '#F97316', size: 11, hudKind: 'wx-volc'},
      {enabled: wxLayers.airepsPireps, items: data.pireps ?? [], color: '#38BDF8', size: 8, hudKind: 'wx-pirep'},
      {enabled: wxLayers.lightning, items: data.lightning ?? [], color: '#FACC15', size: 9, hudKind: 'wx-ltg'},
      {enabled: wxLayers.fog, items: fogZones, color: '#94A3B8', size: 8, hudKind: 'wx-fog'},
    ];

    for (const grp of ptGroups) {
      if (!grp.enabled || grp.items.length === 0) continue;
      const pos: number[] = [];
      for (const mk of grp.items) {
        pos.push(
          (lonToMx(mk.lon) - anchorMx) * MERCATOR_WORLD_M,
          1.15,
          (latToMy(mk.lat) - anchorMy) * MERCATOR_WORLD_M,
        );
        if (this.hudWxLabels.length < 36) {
          this.hudWxLabels.push({
            id: `wx-${mk.id}`,
            lat: mk.lat,
            lon: mk.lon,
            text: mk.title,
            kind: grp.hudKind,
          });
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: grp.color,
        size: grp.size,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = -5;
      pts.frustumCulled = false;
      this.wxGroup.add(pts);
    }
  }

  public dispose() {
    disposeGroupChildren(this.dayNightGroup);
    disposeGroupChildren(this.timezoneGroup);
    disposeGroupChildren(this.atcGroup);
    disposeGroupChildren(this.oceanicGroup);
    disposeGroupChildren(this.airwaysGroup);
    disposeGroupChildren(this.waypointsGroup);
    disposeGroupChildren(this.wxGroup);
    this.symbolAtlas.dispose();
  }
}
