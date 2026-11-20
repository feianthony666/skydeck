import * as THREE from 'three';
import type {AircraftGeometrySpec, AirlineLivery} from '../data/aviationCatalog';
import type {SpecialLiverySpec} from '../types/aviation';
import {
  createLoftedFinGeometry,
  createLoftedFuselageGeometry,
  createLoftedWingGeometry,
  createMultiBladeFanGeometry,
  createSculptedNacelleGeometry,
} from './airframeGeometry';
import {
  acquireSvgFuselageSkinTexture,
  acquireSvgTailSkinTexture,
} from './svgLiverySkins';

export interface AircraftModelRefs {
  group: THREE.Group;
  gearGroup: THREE.Group;
  fanBlades: THREE.Mesh[];
  strobeLight: THREE.Mesh;
  beaconLight: THREE.Mesh;
  groundContactOffsetY: number;
  dispose: () => void;
}

export function buildProceduralAircraft(
  spec: AircraftGeometrySpec,
  livery: AirlineLivery,
  registration: string,
  maxAnisotropy: number,
  gearExtended: boolean,
  specialLivery: SpecialLiverySpec | null = null,
  airnavYellow = true,
): AircraftModelRefs {
  const group = new THREE.Group();
  const disposables: Array<{dispose: () => void}> = [];

  const fusSkin = acquireSvgFuselageSkinTexture(
    livery,
    registration,
    spec,
    specialLivery,
    maxAnisotropy,
    true,
  );
  const tailSkin = acquireSvgTailSkinTexture(livery, specialLivery, maxAnisotropy);
  const fuselageTex = fusSkin.texture;
  const tailTex = tailSkin.texture;
  disposables.push({dispose: fusSkin.release}, {dispose: tailSkin.release});

  const r = spec.fuselageRadius;
  const len = 6.2 * spec.lengthScale;
  const span = 5.8 * spec.wingspanScale;
  const subtype = spec.subtype ?? (spec.tTail ? 'tTail' : spec.category === 'widebody' ? 'b777' : 'a320');
  const isFighter = subtype === 'fighter';
  const isTurboprop = subtype === 'turboprop';
  const isMilCargo = subtype === 'milcargo';
  const isHighWing = isTurboprop || isMilCargo;
  const isRearEngines = subtype === 'tTail' || subtype === 'bizjet';

  const baseFuselageColor = airnavYellow
    ? '#FACC15'
    : isFighter
      ? '#475569'
      : isMilCargo
        ? '#64748B'
        : specialLivery?.theme === 'turtle'
          ? specialLivery.primaryHex
          : livery.fuselageHex;

  const baseTailColor = airnavYellow
    ? '#EAB308'
    : isFighter
      ? '#334155'
      : isMilCargo
        ? '#475569'
        : specialLivery?.primaryHex || livery.tailHex;

  const fuselageMat = new THREE.MeshPhysicalMaterial({
    map: airnavYellow || isFighter || isMilCargo ? null : fuselageTex,
    color: airnavYellow || isFighter || isMilCargo ? baseFuselageColor : '#FFFFFF',
    roughness: airnavYellow ? 0.2 : isFighter ? 0.55 : 0.24,
    metalness: airnavYellow ? 0.24 : isFighter ? 0.42 : 0.16,
    clearcoat: isFighter && !airnavYellow ? 0.15 : 0.92,
    clearcoatRoughness: 0.12,
  });
  const noseMat = new THREE.MeshPhysicalMaterial({
    color: airnavYellow ? '#FACC15' : baseFuselageColor,
    roughness: 0.22,
    metalness: 0.2,
    clearcoat: 0.9,
  });
  const wingMat = new THREE.MeshPhysicalMaterial({
    color: airnavYellow ? '#FACC15' : isFighter ? '#475569' : isMilCargo ? '#64748B' : '#E2E8F0',
    roughness: airnavYellow ? 0.24 : 0.38,
    metalness: airnavYellow ? 0.22 : 0.28,
    clearcoat: airnavYellow ? 0.86 : 0.2,
  });
  const tailMat = new THREE.MeshPhysicalMaterial({
    color: baseTailColor,
    roughness: 0.24,
    metalness: 0.2,
    clearcoat: 0.88,
  });
  const tailDecalMat = new THREE.MeshPhysicalMaterial({
    map: airnavYellow ? null : tailTex,
    color: airnavYellow ? '#EAB308' : '#FFFFFF',
    roughness: 0.24,
    metalness: 0.18,
    clearcoat: 0.88,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: '#CBD5E1',
    roughness: 0.2,
    metalness: 0.9,
  });
  const intakeDarkMat = new THREE.MeshStandardMaterial({
    color: '#0F172A',
    roughness: 0.8,
    metalness: 0.2,
  });
  const darkTireMat = new THREE.MeshStandardMaterial({
    color: '#1E293B',
    roughness: 0.88,
    metalness: 0.04,
  });
  const cockpitGlassMat = new THREE.MeshPhysicalMaterial({
    color: subtype === 'a350' ? '#020617' : '#0F172A',
    roughness: 0.06,
    metalness: 0.25,
    clearcoat: 1.0,
  });
  disposables.push(
    fuselageMat,
    noseMat,
    wingMat,
    tailMat,
    tailDecalMat,
    metalMat,
    intakeDarkMat,
    darkTireMat,
    cockpitGlassMat,
  );

  // 1. Continuous Multi-Station Lofted Fuselage (B747 hump & A380 crown sculpted seamlessly!)
  const fusGeo = createLoftedFuselageGeometry({
    radius: r,
    totalLen: len,
    subtype,
    isFighter,
    radialSegments: 36,
    lengthStations: 38,
  });
  const fuselageMesh = new THREE.Mesh(fusGeo, fuselageMat);
  fuselageMesh.castShadow = true;
  fuselageMesh.receiveShadow = true;
  group.add(fuselageMesh);
  disposables.push(fusGeo);

  // Wing-to-Body Karman Belly Fairing
  if (!isFighter) {
    const fairingGeo = new THREE.CapsuleGeometry(r * 0.82, len * 0.26, 6, 14);
    fairingGeo.rotateX(Math.PI / 2);
    fairingGeo.scale(1.15, 0.55, 1.0);
    const fairing = new THREE.Mesh(fairingGeo, noseMat);
    fairing.position.set(0, -r * 0.48, 0.05);
    fairing.castShadow = true;
    group.add(fairing);
    disposables.push(fairingGeo);
  }

  // Cockpit Windshield Band / Bubble Canopy / A350 Raccoon Mask
  if (isFighter) {
    const canopyGeo = new THREE.CapsuleGeometry(r * 0.58, len * 0.18, 10, 14);
    canopyGeo.rotateX(Math.PI / 2);
    const canopy = new THREE.Mesh(canopyGeo, cockpitGlassMat);
    canopy.position.set(0, r * 0.58, -len * 0.26);
    group.add(canopy);
    disposables.push(canopyGeo);
  } else {
    const windGeo = new THREE.CylinderGeometry(
      r * 0.65,
      r * 0.90,
      len * 0.062,
      24,
      1,
      false,
      -Math.PI * (subtype === 'a350' ? 0.44 : 0.36),
      Math.PI * (subtype === 'a350' ? 0.88 : 0.72),
    );
    windGeo.rotateX(-Math.PI / 2);
    const windMesh = new THREE.Mesh(windGeo, cockpitGlassMat);
    windMesh.position.set(0, r * 0.34, -len * 0.40);
    group.add(windMesh);
    disposables.push(windGeo);
  }

  // 2. Cambered NACA Airfoil Swept Wings + Blended Sharklets / Raked Wingtips + Flap-Track Canoes
  const wingY = isHighWing ? r * 0.72 : -r * 0.28;
  const wingGeo = createLoftedWingGeometry({
    halfSpan: span * 0.5,
    rootChord: isFighter ? 2.15 : isTurboprop ? 0.72 : 1.42 * spec.lengthScale,
    tipChord: isFighter ? 0.38 : isTurboprop ? 0.34 : 0.32 * spec.lengthScale,
    sweepZ: isFighter ? 1.42 : isTurboprop ? 0.14 : (subtype === 'b787' ? 1.32 : 1.18) * spec.lengthScale,
    dihedralY: isHighWing ? -0.06 : 0.24 * spec.wingspanScale,
    rootThick: isFighter ? 0.065 : 0.10 * spec.lengthScale,
    tipThick: isFighter ? 0.025 : 0.032 * spec.lengthScale,
    winglets: spec.winglets && !isFighter,
    rakedTip: subtype === 'b787' || subtype === 'b777',
    flapTrackFairings: isFighter || isTurboprop ? 0 : 3,
  });

  const rightWing = new THREE.Mesh(wingGeo, wingMat);
  rightWing.position.set(r * 0.34, wingY, -0.35);
  rightWing.castShadow = true;
  rightWing.receiveShadow = true;
  group.add(rightWing);

  const leftWing = rightWing.clone();
  leftWing.scale.x = -1;
  leftWing.position.x = -r * 0.34;
  group.add(leftWing);
  disposables.push(wingGeo);

  // 3. Sculpted Swept Vertical Stabilizer(s) + Textured Fin Decal Panels
  const finHeight = (isFighter ? 0.88 : isMilCargo ? 1.54 : 1.34) * spec.lengthScale;
  const vTailGeo = createLoftedFinGeometry(
    1.12 * spec.lengthScale,
    0.46 * spec.lengthScale,
    finHeight,
    0.84 * spec.lengthScale,
    0.055 * spec.lengthScale,
  );

  if (isFighter) {
    const vtL = new THREE.Mesh(vTailGeo, tailMat);
    vtL.position.set(-r * 0.45, r * 0.45, len * 0.22);
    vtL.rotation.z = 0.28;
    const vtR = new THREE.Mesh(vTailGeo, tailMat);
    vtR.position.set(r * 0.45, r * 0.45, len * 0.22);
    vtR.rotation.z = -0.28;
    group.add(vtL, vtR);
  } else {
    const vTail = new THREE.Mesh(vTailGeo, tailMat);
    vTail.position.set(0, r * 0.54, len * 0.25);
    vTail.castShadow = true;
    group.add(vTail);

    const finDecalGeo = new THREE.PlaneGeometry(0.74 * spec.lengthScale, finHeight * 0.62);
    const decalR = new THREE.Mesh(finDecalGeo, tailDecalMat);
    decalR.position.set(0.058 * spec.lengthScale, r * 0.54 + finHeight * 0.52, len * 0.25 + 0.88 * spec.lengthScale);
    decalR.rotation.y = Math.PI / 2;
    const decalL = new THREE.Mesh(finDecalGeo, tailDecalMat);
    decalL.position.set(-0.058 * spec.lengthScale, r * 0.54 + finHeight * 0.52, len * 0.25 + 0.88 * spec.lengthScale);
    decalL.rotation.y = -Math.PI / 2;
    group.add(decalR, decalL);
    disposables.push(finDecalGeo);
  }
  disposables.push(vTailGeo);

  // 4. Cambered Horizontal Stabilizers
  const hGeo = createLoftedWingGeometry({
    halfSpan: span * 0.21,
    rootChord: 0.58 * spec.lengthScale,
    tipChord: 0.22 * spec.lengthScale,
    sweepZ: 0.44 * spec.lengthScale,
    dihedralY: 0.04 * spec.wingspanScale,
    rootThick: 0.042 * spec.lengthScale,
    tipThick: 0.018 * spec.lengthScale,
    winglets: false,
    flapTrackFairings: 0,
  });
  const hY = spec.tTail ? r * 0.54 + finHeight * 0.92 : r * 0.26;
  const hZ = spec.tTail ? len * 0.41 : len * 0.38;
  const hR = new THREE.Mesh(hGeo, wingMat);
  hR.position.set(0.08, hY, hZ);
  hR.castShadow = true;
  group.add(hR);
  const hL = hR.clone();
  hL.scale.x = -1;
  hL.position.x = -0.08;
  group.add(hL);
  disposables.push(hGeo);

  // 5. Sculpted Engines (Curved Lip Nacelles + Pylons + Multi-Blade Titanium Fans)
  const fanBlades: THREE.Mesh[] = [];
  const engOffsets = isFighter
    ? [
        {x: r * 0.44, y: 0, z: len * 0.36},
        {x: -r * 0.44, y: 0, z: len * 0.36},
      ]
    : isRearEngines
      ? [
          {x: r * 1.15, y: r * 0.22, z: len * 0.25},
          {x: -r * 1.15, y: r * 0.22, z: len * 0.25},
        ]
      : spec.engines === 4
        ? [
            {x: span * 0.19, y: wingY - r * 0.36, z: -0.24},
            {x: -span * 0.19, y: wingY - r * 0.36, z: -0.24},
            {x: span * 0.34, y: wingY - r * 0.26, z: 0.22},
            {x: -span * 0.34, y: wingY - r * 0.26, z: 0.22},
          ]
        : [
            {x: span * 0.21, y: wingY - (isHighWing ? 0.08 : r * 0.34), z: -0.24},
            {x: -span * 0.21, y: wingY - (isHighWing ? 0.08 : r * 0.34), z: -0.24},
          ];

  const cowlR = isTurboprop ? r * 0.42 : isFighter ? r * 0.42 : r * 0.58;
  const cowlLen = isTurboprop ? 0.88 : isFighter ? 0.74 : 1.06 * spec.lengthScale;
  const nacelleGeo = createSculptedNacelleGeometry(cowlR, cowlLen);
  const intakeGeo = new THREE.CylinderGeometry(cowlR * 0.80, cowlR * 0.74, cowlLen * 0.82, 18);
  intakeGeo.rotateX(Math.PI / 2);
  const coreGeo = new THREE.ConeGeometry(cowlR * 0.56, 0.46, 16);
  coreGeo.rotateX(Math.PI / 2);
  const fanGeo = createMultiBladeFanGeometry(cowlR * 0.76, 14);
  const spinnerGeo = new THREE.ConeGeometry(cowlR * 0.24, 0.22, 14);
  spinnerGeo.rotateX(-Math.PI / 2);
  const pylonGeo = new THREE.BoxGeometry(0.06, 0.28, 0.62);
  const chevronGeo = new THREE.CylinderGeometry(cowlR * 0.82, cowlR * 0.7, 0.16, 10, 1, true);
  chevronGeo.rotateX(Math.PI / 2);
  const propBladeGeo = new THREE.BoxGeometry(0.055, cowlR * 2.9, 0.02);
  disposables.push(nacelleGeo, intakeGeo, coreGeo, fanGeo, spinnerGeo, pylonGeo, chevronGeo, propBladeGeo);

  for (const pos of engOffsets) {
    const engGroup = new THREE.Group();
    engGroup.position.set(pos.x, pos.y, pos.z);
    const cowl = new THREE.Mesh(nacelleGeo, isRearEngines || isFighter ? tailMat : noseMat);
    const intake = new THREE.Mesh(intakeGeo, intakeDarkMat);
    const core = new THREE.Mesh(coreGeo, intakeDarkMat);
    core.position.z = cowlLen * 0.54;
    const fan = new THREE.Mesh(fanGeo, metalMat);
    fan.position.z = -cowlLen * 0.34;
    const spinner = new THREE.Mesh(spinnerGeo, noseMat);
    spinner.position.z = -cowlLen * 0.44;
    engGroup.add(cowl, intake, core, fan, spinner);

    if (subtype === 'b787') {
      const chev = new THREE.Mesh(chevronGeo, intakeDarkMat);
      chev.position.z = cowlLen * 0.48;
      engGroup.add(chev);
    }

    if (isTurboprop) {
      const propGroup = new THREE.Mesh(propBladeGeo, intakeDarkMat);
      propGroup.position.z = -cowlLen * 0.52;
      const blade2 = new THREE.Mesh(propBladeGeo, intakeDarkMat);
      blade2.rotation.z = Math.PI / 3;
      const blade3 = new THREE.Mesh(propBladeGeo, intakeDarkMat);
      blade3.rotation.z = -Math.PI / 3;
      propGroup.add(blade2, blade3);
      engGroup.add(propGroup);
      fanBlades.push(propGroup);
    } else if (!isFighter && !isRearEngines) {
      const pylon = new THREE.Mesh(pylonGeo, wingMat);
      pylon.position.set(0, cowlR * 0.65, 0.08);
      engGroup.add(pylon);
    }

    fanBlades.push(fan);
    group.add(engGroup);
  }

  // 6. Retractable Landing Gear
  const gearGroup = new THREE.Group();
  const gearDrop = isFighter ? 0.3 : 0.42;
  const tireR = spec.category === 'widebody' ? 0.12 : 0.10;
  const strutGeo = new THREE.CylinderGeometry(0.036, 0.036, gearDrop, 10);
  const tireGeo = new THREE.CylinderGeometry(tireR, tireR, 0.085, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const bogieBeamGeo = new THREE.BoxGeometry(0.05, 0.05, 0.32);
  disposables.push(strutGeo, tireGeo, bogieBeamGeo);

  const wheelCenterY = -r - gearDrop + 0.04;
  const groundContactOffsetY = wheelCenterY - tireR;
  const isQuadBogie = spec.category === 'widebody' && !isMilCargo;

  const gearSpots = [
    {x: 0, z: -len * 0.28, isNose: true},
    {x: span * 0.125, z: 0.28, isNose: false},
    {x: -span * 0.125, z: 0.28, isNose: false},
  ];
  for (const gp of gearSpots) {
    const strut = new THREE.Mesh(strutGeo, metalMat);
    strut.position.set(gp.x, -r - gearDrop * 0.45, gp.z);
    gearGroup.add(strut);

    if (isQuadBogie && !gp.isNose) {
      const beam = new THREE.Mesh(bogieBeamGeo, metalMat);
      beam.position.set(gp.x, wheelCenterY, gp.z);
      gearGroup.add(beam);
      for (const dz of [-0.12, 0.12]) {
        const tireL = new THREE.Mesh(tireGeo, darkTireMat);
        tireL.position.set(gp.x - 0.075, wheelCenterY, gp.z + dz);
        const tireR = new THREE.Mesh(tireGeo, darkTireMat);
        tireR.position.set(gp.x + 0.075, wheelCenterY, gp.z + dz);
        gearGroup.add(tireL, tireR);
      }
    } else {
      const tireL = new THREE.Mesh(tireGeo, darkTireMat);
      tireL.position.set(gp.x - 0.06, wheelCenterY, gp.z);
      const tireR = new THREE.Mesh(tireGeo, darkTireMat);
      tireR.position.set(gp.x + 0.06, wheelCenterY, gp.z);
      gearGroup.add(tireL, tireR);
    }
  }
  gearGroup.visible = gearExtended;
  group.add(gearGroup);

  // 7. Navigation & Anti-Collision Beacons
  const beaconGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const redMat = new THREE.MeshBasicMaterial({color: '#EF4444'});
  const greenMat = new THREE.MeshBasicMaterial({color: '#22C55E'});
  const whiteStrobeMat = new THREE.MeshBasicMaterial({color: '#FFFFFF'});
  disposables.push(beaconGeo, redMat, greenMat, whiteStrobeMat);

  const navLeft = new THREE.Mesh(beaconGeo, redMat);
  navLeft.position.set(-(r * 0.34 + span * 0.5), wingY + 0.22, 0.72);
  const navRight = new THREE.Mesh(beaconGeo, greenMat);
  navRight.position.set(r * 0.34 + span * 0.5, wingY + 0.22, 0.72);
  const beaconLight = new THREE.Mesh(beaconGeo, redMat);
  beaconLight.position.set(0, r + (subtype === 'a380' ? r * 0.42 : 0.06), 0);
  const strobeLight = new THREE.Mesh(beaconGeo, whiteStrobeMat);
  strobeLight.position.set(0, r * 0.54 + finHeight, len * 0.39);
  group.add(navLeft, navRight, beaconLight, strobeLight);

  return {
    group,
    gearGroup,
    fanBlades,
    strobeLight,
    beaconLight,
    groundContactOffsetY,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
