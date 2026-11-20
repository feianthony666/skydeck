/**
 * Custom OpenMapTiles MVT Vector Tile Decoder & High-DPI Canvas2D Cartography Renderer.
 * Renders all world streets (motorway, trunk, primary, secondary, tertiary, minor, residential, service),
 * waterways, water bodies, parks, buildings, aeroways, political borders, and crisp road/city labels
 * with zero blurry raster tiles—even at z=15..19 via exact vector sub-quadrant overzooming.
 */

export type VectorTheme = 'dark' | 'light' | 'osm' | 'hybrid';

export interface MvtFeature {
  type: 1 | 2 | 3; // 1=Point, 2=LineString, 3=Polygon
  props: Record<string, string | number | boolean>;
  rings: Array<Array<[number, number]>>;
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

export type ParsedMvtTile = Map<string, MvtLayer>;

const textDecoder = new TextDecoder();

function readVarint(buf: Uint8Array, pos: {o: number}): number {
  let res = 0;
  let mult = 1;
  while (pos.o < buf.length) {
    const b = buf[pos.o++];
    res += (b & 0x7f) * mult;
    if ((b & 0x80) === 0) return res;
    mult *= 128;
  }
  return res;
}

function readVarint32(buf: Uint8Array, pos: {o: number}): number {
  return readVarint(buf, pos) >>> 0;
}

function unzigzag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

function skipField(buf: Uint8Array, pos: {o: number}, wire: number) {
  if (wire === 0) {
    readVarint(buf, pos);
  } else if (wire === 1) {
    pos.o += 8;
  } else if (wire === 2) {
    const len = readVarint(buf, pos);
    pos.o += len;
  } else if (wire === 5) {
    pos.o += 4;
  } else {
    pos.o = buf.length;
  }
}

function readPackedUint32(buf: Uint8Array, end: number): number[] {
  const out: number[] = [];
  const pos = {o: 0};
  const slice = buf.subarray(0, end);
  while (pos.o < slice.length) {
    out.push(readVarint32(slice, pos));
  }
  return out;
}

function decodeValue(buf: Uint8Array, start: number, end: number): string | number | boolean {
  const pos = {o: start};
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let val: string | number | boolean = '';
  while (pos.o < end) {
    const tag = readVarint(buf, pos);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      const len = readVarint(buf, pos);
      val = textDecoder.decode(buf.subarray(pos.o, pos.o + len));
      pos.o += len;
    } else if (field === 2 && wire === 5) {
      val = view.getFloat32(pos.o, true);
      pos.o += 4;
    } else if (field === 3 && wire === 1) {
      val = view.getFloat64(pos.o, true);
      pos.o += 8;
    } else if (field === 4 && wire === 0) {
      val = readVarint(buf, pos);
    } else if (field === 5 && wire === 0) {
      val = readVarint(buf, pos);
    } else if (field === 6 && wire === 0) {
      val = unzigzag(readVarint32(buf, pos));
    } else if (field === 7 && wire === 0) {
      val = readVarint(buf, pos) !== 0;
    } else {
      skipField(buf, pos, wire);
    }
  }
  return val;
}

function decodeGeometry(geom: number[], type: number): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  let ring: Array<[number, number]> = [];
  let cx = 0;
  let cy = 0;
  let i = 0;

  while (i < geom.length) {
    const cmdInt = geom[i++];
    const cmd = cmdInt & 0x7;
    const count = cmdInt >>> 3;
    if (cmd === 1) {
      for (let c = 0; c < count && i + 1 < geom.length; c++) {
        if (ring.length > 0) rings.push(ring);
        ring = [];
        cx += unzigzag(geom[i++]);
        cy += unzigzag(geom[i++]);
        ring.push([cx, cy]);
      }
    } else if (cmd === 2) {
      for (let c = 0; c < count && i + 1 < geom.length; c++) {
        cx += unzigzag(geom[i++]);
        cy += unzigzag(geom[i++]);
        ring.push([cx, cy]);
      }
    } else if (cmd === 7) {
      if (ring.length > 0 && type === 3) {
        ring.push([ring[0][0], ring[0][1]]);
      }
    } else {
      break;
    }
  }
  if (ring.length > 0) rings.push(ring);
  return rings;
}

