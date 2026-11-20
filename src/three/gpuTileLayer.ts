import * as THREE from 'three';
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

export type BasemapVariant =
  | 'terrain'
  | 'terrain-night'
  | 'light'
  | 'dark'
  | 'osm'
  | 'satellite';

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
const OPENFREEMAP_DIRECT_TPL =
  'https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf';

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

  private getFallbackTexture(kind: 'terrain' | 'night' | 'osm'): THREE.CanvasTexture {
    let tex = this.fallbackTextures.get(kind);
    if (!tex) {
      const theme: VectorTheme = kind === 'night' ? 'dark' : kind === 'osm' ? 'osm' : 'light';
      const canvas = createFallbackGridCanvas(theme, 256);
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

    const tryUrls = [
      `/api/vtile/${z}/${x}/${y}`,
      OPENFREEMAP_DIRECT_TPL.replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y)),
    ];

    let parsed: ParsedMvtTile | null = null;
    for (const url of tryUrls) {
      try {
        const res = await fetch(url, {signal: AbortSignal.timeout(5500)});
        if (res.status === 204) {
          parsed = new Map();
          break;
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

    const srcZ = Math.min(14, z);
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

  private getOrLoadGoogleTile(
    lyrs: 'p' | 'y',
    z: number,
    x: number,
    y: number,
    pin = false,
  ): TileCacheEntry | null {
    const n = 1 << z;
    if (y < 0 || y >= n) return null;
    const wx = ((x % n) + n) % n;
    const key = `gtile-${lyrs}|${z}|${wx}|${y}`;
    const existing = this.lookupTexCache(key);
    if (existing) {
      existing.lastUsedMs = performance.now();
      return existing;
    }
    const shouldPin = pin || z <= 3;
    if (!shouldPin && this.texCache.size >= MAX_TEX_CACHE) {
      this.evictOldestTex(52);
    }

    const entry: TileCacheEntry = {
      texture: null,
      status: 'loading',
      lastUsedMs: performance.now(),
      pinned: shouldPin,
    };
    if (shouldPin) this.pinnedTexCache.set(key, entry);
    else this.texCache.set(key, entry);

    const mtHost = `mt${(wx + y) & 3}.google.com`;
    const primaryUrl = `https://${mtHost}/vt/lyrs=${lyrs}&x=${wx}&y=${y}&z=${z}`;
    const fallbackUrl = `/api/gtile/${lyrs}/${z}/${wx}/${y}`;

    const loadImg = (url: string, allowFallback: boolean) => {
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
        if (allowFallback) {
          loadImg(fallbackUrl, false);
        } else {
          const current = this.lookupTexCache(key);
          if (current) current.status = 'error';
        }
      };
      img.src = url;
    };

    loadImg(primaryUrl, true);
    return entry;
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
    style: BasemapVariant,
    centerMx: number,
    centerMy: number,
    zoom: number,
  ) {
    const mode = style === 'satellite' ? 'y' : style === 'osm' ? 'osm' : 'p';
    if (!this.preloadedThemes.has(mode)) {
      this.preloadedThemes.add(mode);
      if (mode === 'osm') {
        for (let ty = 0; ty < 4; ty++) {
          for (let tx = 0; tx < 4; tx++) {
            this.ensureMvtLoaded(2, tx, ty, 0.1, true);
          }
        }
      } else {
        for (let ty = 0; ty < 4; ty++) {
          for (let tx = 0; tx < 4; tx++) {
            this.getOrLoadGoogleTile(mode, 2, tx, ty, true);
          }
        }
        for (let ty = 1; ty <= 6; ty++) {
          for (let tx = 0; tx < 8; tx++) {
            this.getOrLoadGoogleTile(mode, 3, tx, ty, true);
          }
        }
      }
    }

    const warmZ = Math.min(16, Math.max(3, Math.round(zoom)));
    const n = 1 << warmZ;
    const cx = Math.floor(centerMx * n);
    const cy = Math.floor(centerMy * n);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ty = cy + dy;
        if (ty >= 0 && ty < n) {
          if (mode === 'osm') {
            this.ensureMvtLoaded(Math.min(14, warmZ), cx + dx, ty, 1.0, false);
          } else {
            this.getOrLoadGoogleTile(mode, warmZ, cx + dx, ty, false);
          }
        }
      }
    }
  }

  /**
   * Positions all tile meshes relative to `anchorMx, anchorMy` inside `stableAnchorRoot`.
   * Because `stableAnchorRoot` translates basemap tiles + runways + buildings + overlays in ONE GPU matrix,
   * runways are 100% mathematically GLUED to the Google Terrain map during panning/zooming!
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

    const isNightTerrain = style === 'dark' || style === 'terrain-night';

    const layers: Array<{
      kind: 'gtile-p' | 'gtile-y' | 'osm' | 'radar';
      z: number;
      yOrder: number;
      opacity: number;
      nightTint: number;
    }> = [];

    if (style === 'satellite') {
      layers.push({kind: 'gtile-y', z: Math.min(18, baseZ), yOrder: 0, opacity: 1, nightTint: 0});
    } else if (style === 'osm') {
      layers.push({kind: 'osm', z: baseZ, yOrder: 0, opacity: 1, nightTint: 0});
    } else {
      layers.push({
        kind: 'gtile-p',
        z: Math.min(18, baseZ),
        yOrder: 0,
        opacity: 1,
        nightTint: isNightTerrain ? 0.56 : 0,
      });
    }

    if (showRadar && radarUrlTemplate) {
      layers.push({
        kind: 'radar',
        z: Math.min(7, Math.max(2, baseZ)),
        yOrder: 1,
        opacity: radarOpacity,
        nightTint: 0,
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

          if (lyr.kind === 'gtile-p' || lyr.kind === 'gtile-y') {
            const gCode = lyr.kind === 'gtile-y' ? 'y' : 'p';
            const entry = this.getOrLoadGoogleTile(gCode, z, wx, ty, z <= 2);
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
                const parent = this.lookupTexCache(`gtile-${gCode}|${pz}|${pwx}|${py}`);
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
              chosenTex = this.getFallbackTexture(isNightTerrain ? 'night' : 'terrain');
            }
          } else if (lyr.kind === 'osm') {
            const entry = this.getOrBuildVectorTile('osm', z, wx, ty, centerMx, centerMy, z <= 2);
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
                const parent = this.lookupTexCache(`vec|osm|${pz}|${pwx}|${py}`);
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
              chosenTex = this.getFallbackTexture('osm');
            }
          } else if (lyr.kind === 'radar' && radarUrlTemplate) {
            const entry = this.getOrLoadRadarTile(z, wx, ty, radarUrlTemplate);
            chosenTex = entry?.texture ?? null;
          }

          if (!chosenTex) continue;

          const meshKey = `${lyr.kind}|${z}|${tx}|${ty}|${lyr.kind === 'radar' ? radarUrlTemplate || '' : ''}`;
          neededKeys.add(meshKey);

          let mesh = this.activeMeshes.get(meshKey);
          const worldX = ((tx + 0.5) / n - anchorMx) * MERCATOR_WORLD_M;
          const worldZ = ((ty + 0.5) / n - anchorMy) * MERCATOR_WORLD_M;
          const isTransparent = lyr.opacity < 0.99 || lyr.kind === 'radar';

          if (!mesh) {
            const mat = new THREE.ShaderMaterial({
              uniforms: {
                uTex: {value: chosenTex},
                uUvRect: {value: new THREE.Vector4(uvOffsetX, uvOffsetY, uvScale, uvScale)},
                uOpacity: {value: lyr.opacity},
                uNightTint: {value: lyr.nightTint},
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
                varying vec2 vUv;
                void main() {
                  vec4 texel = texture2D(uTex, vUv);
                  vec3 col = texel.rgb;
                  if (uNightTint > 0.01) {
                    float lum = dot(col, vec3(0.299, 0.587, 0.114));
                    vec3 nightCol = mix(vec3(0.06, 0.10, 0.17), vec3(0.32, 0.44, 0.58), lum * 0.78);
                    col = mix(col, nightCol, uNightTint);
                  }
                  gl_FragColor = vec4(col, texel.a * uOpacity);
                }
              `,
              transparent: isTransparent,
              depthTest: false,
              depthWrite: false,
            });
            mesh = new THREE.Mesh(this.unitQuad, mat);
            mesh.renderOrder = -90 + lyr.yOrder * 25 + Math.min(20, z);
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
