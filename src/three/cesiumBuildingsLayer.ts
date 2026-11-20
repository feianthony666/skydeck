import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLOBAL_OVERPASS_MIRRORS} from '../utils/airfieldGeometry';
import {latToMy, lonToMx, MERCATOR_WORLD_M, mercatorScaleAtLat} from './gpuTileLayer';

// User-provided Cesium Ion access token (used ONLY as last-resort/optional 3D Buildings layer)
const CESIUM_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4OTNiYWIzMy1jOWQ1LTQ5Y2QtOTEwOC00MjFlZjE0OTc2MmMiLCJpZCI6NDUzNzI5LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODM0ODQxMjd9.jZ0asOuRVvnWu6W9oXKJ7aE7KHxzbVofMXe16F8Nq-o';
const CESIUM_OSM_BUILDINGS_ASSET_ID = 96188;

interface OsmBuildingPoly {
  coords: Array<[number, number]>;
  heightM: number;
}

interface CesiumEndpointInfo {
  url: string;
  accessToken: string;
}

interface TilesetNode {
  boundingVolume?: {
    region?: [number, number, number, number, number, number];
  };
  content?: {uri?: string; url?: string};
  children?: TilesetNode[];
}

function ecefToGeodeticLatLon(x: number, y: number, z: number): {lat: number; lon: number} {
  const a = 6378137.0;
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  const lat = Math.atan2(z, p * (1 - 0.00669437999014));
  void a;
  return {
    lat: THREE.MathUtils.radToDeg(lat),
    lon: THREE.MathUtils.radToDeg(lon),
  };
}

/**
 * Extracts the embedded GLB payload + optional RTC_CENTER from a Cesium .b3dm binary tile.
 */
function extractGlbFromB3dm(buffer: ArrayBuffer): {
  glbBuffer: ArrayBuffer;
  rtcCenter?: [number, number, number];
} | null {
  if (buffer.byteLength < 28) return null;
  const view = new DataView(buffer);
  const magic =
    String.fromCharCode(view.getUint8(0)) +
    String.fromCharCode(view.getUint8(1)) +
    String.fromCharCode(view.getUint8(2)) +
    String.fromCharCode(view.getUint8(3));
  if (magic !== 'b3dm') return null;

  const ftJsonLen = view.getUint32(12, true);
  const ftBinLen = view.getUint32(16, true);
  const btJsonLen = view.getUint32(20, true);
  const btBinLen = view.getUint32(24, true);

  let rtcCenter: [number, number, number] | undefined;
  if (ftJsonLen > 0) {
    try {
      const jsonStr = new TextDecoder().decode(new Uint8Array(buffer, 28, ftJsonLen));
      const ft = JSON.parse(jsonStr) as {RTC_CENTER?: [number, number, number]};
      if (Array.isArray(ft.RTC_CENTER) && ft.RTC_CENTER.length === 3) {
        rtcCenter = ft.RTC_CENTER;
      }
    } catch {
      // ignore featureTable parse failure
    }
  }

  const glbOffset = 28 + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
  if (glbOffset >= buffer.byteLength) return null;
  return {
    glbBuffer: buffer.slice(glbOffset),
    rtcCenter,
  };
}

export class World3DBuildingsManager {
  private group = new THREE.Group();
  private osmChunkCache = new Map<string, OsmBuildingPoly[]>();
  private inFlightCells = new Set<string>();
  private builtCells = new Map<string, {mesh: THREE.Group; lat: number; lon: number}>();
  private cesiumEndpoint: CesiumEndpointInfo | null = null;
  private cesiumTried = false;
  private gltfLoader = new GLTFLoader();
  private sharedOsmMat = new THREE.MeshStandardMaterial({
    color: '#334155',
    roughness: 0.65,
    metalness: 0.18,
  });
  private onUpdated: () => void;

  constructor(onUpdated: () => void) {
    this.onUpdated = onUpdated;
  }

  public getGroup(): THREE.Group {
    return this.group;
  }

