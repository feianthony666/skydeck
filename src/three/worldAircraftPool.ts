import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {
  resolveAircraftSpec,
  resolveAirlineLivery,
  resolveSpecialLivery,
} from '../data/aviationCatalog';
import {resolveAirlineManifest} from '../data/modelsAndAirlines';
import {resolveFr24ModelClass, type Fr24ModelClass} from '../components/aircraftIcons';
import type {LiveFlight} from '../types/aviation';
import {
  createLoftedFinGeometry,
  createLoftedFuselageGeometry,
  createLoftedWingGeometry,
  createMultiBladeFanGeometry,
  createSculptedNacelleGeometry,
} from './airframeGeometry';
import {acquireCompositedLiveryTexture} from './liveryCompositor';
import {
  acquireSvgTailSkinTexture,
} from './svgLiverySkins';

/**
 * High-Detail, Low-Draw-Call 3D World Aircraft Pool (MSFS / X-Plane / GeoFS fidelity).
 * Merges static airframe assemblies per aircraft class into 4 total draw calls per 3D plane
 * (down from ~33) while preserving full lofted fuselages, NACA wings, sharklets, flap canoes,
 * sculpted turbofans, navigation lights, GeoFS SVG fuselage liveries, and SVG tail fin art.
 */

interface PreparedGeoOpts {
  translate?: [number, number, number];
  scale?: [number, number, number];
  rotateY?: number;
  colorHex?: string;
}

function preparePartGeo(
  src: THREE.BufferGeometry,
  opts: PreparedGeoOpts = {},
  keepUv = false,
): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  if (opts.scale) {
    g.scale(opts.scale[0], opts.scale[1], opts.scale[2]);
    // Flip winding if negatively scaled in X
    if (opts.scale[0] * opts.scale[1] * opts.scale[2] < 0) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, x1, y1, z1);
      }
      pos.needsUpdate = true;
    }
  }
  if (opts.rotateY) g.rotateY(opts.rotateY);
  if (opts.translate) g.translate(opts.translate[0], opts.translate[1], opts.translate[2]);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!keepUv && g.getAttribute('uv')) g.deleteAttribute('uv');

  if (opts.colorHex) {
    const col = new THREE.Color(opts.colorHex);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return g;
}

interface SharedClassKit {
  fuselageGeo: THREE.BufferGeometry;
  staticAirframeGeo: THREE.BufferGeometry; // wings, hTail, pylons, intakes, windshield, nav lights, antennas (vertex-colored)
  liveryTrimGeo: THREE.BufferGeometry; // vTail, belly fairing, engine cowls, spinners (colored by airline/special livery)
  finDecalGeo: THREE.BufferGeometry | null; // merged L+R tail SVG decal planes
  fansGeo: THREE.BufferGeometry | null; // merged static/titanium fan blades
  rotorGeo?: THREE.BufferGeometry;
  fuselageRadius: number;
  lengthScale: number;
  isFighter: boolean;
  isHeli: boolean;
}

const classKits = new Map<Fr24ModelClass, SharedClassKit>();

