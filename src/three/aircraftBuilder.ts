import * as THREE from 'three';
import type {AircraftGeometrySpec, AirlineLivery} from '../data/aviationCatalog';
import {createAirlineLiveryTexture} from './avionicsTextures';

export interface AircraftModelRefs {
  group: THREE.Group;
  gearGroup: THREE.Group;
  fanBlades: THREE.Mesh[];
  strobeLight: THREE.Mesh;
  beaconLight: THREE.Mesh;
  dispose: () => void;
}

export function buildProceduralAircraft(
  spec: AircraftGeometrySpec,
  livery: AirlineLivery,
  registration: string,
  maxAnisotropy: number,
  gearExtended: boolean,
): AircraftModelRefs {
  const group = new THREE.Group();
  const disposables: Array<{dispose: () => void}> = [];

  const fuselageTex = createAirlineLiveryTexture(livery, registration, maxAnisotropy);
  disposables.push(fuselageTex);

  const r = spec.fuselageRadius;
  const len = 6.2 * spec.lengthScale;
  const span = 5.8 * spec.wingspanScale;

  // Materials with >0.25 roughness differentiation
  const fuselageMat = new THREE.MeshPhysicalMaterial({
    map: fuselageTex,
    roughness: 0.28,
    metalness: 0.15,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    color: '#E2E8F0',
    roughness: 0.48,
    metalness: 0.25,
  });
  const tailMat = new THREE.MeshPhysicalMaterial({
    color: livery.tailHex,
    roughness: 0.3,
    metalness: 0.15,
    clearcoat: 0.8,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: '#94A3B8',
    roughness: 0.22,
    metalness: 0.88,
  });
  const darkTireMat = new THREE.MeshStandardMaterial({
    color: '#1E293B',
    roughness: 0.85,
    metalness: 0.05,
  });
  const cockpitGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#0F172A',
    roughness: 0.08,
    metalness: 0.2,
    clearcoat: 1.0,
  });
  disposables.push(fuselageMat, wingMat, tailMat, metalMat, darkTireMat, cockpitGlassMat);

  // 1. Main Fuselage Cylinder (aligned along Z, nose at -Z)
  const cylGeo = new THREE.CylinderGeometry(r, r * 0.96, len * 0.66, 28);
  cylGeo.rotateX(Math.PI / 2);
  const fuselageMesh = new THREE.Mesh(cylGeo, fuselageMat);
  fuselageMesh.castShadow = true;
  fuselageMesh.receiveShadow = true;
  group.add(fuselageMesh);
  disposables.push(cylGeo);

  // 2. Nose Cone (Lathe profile)
  const nosePts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    nosePts.push(new THREE.Vector2(Math.sin((1 - t) * (Math.PI / 2)) * r, t * (len * 0.18)));
  }
  const noseGeo = new THREE.LatheGeometry(nosePts, 24);
  noseGeo.rotateX(-Math.PI / 2);
  const noseMesh = new THREE.Mesh(noseGeo, new THREE.MeshPhysicalMaterial({color: livery.fuselageHex, roughness: 0.26, clearcoat: 0.85}));
  noseMesh.position.z = -len * 0.33;
  noseMesh.castShadow = true;
  group.add(noseMesh);
  disposables.push(noseGeo, noseMesh.material);

  // Cockpit Windshield Band
  const windGeo = new THREE.CylinderGeometry(r * 0.72, r * 0.92, len * 0.06, 18, 1, false, -Math.PI * 0.38, Math.PI * 0.76);
  windGeo.rotateX(-Math.PI / 2);
  const windMesh = new THREE.Mesh(windGeo, cockpitGlassMat);
  windMesh.position.set(0, r * 0.22, -len * 0.38);
  group.add(windMesh);
  disposables.push(windGeo);

  // 3. Tail Cone
  const tailConeGeo = new THREE.ConeGeometry(r * 0.96, len * 0.22, 24);
  tailConeGeo.rotateX(Math.PI / 2);
  const tailConeMesh = new THREE.Mesh(tailConeGeo, new THREE.MeshPhysicalMaterial({color: livery.tailHex, roughness: 0.32, clearcoat: 0.7}));
  tailConeMesh.position.z = len * 0.44;
  tailConeMesh.castShadow = true;
  group.add(tailConeMesh);
  disposables.push(tailConeGeo, tailConeMesh.material);

  // 4. Swept Main Wings (ExtrudeGeometry)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -0.55);
  wingShape.lineTo(span * 0.5, 0.85);
  wingShape.lineTo(span * 0.5, 1.18);
  wingShape.lineTo(0, 0.75);
  wingShape.closePath();

  const wingExtrude = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  wingExtrude.rotateX(Math.PI / 2);

  const rightWing = new THREE.Mesh(wingExtrude, wingMat);
  rightWing.position.set(r * 0.4, -r * 0.25, -0.2);
  rightWing.rotation.z = 0.05;
  rightWing.castShadow = true;
  rightWing.receiveShadow = true;
  group.add(rightWing);

  const leftWing = rightWing.clone();
  leftWing.scale.x = -1;
  leftWing.position.x = -r * 0.4;
  leftWing.rotation.z = -0.05;
  group.add(leftWing);
  disposables.push(wingExtrude);

  // Winglets
  if (spec.winglets) {
    const wlGeo = new THREE.BoxGeometry(0.04, 0.36 * spec.wingspanScale, 0.32);
    const wlR = new THREE.Mesh(wlGeo, tailMat);
    wlR.position.set(r * 0.4 + span * 0.5, -r * 0.1 + 0.16, 0.82);
    wlR.rotation.z = -0.22;
    wlR.rotation.x = 0.25;
    group.add(wlR);

    const wlL = wlR.clone();
    wlL.position.x = -(r * 0.4 + span * 0.5);
    wlL.rotation.z = 0.22;
    group.add(wlL);
    disposables.push(wlGeo);
  }

  // 5. Vertical Stabilizer
  const vTailShape = new THREE.Shape();
  vTailShape.moveTo(0, 0);
  vTailShape.lineTo(0.85 * spec.lengthScale, 1.32 * spec.lengthScale);
  vTailShape.lineTo(1.38 * spec.lengthScale, 1.32 * spec.lengthScale);
  vTailShape.lineTo(1.15 * spec.lengthScale, 0);
  vTailShape.closePath();

  const vTailGeo = new THREE.ExtrudeGeometry(vTailShape, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
  });
  vTailGeo.rotateY(-Math.PI / 2);
  const vTail = new THREE.Mesh(vTailGeo, tailMat);
  vTail.position.set(0.03, r * 0.55, len * 0.24);
  vTail.castShadow = true;
  group.add(vTail);
  disposables.push(vTailGeo);

  // 6. Horizontal Stabilizers
  const hShape = new THREE.Shape();
  hShape.moveTo(0, -0.2);
  hShape.lineTo(span * 0.21, 0.35);
  hShape.lineTo(span * 0.21, 0.54);
  hShape.lineTo(0, 0.34);
  hShape.closePath();
  const hGeo = new THREE.ExtrudeGeometry(hShape, {depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01});
  hGeo.rotateX(Math.PI / 2);
  const hR = new THREE.Mesh(hGeo, wingMat);
  hR.position.set(0.08, spec.tTail ? r * 0.55 + 1.25 * spec.lengthScale : r * 0.15, len * 0.38);
  hR.castShadow = true;
  group.add(hR);
  const hL = hR.clone();
  hL.scale.x = -1;
  hL.position.x = -0.08;
  group.add(hL);
  disposables.push(hGeo);

  // 7. High-Bypass Turbofan Engines
  const fanBlades: THREE.Mesh[] = [];
  const engOffsets =
    spec.engines === 4
      ? [
          {x: span * 0.18, z: -0.25},
          {x: -span * 0.18, z: -0.25},
          {x: span * 0.33, z: 0.25},
          {x: -span * 0.33, z: 0.25},
        ]
      : [
          {x: span * 0.2, z: -0.2},
          {x: -span * 0.2, z: -0.2},
        ];

  const nacelleGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.52, 0.95 * spec.lengthScale, 20, 1, true);
  nacelleGeo.rotateX(Math.PI / 2);
  const coreGeo = new THREE.ConeGeometry(r * 0.34, 0.45, 16);
  coreGeo.rotateX(Math.PI / 2);
  const fanGeo = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.04, 12);
  fanGeo.rotateX(Math.PI / 2);
  const pylonGeo = new THREE.BoxGeometry(0.06, 0.28, 0.6);
  disposables.push(nacelleGeo, coreGeo, fanGeo, pylonGeo);

  for (const pos of engOffsets) {
    const engGroup = new THREE.Group();
    engGroup.position.set(pos.x, -r * 0.55, pos.z);
    const cowl = new THREE.Mesh(nacelleGeo, fuselageMat);
    const core = new THREE.Mesh(coreGeo, metalMat);
    core.position.z = 0.55;
    const fan = new THREE.Mesh(fanGeo, metalMat);
    fan.position.z = -0.32;
    const pylon = new THREE.Mesh(pylonGeo, wingMat);
    pylon.position.set(0, r * 0.42, 0.05);
    engGroup.add(cowl, core, fan, pylon);
    fanBlades.push(fan);
    group.add(engGroup);
  }

  // 8. Retractable Tricycle Landing Gear
  const gearGroup = new THREE.Group();
  const strutGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.46, 10);
  const tireGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.09, 14);
  tireGeo.rotateZ(Math.PI / 2);
  disposables.push(strutGeo, tireGeo);

  const gearSpots = [
    {x: 0, z: -len * 0.28},
    {x: span * 0.12, z: 0.28},
    {x: -span * 0.12, z: 0.28},
  ];
  for (const gp of gearSpots) {
    const strut = new THREE.Mesh(strutGeo, metalMat);
    strut.position.set(gp.x, -r - 0.18, gp.z);
    const tireL = new THREE.Mesh(tireGeo, darkTireMat);
    tireL.position.set(gp.x - 0.06, -r - 0.38, gp.z);
    const tireR = new THREE.Mesh(tireGeo, darkTireMat);
    tireR.position.set(gp.x + 0.06, -r - 0.38, gp.z);
    gearGroup.add(strut, tireL, tireR);
  }
  gearGroup.visible = gearExtended;
  group.add(gearGroup);

  // 9. Navigation & Anti-Collision Beacons
  const beaconGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const redMat = new THREE.MeshBasicMaterial({color: '#EF4444'});
  const greenMat = new THREE.MeshBasicMaterial({color: '#22C55E'});
  const whiteStrobeMat = new THREE.MeshBasicMaterial({color: '#FFFFFF'});
  disposables.push(beaconGeo, redMat, greenMat, whiteStrobeMat);

  const navLeft = new THREE.Mesh(beaconGeo, redMat);
  navLeft.position.set(-(r * 0.4 + span * 0.5), -r * 0.12, 0.85);
  const navRight = new THREE.Mesh(beaconGeo, greenMat);
  navRight.position.set(r * 0.4 + span * 0.5, -r * 0.12, 0.85);
  const beaconLight = new THREE.Mesh(beaconGeo, redMat);
  beaconLight.position.set(0, r + 0.04, 0);
  const strobeLight = new THREE.Mesh(beaconGeo, whiteStrobeMat);
  strobeLight.position.set(0, r * 0.55 + 1.32 * spec.lengthScale, len * 0.39);
  group.add(navLeft, navRight, beaconLight, strobeLight);

  return {
    group,
    gearGroup,
    fanBlades,
    strobeLight,
    beaconLight,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
