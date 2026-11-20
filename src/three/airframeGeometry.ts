import * as THREE from 'three';

export interface LoftedFuselageOptions {
  radius: number;
  totalLen: number;
  subtype?: string;
  isFighter?: boolean;
  isHeli?: boolean;
  radialSegments?: number;
  lengthStations?: number;
}

/**
 * Generates a continuous multi-station lofted aircraft fuselage (Z-axis: -Z = Nose, +Z = Tail)
 * preserving standard CylinderGeometry UVs so GeoFS SVG livery skins map cleanly without seams.
 */
export function createLoftedFuselageGeometry(opts: LoftedFuselageOptions): THREE.BufferGeometry {
  const {
    radius: r,
    totalLen: len,
    subtype = 'a320',
    isFighter = false,
    isHeli = false,
    radialSegments = 24,
    lengthStations = 28,
  } = opts;

  const isA380 = subtype === 'a380';
  const isB747 = subtype === 'b747';
  const isMilCargo = subtype === 'milcargo';

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s <= lengthStations; s++) {
    const f = s / lengthStations; // 0 = nose tip (-Z), 1 = tail tip (+Z)
    const z = (f - 0.5) * len;

    // Cross-section profile width (rx), height (ry), and vertical center shift (cy)
    let scale = 1.0;
    let rxScale = 1.0;
    let ryScale = 1.03;
    let cy = 0;

    if (isHeli) {
      if (f < 0.25) {
        const t = f / 0.25;
        scale = Math.sin(t * (Math.PI / 2));
        cy = -r * 0.1 * (1 - t);
      } else if (f < 0.56) {
        scale = 1.0;
      } else {
        // Tapered tail boom
        const t = (f - 0.56) / 0.44;
        scale = Math.max(0.14, 1.0 - t * 0.84);
        cy = r * 0.28 * t;
      }
    } else if (isFighter) {
      if (f < 0.26) {
        const t = f / 0.26;
        scale = Math.pow(t, 0.72);
        rxScale = 1.15;
        ryScale = 0.88;
      } else if (f < 0.72) {
        scale = 1.0;
        rxScale = 1.32;
        ryScale = 0.82;
      } else {
        const t = (f - 0.72) / 0.28;
        scale = Math.max(0.45, 1.0 - t * 0.52);
        rxScale = 1.25;
        ryScale = 0.85;
      }
    } else {
      // Airliner / Business Jet / Turboprop loft profile
      if (f < 0.16) {
        // Smooth radome + flight-deck brow
        const t = f / 0.16;
        scale = Math.sin(t * (Math.PI / 2));
        // Subtle nose droop for realistic cockpit slope
        cy = -r * 0.22 * (1 - t) * (1 - t);
      } else if (f < 0.76) {
        scale = 1.0;
      } else {
        // Upswept pressurized aft pressure bulkhead -> tapered APU tailcone
        const t = (f - 0.76) / 0.24;
        scale = Math.max(0.09, Math.pow(1 - t, 0.82));
        cy = (isMilCargo ? r * 0.52 : r * 0.36) * t;
      }

      // Airframe-specific cross-sections
      if (isA380) {
        ryScale = 1.34;
        rxScale = 0.96;
      } else if (isB747 && f > 0.10 && f < 0.48) {
        const humpEnv = Math.sin(((f - 0.10) / 0.38) * Math.PI);
        ryScale = 1.04 + 0.36 * humpEnv;
        cy += r * 0.22 * humpEnv;
      } else if (subtype === 'b787' || subtype === 'a350') {
        ryScale = 1.08;
      }
    }

    // Map cabin section [0.16 .. 0.78] cleanly across SVG V [0.95 .. 0.05]
    const vCoord = THREE.MathUtils.clamp(1.0 - (f - 0.14) / 0.66, 0.01, 0.99);

    for (let j = 0; j <= radialSegments; j++) {
      const u = j / radialSegments;
      // Match Three.js CylinderGeometry UV seam convention rotated for nose=-Z:
      // u=0.0 -> -Y belly, u=0.25 -> +X starboard, u=0.50 -> +Y crown, u=0.75 -> -X port, u=1.0 -> -Y belly
      const theta = u * Math.PI * 2;
      const sx = Math.sin(theta);
      const sy = -Math.cos(theta);

      // Gentle upper crown vs lower belly flatten on widebodies
      const crownStretch = sy > 0 && isB747 && f > 0.10 && f < 0.48 ? 1.05 : 1.0;
      const x = sx * r * scale * rxScale;
      const y = cy + sy * r * scale * ryScale * crownStretch;

      positions.push(x, y, z);
      uvs.push(u, vCoord);
    }
  }

  const stride = radialSegments + 1;
  for (let s = 0; s < lengthStations; s++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = s * stride + j;
      const b = a + 1;
      const c = (s + 1) * stride + j;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export interface LoftedWingOptions {
  halfSpan: number;
  rootChord: number;
  tipChord: number;
  sweepZ: number;
  dihedralY: number;
  rootThick: number;
  tipThick: number;
  winglets?: boolean;
  rakedTip?: boolean;
  flapTrackFairings?: number;
}

/**
 * Generates a realistic cambered NACA airfoil swept right (+X) wing with optional
 * blended upturned sharklet or raked wingtip, plus sculpted underwing flap-track canoe fairings.
 */
export function createLoftedWingGeometry(opts: LoftedWingOptions): THREE.BufferGeometry {
  const {
    halfSpan,
    rootChord,
    tipChord,
    sweepZ,
    dihedralY,
    rootThick,
    tipThick,
    winglets = true,
    rakedTip = false,
    flapTrackFairings = 3,
  } = opts;

  const positions: number[] = [];
  const indices: number[] = [];

  // 12-point closed cambered airfoil section [chordFrac 0..1, upper/lower thickness sign]
  // Ordered around airfoil loop: LE -> upper surface -> TE -> lower surface -> LE
  const profilePts: Array<[number, number]> = [
    [0.0, 0.0],
    [0.04, 0.46],
    [0.14, 0.85],
    [0.30, 1.0],
    [0.52, 0.80],
    [0.76, 0.42],
    [1.0, 0.03],
    [1.0, -0.02],
    [0.74, -0.22],
    [0.48, -0.34],
    [0.22, -0.40],
    [0.05, -0.28],
    [0.0, 0.0],
  ];
  const ringCount = profilePts.length;

  interface WingStation {
    x: number;
    y: number;
    zOffset: number;
    chord: number;
    thick: number;
    tiltZ: number;
  }

  const stations: WingStation[] = [];
  const spanSteps = 5;
  for (let i = 0; i <= spanSteps; i++) {
    const t = i / spanSteps;
    // Slight Yehudi trailing edge kink on inner 28% for airliner realism
    const chord =
      t < 0.28
        ? THREE.MathUtils.lerp(rootChord, rootChord * 0.62, t / 0.28)
        : THREE.MathUtils.lerp(rootChord * 0.62, tipChord, (t - 0.28) / 0.72);
    stations.push({
      x: t * halfSpan,
      y: t * dihedralY,
      zOffset: t * sweepZ,
      chord,
      thick: THREE.MathUtils.lerp(rootThick, tipThick, Math.pow(t, 0.8)),
      tiltZ: 0,
    });
  }

  if (winglets) {
    if (rakedTip) {
      stations.push({
        x: halfSpan * 1.07,
        y: dihedralY + halfSpan * 0.025,
        zOffset: sweepZ + rootChord * 0.24,
        chord: tipChord * 0.35,
        thick: tipThick * 0.55,
        tiltZ: 0.14,
      });
    } else {
      // Smooth blended Airbus/Boeing sharklet curve
      stations.push({
        x: halfSpan * 1.022,
        y: dihedralY + halfSpan * 0.042,
        zOffset: sweepZ + rootChord * 0.1,
        chord: tipChord * 0.72,
        thick: tipThick * 0.78,
        tiltZ: 0.55,
      });
      stations.push({
        x: halfSpan * 1.04,
        y: dihedralY + halfSpan * 0.115,
        zOffset: sweepZ + rootChord * 0.22,
        chord: tipChord * 0.42,
        thick: tipThick * 0.55,
        tiltZ: 1.28,
      });
    }
  }

  for (const st of stations) {
    const cosT = Math.cos(st.tiltZ);
    const sinT = Math.sin(st.tiltZ);
    for (const [cf, th] of profilePts) {
      const localZ = st.zOffset + (cf - 0.25) * st.chord;
      const localUp = th * st.thick;
      const x = st.x - localUp * sinT;
      const y = st.y + localUp * cosT;
      positions.push(x, y, localZ);
    }
  }

  for (let s = 0; s < stations.length - 1; s++) {
    for (let j = 0; j < ringCount - 1; j++) {
      const a = s * ringCount + j;
      const b = a + 1;
      const c = (s + 1) * ringCount + j;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // Tip cap close
  const lastBase = (stations.length - 1) * ringCount;
  for (let j = 1; j < ringCount - 2; j++) {
    indices.push(lastBase, lastBase + j, lastBase + j + 1);
  }

  // Sculpted underwing flap-track canoe fairings
  for (let f = 0; f < flapTrackFairings; f++) {
    const t = 0.24 + f * 0.21;
    const fx = t * halfSpan;
    const fy = t * dihedralY - rootThick * 0.42;
    const chordAt =
      t < 0.28
        ? THREE.MathUtils.lerp(rootChord, rootChord * 0.62, t / 0.28)
        : THREE.MathUtils.lerp(rootChord * 0.62, tipChord, (t - 0.28) / 0.72);
    const fz = t * sweepZ + chordAt * 0.62;
    const canoe = new THREE.CapsuleGeometry(rootThick * 0.36, chordAt * 0.32, 3, 6);
    canoe.rotateX(Math.PI / 2);
    canoe.translate(fx, fy, fz);
    const cPos = canoe.getAttribute('position');
    const cIdx = canoe.getIndex();
    const baseVertex = positions.length / 3;
    for (let k = 0; k < cPos.count; k++) {
      positions.push(cPos.getX(k), cPos.getY(k), cPos.getZ(k));
    }
    if (cIdx) {
      for (let k = 0; k < cIdx.count; k++) {
        indices.push(baseVertex + cIdx.getX(k));
      }
    }
    canoe.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a swept cambered vertical stabilizer fin with dorsal fairing fillet.
 */
export function createLoftedFinGeometry(
  baseChord: number,
  tipChord: number,
  height: number,
  sweepZ: number,
  thickness: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  const profile: Array<[number, number]> = [
    [0.0, 0.0],
    [0.14, 0.72],
    [0.35, 1.0],
    [0.68, 0.64],
    [1.0, 0.04],
    [0.68, -0.64],
    [0.35, -1.0],
    [0.14, -0.72],
    [0.0, 0.0],
  ];
  const ring = profile.length;

  const stations = [
    {y: 0, z0: -baseChord * 0.14, chord: baseChord * 1.14, thick: thickness * 1.15},
    {y: height * 0.14, z0: sweepZ * 0.14, chord: baseChord * 0.92, thick: thickness},
    {y: height * 0.6, z0: sweepZ * 0.6, chord: THREE.MathUtils.lerp(baseChord, tipChord, 0.6), thick: thickness * 0.76},
    {y: height, z0: sweepZ, chord: tipChord, thick: thickness * 0.54},
  ];

  for (const st of stations) {
    for (const [cf, th] of profile) {
      positions.push(th * st.thick, st.y, st.z0 + cf * st.chord);
    }
  }

  for (let s = 0; s < stations.length - 1; s++) {
    for (let j = 0; j < ring - 1; j++) {
      const a = s * ring + j;
      const b = a + 1;
      const c = (s + 1) * ring + j;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const tipBase = (stations.length - 1) * ring;
  for (let j = 1; j < ring - 2; j++) {
    indices.push(tipBase, tipBase + j, tipBase + j + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates an aerodynamic sculpted turbofan nacelle cowl (curved intake lip + barrel + tapered fan nozzle).
 */
export function createSculptedNacelleGeometry(radius: number, length: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    // Inner intake lip throat
    new THREE.Vector2(radius * 0.78, -length * 0.44),
    new THREE.Vector2(radius * 0.85, -length * 0.50),
    new THREE.Vector2(radius * 0.98, -length * 0.46),
    new THREE.Vector2(radius * 1.05, -length * 0.22),
    new THREE.Vector2(radius * 1.02, length * 0.08),
    new THREE.Vector2(radius * 0.92, length * 0.36),
    new THREE.Vector2(radius * 0.76, length * 0.50),
  ];
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Multi-blade titanium radial fan rotor disc geometry (replaces flat cylinder cap).
 */
export function createMultiBladeFanGeometry(radius: number, blades = 12): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let vOff = 0;

  for (let i = 0; i < blades; i++) {
    const ang = (i / blades) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const px = -sa;
    const py = ca;
    const r0 = radius * 0.22;
    const r1 = radius * 0.96;
    const w0 = radius * 0.07;
    const w1 = radius * 0.14;
    const pitchZ = radius * 0.07;

    positions.push(
      ca * r0 - px * w0, sa * r0 - py * w0, -pitchZ,
      ca * r0 + px * w0, sa * r0 + py * w0, pitchZ,
      ca * r1 + px * w1, sa * r1 + py * w1, pitchZ * 0.7,
      ca * r1 - px * w1, sa * r1 - py * w1, -pitchZ * 0.7,
    );
    indices.push(vOff, vOff + 1, vOff + 2, vOff, vOff + 2, vOff + 3);
    vOff += 4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