function buildKitForClass(cls: Fr24ModelClass): SharedClassKit {
  const isHeli = cls === 'heli';
  const isFighter = cls === 'fighter';
  const isTurboprop = cls === 'turboprop' || cls === 'lightprop';
  const isMilCargo = cls === 'milcargo';
  const isRear = cls === 'rearjet' || cls === 'bizjet';
  const engines4 = cls === 'a380' || cls === 'heavy4' || cls === 'milcargo';

  const lengthScale =
    cls === 'a380'
      ? 1.38
      : cls === 'heavy4'
        ? 1.34
        : cls === 'widebody'
          ? 1.24
          : cls === 'milcargo'
            ? 1.2
            : cls === 'bizjet'
              ? 0.78
              : cls === 'turboprop'
                ? 0.85
                : cls === 'lightprop'
                  ? 0.62
                  : cls === 'heli'
                    ? 0.65
                    : cls === 'fighter'
                      ? 0.76
                      : 1.0;

  const spanScale =
    cls === 'a380'
      ? 1.44
      : cls === 'heavy4'
        ? 1.32
        : cls === 'widebody'
          ? 1.28
          : cls === 'milcargo'
            ? 1.25
            : cls === 'turboprop'
              ? 1.08
              : cls === 'lightprop'
                ? 0.88
                : cls === 'fighter'
                  ? 0.72
                  : cls === 'bizjet'
                    ? 0.78
                    : 1.0;

  const r =
    cls === 'a380'
      ? 0.56
      : cls === 'heavy4'
        ? 0.50
        : cls === 'widebody'
          ? 0.44
          : cls === 'milcargo'
            ? 0.46
            : cls === 'fighter' || cls === 'lightprop'
              ? 0.23
              : cls === 'bizjet' || cls === 'heli'
                ? 0.26
                : 0.33;

  const len = 6.0 * lengthScale;
  const span = 5.6 * spanScale;
  const subtype =
    cls === 'a380'
      ? 'a380'
      : cls === 'heavy4'
        ? 'b747'
        : cls === 'milcargo'
          ? 'milcargo'
          : cls === 'widebody'
            ? 'b787'
            : 'a320';

  const fuselageGeo = createLoftedFuselageGeometry({
    radius: r,
    totalLen: len,
    subtype,
    isFighter,
    isHeli,
    radialSegments: 22,
    lengthStations: 24,
  });

  const staticParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];
  const tempDisposables: THREE.BufferGeometry[] = [];

  // AirNav Radar signature glossy golden-yellow airframe palette
  const wingHex = isFighter || isMilCargo ? '#EAB308' : '#FACC15';
  const wingY = isTurboprop || isMilCargo ? r * 0.68 : -r * 0.28;

  // 1. Wing-to-body belly fairing + Dorsal SATCOM Wi-Fi radome hump
  if (!isHeli && !isFighter) {
    const fairingBase = new THREE.CapsuleGeometry(r * 0.78, len * 0.24, 4, 10);
    fairingBase.rotateX(Math.PI / 2);
    tempDisposables.push(fairingBase);
    trimParts.push(
      preparePartGeo(fairingBase, {
        scale: [1.12, 0.55, 1.0],
        translate: [0, -r * 0.46, 0.05],
      }),
    );

    if (cls === 'widebody' || cls === 'narrowbody' || cls === 'a380' || cls === 'heavy4') {
      const satcom = new THREE.CapsuleGeometry(r * 0.22, len * 0.08, 4, 8);
      satcom.rotateX(Math.PI / 2);
      tempDisposables.push(satcom);
      trimParts.push(
        preparePartGeo(satcom, {
          scale: [0.85, 0.45, 1.0],
          translate: [0, r * 0.96, -len * 0.04],
        }),
      );
    }
  }

  // 2. Cockpit Windshield (gloss black wrap-around panes)
  const windRaw = new THREE.CylinderGeometry(
    r * 0.64,
    r * 0.88,
    len * 0.06,
    14,
    1,
    false,
    -Math.PI * 0.36,
    Math.PI * 0.72,
  );
  windRaw.rotateX(-Math.PI / 2);
  tempDisposables.push(windRaw);
  staticParts.push(
    preparePartGeo(windRaw, {
      translate: [0, r * 0.34, -len * 0.40],
      colorHex: '#070E1A',
    }),
  );

  // 3. Cambered NACA Airfoil Wings (L + R with sharklets/raked tips & flap-track canoes)
  const wingRaw = isHeli
    ? new THREE.BoxGeometry(span * 0.16, 0.06, 0.55)
    : createLoftedWingGeometry({
        halfSpan: span * 0.5,
        rootChord: isFighter ? 2.15 : isTurboprop ? 0.72 : 1.38 * lengthScale,
        tipChord: isFighter ? 0.38 : isTurboprop ? 0.34 : 0.32 * lengthScale,
        sweepZ: isFighter ? 1.38 : isTurboprop ? 0.14 : 1.18 * lengthScale,
        dihedralY: isTurboprop || isMilCargo ? -0.06 : 0.22 * spanScale,
        rootThick: isFighter ? 0.065 : 0.095 * lengthScale,
        tipThick: isFighter ? 0.025 : 0.032 * lengthScale,
        winglets: !isFighter && !isTurboprop && !isMilCargo,
        rakedTip: cls === 'widebody',
        flapTrackFairings: isFighter || isTurboprop ? 0 : 3,
      });
  tempDisposables.push(wingRaw);
  staticParts.push(
    preparePartGeo(wingRaw, {translate: [r * 0.35, wingY, -0.35], colorHex: wingHex}),
    preparePartGeo(wingRaw, {
      scale: [-1, 1, 1],
      translate: [-r * 0.35, wingY, -0.35],
      colorHex: wingHex,
    }),
  );

  // 4. Wingtip Navigation Lights + Tail Strobe
  if (!isHeli) {
    const navRaw = new THREE.SphereGeometry(0.06, 6, 6);
    tempDisposables.push(navRaw);
    staticParts.push(
      preparePartGeo(navRaw, {
        translate: [-(r * 0.35 + span * 0.5), wingY + 0.18, 0.72],
        colorHex: '#EF4444',
      }),
      preparePartGeo(navRaw, {
        translate: [r * 0.35 + span * 0.5, wingY + 0.18, 0.72],
        colorHex: '#22C55E',
      }),
      preparePartGeo(navRaw, {
        translate: [0, r * 0.25, len * 0.49],
        colorHex: '#FFFFFF',
      }),
    );
  }

  // 5. Vertical Stabilizer Fin + Fin SVG Decal Mesh
  const finH = (isFighter ? 0.85 : isHeli ? 0.62 : 1.28) * lengthScale;
  const vTailRaw = createLoftedFinGeometry(
    1.08 * lengthScale,
    0.46 * lengthScale,
    finH,
    0.82 * lengthScale,
    0.055 * lengthScale,
  );
  tempDisposables.push(vTailRaw);
  if (isFighter) {
    // Twin canted fighter tails
    const cantL = vTailRaw.clone();
    cantL.rotateZ(0.28);
    const cantR = vTailRaw.clone();
    cantR.rotateZ(-0.28);
    tempDisposables.push(cantL, cantR);
    trimParts.push(
      preparePartGeo(cantL, {translate: [-r * 0.55, r * 0.38, len * 0.24]}),
      preparePartGeo(cantR, {translate: [r * 0.55, r * 0.38, len * 0.24]}),
    );
  } else {
    trimParts.push(
      preparePartGeo(vTailRaw, {translate: [0, r * 0.52, len * 0.24]}),
    );
  }

  let finDecalGeo: THREE.BufferGeometry | null = null;
  if (!isFighter && !isMilCargo) {
    const decRaw = new THREE.PlaneGeometry(0.68 * lengthScale, finH * 0.62);
    const decR = preparePartGeo(
      decRaw,
      {
        rotateY: Math.PI / 2,
        translate: [0.055 * lengthScale, r * 0.52 + finH * 0.52, len * 0.24 + 0.85 * lengthScale],
      },
      true,
    );
    const decL = preparePartGeo(
      decRaw,
      {
        rotateY: -Math.PI / 2,
        translate: [-0.055 * lengthScale, r * 0.52 + finH * 0.52, len * 0.24 + 0.85 * lengthScale],
      },
      true,
    );
    finDecalGeo = mergeGeometries([decR, decL], false);
    decRaw.dispose();
    decR.dispose();
    decL.dispose();
  }

  // 6. Horizontal Stabilizers
  if (!isHeli) {
    const hRaw = createLoftedWingGeometry({
      halfSpan: span * 0.21,
      rootChord: 0.56 * lengthScale,
      tipChord: 0.21 * lengthScale,
      sweepZ: 0.42 * lengthScale,
      dihedralY: 0.04 * spanScale,
      rootThick: 0.04 * lengthScale,
      tipThick: 0.018 * lengthScale,
      winglets: false,
      flapTrackFairings: 0,
    });
    tempDisposables.push(hRaw);
    const hY = isRear ? r * 0.52 + finH * 0.92 : r * 0.26;
    const hZ = len * 0.38;
    staticParts.push(
      preparePartGeo(hRaw, {translate: [0.08, hY, hZ], colorHex: wingHex}),
      preparePartGeo(hRaw, {scale: [-1, 1, 1], translate: [-0.08, hY, hZ], colorHex: wingHex}),
    );
  }

  // 7. Sculpted Turbofan Nacelles, Pylons, Intakes, Spinners & Fan Discs
  const engines = isHeli || cls === 'lightprop'
    ? []
    : isFighter
      ? [
          {x: r * 0.44, y: 0, z: len * 0.36},
          {x: -r * 0.44, y: 0, z: len * 0.36},
        ]
      : isRear
        ? [
            {x: r * 1.15, y: r * 0.24, z: len * 0.25},
            {x: -r * 1.15, y: r * 0.24, z: len * 0.25},
          ]
        : engines4
          ? [
              {x: span * 0.19, y: wingY - r * 0.36, z: -0.22},
              {x: -span * 0.19, y: wingY - r * 0.36, z: -0.22},
              {x: span * 0.34, y: wingY - r * 0.26, z: 0.22},
              {x: -span * 0.34, y: wingY - r * 0.26, z: 0.22},
            ]
          : [
              {x: span * 0.21, y: wingY - r * 0.34, z: -0.22},
              {x: -span * 0.21, y: wingY - r * 0.34, z: -0.22},
            ];

  const fanParts: THREE.BufferGeometry[] = [];
  if (engines.length > 0) {
    const cowlR = isTurboprop ? r * 0.42 : r * 0.56;
    const cowlLen = isTurboprop ? 0.85 : 1.02 * lengthScale;
    const cowlRaw = createSculptedNacelleGeometry(cowlR, cowlLen);
    const intakeRaw = new THREE.CylinderGeometry(cowlR * 0.8, cowlR * 0.74, cowlLen * 0.82, 14);
    intakeRaw.rotateX(Math.PI / 2);
    const fanRaw = createMultiBladeFanGeometry(cowlR * 0.76, 12);
    const spinnerRaw = new THREE.ConeGeometry(cowlR * 0.22, 0.18, 10);
    spinnerRaw.rotateX(-Math.PI / 2);
    const pylonRaw = new THREE.BoxGeometry(0.05, 0.26 * lengthScale, 0.55 * lengthScale);
    tempDisposables.push(cowlRaw, intakeRaw, fanRaw, spinnerRaw, pylonRaw);

    for (const pos of engines) {
      trimParts.push(
        preparePartGeo(cowlRaw, {translate: [pos.x, pos.y, pos.z]}),
        preparePartGeo(spinnerRaw, {
          translate: [pos.x, pos.y, pos.z - 0.42 * lengthScale],
        }),
      );
      staticParts.push(
        preparePartGeo(intakeRaw, {translate: [pos.x, pos.y, pos.z], colorHex: '#0F172A'}),
      );
      if (!isFighter && !isRear) {
        staticParts.push(
          preparePartGeo(pylonRaw, {
            translate: [pos.x, pos.y + r * 0.34, pos.z + 0.08],
            colorHex: wingHex,
          }),
        );
      }
      fanParts.push(
        preparePartGeo(fanRaw, {translate: [pos.x, pos.y, pos.z - 0.32 * lengthScale]}),
      );
    }
  }

  let rotorGeo: THREE.BufferGeometry | undefined;
  if (isHeli) {
    const b1 = new THREE.BoxGeometry(span * 1.15, 0.04, 0.18);
    const b2 = new THREE.BoxGeometry(0.18, 0.04, span * 1.15);
    const p1 = preparePartGeo(b1);
    const p2 = preparePartGeo(b2);
    rotorGeo = mergeGeometries([p1, p2], false);
    b1.dispose();
    b2.dispose();
    p1.dispose();
    p2.dispose();
  }

  const staticAirframeGeo = mergeGeometries(staticParts, false);
  const liveryTrimGeo = mergeGeometries(trimParts, false);
  const fansGeo = fanParts.length > 0 ? mergeGeometries(fanParts, false) : null;

  for (const g of tempDisposables) g.dispose();
  for (const g of staticParts) g.dispose();
  for (const g of trimParts) g.dispose();
  for (const g of fanParts) g.dispose();

  return {
    fuselageGeo,
    staticAirframeGeo,
    liveryTrimGeo,
    finDecalGeo,
    fansGeo,
    rotorGeo,
    fuselageRadius: r,
    lengthScale,
    isFighter,
    isHeli,
  };
}

