import * as THREE from 'three';
import {
  AIRLINE_LIVERIES,
  SPECIAL_LIVERIES,
  type AircraftGeometrySpec,
  type AirlineLivery,
} from '../data/aviationCatalog';
import type {SpecialLiverySpec} from '../types/aviation';

export interface LiverySkinPreset {
  id: string;
  label: string;
  airlineIcao: string;
  registration: string;
  special?: SpecialLiverySpec;
}

const SDG_WHEEL_COLORS = [
  '#E5243B',
  '#DDA63A',
  '#4C9F38',
  '#C5192D',
  '#FF3A21',
  '#26BDE2',
  '#FCC30B',
  '#A21942',
  '#FD6925',
  '#DD1367',
  '#FD9D24',
  '#BF8B2E',
  '#3F7E44',
  '#0A97D9',
  '#56C02B',
  '#00689D',
  '#19486A',
];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSdgWheelSvg(cx: number, cy: number, outerR: number, innerR: number): string {
  const n = SDG_WHEEL_COLORS.length;
  const seg = (Math.PI * 2) / n;
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = i * seg - Math.PI / 2;
    const a1 = (i + 1) * seg - Math.PI / 2 - 0.025;
    const x0o = (cx + Math.cos(a0) * outerR).toFixed(1);
    const y0o = (cy + Math.sin(a0) * outerR).toFixed(1);
    const x1o = (cx + Math.cos(a1) * outerR).toFixed(1);
    const y1o = (cy + Math.sin(a1) * outerR).toFixed(1);
    const x1i = (cx + Math.cos(a1) * innerR).toFixed(1);
    const y1i = (cy + Math.sin(a1) * innerR).toFixed(1);
    const x0i = (cx + Math.cos(a0) * innerR).toFixed(1);
    const y0i = (cy + Math.sin(a0) * innerR).toFixed(1);
    paths.push(
      `<path d="M${x0o},${y0o} A${outerR},${outerR} 0 0,1 ${x1o},${y1o} L${x1i},${y1i} A${innerR},${innerR} 0 0,0 ${x0i},${y0i} Z" fill="${SDG_WHEEL_COLORS[i]}"/>`,
    );
  }
  return paths.join('');
}

