/**
 * Custom OpenMapTiles MVT Vector Tile Decoder & High-DPI Canvas2D Cartography Renderer.
 * Renders all world streets (motorway, trunk, primary, secondary, tertiary, minor, residential, service),
 * waterways, water bodies, parks, buildings, aeroways, political borders, and crisp road/city labels
 * with zero blurry raster tiles—even at z=15..19 via exact vector sub-quadrant overzooming.
 */

export type VectorTheme = 'maptiler-dark' | 'maptiler-light';

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
  labelCountry?: string;
  labelCity?: string;
  labelRoad: string;
  labelWater: string;
  labelHalo: string;
  hideRoadLabels?: boolean;
  hideNeighborhoodLabels?: boolean;
}

const PALETTES: Record<VectorTheme, PaletteSpec> = {
  // Exact MapTiler style 01a1fd4b-dd4d-7bc2-b7ac-25bc8cab638c (Dataviz Dark)
  'maptiler-dark': {
    land: '#333333',
    water: '#212121',
    waterStroke: '#0D0D0D',
    park: '#2B2B2B',
    landuse: '#2E2E2E',
    buildingFill: '#2E2E2E',
    buildingStroke: '#292929',
    aerowayApron: '#2B2B2B',
    aerowayRunway: '#363636',
    roadCasing: '#363636',
    motorway: '#3D3D3D',
    motorwayCasing: '#333333',
    trunk: '#3B3B3B',
    primary: '#3B3B3B',
    secondary: '#383838',
    minor: '#363636',
    service: '#343434',
    rail: '#292929',
    borderCountry: '#575757',
    borderState: '#525252',
    labelMain: '#858585',
    labelCountry: '#9A9A9A',
    labelCity: '#A6A6A6',
    labelRoad: '#858585',
    labelWater: '#5E5E5E',
    labelHalo: '#0D0D0D',
  },
  // Exact MapTiler style 01a1fd4a-9db0-7483-8059-a7bf73fb9c17 (Dataviz Light)
  'maptiler-light': {
    land: '#F7F7F7',
    water: '#E0E0E2',
    waterStroke: '#C2C2C4',
    park: '#EFEFEF',
    landuse: '#F0F0F0',
    buildingFill: '#EDEDED',
    buildingStroke: '#DCDCDC',
    aerowayApron: '#EAEAEA',
    aerowayRunway: '#DEDEDE',
    roadCasing: '#D9D9D9',
    motorway: '#FFFFFF',
    motorwayCasing: '#CCCCCC',
    trunk: '#FFFFFF',
    primary: '#FFFFFF',
    secondary: '#FFFFFF',
    minor: '#FFFFFF',
    service: '#FAFAFA',
    rail: '#CCCCCC',
    borderCountry: '#CFCFCF',
    borderState: '#D4D4D4',
    labelMain: '#8C8C8C',
    labelCountry: '#737373',
    labelCity: '#6B6B6B',
    labelRoad: '#8C8C8C',
    labelWater: '#AFB0B2',
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
  const pal = PALETTES[theme];

  ctx.fillStyle = pal.land;
  ctx.fillRect(0, 0, size, size);

  const overScale = Math.pow(2, z - srcZ);
  const subX = (x - srcX * overScale) * size;
  const subY = (y - srcY * overScale) * size;

  const mapLayer = (name: string) => mvt.get(name);
  const scaleFactor = (ext: number) => (size * overScale) / ext;

  // 1. Landcover & Parks & Landuse (MapTiler v4 + OpenMapTiles aliases)
  {
    for (const lname of [
      'residential',
      'industrial',
      'cemetery',
      'wood',
      'grass',
      'forest',
      'wetland',
      'leisure',
      'landcover',
      'landuse',
      'park',
    ]) {
      const lyr = mapLayer(lname);
      if (!lyr) continue;
      const sf = scaleFactor(lyr.extent);
      const isGreen =
        lname === 'wood' ||
        lname === 'grass' ||
        lname === 'forest' ||
        lname === 'wetland' ||
        lname === 'park';
      ctx.fillStyle = isGreen ? pal.park : pal.landuse;
      for (const f of lyr.features) {
        if (f.type !== 3) continue;
        const cls = String(f.props.class ?? '');
        if (lname === 'landcover' && cls !== 'wood' && cls !== 'grass' && cls !== 'wetland') continue;
        if (lname === 'landuse' && cls === 'residential') continue;
        ctx.fillStyle =
          isGreen || cls === 'wood' || cls === 'grass' ? pal.park : pal.landuse;
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

    // 3. Global Aeroway / Aviation Layer
    for (const aeroName of ['aviation', 'aviation_line', 'aeroway']) {
      const aeroLyr = mapLayer(aeroName);
      if (!aeroLyr || z < 6) continue;
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

  // 5. ALL World Streets, Railways & Highways (`road` in MapTiler v4, `transportation` fallback)
  const transLayers = [mapLayer('road'), mapLayer('railway'), mapLayer('transportation')].filter(
    (l): l is MvtLayer => Boolean(l),
  );
  if (transLayers.length > 0) {
    const zBoost = z >= 14 ? Math.min(3.4, Math.pow(1.42, z - 14)) : Math.max(0.55, (z - 3) / 10);

    type RoadBucket = {
      order: number;
      width: number;
      casingWidth: number;
      color: string;
      casingColor: string;
      dashed?: boolean;
      lines: Array<{rings: Array<Array<[number, number]>>; sf: number}>;
    };

    const buckets = new Map<string, RoadBucket>();
    const pushRoad = (
      key: string,
      order: number,
      width: number,
      color: string,
      casingColor: string,
      rings: Array<Array<[number, number]>>,
      sf: number,
      dashed = false,
    ) => {
      let b = buckets.get(key);
      if (!b) {
        b = {
          order,
          width,
          casingWidth: width + (width >= 2.0 ? 1.8 : 0.9),
          color,
          casingColor,
          dashed,
          lines: [],
        };
        buckets.set(key, b);
      }
      b.lines.push({rings, sf});
    };

    for (const transLyr of transLayers) {
      const sf = scaleFactor(transLyr.extent);
      const isRailLayer = transLyr.name === 'railway';
      for (const f of transLyr.features) {
        if (f.type !== 2) continue;
        const cls = String(f.props.class ?? '');
        if (isRailLayer || cls === 'rail') {
          if (z >= 9) {
            pushRoad('rail', 0, Math.max(0.8, 0.9 * zBoost), pal.rail, pal.roadCasing, f.rings, sf, true);
          }
        } else if (cls === 'motorway') {
          pushRoad('motorway', 7, Math.max(2.0, 3.2 * zBoost), pal.motorway, pal.motorwayCasing, f.rings, sf);
        } else if (cls === 'trunk') {
          pushRoad('trunk', 6, Math.max(1.6, 2.7 * zBoost), pal.trunk, pal.roadCasing, f.rings, sf);
        } else if (cls === 'primary') {
          pushRoad('primary', 5, Math.max(1.3, 2.3 * zBoost), pal.primary, pal.roadCasing, f.rings, sf);
        } else if (cls === 'secondary' && z >= 8) {
          pushRoad('secondary', 4, Math.max(1.1, 1.9 * zBoost), pal.secondary, pal.roadCasing, f.rings, sf);
        } else if (cls === 'tertiary' && z >= 9) {
          pushRoad('tertiary', 3, Math.max(1.0, 1.6 * zBoost), pal.secondary, pal.roadCasing, f.rings, sf);
        } else if ((cls === 'minor' || cls === 'street' || cls === 'residential') && z >= 10) {
          pushRoad('minor', 2, Math.max(0.85, 1.3 * zBoost), pal.minor, pal.roadCasing, f.rings, sf);
        } else if ((cls === 'service' || cls === 'track' || cls === 'path') && z >= 12) {
          pushRoad('service', 1, Math.max(0.7, 0.9 * zBoost), pal.service, pal.roadCasing, f.rings, sf);
        }
      }
    }

    const sortedBuckets = Array.from(buckets.values()).sort((a, b) => a.order - b.order);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const b of sortedBuckets) {
      if (b.dashed || b.lines.length === 0) continue;
      if (b.order <= 2 && z < 12) continue;
      ctx.strokeStyle = b.casingColor;
      ctx.lineWidth = b.casingWidth;
      for (const item of b.lines) {
        traceLines(ctx, item.rings, item.sf, subX, item.sf, subY);
        ctx.stroke();
      }
    }

    for (const b of sortedBuckets) {
      if (b.lines.length === 0) continue;
      if (b.dashed) {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        for (const item of b.lines) {
          traceLines(ctx, item.rings, item.sf, subX, item.sf, subY);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        for (const item of b.lines) {
          traceLines(ctx, item.rings, item.sf, subX, item.sf, subY);
          ctx.stroke();
        }
      }
    }
  }

  // 6. Political Boundaries (`country_border`, `country_border_disputed`, `sub_border`, or `boundary`)
  for (const bName of ['country_border', 'country_border_disputed', 'sub_border', 'boundary']) {
    const boundLyr = mapLayer(bName);
    if (!boundLyr) continue;
    const sf = scaleFactor(boundLyr.extent);
    ctx.save();
    for (const f of boundLyr.features) {
      if (f.type !== 2) continue;
      if (f.props.maritime === 1) continue;
      const lvl = Number(f.props.admin_level ?? (bName === 'sub_border' ? 40 : 2));
      const isCountry = bName === 'country_border' || bName === 'country_border_disputed' || lvl <= 2;
      if (isCountry) {
        ctx.strokeStyle = pal.borderCountry;
        ctx.lineWidth = 1.4;
        ctx.setLineDash(bName === 'country_border_disputed' ? [3, 4] : [6, 4]);
      } else if (z >= 4) {
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
    ctx.lineWidth = 3.0;
    ctx.strokeStyle = pal.labelHalo;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  // Street names (`road_label` in MapTiler v4, `transportation_name` fallback)
  const roadNameLyr = mapLayer('road_label') ?? mapLayer('transportation_name');
  if (roadNameLyr && z >= 12 && !pal.hideRoadLabels) {
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

  // City / Country / State / Town / Place names (MapTiler v4 split symbol layers + OpenMapTiles `place`)
  const placeSpecs: Array<{
    layer: string;
    minZ: number;
    maxZ: number;
    font: string;
    color: string;
  }> = [
    {layer: 'continent_label', minZ: 1, maxZ: 4, font: '700 13px "Outfit", system-ui, sans-serif', color: pal.labelCountry ?? pal.labelMain},
    {layer: 'country_label', minZ: 2, maxZ: 7, font: '700 12px "Outfit", system-ui, sans-serif', color: pal.labelCountry ?? pal.labelMain},
    {layer: 'state_label', minZ: 4, maxZ: 8, font: '600 11px "Inter", system-ui, sans-serif', color: pal.labelMain},
    {layer: 'city_label', minZ: 4, maxZ: 15, font: '700 12.5px "Outfit", system-ui, sans-serif', color: pal.labelCity ?? pal.labelMain},
    {layer: 'town_label', minZ: 7, maxZ: 15, font: '600 11px "Inter", system-ui, sans-serif', color: pal.labelCity ?? pal.labelMain},
    {layer: 'place_label', minZ: 10, maxZ: 16, font: '600 10.5px "Inter", system-ui, sans-serif', color: pal.labelMain},
    {layer: 'water_centroid', minZ: 2, maxZ: 8, font: 'italic 600 11px "Inter", system-ui, sans-serif', color: pal.labelWater},
  ];
  for (const spec of placeSpecs) {
    if (z < spec.minZ || z > spec.maxZ) continue;
    const lyr = mapLayer(spec.layer);
    if (!lyr) continue;
    const sf = scaleFactor(lyr.extent);
    const sorted = [...lyr.features].sort(
      (a, b) => Number(a.props.rank ?? 99) - Number(b.props.rank ?? 99),
    );
    for (const f of sorted) {
      if (f.type !== 1 || f.rings.length === 0) continue;
      const name = String(f.props['name:en'] ?? f.props.name ?? '').trim();
      if (!name) continue;
      const pt = f.rings[0][0];
      if (!pt) continue;
      tryPlaceText(name.slice(0, 24), pt[0] * sf - subX, pt[1] * sf - subY, spec.font, spec.color);
      if (placedLabels.length >= 34) break;
    }
    if (placedLabels.length >= 34) break;
  }

  const placeLyr = mapLayer('place');
  if (placeLyr && placedLabels.length < 34) {
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
      if (cls === 'suburb' || cls === 'neighbourhood' || cls === 'quarter') {
        if (pal.hideNeighborhoodLabels || z < 11) continue;
      }
      const name = String(f.props['name:en'] ?? f.props.name ?? '').trim();
      if (!name) continue;
      const pt = f.rings[0][0];
      if (!pt) continue;
      const font =
        cls === 'country'
          ? '700 12px "Outfit", system-ui, sans-serif'
          : cls === 'city'
            ? '700 12.5px "Outfit", system-ui, sans-serif'
            : '600 11px "Inter", system-ui, sans-serif';
      const labelFill =
        cls === 'country'
          ? (pal.labelCountry ?? pal.labelMain)
          : cls === 'city' || cls === 'town'
            ? (pal.labelCity ?? pal.labelMain)
            : pal.labelMain;
      tryPlaceText(name.slice(0, 24), pt[0] * sf - subX, pt[1] * sf - subY, font, labelFill);
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
  const pal = PALETTES[theme];
  ctx.fillStyle = pal.land;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = theme === 'maptiler-dark' ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)';
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
