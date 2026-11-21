import * as THREE from 'three';
import {
  isStaticHostingMode,
  markStaticHostingDetected,
} from '../services/directAviationClient';
import type {WeatherOverlaySettings} from '../types/aviation';
import {
  createFallbackGridCanvas,
  parseMvtBuffer,
  renderMvtTileToCanvas,
  type ParsedMvtTile,
  type VectorTheme,
} from './vectorTileEngine';

export const MERCATOR_WORLD_M = 40075016.68557849;
export const MAX_MERCATOR_LAT = 85.05112878;

export function lonToMx(lon: number): number {
  return (lon + 180) / 360;
}

export function latToMy(lat: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

export function mxToLon(mx: number): number {
  return mx * 360 - 180;
}

export function myToLat(my: number): number {
  const n = Math.PI - 2 * Math.PI * my;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function mercatorScaleAtLat(lat: number): number {
  const rad = (Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI) / 180;
  return 1 / Math.max(0.18, Math.cos(rad));
}

export type BasemapVariant = 'maptiler-light' | 'maptiler-dark';

interface TileCacheEntry {
  texture: THREE.Texture | null;
  status: 'loading' | 'ready' | 'error';
  lastUsedMs: number;
  pinned?: boolean;
}

interface MvtCacheEntry {
  tile: ParsedMvtTile | null;
  status: 'loading' | 'ready' | 'error';
  lastUsedMs: number;
  pinned?: boolean;
}

const MAX_TEX_CACHE = 460;
const MAX_MVT_CACHE = 220;
const MAX_CONCURRENT_MVT_FETCHES = 6;
const MAPTILER_V4_DIRECT_TPL =
  'https://api.maptiler.com/tiles/v4/{z}/{x}/{y}?key=dpyD4FwxbBpi1ejajPmX';

export class GpuTileManager {
  private group = new THREE.Group();
  private pinnedTexCache = new Map<string, TileCacheEntry>();
  private texCache = new Map<string, TileCacheEntry>();
  private mvtCache = new Map<string, MvtCacheEntry>();
  private mvtWaiters = new Map<string, Array<() => void>>();
  private fetchQueue: Array<{
    key: string;
    z: number;
    x: number;
    y: number;
    pinned: boolean;
    priority: number;
  }> = [];
  private inFlightFetches = 0;

  private activeMeshes = new Map<string, THREE.Mesh>();
  private unitQuad: THREE.PlaneGeometry;
  private maxAnisotropy: number;
  private onTileReady: () => void;
  private preloadedThemes = new Set<string>();
  private fallbackTextures = new Map<string, THREE.CanvasTexture>();
  private rasterizedThisFrame = 0;

  constructor(maxAnisotropy: number, onTileReady: () => void) {
    this.maxAnisotropy = Math.min(4, maxAnisotropy);
    this.onTileReady = onTileReady;
    this.unitQuad = new THREE.PlaneGeometry(1, 1);
    this.unitQuad.rotateX(-Math.PI / 2);
  }

  public getGroup(): THREE.Group {
    return this.group;
  }

  private getFallbackTexture(kind: BasemapVariant): THREE.CanvasTexture {
    let tex = this.fallbackTextures.get(kind);
    if (!tex) {
      const canvas = createFallbackGridCanvas(kind, 256);
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.fallbackTextures.set(kind, tex);
    }
    return tex;
  }

  private lookupTexCache(key: string): TileCacheEntry | undefined {
    return this.pinnedTexCache.get(key) ?? this.texCache.get(key);
  }

  private evictOldestTex(count: number) {
    const entries = Array.from(this.texCache.entries())
      .filter(([, v]) => !v.pinned && v.status !== 'loading')
      .sort((a, b) => a[1].lastUsedMs - b[1].lastUsedMs);
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const [k, v] = entries[i];
      v.texture?.dispose();
      this.texCache.delete(k);
    }
  }

  private evictOldestMvt(count: number) {
    const entries = Array.from(this.mvtCache.entries())
      .filter(([, v]) => !v.pinned && v.status !== 'loading')
      .sort((a, b) => a[1].lastUsedMs - b[1].lastUsedMs);
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.mvtCache.delete(entries[i][0]);
    }
  }

  private pumpMvtQueue() {
    while (this.inFlightFetches < MAX_CONCURRENT_MVT_FETCHES && this.fetchQueue.length > 0) {
      this.fetchQueue.sort((a, b) => a.priority - b.priority);
      const job = this.fetchQueue.shift()!;
      this.inFlightFetches++;
      void this.fetchAndDecodeMvt(job.key, job.z, job.x, job.y).finally(() => {
        this.inFlightFetches--;
        this.pumpMvtQueue();
      });
    }
  }

  private async fetchAndDecodeMvt(key: string, z: number, x: number, y: number) {
    const entry = this.mvtCache.get(key);
    if (!entry) return;

    const directUrl = MAPTILER_V4_DIRECT_TPL.replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));

    const tryUrls = isStaticHostingMode()
      ? [directUrl]
      : [`./api/vtile/${z}/${x}/${y}`, directUrl];

    let parsed: ParsedMvtTile | null = null;
    for (const url of tryUrls) {
      try {
        const res = await fetch(url, {signal: AbortSignal.timeout(6500)});
        if (res.status === 204) {
          parsed = new Map();
          break;
        }
        const ct = (res.headers.get('content-type') ?? '').toLowerCase();
        if (url.startsWith('./api/') && (res.status === 404 || ct.includes('text/html'))) {
          markStaticHostingDetected();
          continue;
        }
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) {
          parsed = new Map();
          break;
        }
        parsed = await parseMvtBuffer(buf);
        break;
      } catch {
        // try next
      }
    }

    if (parsed) {
      entry.tile = parsed;
      entry.status = 'ready';
    } else {
      entry.status = 'error';
    }
    entry.lastUsedMs = performance.now();

    const waiters = this.mvtWaiters.get(key);
    this.mvtWaiters.delete(key);
    if (waiters) {
      for (const cb of waiters) cb();
    }
    this.onTileReady();
  }

  private ensureMvtLoaded(
    z: number,
    x: number,
    y: number,
    priority: number,
    pinned: boolean,
  ): MvtCacheEntry {
    const n = 1 << z;
    const wx = ((x % n) + n) % n;
    const key = `${z}|${wx}|${y}`;
    let entry = this.mvtCache.get(key);
    if (entry) {
      entry.lastUsedMs = performance.now();
      if (pinned) entry.pinned = true;
      return entry;
    }

    if (this.mvtCache.size >= MAX_MVT_CACHE) {
      this.evictOldestMvt(40);
    }

    entry = {
      tile: null,
      status: 'loading',
      lastUsedMs: performance.now(),
      pinned,
    };
    this.mvtCache.set(key, entry);
    this.fetchQueue.push({key, z, x: wx, y, pinned, priority});
    this.pumpMvtQueue();
    return entry;
  }

  private getOrBuildVectorTile(
    theme: VectorTheme,
    z: number,
    x: number,
    y: number,
    centerMx: number,
    centerMy: number,
    pin = false,
  ): TileCacheEntry | null {
    const n = 1 << z;
    if (y < 0 || y >= n) return null;
    const wx = ((x % n) + n) % n;
    const texKey = `vec|${theme}|${z}|${wx}|${y}`;

    const existing = this.lookupTexCache(texKey);
    if (existing) {
      existing.lastUsedMs = performance.now();
      return existing;
    }

    const srcZ = Math.min(15, z);
    const overShift = z - srcZ;
    const srcX = wx >> overShift;
    const srcY = y >> overShift;

    const tileCenterMx = (wx + 0.5) / n;
    const tileCenterMy = (y + 0.5) / n;
    const dist = Math.hypot(tileCenterMx - centerMx, tileCenterMy - centerMy);
    const priority = pin ? z * 0.1 : z * 0.25 + dist * 10;

    const shouldPin = pin || z <= 3;
    const mvtEntry = this.ensureMvtLoaded(srcZ, srcX, srcY, priority, shouldPin);

    if (mvtEntry.status === 'ready' && mvtEntry.tile) {
      if (this.rasterizedThisFrame >= 3 && !shouldPin) {
        return null;
      }
      this.rasterizedThisFrame++;

      if (!shouldPin && this.texCache.size >= MAX_TEX_CACHE) {
        this.evictOldestTex(48);
      }
      const canvas = renderMvtTileToCanvas(
        mvtEntry.tile,
        z,
        wx,
        y,
        srcZ,
        srcX,
        srcY,
        theme,
        512,
      );
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.maxAnisotropy;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;

      const created: TileCacheEntry = {
        texture: tex,
        status: 'ready',
        lastUsedMs: performance.now(),
        pinned: shouldPin,
      };
      if (shouldPin) this.pinnedTexCache.set(texKey, created);
      else this.texCache.set(texKey, created);
      return created;
    }

    return null;
  }

  private getOrLoadRadarTile(
    z: number,
    x: number,
    y: number,
    radarUrlTemplate: string,
  ): TileCacheEntry | null {
    const n = 1 << z;
    if (y < 0 || y >= n) return null;
    const wx = ((x % n) + n) % n;
    const key = `radar|${z}|${wx}|${y}|${radarUrlTemplate}`;
    const existing = this.lookupTexCache(key);
    if (existing) {
      existing.lastUsedMs = performance.now();
      return existing;
    }
    if (this.texCache.size >= MAX_TEX_CACHE) {
      this.evictOldestTex(48);
    }

    const url = radarUrlTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(wx))
      .replace('{y}', String(y));
    const entry: TileCacheEntry = {
      texture: null,
      status: 'loading',
      lastUsedMs: performance.now(),
    };
    this.texCache.set(key, entry);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const current = this.lookupTexCache(key);
      if (!current) return;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.maxAnisotropy;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      current.texture = tex;
      current.status = 'ready';
      this.onTileReady();
    };
    img.onerror = () => {
      const current = this.lookupTexCache(key);
      if (current) current.status = 'error';
    };
    img.src = url;
    return entry;
  }

  /**
   * Preloads global z=2 + z=3 + initial region tiles immediately on website entry.
   */
  public preloadWorldAndRegion(
    _style: BasemapVariant,
    centerMx: number,
    centerMy: number,
    zoom: number,
  ) {
    if (!this.preloadedThemes.has('mvt')) {
      this.preloadedThemes.add('mvt');
      for (let ty = 0; ty < 4; ty++) {
        for (let tx = 0; tx < 4; tx++) {
          this.ensureMvtLoaded(2, tx, ty, 0.1, true);
        }
      }
    }

    const warmZ = Math.min(15, Math.max(3, Math.round(zoom)));
    const n = 1 << warmZ;
    const cx = Math.floor(centerMx * n);
    const cy = Math.floor(centerMy * n);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ty = cy + dy;
        if (ty >= 0 && ty < n) {
          this.ensureMvtLoaded(warmZ, cx + dx, ty, 1.0, false);
        }
      }
    }
  }

  /**
   * Positions all tile meshes relative to `anchorMx, anchorMy` inside `stableAnchorRoot`.
   * Because `stableAnchorRoot` translates basemap tiles + runways + buildings + overlays in ONE GPU matrix,
   * runways are 100% mathematically GLUED to the basemap during panning/zooming!
   */
  public update(params: {
    anchorMx: number;
    anchorMy: number;
    centerMx: number;
    centerMy: number;
    zoom: number;
    style: BasemapVariant;
    showRadar: boolean;
    radarOpacity: number;
    radarUrlTemplate?: string;
    wxLayers?: WeatherOverlaySettings;
    aspect: number;
    fovDeg: number;
    pitchDeg: number;
  }) {
    const {
      anchorMx,
      anchorMy,
      centerMx,
      centerMy,
      zoom,
      style,
      showRadar,
      radarOpacity,
      radarUrlTemplate,
      wxLayers,
      aspect,
      pitchDeg,
    } = params;

    this.rasterizedThisFrame = 0;
    this.preloadWorldAndRegion(style, centerMx, centerMy, zoom);

    let baseZ = Math.max(2, Math.min(18, Math.round(zoom)));
    const tiltFactor = pitchDeg > 55 ? 2.15 : pitchDeg > 18 ? 1.55 : 1.18;
    const baseSpanMerc = Math.pow(2, -zoom) * 2.25;
    const halfSpanX = baseSpanMerc * Math.max(1.25, aspect * 0.98) * tiltFactor;
    const halfSpanY = baseSpanMerc * (pitchDeg > 55 ? 2.25 : pitchDeg > 18 ? 1.65 : 1.18);

    while (baseZ > 2) {
      const n = 1 << baseZ;
      const cols = Math.ceil(halfSpanX * 2 * n) + 2;
      const rows = Math.ceil(halfSpanY * 2 * n) + 2;
      if (cols * rows <= 76) break;
      baseZ--;
    }

    const layers: Array<{
      kind: 'mvt' | 'radar';
      vectorTheme?: VectorTheme;
      z: number;
      yOrder: number;
      opacity: number;
      nightTint: number;
      tpl?: string;
      intenseOnly?: number;
      tag?: string;
    }> = [];

    layers.push({kind: 'mvt', vectorTheme: style, z: baseZ, yOrder: 0, opacity: 1, nightTint: 0});

    if (wxLayers?.cloudCoverage) {
      layers.push({
        kind: 'radar',
        z: Math.min(6, Math.max(2, baseZ)),
        yOrder: 1,
        opacity: Math.max(0.45, radarOpacity * 0.85),
        nightTint: 0,
        tpl: isStaticHostingMode()
          ? 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes-east-ir-4km-900913/{z}/{x}/{y}.png'
          : './api/wtile/clouds/{z}/{x}/{y}',
        intenseOnly: 0,
        tag: 'clouds',
      });
    }
    if ((showRadar || wxLayers?.totalPrecip) && radarUrlTemplate) {
      layers.push({
        kind: 'radar',
        z: Math.min(7, Math.max(2, baseZ)),
        yOrder: 2,
        opacity: radarOpacity,
        nightTint: 0,
        tpl: radarUrlTemplate,
        intenseOnly: 0,
        tag: 'precip',
      });
    }
    if (wxLayers?.intensePrecip && radarUrlTemplate) {
      const intenseTpl = radarUrlTemplate.replace(/\/2\/1_1\.png$/, '/6/1_1.png');
      layers.push({
        kind: 'radar',
        z: Math.min(7, Math.max(2, baseZ)),
        yOrder: 3,
        opacity: Math.min(0.95, radarOpacity + 0.15),
        nightTint: 0,
        tpl: intenseTpl,
        intenseOnly: 1.0,
        tag: 'intense',
      });
    }
    if (wxLayers?.naRadar) {
      layers.push({
        kind: 'radar',
        z: Math.min(8, Math.max(2, baseZ)),
        yOrder: 4,
        opacity: Math.min(0.9, radarOpacity + 0.1),
        nightTint: 0,
        tpl: isStaticHostingMode()
          ? 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'
          : './api/wtile/nexrad/{z}/{x}/{y}',
        intenseOnly: 0,
        tag: 'nexrad',
      });
    }

    const neededKeys = new Set<string>();

    for (const lyr of layers) {
      const z = lyr.z;
      const n = 1 << z;
      // +1 tile pad around viewport so rapid dragging never uncovers missing edge tiles
      const txMin = Math.floor((centerMx - halfSpanX) * n) - 1;
      const txMax = Math.floor((centerMx + halfSpanX) * n) + 1;
      const tyMin = Math.max(0, Math.floor((centerMy - halfSpanY) * n) - 1);
      const tyMax = Math.min(n - 1, Math.floor((centerMy + halfSpanY) * n) + 1);
      const tileSizeWorld = MERCATOR_WORLD_M / n;

      for (let ty = tyMin; ty <= tyMax; ty++) {
        for (let tx = txMin; tx <= txMax; tx++) {
          const wx = ((tx % n) + n) % n;
          let chosenTex: THREE.Texture | null = null;
          let uvScale = 1;
          let uvOffsetX = 0;
          let uvOffsetY = 0;

          if (lyr.kind === 'mvt') {
            const vTheme = lyr.vectorTheme ?? style;
            const entry = this.getOrBuildVectorTile(vTheme, z, wx, ty, centerMx, centerMy, z <= 2);
            chosenTex = entry?.texture ?? null;
            if (!chosenTex) {
              for (let dz = 1; dz <= z - 2; dz++) {
                const pz = z - dz;
                if (pz < 2) break;
                const div = 1 << dz;
                const px = Math.floor(tx / div);
                const py = Math.floor(ty / div);
                const pn = 1 << pz;
                const pwx = ((px % pn) + pn) % pn;
                const parent = this.lookupTexCache(`vec|${vTheme}|${pz}|${pwx}|${py}`);
                if (parent?.texture) {
                  chosenTex = parent.texture;
                  uvScale = 1 / div;
                  const localX = ((tx % div) + div) % div;
                  const localY = ty - py * div;
                  uvOffsetX = localX * uvScale;
                  uvOffsetY = 1 - (localY + 1) * uvScale;
                  break;
                }
              }
            }
            if (!chosenTex) {
              chosenTex = this.getFallbackTexture(vTheme);
            }
          } else if (lyr.kind === 'radar' && lyr.tpl) {
            const entry = this.getOrLoadRadarTile(z, wx, ty, lyr.tpl);
            chosenTex = entry?.texture ?? null;
          }

          if (!chosenTex) continue;

          const meshKey = `${lyr.kind}|${lyr.vectorTheme ?? lyr.tag ?? ''}|${z}|${tx}|${ty}|${lyr.tpl ?? ''}`;
          neededKeys.add(meshKey);

          let mesh = this.activeMeshes.get(meshKey);
          const worldX = ((tx + 0.5) / n - anchorMx) * MERCATOR_WORLD_M;
          const worldZ = ((ty + 0.5) / n - anchorMy) * MERCATOR_WORLD_M;
          const isTransparent = lyr.opacity < 0.99 || lyr.kind === 'radar';
          const intenseOnlyVal = lyr.intenseOnly ?? 0;

          if (!mesh) {
            const mat = new THREE.ShaderMaterial({
              uniforms: {
                uTex: {value: chosenTex},
                uUvRect: {value: new THREE.Vector4(uvOffsetX, uvOffsetY, uvScale, uvScale)},
                uOpacity: {value: lyr.opacity},
                uNightTint: {value: lyr.nightTint},
                uIntenseOnly: {value: intenseOnlyVal},
              },
              vertexShader: `
                varying vec2 vUv;
                uniform vec4 uUvRect;
                void main() {
                  vUv = uUvRect.xy + uv * uUvRect.zw;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
              `,
              fragmentShader: `
                uniform sampler2D uTex;
                uniform float uOpacity;
                uniform float uNightTint;
                uniform float uIntenseOnly;
                varying vec2 vUv;
                void main() {
                  vec4 texel = texture2D(uTex, vUv);
                  vec3 col = texel.rgb;
                  float a = texel.a;
                  if (uIntenseOnly > 0.5) {
                    float warmness = col.r + col.g * 0.45 - col.b * 0.9;
                    if (warmness < 0.38 || a < 0.2) discard;
                  }
                  if (uNightTint > 0.01) {
                    float lum = dot(col, vec3(0.299, 0.587, 0.114));
                    vec3 nightCol = mix(vec3(0.06, 0.10, 0.17), vec3(0.32, 0.44, 0.58), lum * 0.78);
                    col = mix(col, nightCol, uNightTint);
                  }
                  gl_FragColor = vec4(col, a * uOpacity);
                }
              `,
              transparent: isTransparent,
              depthTest: false,
              depthWrite: false,
            });
            mesh = new THREE.Mesh(this.unitQuad, mat);
            mesh.renderOrder = -90 + lyr.yOrder * 6 + Math.min(18, z);
            mesh.frustumCulled = false;
            this.group.add(mesh);
            this.activeMeshes.set(meshKey, mesh);
          } else {
            const mat = mesh.material as THREE.ShaderMaterial;
            if (mat.uniforms.uTex.value !== chosenTex) {
              mat.uniforms.uTex.value = chosenTex;
            }
            mat.uniforms.uUvRect.value.set(uvOffsetX, uvOffsetY, uvScale, uvScale);
            mat.uniforms.uOpacity.value = lyr.opacity;
            mat.uniforms.uNightTint.value = lyr.nightTint;
            mat.uniforms.uIntenseOnly.value = intenseOnlyVal;
          }

          mesh.position.set(worldX, 0, worldZ);
          mesh.scale.set(tileSizeWorld * 1.0012, 1, tileSizeWorld * 1.0012);
        }
      }
    }

    for (const [k, mesh] of this.activeMeshes.entries()) {
      if (!neededKeys.has(k)) {
        this.group.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.activeMeshes.delete(k);
      }
    }
  }

  public dispose() {
    for (const mesh of this.activeMeshes.values()) {
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.activeMeshes.clear();
    for (const entry of this.texCache.values()) {
      entry.texture?.dispose();
    }
    this.texCache.clear();
    for (const entry of this.pinnedTexCache.values()) {
      entry.texture?.dispose();
    }
    this.pinnedTexCache.clear();
    for (const tex of this.fallbackTextures.values()) {
      tex.dispose();
    }
    this.fallbackTextures.clear();
    this.mvtCache.clear();
    this.fetchQueue = [];
    this.unitQuad.dispose();
  }
}