function buildSpecialSideSvg(spec: SpecialLiverySpec, dir: 1 | -1): string {
  if (spec.theme === 'un-sdg') {
    // B-1356 United Dream UN SDGs cerulean ribbons + 17-color SDG wheel
    return `
      <defs>
        <linearGradient id="sdgGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0284C7"/>
          <stop offset="55%" stop-color="#0EA5E9"/>
          <stop offset="100%" stop-color="#0369A1"/>
        </linearGradient>
      </defs>
      <path d="M-480,24 C-180,-18 120,48 480,10 L480,118 L-480,118 Z" fill="url(#sdgGrad)"/>
      <path d="M-480,32 C-180,-10 120,54 480,18" fill="none" stroke="#FFFFFF" stroke-width="4.5"/>
      <path d="M-480,46 C-120,12 160,64 480,30" fill="none" stroke="#7DD3FC" stroke-width="2.5" opacity="0.85"/>
      ${buildSdgWheelSvg(dir * 135, 36, 46, 20)}
    `;
  }
  if (spec.theme === 'turtle') {
    return `
      <path d="M-480,-40 C-140,25 160,-35 480,15 L480,120 L-480,120 Z" fill="${spec.secondaryHex}" opacity="0.85"/>
      <ellipse cx="${dir * 120}" cy="8" rx="54" ry="34" fill="${spec.accentHex}"/>
      <ellipse cx="${dir * 120}" cy="8" rx="38" ry="24" fill="${spec.primaryHex}"/>
      <circle cx="${dir * 170}" cy="-4" r="14" fill="${spec.accentHex}"/>
    `;
  }
  if (spec.theme === 'retro') {
    return `
      <rect x="-480" y="-4" width="960" height="24" fill="${spec.primaryHex}"/>
      <rect x="-480" y="20" width="960" height="9" fill="${spec.secondaryHex}"/>
    `;
  }
  if (spec.theme === 'cartoon') {
    return `
      <rect x="-380" y="-68" width="92" height="145" rx="8" fill="${spec.primaryHex}"/>
      <rect x="220" y="-68" width="120" height="145" rx="8" fill="${spec.primaryHex}"/>
      <rect x="-240" y="18" width="420" height="20" rx="6" fill="${spec.accentHex}"/>
    `;
  }
  if (spec.theme === 'panda') {
    const px = dir * 130;
    return `
      <rect x="-480" y="28" width="960" height="18" fill="${spec.accentHex}"/>
      <circle cx="${px}" cy="14" r="34" fill="#FFFFFF"/>
      <circle cx="${px - 24}" cy="-12" r="11" fill="#0F172A"/>
      <circle cx="${px + 24}" cy="-12" r="11" fill="#0F172A"/>
      <ellipse cx="${px - 11}" cy="10" rx="8" ry="10" fill="#0F172A"/>
      <ellipse cx="${px + 11}" cy="10" rx="8" ry="10" fill="#0F172A"/>
    `;
  }
  if (spec.theme === 'aurora') {
    return `
      <path d="M-480,12 C-160,-58 160,44 480,-28 L480,52 C160,84 -160,-18 -480,48 Z" fill="#4ADE80" opacity="0.72"/>
      <path d="M-480,26 C-140,-34 140,56 480,-10" fill="none" stroke="#38BDF8" stroke-width="6" opacity="0.9"/>
    `;
  }
  if (spec.theme === 'allblacks') {
    const fronds = Array.from({length: 9}, (_, i) => {
      const fx = dir * (85 + i * 24);
      const fy = 44 - i * 9;
      return `<line x1="${fx}" y1="${fy}" x2="${fx + dir * 14}" y2="${fy - 14}" stroke="#E2E8F0" stroke-width="3.2"/>`;
    }).join('');
    return `
      <path d="M${dir * 60},60 Q${dir * 180},0 ${dir * 320},-45" fill="none" stroke="#E2E8F0" stroke-width="4.5"/>
      ${fronds}
    `;
  }
  if (spec.theme === 'expo' || spec.theme === 'oneworld' || spec.theme === 'skyteam') {
    return `
      <path d="M-480,26 C-140,-12 140,44 480,12 L480,68 L-480,68 Z" fill="${spec.secondaryHex}" opacity="0.88"/>
      <circle cx="${dir * 140}" cy="24" r="32" fill="${spec.accentHex}"/>
    `;
  }
  // floral / dreaming petals
  const dots = Array.from({length: 28}, (_, i) => {
    const colors = [spec.primaryHex, spec.secondaryHex, spec.accentHex, '#38BDF8'];
    const cx = -360 + i * 26;
    const cy = Math.sin(i * 0.65) * 38 + 12;
    const r = 7 + (i % 3) * 3;
    return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r}" fill="${colors[i % colors.length]}" opacity="0.92"/>`;
  }).join('');
  return dots;
}

/**
 * Generates a Minecraft-skin / GeoFS-Livery-Selector-inspired 1024x1024 UV SVG template
 * covering Starboard (+X, u=0.25), Crown (+Y, u=0.50), Port (-X, u=0.75), Belly (-Y, u=0/1).
 */