  private async ensureCesiumEndpoint(): Promise<CesiumEndpointInfo | null> {
    if (this.cesiumEndpoint) return this.cesiumEndpoint;
    if (this.cesiumTried) return null;
    this.cesiumTried = true;
    try {
      const res = await fetch(
        `https://api.cesium.com/v1/assets/${CESIUM_OSM_BUILDINGS_ASSET_ID}/endpoint?access_token=${CESIUM_ION_TOKEN}`,
        {signal: AbortSignal.timeout(4500)},
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {url?: string; accessToken?: string};
      if (json.url && json.accessToken) {
        this.cesiumEndpoint = {url: json.url, accessToken: json.accessToken};
        return this.cesiumEndpoint;
      }
    } catch {
      // fallback silently to OSM building footprints
    }
    return null;
  }

  private findCesiumLeafTileUris(
    node: TilesetNode,
    baseUrl: string,
    latRad: number,
    lonRad: number,
    depth = 0,
    out: Array<{uri: string; centerLat: number; centerLon: number}> = [],
  ): Array<{uri: string; centerLat: number; centerLon: number}> {
    if (depth > 8 || out.length >= 2) return out;
    const reg = node.boundingVolume?.region;
    if (reg) {
      const [w, s, e, n] = reg;
      if (lonRad < w || lonRad > e || latRad < s || latRad > n) {
        return out;
      }
    }
    const contentUri = node.content?.uri ?? node.content?.url;
    if (contentUri && contentUri.endsWith('.b3dm') && depth >= 2) {
      const absUrl = new URL(contentUri, baseUrl).toString();
      const cLat = reg ? THREE.MathUtils.radToDeg((reg[1] + reg[3]) * 0.5) : THREE.MathUtils.radToDeg(latRad);
      const cLon = reg ? THREE.MathUtils.radToDeg((reg[0] + reg[2]) * 0.5) : THREE.MathUtils.radToDeg(lonRad);
      out.push({uri: absUrl, centerLat: cLat, centerLon: cLon});
      return out;
    }
    for (const ch of node.children ?? []) {
      this.findCesiumLeafTileUris(ch, baseUrl, latRad, lonRad, depth + 1, out);
      if (out.length >= 2) break;
    }
    return out;
  }

  private async loadCell(cellKey: string, centerLat: number, centerLon: number) {
    if (this.inFlightCells.has(cellKey)) return;
    this.inFlightCells.add(cellKey);

    try {
      // 1. Primary local OSM building footprints (fast, crisp, zero ECEF transform mismatch)
      const dLat = 0.012;
      const dLon = 0.015;
      const s = (centerLat - dLat).toFixed(4);
      const w = (centerLon - dLon).toFixed(4);
      const n = (centerLat + dLat).toFixed(4);
      const e = (centerLon + dLon).toFixed(4);
      const q = `[out:json][timeout:8];(way["building"]["building"!="terminal"](${s},${w},${n},${e}););out geom 180;`;

      let polys: OsmBuildingPoly[] = [];
      try {
        const res = await Promise.any(
          GLOBAL_OVERPASS_MIRRORS.slice(0, 3).map(async (mirror) => {
            const r = await fetch(mirror, {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body: `data=${encodeURIComponent(q)}`,
              signal: AbortSignal.timeout(5500),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return (await r.json()) as {
              elements?: Array<{
                geometry?: Array<{lat: number; lon: number}>;
                tags?: Record<string, string>;
              }>;
            };
          }),
        );
        for (const el of res.elements ?? []) {
          if (!el.geometry || el.geometry.length < 3) continue;
          const coords: Array<[number, number]> = el.geometry.map((p) => [p.lat, p.lon]);
          const hRaw = Number.parseFloat(el.tags?.height ?? '');
          const lvRaw = Number.parseFloat(el.tags?.['building:levels'] ?? '');
          const heightM = Number.isFinite(hRaw)
            ? Math.min(260, Math.max(6, hRaw))
            : Number.isFinite(lvRaw)
              ? Math.min(240, Math.max(6, lvRaw * 3.8))
              : 14;
          polys.push({coords, heightM});
        }
      } catch {
        polys = [];
      }

      if (polys.length > 0) {
        this.osmChunkCache.set(cellKey, polys);
        this.buildOsmCellGroup(cellKey, centerLat, centerLon, polys);
        this.onUpdated();
        return;
      }

      // 2. Last-resort fallback: Cesium Ion 3D Buildings (asset 96188) .b3dm -> GLB
      const ep = await this.ensureCesiumEndpoint();
      if (!ep) return;

      const tsRes = await fetch(ep.url, {
        headers: {Authorization: `Bearer ${ep.accessToken}`},
        signal: AbortSignal.timeout(5000),
      });
      if (!tsRes.ok) return;
      const tileset = (await tsRes.json()) as {root?: TilesetNode};
      if (!tileset.root) return;

      const latRad = THREE.MathUtils.degToRad(centerLat);
      const lonRad = THREE.MathUtils.degToRad(centerLon);
      const leaves = this.findCesiumLeafTileUris(tileset.root, ep.url, latRad, lonRad);
      for (const leaf of leaves) {
        const bRes = await fetch(leaf.uri, {
          headers: {Authorization: `Bearer ${ep.accessToken}`},
          signal: AbortSignal.timeout(6000),
        });
        if (!bRes.ok) continue;
        const arr = await bRes.arrayBuffer();
        const extracted = extractGlbFromB3dm(arr);
        if (!extracted) continue;

        this.gltfLoader.parse(
          extracted.glbBuffer,
          '',
          (gltf) => {
            const tileScene = gltf.scene;
            const grp = new THREE.Group();
            let geoLat = leaf.centerLat;
            let geoLon = leaf.centerLon;
            if (extracted.rtcCenter) {
              const g = ecefToGeodeticLatLon(
                extracted.rtcCenter[0],
                extracted.rtcCenter[1],
                extracted.rtcCenter[2],
              );
              geoLat = g.lat;
              geoLon = g.lon;
            }
            // Orient ECEF Y/Z up into ENU local space cleanly
            const latR = THREE.MathUtils.degToRad(geoLat);
            const lonR = THREE.MathUtils.degToRad(geoLon);
            const mScale = mercatorScaleAtLat(geoLat);
            tileScene.scale.setScalar(mScale);
            tileScene.rotation.order = 'YXZ';
            tileScene.rotation.y = -lonR - Math.PI / 2;
            tileScene.rotation.x = latR - Math.PI / 2;
            tileScene.traverse((obj) => {
              const mesh = obj as THREE.Mesh;
              if (mesh.isMesh) {
                mesh.material = this.sharedOsmMat;
              }
            });
            grp.add(tileScene);
            this.builtCells.set(cellKey, {mesh: grp, lat: geoLat, lon: geoLon});
            this.group.add(grp);
            this.onUpdated();
          },
          () => {
            // ignore gltf decode error
          },
        );
      }
    } finally {
      this.inFlightCells.delete(cellKey);
    }
  }

  private buildOsmCellGroup(
    cellKey: string,
    anchorLat: number,
    anchorLon: number,
    polys: OsmBuildingPoly[],
  ) {
    const existing = this.builtCells.get(cellKey);
    if (existing) {
      this.group.remove(existing.mesh);
      existing.mesh.traverse((node) => {
        const m = node as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }

    const anchorMx = lonToMx(anchorLon);
    const anchorMy = latToMy(anchorLat);
    const mScale = mercatorScaleAtLat(anchorLat);
    const verts: number[] = [];

    for (const b of polys) {
      const shape = new THREE.Shape();
      b.coords.forEach(([lat, lon], idx) => {
        const x = (lonToMx(lon) - anchorMx) * MERCATOR_WORLD_M;
        const z = (latToMy(lat) - anchorMy) * MERCATOR_WORLD_M;
        if (idx === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
      });
      shape.closePath();
      const ext = new THREE.ExtrudeGeometry(shape, {
        depth: b.heightM * mScale,
        bevelEnabled: false,
      });
      ext.rotateX(-Math.PI / 2);
      const nonIdx = ext.index ? ext.toNonIndexed() : ext;
      const pos = nonIdx.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        verts.push(pos.getX(i), pos.getY(i) + 0.1, pos.getZ(i));
      }
      if (nonIdx !== ext) nonIdx.dispose();
      ext.dispose();
    }

    const grp = new THREE.Group();
    if (verts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.sharedOsmMat);
      mesh.renderOrder = 4;
      mesh.frustumCulled = false;
      grp.add(mesh);
    }

    this.builtCells.set(cellKey, {mesh: grp, lat: anchorLat, lon: anchorLon});
    this.group.add(grp);
  }

  public update(params: {
    enabled: boolean;
    is3D: boolean;
    zoom: number;
    centerLat: number;
    centerLon: number;
    originMx: number;
    originMy: number;
  }) {
    const active = params.enabled && params.is3D && params.zoom >= 14.0;
    this.group.visible = active;
    if (!active) return;

    const cellLat = Math.round(params.centerLat / 0.024) * 0.024;
    const cellLon = Math.round(params.centerLon / 0.03) * 0.03;
    const cellKey = `${cellLat.toFixed(3)}|${cellLon.toFixed(3)}`;

    if (!this.builtCells.has(cellKey)) {
      const cached = this.osmChunkCache.get(cellKey);
      if (cached) {
        this.buildOsmCellGroup(cellKey, cellLat, cellLon, cached);
      } else {
        void this.loadCell(cellKey, cellLat, cellLon);
      }
    }

    for (const [k, rec] of this.builtCells.entries()) {
      const dist = Math.hypot(rec.lat - params.centerLat, rec.lon - params.centerLon);
      rec.mesh.visible = dist < 0.08;
      if (rec.mesh.visible) {
        rec.mesh.position.set(
          (lonToMx(rec.lon) - params.originMx) * MERCATOR_WORLD_M,
          0,
          (latToMy(rec.lat) - params.originMy) * MERCATOR_WORLD_M,
        );
      } else if (this.builtCells.size > 8) {
        this.group.remove(rec.mesh);
        rec.mesh.traverse((node) => {
          const m = node as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
        this.builtCells.delete(k);
      }
    }
  }

  public dispose() {
    for (const rec of this.builtCells.values()) {
      this.group.remove(rec.mesh);
      rec.mesh.traverse((node) => {
        const m = node as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.builtCells.clear();
    this.sharedOsmMat.dispose();
  }
}