function decodeFeature(
  buf: Uint8Array,
  start: number,
  end: number,
  keys: string[],
  values: Array<string | number | boolean>,
): MvtFeature | null {
  const pos = {o: start};
  let ftype: 1 | 2 | 3 = 1;
  let tags: number[] = [];
  let geom: number[] = [];

  while (pos.o < end) {
    const tag = readVarint(buf, pos);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 2 && wire === 2) {
      const len = readVarint(buf, pos);
      tags = readPackedUint32(buf.subarray(pos.o, pos.o + len), len);
      pos.o += len;
    } else if (field === 3 && wire === 0) {
      const t = readVarint(buf, pos);
      ftype = t === 2 ? 2 : t === 3 ? 3 : 1;
    } else if (field === 4 && wire === 2) {
      const len = readVarint(buf, pos);
      geom = readPackedUint32(buf.subarray(pos.o, pos.o + len), len);
      pos.o += len;
    } else {
      skipField(buf, pos, wire);
    }
  }

  const rings = decodeGeometry(geom, ftype);
  if (rings.length === 0) return null;

  const props: Record<string, string | number | boolean> = {};
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const k = keys[tags[i]];
    const v = values[tags[i + 1]];
    if (k !== undefined && v !== undefined) {
      props[k] = v;
    }
  }
  return {type: ftype, props, rings};
}

function decodeLayer(buf: Uint8Array, start: number, end: number): MvtLayer | null {
  const pos = {o: start};
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: Array<string | number | boolean> = [];
  const featureSlices: Array<[number, number]> = [];

  while (pos.o < end) {
    const tag = readVarint(buf, pos);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      const len = readVarint(buf, pos);
      name = textDecoder.decode(buf.subarray(pos.o, pos.o + len));
      pos.o += len;
    } else if (field === 2 && wire === 2) {
      const len = readVarint(buf, pos);
      featureSlices.push([pos.o, pos.o + len]);
      pos.o += len;
    } else if (field === 3 && wire === 2) {
      const len = readVarint(buf, pos);
      keys.push(textDecoder.decode(buf.subarray(pos.o, pos.o + len)));
      pos.o += len;
    } else if (field === 4 && wire === 2) {
      const len = readVarint(buf, pos);
      values.push(decodeValue(buf, pos.o, pos.o + len));
      pos.o += len;
    } else if (field === 5 && wire === 0) {
      extent = readVarint(buf, pos) || 4096;
    } else {
      skipField(buf, pos, wire);
    }
  }

  if (!name) return null;
  const features: MvtFeature[] = [];
  for (const [fs, fe] of featureSlices) {
    const f = decodeFeature(buf, fs, fe, keys, values);
    if (f) features.push(f);
  }
  return {name, extent, features};
}

export async function parseMvtBuffer(rawBuf: ArrayBuffer): Promise<ParsedMvtTile> {
  let bytes = new Uint8Array(rawBuf);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('gzip');
      const stream = new Response(bytes).body!.pipeThrough(ds);
      const decompressed = await new Response(stream).arrayBuffer();
      bytes = new Uint8Array(decompressed);
    }
  }

  const tile: ParsedMvtTile = new Map();
  const pos = {o: 0};
  while (pos.o < bytes.length) {
    const tag = readVarint(bytes, pos);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 3 && wire === 2) {
      const len = readVarint(bytes, pos);
      const layer = decodeLayer(bytes, pos.o, pos.o + len);
      pos.o += len;
      if (layer) tile.set(layer.name, layer);
    } else {
      skipField(bytes, pos, wire);
    }
  }
  return tile;
}

interface PaletteSpec {
  land: string;
  water: string;
  waterStroke: string;
  park: string;
  landuse: string;
  buildingFill: string;
  buildingStroke: string;
  aerowayApron: string;
  aerowayRunway: string;
  roadCasing: string;
  motorway: string;
  motorwayCasing: string;
  trunk: string;
  primary: string;
  secondary: string;
  minor: string;
  service: string;
  rail: string;
  borderCountry: string;
  borderState: string;
  labelMain: string;
  labelRoad: string;
  labelWater: string;
  labelHalo: string;
}