function getKit(cls: Fr24ModelClass): SharedClassKit {
  let kit = classKits.get(cls);
  if (!kit) {
    kit = buildKitForClass(cls);
    classKits.set(cls, kit);
  }
  return kit;
}

const sharedVertexColorMat = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  roughness: 0.22,
  metalness: 0.22,
  clearcoat: 0.9,
  clearcoatRoughness: 0.14,
});
const sharedAirnavYellowMat = new THREE.MeshPhysicalMaterial({
  color: '#FACC15',
  roughness: 0.2,
  metalness: 0.24,
  clearcoat: 0.92,
  clearcoatRoughness: 0.12,
});
const sharedAirnavTrimMat = new THREE.MeshPhysicalMaterial({
  color: '#EAB308',
  roughness: 0.22,
  metalness: 0.28,
  clearcoat: 0.88,
  clearcoatRoughness: 0.14,
});
const sharedAirnavSelectedMat = new THREE.MeshPhysicalMaterial({
  color: '#FDE047',
  emissive: '#CA8A04',
  emissiveIntensity: 0.28,
  roughness: 0.18,
  metalness: 0.26,
  clearcoat: 0.95,
});
const sharedIntakeMat = new THREE.MeshStandardMaterial({
  color: '#0F172A',
  roughness: 0.78,
  metalness: 0.25,
});
const sharedTitaniumMat = new THREE.MeshStandardMaterial({
  color: '#CBD5E1',
  roughness: 0.2,
  metalness: 0.88,
});
const sharedEmissiveSelectedMat = new THREE.MeshBasicMaterial({color: '#F59E0B', depthTest: false});
const sharedEmissiveEmergMat = new THREE.MeshBasicMaterial({color: '#EF4444', depthTest: false});