export function buildFuselageSkinSvg(
  livery: AirlineLivery,
  registration: string,
  spec: AircraftGeometrySpec,
  specialLivery: SpecialLiverySpec | null,
): string {
  const isFullDarkBase =
    specialLivery?.theme === 'turtle' ||
    specialLivery?.theme === 'allblacks' ||
    specialLivery?.theme === 'aurora';
  const baseColor = isFullDarkBase
    ? specialLivery!.primaryHex
    : specialLivery?.theme === 'skyteam'
      ? '#CBD5E1'
      : livery.fuselageHex;
  const bellyColor = specialLivery?.bellyHex || livery.bellyHex;
  const accentColor = specialLivery?.accentHex || livery.accentHex;
  const titleText = escapeXml((specialLivery?.titleText || livery.name).toUpperCase());
  const subtitleText = escapeXml(specialLivery?.subtitleText || '');
  const regText = escapeXml((registration || '').toUpperCase());

  const winStep = spec.category === 'widebody' ? 20 : 24;
  const winColor = isFullDarkBase ? '#E0F2FE' : '#0F172A';
  const windows: string[] = [];
  for (let wx = -390; wx <= 390; wx += winStep) {
    if (Math.abs(wx + 360) < 20 || Math.abs(wx - 350) < 20 || Math.abs(wx) < 16) continue;
    windows.push(`<rect x="${wx - 4}" y="-22" width="8" height="13" rx="3" fill="${winColor}"/>`);
  }
  if (spec.subtype === 'a380') {
    for (let wx = -340; wx <= 320; wx += 22) {
      windows.push(`<rect x="${wx - 4}" y="-72" width="7" height="11" rx="3" fill="${winColor}"/>`);
    }
  } else if (spec.subtype === 'b747') {
    for (let wx = -360; wx <= -80; wx += 24) {
      windows.push(`<rect x="${wx - 4}" y="-70" width="7" height="11" rx="3" fill="${winColor}"/>`);
    }
  }

  const doors = [-360, 350]
    .map(
      (dx) =>
        `<rect x="${dx - 11}" y="-28" width="22" height="54" rx="4" fill="none" stroke="${
          isFullDarkBase ? '#FFFFFF' : '#475569'
        }" stroke-width="2.5"/><rect x="${dx - 4}" y="-20" width="8" height="12" rx="2" fill="#1E293B"/>`,
    )
    .join('');

  const sideBlock = (isStarboard: boolean) => {
    const dir: 1 | -1 = isStarboard ? -1 : 1;
    const transform = isStarboard
      ? 'translate(256,512) rotate(90)'
      : 'translate(768,512) rotate(-90)';
    const titleColor = isFullDarkBase ? '#FFFFFF' : livery.titleColor;
    const subColor = specialLivery?.theme === 'un-sdg' || isFullDarkBase ? '#FFFFFF' : '#475569';
    return `
      <g transform="${transform}">
        ${specialLivery ? buildSpecialSideSvg(specialLivery, dir) : ''}
        ${windows.join('')}
        ${doors}
        <text x="${-dir * 165}" y="-54" text-anchor="middle" font-family="Outfit, system-ui, sans-serif" font-weight="800" font-size="34" fill="${titleColor}">${titleText}</text>
        ${
          subtitleText
            ? `<text x="${-dir * 165}" y="58" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="700" font-size="14" fill="${subColor}">${subtitleText}</text>`
            : ''
        }
        ${
          regText
            ? `<text x="${dir * 285}" y="22" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="800" font-size="20" fill="${subColor}">${regText}</text>`
            : ''
        }
      </g>
    `;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <rect x="0" y="0" width="1024" height="1024" fill="${baseColor}"/>
    <rect x="0" y="0" width="128" height="1024" fill="${bellyColor}"/>
    <rect x="896" y="0" width="128" height="1024" fill="${bellyColor}"/>
    <rect x="128" y="0" width="24" height="1024" fill="${accentColor}"/>
    <rect x="872" y="0" width="24" height="1024" fill="${accentColor}"/>
    ${sideBlock(true)}
    ${sideBlock(false)}
  </svg>`;
}

export function buildTailFinSkinSvg(
  livery: AirlineLivery,
  specialLivery: SpecialLiverySpec | null,
): string {
  const finBg = specialLivery?.primaryHex || livery.tailHex;
  const finAccent = specialLivery?.accentHex || livery.accentHex;
  const code = escapeXml((livery.iata || livery.icao.slice(0, 2)).toUpperCase());

  let emblem = `
    <circle cx="256" cy="240" r="92" fill="#FFFFFF"/>
    <text x="256" y="268" text-anchor="middle" font-family="Outfit, system-ui, sans-serif" font-weight="800" font-size="82" fill="${finBg}">${code}</text>
  `;
  if (specialLivery?.theme === 'un-sdg') {
    emblem = `
      <circle cx="256" cy="236" r="96" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-dasharray="140 160"/>
      ${buildSdgWheelSvg(256, 236, 76, 36)}
      <text x="256" y="392" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="800" font-size="34" fill="#FFFFFF">UN SDGs</text>
    `;
  } else if (specialLivery?.theme === 'panda') {
    emblem = `
      <circle cx="256" cy="244" r="86" fill="#FFFFFF"/>
      <circle cx="192" cy="178" r="26" fill="#0F172A"/>
      <circle cx="320" cy="178" r="26" fill="#0F172A"/>
      <ellipse cx="226" cy="235" rx="20" ry="26" fill="#0F172A"/>
      <ellipse cx="286" cy="235" rx="20" ry="26" fill="#0F172A"/>
    `;
  } else if (specialLivery?.theme === 'allblacks') {
    emblem = `
      <circle cx="256" cy="256" r="76" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-dasharray="220 140"/>
      <circle cx="256" cy="256" r="26" fill="#FFFFFF"/>
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect x="0" y="0" width="512" height="512" fill="${finBg}"/>
    <polygon points="0,380 512,110 512,185 0,455" fill="${finAccent}"/>
    ${emblem}
  </svg>`;
}

interface CachedSkinEntry {
  texture: THREE.CanvasTexture;
  refCount: number;
  lastUsed: number;
}

const skinTextureCache = new Map<string, CachedSkinEntry>();
const MAX_SKIN_CACHE = 96;

function rasterizeSvgToTexture(
  cacheKey: string,
  svgMarkup: string,
  size: number,
  fallbackBaseHex: string,
  fallbackAccentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const existing = skinTextureCache.get(cacheKey);
  if (existing) {
    existing.refCount++;
    existing.lastUsed = Date.now();
    return existing.texture;
  }

  // LRU eviction if large world traffic loads many operators
  if (skinTextureCache.size >= MAX_SKIN_CACHE) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, v] of skinTextureCache.entries()) {
      if (v.refCount <= 0 && v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      const victim = skinTextureCache.get(oldestKey);
      victim?.texture.dispose();
      skinTextureCache.delete(oldestKey);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Immediate Frame-0 solid livery paint before async SVG Image decode finishes
  ctx.fillStyle = fallbackBaseHex;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fallbackAccentHex;
  ctx.fillRect(size * 0.12, 0, size * 0.03, size);
  ctx.fillRect(size * 0.85, 0, size * 0.03, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    texture.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

  skinTextureCache.set(cacheKey, {
    texture,
    refCount: 1,
    lastUsed: Date.now(),
  });
  return texture;
}

export function acquireSvgFuselageSkinTexture(
  livery: AirlineLivery,
  registration: string,
  spec: AircraftGeometrySpec,
  specialLivery: SpecialLiverySpec | null,
  maxAnisotropy: number,
  highRes = true,
): {texture: THREE.CanvasTexture; release: () => void} {
  const regKey = specialLivery ? specialLivery.registration : registration.slice(0, 8);
  const key = `fus|${highRes ? '1k' : '512'}|${livery.icao}|${spec.subtype || spec.category}|${specialLivery?.theme || 'std'}|${regKey}`;
  const svg = buildFuselageSkinSvg(livery, registration, spec, specialLivery);
  const tex = rasterizeSvgToTexture(
    key,
    svg,
    highRes ? 1024 : 512,
    specialLivery?.primaryHex || livery.fuselageHex,
    specialLivery?.accentHex || livery.accentHex,
    maxAnisotropy,
  );
  return {
    texture: tex,
    release: () => {
      const entry = skinTextureCache.get(key);
      if (entry && entry.refCount > 0) entry.refCount--;
    },
  };
}

export function acquireSvgTailSkinTexture(
  livery: AirlineLivery,
  specialLivery: SpecialLiverySpec | null,
  maxAnisotropy: number,
): {texture: THREE.CanvasTexture; release: () => void} {
  const key = `tail|${livery.icao}|${specialLivery?.registration || 'std'}`;
  const svg = buildTailFinSkinSvg(livery, specialLivery);
  const tex = rasterizeSvgToTexture(
    key,
    svg,
    512,
    specialLivery?.primaryHex || livery.tailHex,
    specialLivery?.accentHex || livery.accentHex,
    maxAnisotropy,
  );
  return {
    texture: tex,
    release: () => {
      const entry = skinTextureCache.get(key);
      if (entry && entry.refCount > 0) entry.refCount--;
    },
  };
}

export function listGeoFsStyleLiveryPresets(): LiverySkinPreset[] {
  const specials: LiverySkinPreset[] = Object.values(SPECIAL_LIVERIES).map((s) => ({
    id: `sp:${s.registration}`,
    label: `${s.registration} · ${s.liveryName}`,
    airlineIcao: s.airlineIcao,
    registration: s.registration,
    special: s,
  }));

  const flagshipCarriers = ['CXA', 'CCA', 'CES', 'CSN', 'CPA', 'ANA', 'JAL', 'SIA', 'KAL', 'EVA', 'UAL', 'DAL', 'AAL', 'BAW', 'DLH', 'AFR', 'UAE', 'QTR'];
  const carriers: LiverySkinPreset[] = flagshipCarriers
    .filter((k) => Boolean(AIRLINE_LIVERIES[k]))
    .map((k) => {
      const l = AIRLINE_LIVERIES[k];
      return {
        id: `al:${l.icao}`,
        label: `${l.iata} / ${l.icao} · ${l.name} House`,
        airlineIcao: l.icao,
        registration: '',
      };
    });

  return [...specials, ...carriers];
}

export function getSkinPreviewSvgDataUrl(
  livery: AirlineLivery,
  specialLivery: SpecialLiverySpec | null,
): string {
  const tail = buildTailFinSkinSvg(livery, specialLivery);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tail)}`;
}