const PALETTES: Record<Exclude<VectorTheme, 'hybrid'>, PaletteSpec> = {
  dark: {
    land: '#0D1422',
    water: '#061325',
    waterStroke: '#153459',
    park: '#0F1F1E',
    landuse: '#121B2C',
    buildingFill: '#172236',
    buildingStroke: '#253652',
    aerowayApron: '#162033',
    aerowayRunway: '#223047',
    roadCasing: '#090E18',
    motorway: '#D97706',
    motorwayCasing: '#78350F',
    trunk: '#B45309',
    primary: '#64748B',
    secondary: '#475569',
    minor: '#2D3C53',
    service: '#212E42',
    rail: '#2B3B52',
    borderCountry: 'rgba(56, 189, 248, 0.55)',
    borderState: 'rgba(100, 116, 139, 0.35)',
    labelMain: '#E2E8F0',
    labelRoad: '#CBD5E1',
    labelWater: '#7DD3FC',
    labelHalo: '#070B13',
  },
  light: {
    land: '#ECF1F6',
    water: '#B6DCF2',
    waterStroke: '#8BC5E8',
    park: '#D8EED9',
    landuse: '#E3E9F0',
    buildingFill: '#D7E0EA',
    buildingStroke: '#BCC8D6',
    aerowayApron: '#DFE6EE',
    aerowayRunway: '#94A3B8',
    roadCasing: '#BAC6D4',
    motorway: '#F59E0B',
    motorwayCasing: '#B45309',
    trunk: '#FBBF24',
    primary: '#FDE68A',
    secondary: '#FFFFFF',
    minor: '#FFFFFF',
    service: '#F8FAFC',
    rail: '#94A3B8',
    borderCountry: 'rgba(30, 64, 175, 0.45)',
    borderState: 'rgba(100, 116, 139, 0.32)',
    labelMain: '#0F172A',
    labelRoad: '#334155',
    labelWater: '#0369A1',
    labelHalo: '#F8FAFC',
  },
  osm: {
    land: '#F3EFE6',
    water: '#A6D1E6',
    waterStroke: '#7EB8D8',
    park: '#CBE9B8',
    landuse: '#E7E4DC',
    buildingFill: '#D8CFC4',
    buildingStroke: '#C2B6A8',
    aerowayApron: '#E2DFEC',
    aerowayRunway: '#9CA3AF',
    roadCasing: '#B3A89A',
    motorway: '#E88B68',
    motorwayCasing: '#C2532B',
    trunk: '#F3B27A',
    primary: '#FCD475',
    secondary: '#FEF3B4',
    minor: '#FFFFFF',
    service: '#FAFAFA',
    rail: '#78716C',
    borderCountry: 'rgba(147, 51, 234, 0.45)',
    borderState: 'rgba(107, 114, 128, 0.35)',
    labelMain: '#1E293B',
    labelRoad: '#1F2937',
    labelWater: '#0284C7',
    labelHalo: '#FFFFFF',
  },
};

function tracePolygons(
  ctx: CanvasRenderingContext2D,
  rings: Array<Array<[number, number]>>,
  sx: number,
  ox: number,
  sy: number,
  oy: number,
) {
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    ctx.moveTo(ring[0][0] * sx - ox, ring[0][1] * sy - oy);
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(ring[i][0] * sx - ox, ring[i][1] * sy - oy);
    }
    ctx.closePath();
  }
}

function traceLines(
  ctx: CanvasRenderingContext2D,
  rings: Array<Array<[number, number]>>,
  sx: number,
  ox: number,
  sy: number,
  oy: number,
) {
  ctx.beginPath();
  for (const line of rings) {
    if (line.length < 2) continue;
    ctx.moveTo(line[0][0] * sx - ox, line[0][1] * sy - oy);
    for (let i = 1; i < line.length; i++) {
      ctx.lineTo(line[i][0] * sx - ox, line[i][1] * sy - oy);
    }
  }
}

/**
 * Renders a crisp 512x512 world street tile directly from parsed OpenMapTiles MVT data.
 * Supports arbitrary overzooming (z=15..19 rendered directly from z=14 vectors with zero blur!).
 */
