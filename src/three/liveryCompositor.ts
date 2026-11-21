import * as THREE from 'three';
import {AIRCRAFT_MODELS_MANIFEST, resolveAirlineManifest, type AirlineManifestEntry} from '../data/modelsAndAirlines';
import {buildFr24AircraftSvg, resolveFr24ModelClass, type Fr24ModelClass} from '../components/aircraftIcons';

interface CompositedTextureEntry {
  key: string;
  texture: THREE.CanvasTexture;
  refCount: number;
  lastUsedMs: number;
}

const compositedCache = new Map<string, CompositedTextureEntry>();
let baseFuselageSheet: HTMLCanvasElement | null = null;
const tailEmblemCache = new Map<string, HTMLCanvasElement>();

/**
 * Generates a reusable crisp 512x512 blank white fuselage UV template
 * with cockpit windscreen, passenger cabin windows, cargo/entry doors & panel seams.
 */
function getBaseFuselageUvSheet(): HTMLCanvasElement {
  if (baseFuselageSheet) return baseFuselageSheet;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  // Gloss white base paint
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, 512, 512);

  // Belly metallic shading (lower bands)
  const bellyGrad = ctx.createLinearGradient(0, 340, 0, 512);
  bellyGrad.addColorStop(0, '#E2E8F0');
  bellyGrad.addColorStop(1, '#CBD5E1');
  ctx.fillStyle = bellyGrad;
  ctx.fillRect(0, 360, 512, 152);

  // Subtle fuselage circumferential panel seams
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.18)';
  ctx.lineWidth = 1;
  for (let x = 24; x < 512; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }

  // Twin side window rows (symmetric UV wrap around fuselage cylinder)
  const drawWindowBand = (yTop: number) => {
    // Doors L1/R1, L2/R2, overwing exits
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.6;
    for (const dx of [72, 198, 290, 418]) {
      ctx.strokeRect(dx, yTop - 6, 14, 30);
    }
    ctx.fillStyle = '#0F172A';
    for (let x = 96; x <= 406; x += 10) {
      if (Math.abs(x - 198) < 12 || Math.abs(x - 290) < 12) continue;
      ctx.fillRect(x, yTop, 5.5, 9);
    }
  };
  drawWindowBand(126);
  drawWindowBand(286);

  baseFuselageSheet = c;
  return c;
}

/**
 * Generates a square 128x128 stylized airline tail emblem offscreen canvas
 * with zero external PNG 404s.
 */
function getTailEmblemCanvas(airline: AirlineManifestEntry): HTMLCanvasElement {
  const existing = tailEmblemCache.get(airline.icao);
  if (existing) return existing;

  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, airline.primaryHex);
  grad.addColorStop(1, airline.secondaryHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  // Diagonal swept ribbon motif
  ctx.fillStyle = airline.accentHex;
  ctx.beginPath();
  ctx.moveTo(0, 108);
  ctx.lineTo(128, 22);
  ctx.lineTo(128, 48);
  ctx.lineTo(0, 128);
  ctx.closePath();
  ctx.fill();

  // Crisp monogram / badge
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 32px "Outfit", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.fillText(airline.icao.slice(0, 3), 64, 62);

  if (tailEmblemCache.size > 160) {
    const oldest = tailEmblemCache.keys().next().value;
    if (oldest) tailEmblemCache.delete(oldest);
  }
  tailEmblemCache.set(airline.icao, c);
  return c;
}

/**
 * Dynamic Canvas UV Compositor:
 * Draws white base UV map, tints cheatline/tail masks by airlines.json colors,
 * stamps 128x128 tail emblem into the tail UV box, converts to Three.js CanvasTexture,
 * caches & ref-counts by `${aircraftType}_${airlineCode}`.
 */