interface LiveryMaterialEntry {
  fuselageMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  noseMat: THREE.MeshStandardMaterial;
  releaseFus: () => void;
  releaseTail: () => void;
  refCount: number;
}

const liveryMatCache = new Map<string, LiveryMaterialEntry>();

function acquireWorldLiveryMaterials(
  flight: LiveFlight,
  maxAnisotropy: number,
): {entry: LiveryMaterialEntry; release: () => void} {
  const livery = resolveAirlineLivery(flight.airlineIcao, flight.callsign);
  const special = resolveSpecialLivery(flight.registration, flight.callsign);
  const manifestAirline = resolveAirlineManifest(flight.airlineIcao, flight.callsign);
  const spec = resolveAircraftSpec(flight.aircraftType);
  const acCode = (flight.aircraftType || spec.code || 'A320').toUpperCase();
  const key = `${acCode}_${manifestAirline.icao}_${special?.theme ?? 'std'}`;

  let entry = liveryMatCache.get(key);
  if (!entry) {
    const fus = acquireCompositedLiveryTexture(acCode, manifestAirline.icao, flight.callsign, maxAnisotropy);
    const tail = acquireSvgTailSkinTexture(livery, special, maxAnisotropy);
    const fuselageMat = new THREE.MeshStandardMaterial({
      map: fus.texture,
      roughness: 0.25,
      metalness: 0.16,
    });
    const tailMat = new THREE.MeshStandardMaterial({
      map: tail.texture,
      color: '#FFFFFF',
      roughness: 0.26,
      metalness: 0.14,
    });
    const noseMat = new THREE.MeshStandardMaterial({
      color: special?.primaryHex || manifestAirline.primaryHex || livery.tailHex,
      roughness: 0.26,
      metalness: 0.18,
    });
    entry = {
      fuselageMat,
      tailMat,
      noseMat,
      releaseFus: fus.release,
      releaseTail: tail.release,
      refCount: 0,
    };
    liveryMatCache.set(key, entry);
  }
  entry.refCount++;
  const captured = entry;
  return {
    entry: captured,
    release: () => {
      captured.refCount--;
      if (captured.refCount <= 0 && liveryMatCache.size > 96) {
        captured.fuselageMat.dispose();
        captured.tailMat.dispose();
        captured.noseMat.dispose();
        captured.releaseFus();
        captured.releaseTail();
        liveryMatCache.delete(key);
      }
    },
  };
}