export function renderMvtTileToCanvas(
  mvt: ParsedMvtTile,
  z: number,
  x: number,
  y: number,
  srcZ: number,
  srcX: number,
  srcY: number,
  theme: VectorTheme,
  size = 512,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const isHybrid = theme === 'hybrid';
  const pal = PALETTES[isHybrid ? 'dark' : theme];

  if (!isHybrid) {
    ctx.fillStyle = pal.land;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.clearRect(0, 0, size, size);
  }

  const overScale = Math.pow(2, z - srcZ);
  const subX = (x - srcX * overScale) * size;
  const subY = (y - srcY * overScale) * size;

  const mapLayer = (name: string) => mvt.get(name);
  const scaleFactor = (ext: number) => (size * overScale) / ext;

  // 1. Landcover & Parks & Landuse (skip on hybrid overlay)
  if (!isHybrid) {
    for (const lname of ['landcover', 'landuse', 'park']) {
      const lyr = mapLayer(lname);
      if (!lyr) continue;
      const sf = scaleFactor(lyr.extent);
      ctx.fillStyle = lname === 'park' ? pal.park : pal.landuse;
      for (const f of lyr.features) {
        if (f.type !== 3) continue;
        const cls = String(f.props.class ?? '');
        if (lname === 'landcover' && cls !== 'wood' && cls !== 'grass' && cls !== 'wetland') continue;
        if (lname === 'landuse' && cls === 'residential') continue;
        ctx.fillStyle =
          lname === 'park' || cls === 'wood' || cls === 'grass' ? pal.park : pal.landuse;
        tracePolygons(ctx, f.rings, sf, subX, sf, subY);
        ctx.fill('evenodd');
      }
    }

    // 2. Water bodies & Rivers
    const waterLyr = mapLayer('water');
    if (waterLyr) {
      const sf = scaleFactor(waterLyr.extent);
      ctx.fillStyle = pal.water;
      ctx.strokeStyle = pal.waterStroke;
      ctx.lineWidth = 1.0;
      for (const f of waterLyr.features) {
        if (f.type !== 3) continue;
        tracePolygons(ctx, f.rings, sf, subX, sf, subY);
        ctx.fill('evenodd');
        if (z >= 7) ctx.stroke();
      }
    }

    const waterwayLyr = mapLayer('waterway');
    if (waterwayLyr && z >= 6) {
      const sf = scaleFactor(waterwayLyr.extent);
      ctx.strokeStyle = pal.water;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const f of waterwayLyr.features) {
        if (f.type !== 2) continue;
        const cls = String(f.props.class ?? '');
        ctx.lineWidth = cls === 'river' ? Math.max(1.8, (z - 5) * 0.8) : Math.max(1.0, (z - 9) * 0.5);
        traceLines(ctx, f.rings, sf, subX, sf, subY);
        ctx.stroke();
      }
    }

    // 3. Global Aeroway Layer (base footprints visible from z=5..19 everywhere on Earth)
    const aeroLyr = mapLayer('aeroway');
    if (aeroLyr && z >= 6) {
      const sf = scaleFactor(aeroLyr.extent);
      for (const f of aeroLyr.features) {
        const cls = String(f.props.class ?? '');
        if (f.type === 3) {
          ctx.fillStyle = cls === 'runway' ? pal.aerowayRunway : pal.aerowayApron;
          tracePolygons(ctx, f.rings, sf, subX, sf, subY);
          ctx.fill('evenodd');
        } else if (f.type === 2) {
          ctx.strokeStyle = pal.aerowayRunway;
          ctx.lineCap = 'butt';
          ctx.lineWidth =
            cls === 'runway'
              ? Math.max(2.2, Math.pow(2, z - 12) * 5.5)
              : Math.max(1.2, Math.pow(2, z - 12) * 2.4);
          traceLines(ctx, f.rings, sf, subX, sf, subY);
          ctx.stroke();
        }
      }
    }

    // 4. Buildings (z >= 13)
    const bldgLyr = mapLayer('building');
    if (bldgLyr && z >= 13) {
      const sf = scaleFactor(bldgLyr.extent);
      ctx.fillStyle = pal.buildingFill;
      ctx.strokeStyle = pal.buildingStroke;
      ctx.lineWidth = 0.8;
      for (const f of bldgLyr.features) {
        if (f.type !== 3) continue;
        tracePolygons(ctx, f.rings, sf, subX, sf, subY);
        ctx.fill('evenodd');
        if (z >= 14) ctx.stroke();
      }
    }
  }

  // 5. ALL World Streets & Highways (`transportation`)
  const transLyr = mapLayer('transportation');
  if (transLyr) {
    const sf = scaleFactor(transLyr.extent);
    const zBoost = z >= 14 ? Math.min(3.4, Math.pow(1.42, z - 14)) : Math.max(0.55, (z - 3) / 10);

    type RoadBucket = {
      order: number;
      width: number;
      casingWidth: number;
      color: string;
      casingColor: string;
      dashed?: boolean;
      lines: Array<Array<[number, number]>>;
    };

    const buckets = new Map<string, RoadBucket>();
    const pushRoad = (
      key: string,
      order: number,
      width: number,
      color: string,
      casingColor: string,
      rings: Array<Array<[number, number]>>,
      dashed = false,
    ) => {
      let b = buckets.get(key);
      if (!b) {
        b = {
          order,
          width,
          casingWidth: width + (width >= 2.2 ? 1.8 : 0.8),
          color,
          casingColor,
          dashed,
          lines: [],
        };
        buckets.set(key, b);
      }
      for (const r of rings) b.lines.push(r);
    };

    for (const f of transLyr.features) {
      if (f.type !== 2) continue;
      const cls = String(f.props.class ?? '');
      if (cls === 'motorway') {
        pushRoad('motorway', 7, Math.max(2.0, 3.2 * zBoost), pal.motorway, pal.motorwayCasing, f.rings);
      } else if (cls === 'trunk') {
        pushRoad('trunk', 6, Math.max(1.6, 2.7 * zBoost), pal.trunk, pal.roadCasing, f.rings);
      } else if (cls === 'primary') {
        pushRoad('primary', 5, Math.max(1.3, 2.3 * zBoost), pal.primary, pal.roadCasing, f.rings);
      } else if (cls === 'secondary' && z >= 8) {
        pushRoad('secondary', 4, Math.max(1.1, 1.9 * zBoost), pal.secondary, pal.roadCasing, f.rings);
      } else if (cls === 'tertiary' && z >= 9) {
        pushRoad('tertiary', 3, Math.max(1.0, 1.6 * zBoost), pal.secondary, pal.roadCasing, f.rings);
      } else if ((cls === 'minor' || cls === 'street' || cls === 'residential') && z >= 10) {
        pushRoad('minor', 2, Math.max(0.85, 1.3 * zBoost), pal.minor, pal.roadCasing, f.rings);
      } else if ((cls === 'service' || cls === 'track' || cls === 'path') && z >= 12) {
        pushRoad('service', 1, Math.max(0.7, 0.9 * zBoost), pal.service, pal.roadCasing, f.rings);
      } else if (cls === 'rail' && z >= 9) {
        pushRoad('rail', 0, Math.max(0.8, 0.9 * zBoost), pal.rail, pal.roadCasing, f.rings, true);
      }
    }

    const sortedBuckets = Array.from(buckets.values()).sort((a, b) => a.order - b.order);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Pass 1: Casings for crisp intersections & street borders
    for (const b of sortedBuckets) {
      if (b.dashed || b.lines.length === 0) continue;
      if (b.order <= 2 && z < 12) continue;
      ctx.strokeStyle = b.casingColor;
      ctx.lineWidth = b.casingWidth;
      traceLines(ctx, b.lines, sf, subX, sf, subY);
      ctx.stroke();
    }

    // Pass 2: Road fills
    for (const b of sortedBuckets) {
      if (b.lines.length === 0) continue;
      if (b.dashed) {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        traceLines(ctx, b.lines, sf, subX, sf, subY);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        traceLines(ctx, b.lines, sf, subX, sf, subY);
        ctx.stroke();
      }
    }
  }

  // 6. Political Boundaries
  const boundLyr = mapLayer('boundary');
  if (boundLyr) {
    const sf = scaleFactor(boundLyr.extent);
    ctx.save();
    for (const f of boundLyr.features) {
      if (f.type !== 2) continue;
      if (f.props.maritime === 1) continue;
      const lvl = Number(f.props.admin_level ?? 2);
      if (lvl <= 2) {
        ctx.strokeStyle = pal.borderCountry;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
      } else if (lvl <= 4 && z >= 4) {
        ctx.strokeStyle = pal.borderState;
        ctx.lineWidth = 0.9;
        ctx.setLineDash([3, 4]);
      } else {
        continue;
      }
      traceLines(ctx, f.rings, sf, subX, sf, subY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. Street Names, Cities & Countries (collision-culled)
  const placedLabels: Array<{x0: number; y0: number; x1: number; y1: number}> = [];
  const tryPlaceText = (
    text: string,
    cx: number,
    cy: number,
    font: string,
    fill: string,
    angle = 0,
  ) => {
    if (!text || cx < -24 || cy < -16 || cx > size + 24 || cy > size + 16) return;
    ctx.font = font;
    const tw = ctx.measureText(text).width + 10;
    const th = 16;
    const x0 = cx - tw * 0.5;
    const y0 = cy - th * 0.5;
    const x1 = cx + tw * 0.5;
    const y1 = cy + th * 0.5;
    for (const p of placedLabels) {
      if (!(x1 < p.x0 || x0 > p.x1 || y1 < p.y0 || y0 > p.y1)) return;
    }
    placedLabels.push({x0, y0, x1, y1});

    ctx.save();
    ctx.translate(cx, cy);
    if (angle !== 0) ctx.rotate(angle);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = pal.labelHalo;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  // Street names (`transportation_name`)
  const roadNameLyr = mapLayer('transportation_name');
  if (roadNameLyr && z >= 11) {
    const sf = scaleFactor(roadNameLyr.extent);
    for (const f of roadNameLyr.features) {
      if (f.type !== 2 || f.rings.length === 0) continue;
      const cls = String(f.props.class ?? '');
      if (z < 13 && cls !== 'motorway' && cls !== 'trunk' && cls !== 'primary') continue;
      const name = String(f.props['name:en'] ?? f.props.name ?? f.props.ref ?? '').trim();
      if (!name) continue;
      const pts = f.rings[0];
      if (pts.length < 2) continue;
      const mid = Math.floor(pts.length / 2);
      const a = pts[Math.max(0, mid - 1)];
      const b = pts[Math.min(pts.length - 1, mid)];
      const ax = a[0] * sf - subX;
      const ay = a[1] * sf - subY;
      const bx = b[0] * sf - subX;
      const by = b[1] * sf - subY;
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;
      let ang = Math.atan2(by - ay, bx - ax);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      tryPlaceText(
        name.slice(0, 22),
        mx,
        my,
        '600 10.5px "Inter", system-ui, sans-serif',
        pal.labelRoad,
        ang,
      );
      if (placedLabels.length >= 24) break;
    }
  }

  // City / Country / Place names (`place`)
  const placeLyr = mapLayer('place');
  if (placeLyr) {
    const sf = scaleFactor(placeLyr.extent);
    const sortedPlaces = [...placeLyr.features].sort(
      (a, b) => Number(a.props.rank ?? 99) - Number(b.props.rank ?? 99),
    );
    for (const f of sortedPlaces) {
      if (f.type !== 1 || f.rings.length === 0) continue;
      const cls = String(f.props.class ?? '');
      if (cls === 'continent' && z > 4) continue;
      if (cls === 'country' && (z < 2 || z > 7)) continue;
      if (cls === 'state' && (z < 4 || z > 8)) continue;
      if ((cls === 'town' || cls === 'village') && z < 8) continue;
      if ((cls === 'suburb' || cls === 'neighbourhood') && z < 11) continue;
      const name = String(f.props['name:en'] ?? f.props.name ?? '').trim();
      if (!name) continue;
      const pt = f.rings[0][0];
      if (!pt) continue;
      const px = pt[0] * sf - subX;
      const py = pt[1] * sf - subY;
      const font =
        cls === 'country'
          ? '700 12px "Outfit", system-ui, sans-serif'
          : cls === 'city'
            ? '700 12.5px "Outfit", system-ui, sans-serif'
            : '600 11px "Inter", system-ui, sans-serif';
      tryPlaceText(name.slice(0, 24), px, py, font, pal.labelMain);
      if (placedLabels.length >= 34) break;
    }
  }

  return canvas;
}

/**
 * Generates an instant clean base canvas for immediate zero-flash display while MVT loads.
 */
export function createFallbackGridCanvas(theme: VectorTheme, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  if (theme === 'hybrid') {
    ctx.clearRect(0, 0, size, size);
    return canvas;
  }
  const pal = PALETTES[theme];
  ctx.fillStyle = pal.land;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = theme === 'dark' ? 'rgba(56,189,248,0.06)' : 'rgba(15,23,42,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const p = (i * size) / 4;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();
  return canvas;
}