export function acquireCompositedLiveryTexture(
  aircraftType: string,
  airlineCode: string,
  callsign: string,
  maxAnisotropy: number,
): {texture: THREE.CanvasTexture; key: string; release: () => void} {
  const cleanType = (aircraftType || 'A320').toUpperCase();
  const airline = resolveAirlineManifest(airlineCode, callsign);
  const key = `${cleanType}_${airline.icao}`;

  let entry = compositedCache.get(key);
  if (!entry) {
    const spec = AIRCRAFT_MODELS_MANIFEST[cleanType];
    const [tx, ty, tw, th] = spec?.tailUvRect ?? [0.68, 0.06, 0.28, 0.28];
    const [sx, sy, sw, sh] = spec?.stripeUvRect ?? [0.02, 0.42, 0.96, 0.14];

    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d')!;

    // 1. Base white UV sheet
    ctx.drawImage(getBaseFuselageUvSheet(), 0, 0);

    // 2. Tint fuselage stripe / belly mask using airline colors
    ctx.fillStyle = airline.primaryHex;
    ctx.fillRect(sx * 512, sy * 512, sw * 512, sh * 512 * 0.52);
    ctx.fillStyle = airline.secondaryHex;
    ctx.fillRect(sx * 512, (sy + sh * 0.52) * 512, sw * 512, sh * 512 * 0.28);
    ctx.fillStyle = airline.accentHex;
    ctx.fillRect(sx * 512, (sy + sh * 0.8) * 512, sw * 512, sh * 512 * 0.14);

    // 3. Billboard airline title along forward upper fuselage
    ctx.fillStyle = airline.primaryHex;
    ctx.font = '800 26px "Outfit", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(airline.motifText.slice(0, 14), 86, 100);
    ctx.fillText(airline.motifText.slice(0, 14), 86, 260);

    // 4. Stamp square 128x128 tail emblem into UV tail box
    const tailLogo = getTailEmblemCanvas(airline);
    ctx.drawImage(tailLogo, tx * 512, ty * 512, tw * 512, th * 512);

    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, maxAnisotropy);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    entry = {key, texture, refCount: 0, lastUsedMs: performance.now()};
    compositedCache.set(key, entry);
  }

  entry.refCount++;
  entry.lastUsedMs = performance.now();
  const captured = entry;

  return {
    texture: captured.texture,
    key,
    release: () => {
      captured.refCount = Math.max(0, captured.refCount - 1);
      if (captured.refCount === 0 && compositedCache.size > 96) {
        // Evict oldest zero-ref textures cleanly
        for (const [k, item] of compositedCache.entries()) {
          if (item.refCount === 0) {
            item.texture.dispose();
            compositedCache.delete(k);
            if (compositedCache.size <= 72) break;
          }
        }
      }
    },
  };
}

export const SPRITE_ATLAS_CLASSES: Fr24ModelClass[] = [
  'narrowbody',
  'widebody',
  'a380',
  'heavy4',
  'rearjet',
  'bizjet',
  'turboprop',
  'lightprop',
  'milcargo',
  'fighter',
  'heli',
];

let cachedSpriteAtlas: THREE.CanvasTexture | null = null;

/**
 * Single 1024x128 crisp white-on-transparent aircraft silhouette atlas (11 model cells)
 * for single-draw-call `THREE.InstancedMesh` 2D radar plane rendering (5,000+ planes @ 60fps!).
 */