export interface WorldAircraftHandle {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  rotor?: THREE.Mesh;
  beaconMesh?: THREE.Mesh;
  modelKey: string;
  dispose: () => void;
}

export function buildWorld3DAircraft(
  flight: LiveFlight,
  maxAnisotropy: number,
  isSelected: boolean,
  isEmergency: boolean,
  useAirnavYellow = false,
): WorldAircraftHandle {
  const cls = resolveFr24ModelClass(flight.aircraftType, flight.callsign);
  const kit = getKit(cls);
  const liv = useAirnavYellow ? null : acquireWorldLiveryMaterials(flight, maxAnisotropy);

  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  // Draw Call 1: Multi-Station Lofted Fuselage (Live Canvas UV Compositor OR AirNav Golden Yellow)
  const fusMesh = new THREE.Mesh(
    kit.fuselageGeo,
    useAirnavYellow
      ? isSelected
        ? sharedAirnavSelectedMat
        : sharedAirnavYellowMat
      : liv!.entry.fuselageMat,
  );
  fusMesh.renderOrder = isSelected ? 26 : 18;
  bodyGroup.add(fusMesh);

  // Draw Call 2: Merged Static Airframe (NACA Wings, Sharklets, Flap Canoes, H-Tail, Dark Windshield, Intakes, Nav Lights)
  const staticMesh = new THREE.Mesh(kit.staticAirframeGeo, sharedVertexColorMat);
  staticMesh.renderOrder = isSelected ? 26 : 18;
  bodyGroup.add(staticMesh);

  // Draw Call 3: Merged Vertical Fin, Nacelle Cowls, Belly Fairing, Spinners, SATCOM
  const trimMesh = new THREE.Mesh(
    kit.liveryTrimGeo,
    useAirnavYellow ? sharedAirnavTrimMat : liv!.entry.noseMat,
  );
  trimMesh.renderOrder = isSelected ? 26 : 18;
  bodyGroup.add(trimMesh);

  // Draw Call 3b (Live Livery Mode): Fin Airline Tail Emblem
  if (!useAirnavYellow && kit.finDecalGeo && liv) {
    const finMesh = new THREE.Mesh(kit.finDecalGeo, liv.entry.tailMat);
    finMesh.renderOrder = isSelected ? 27 : 19;
    bodyGroup.add(finMesh);
  }

  // Draw Call 4: Merged Multi-Blade Titanium Fans OR Spinning Heli Rotor
  if (kit.fansGeo) {
    const fansMesh = new THREE.Mesh(kit.fansGeo, sharedTitaniumMat);
    fansMesh.renderOrder = isSelected ? 26 : 18;
    bodyGroup.add(fansMesh);
  }

  let rotor: THREE.Mesh | undefined;
  if (kit.isHeli && kit.rotorGeo) {
    rotor = new THREE.Mesh(kit.rotorGeo, sharedIntakeMat);
    rotor.position.set(0, kit.fuselageRadius * 1.15, 0);
    bodyGroup.add(rotor);
  }

  let beaconMesh: THREE.Mesh | undefined;
  if (isSelected || isEmergency) {
    const haloGeo = new THREE.RingGeometry(2.8, 3.3, 28);
    haloGeo.rotateX(-Math.PI / 2);
    const halo = new THREE.Mesh(
      haloGeo,
      isEmergency ? sharedEmissiveEmergMat : sharedEmissiveSelectedMat,
    );
    halo.position.y = 0.05;
    halo.renderOrder = 25;
    group.add(halo);
    beaconMesh = halo;
  }

  const styleTag = useAirnavYellow ? 'airnav' : `livery|${flight.airlineIcao || flight.callsign.slice(0, 3)}`;
  return {
    group,
    bodyGroup,
    rotor,
    beaconMesh,
    modelKey: `${styleTag}|${cls}|${isSelected ? 1 : 0}|${isEmergency ? 1 : 0}`,
    dispose: () => {
      if (beaconMesh) beaconMesh.geometry.dispose();
      liv?.release();
    },
  };
}