export function get2DAircraftSpriteAtlas(maxAnisotropy: number): {
  texture: THREE.CanvasTexture;
  cellCount: number;
  getCellIndex: (aircraftType: string, callsign?: string) => number;
} {
  if (!cachedSpriteAtlas) {
    const cellSize = 128;
    const count = SPRITE_ATLAS_CLASSES.length;
    const c = document.createElement('canvas');
    c.width = cellSize * count;
    c.height = cellSize;
    const ctx = c.getContext('2d')!;

    SPRITE_ATLAS_CLASSES.forEach((cls, idx) => {
      ctx.save();
      ctx.translate(idx * cellSize + cellSize / 2, cellSize / 2);
      ctx.scale(cellSize / 100, cellSize / 100);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 3.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.beginPath();
      if (cls === 'heli') {
        ctx.ellipse(0, -4, 9, 17, 0, 0, Math.PI * 2);
        ctx.moveTo(-2, 13);
        ctx.lineTo(-2, 34);
        ctx.lineTo(2, 34);
        ctx.lineTo(2, 13);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-34, -22);
        ctx.lineTo(34, 14);
        ctx.moveTo(-34, 14);
        ctx.lineTo(34, -22);
        ctx.lineWidth = 4.2;
        ctx.stroke();
      } else if (cls === 'fighter') {
        ctx.moveTo(0, -44);
        ctx.lineTo(6, -18);
        ctx.lineTo(34, 14);
        ctx.lineTo(34, 24);
        ctx.lineTo(8, 18);
        ctx.lineTo(14, 34);
        ctx.lineTo(0, 29);
        ctx.lineTo(-14, 34);
        ctx.lineTo(-8, 18);
        ctx.lineTo(-34, 24);
        ctx.lineTo(-34, 14);
        ctx.lineTo(-6, -18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (cls === 'lightprop') {
        ctx.moveTo(0, -38);
        ctx.lineTo(4.5, -16);
        ctx.lineTo(38, -8);
        ctx.lineTo(38, 2);
        ctx.lineTo(4.5, 4);
        ctx.lineTo(3, 28);
        ctx.lineTo(15, 36);
        ctx.lineTo(15, 41);
        ctx.lineTo(0, 38);
        ctx.lineTo(-15, 41);
        ctx.lineTo(-15, 36);
        ctx.lineTo(-3, 28);
        ctx.lineTo(-4.5, 4);
        ctx.lineTo(-38, 2);
        ctx.lineTo(-38, -8);
        ctx.lineTo(-4.5, -16);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (cls === 'turboprop') {
        ctx.moveTo(0, -42);
        ctx.lineTo(5, -14);
        ctx.lineTo(41, -6);
        ctx.lineTo(41, 4);
        ctx.lineTo(5, 6);
        ctx.lineTo(3.5, 30);
        ctx.lineTo(17, 38);
        ctx.lineTo(17, 43);
        ctx.lineTo(0, 39);
        ctx.lineTo(-17, 43);
        ctx.lineTo(-17, 38);
        ctx.lineTo(-3.5, 30);
        ctx.lineTo(-5, 6);
        ctx.lineTo(-41, 4);
        ctx.lineTo(-41, -6);
        ctx.lineTo(-5, -14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (cls === 'rearjet' || cls === 'bizjet') {
        const s = cls === 'bizjet' ? 0.88 : 1.0;
        ctx.scale(s, s);
        ctx.moveTo(0, -43);
        ctx.lineTo(5, -12);
        ctx.lineTo(36, 12);
        ctx.lineTo(36, 20);
        ctx.lineTo(5, 11);
        ctx.lineTo(4.5, 25);
        ctx.lineTo(17, 36);
        ctx.lineTo(17, 41);
        ctx.lineTo(0, 37);
        ctx.lineTo(-17, 41);
        ctx.lineTo(-17, 36);
        ctx.lineTo(-4.5, 25);
        ctx.lineTo(-5, 11);
        ctx.lineTo(-36, 20);
        ctx.lineTo(-36, 12);
        ctx.lineTo(-5, -12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Airliner swept wing silhouette (scaled subtly for heavy/a380/widebody)
        const wide = cls === 'a380' || cls === 'heavy4' || cls === 'widebody';
        const fusW = cls === 'a380' ? 7.2 : wide ? 6.0 : 4.8;
        const wingSpan = cls === 'a380' ? 45 : wide ? 43 : 39;
        ctx.moveTo(0, -45);
        ctx.quadraticCurveTo(fusW, -32, fusW, -14);
        ctx.lineTo(wingSpan, 11);
        ctx.lineTo(wingSpan, 19);
        ctx.lineTo(fusW, 8);
        ctx.lineTo(fusW * 0.8, 28);
        ctx.lineTo(18, 39);
        ctx.lineTo(18, 44);
        ctx.lineTo(0, 39);
        ctx.lineTo(-18, 44);
        ctx.lineTo(-18, 39);
        ctx.lineTo(-fusW * 0.8, 28);
        ctx.lineTo(-fusW, 8);
        ctx.lineTo(-wingSpan, 19);
        ctx.lineTo(-wingSpan, 11);
        ctx.lineTo(-fusW, -14);
        ctx.quadraticCurveTo(-fusW, -32, 0, -45);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, maxAnisotropy);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    cachedSpriteAtlas = tex;

    // Rasterize crisp Flightradar24 SVG silhouettes directly into each atlas cell
    let remaining = count;
    SPRITE_ATLAS_CLASSES.forEach((cls, idx) => {
      const svg = buildFr24AircraftSvg(cls, cellSize, '#FFFFFF', '#0F172A');
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(idx * cellSize, 0, cellSize, cellSize);
        ctx.drawImage(img, idx * cellSize, 0, cellSize, cellSize);
        remaining--;
        if (remaining === 0 || idx % 3 === 0) {
          tex.needsUpdate = true;
        }
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  }

  return {
    texture: cachedSpriteAtlas,
    cellCount: SPRITE_ATLAS_CLASSES.length,
    getCellIndex: (aircraftType: string, callsign?: string) => {
      const cls = resolveFr24ModelClass(aircraftType, callsign);
      const idx = SPRITE_ATLAS_CLASSES.indexOf(cls);
      return idx >= 0 ? idx : 0;
    },
  };
}
