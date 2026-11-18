import * as THREE from 'three';
import type {AvionicsTextureBundle} from './avionicsTextures';

export interface CockpitRefs {
  group: THREE.Group;
  yokeLeft: THREE.Group;
  yokeRight: THREE.Group;
  throttleLeft: THREE.Mesh;
  throttleRight: THREE.Mesh;
  hudGlass: THREE.Mesh;
  outsideWorld: THREE.Group;
  cloudLayer: THREE.Group;
  dispose: () => void;
}

export function buildFlightDeckCockpit(textures: AvionicsTextureBundle): CockpitRefs {
  const group = new THREE.Group();
  const disposables: Array<{dispose: () => void}> = [];

  const panelMat = new THREE.MeshStandardMaterial({color: '#1E293B', roughness: 0.62, metalness: 0.35});
  const glareMat = new THREE.MeshStandardMaterial({color: '#0F172A', roughness: 0.85, metalness: 0.1});
  const metalMat = new THREE.MeshStandardMaterial({color: '#64748B', roughness: 0.3, metalness: 0.82});
  const yokeMat = new THREE.MeshStandardMaterial({color: '#111827', roughness: 0.7, metalness: 0.15});
  const screenBezelMat = new THREE.MeshStandardMaterial({color: '#090D16', roughness: 0.4, metalness: 0.5});
  const windowFrameMat = new THREE.MeshStandardMaterial({color: '#1E293B', roughness: 0.55, metalness: 0.45});
  disposables.push(panelMat, glareMat, metalMat, yokeMat, screenBezelMat, windowFrameMat);

  // Main Instrument Panel Housing
  const mipGeo = new THREE.BoxGeometry(2.7, 0.72, 0.32);
  const mip = new THREE.Mesh(mipGeo, panelMat);
  mip.position.set(0, 0.85, -1.05);
  mip.rotation.x = -0.16;
  group.add(mip);
  disposables.push(mipGeo);

  // Glare Shield
  const glareGeo = new THREE.BoxGeometry(2.78, 0.08, 0.52);
  const glare = new THREE.Mesh(glareGeo, glareMat);
  glare.position.set(0, 1.24, -1.02);
  group.add(glare);
  disposables.push(glareGeo);

  // MCP Autopilot Faceplate
  const mcpGeo = new THREE.PlaneGeometry(1.15, 0.24);
  const mcpMat = new THREE.MeshBasicMaterial({map: textures.mcpTexture});
  const mcpMesh = new THREE.Mesh(mcpGeo, mcpMat);
  mcpMesh.position.set(0, 1.18, -0.755);
  mcpMesh.rotation.x = -0.25;
  group.add(mcpMesh);
  disposables.push(mcpGeo, mcpMat);

  // 5 EFIS Glass Displays (Captain PFD, Captain ND, Center EICAS, FO ND, FO PFD)
  const screenGeo = new THREE.PlaneGeometry(0.42, 0.42);
  const bezelGeo = new THREE.BoxGeometry(0.46, 0.46, 0.03);
  const pfdMat = new THREE.MeshBasicMaterial({map: textures.pfdTexture});
  const ndMat = new THREE.MeshBasicMaterial({map: textures.ndTexture});
  const eicasMat = new THREE.MeshBasicMaterial({map: textures.eicasTexture});
  disposables.push(screenGeo, bezelGeo, pfdMat, ndMat, eicasMat);

  const screenSlots = [
    {x: -1.02, mat: pfdMat},
    {x: -0.52, mat: ndMat},
    {x: 0.0, mat: eicasMat},
    {x: 0.52, mat: ndMat},
    {x: 1.02, mat: pfdMat},
  ];
  for (const s of screenSlots) {
    const bezel = new THREE.Mesh(bezelGeo, screenBezelMat);
    bezel.position.set(s.x, 0.85, -0.89);
    bezel.rotation.x = -0.16;
    const scr = new THREE.Mesh(screenGeo, s.mat);
    scr.position.set(s.x, 0.85, -0.872);
    scr.rotation.x = -0.16;
    group.add(bezel, scr);
  }

  // Collimated Glass HUD Combiner above Captain PFD
  const hudGeo = new THREE.PlaneGeometry(0.42, 0.3);
  const hudMat = new THREE.MeshBasicMaterial({
    map: textures.pfdTexture,
    transparent: true,
    opacity: 0.36,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const hudGlass = new THREE.Mesh(hudGeo, hudMat);
  hudGlass.position.set(-0.62, 1.44, -0.86);
  hudGlass.rotation.x = 0.28;
  group.add(hudGlass);
  disposables.push(hudGeo, hudMat);

  // Center Pedestal & Thrust Quadrant
  const pedGeo = new THREE.BoxGeometry(0.68, 0.72, 1.15);
  const pedestal = new THREE.Mesh(pedGeo, panelMat);
  pedestal.position.set(0, 0.36, -0.35);
  group.add(pedestal);
  disposables.push(pedGeo);

  const leverGeo = new THREE.BoxGeometry(0.055, 0.24, 0.055);
  const knobGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.09, 14);
  knobGeo.rotateX(Math.PI / 2);
  knobGeo.rotateY(Math.PI / 2);
  disposables.push(leverGeo, knobGeo);

  const throttleLeft = new THREE.Mesh(leverGeo, metalMat);
  throttleLeft.position.set(-0.07, 0.8, -0.58);
  const knobL = new THREE.Mesh(knobGeo, yokeMat);
  knobL.position.set(0, 0.13, 0);
  throttleLeft.add(knobL);

  const throttleRight = new THREE.Mesh(leverGeo, metalMat);
  throttleRight.position.set(0.07, 0.8, -0.58);
  const knobR = new THREE.Mesh(knobGeo, yokeMat);
  knobR.position.set(0, 0.13, 0);
  throttleRight.add(knobR);
  group.add(throttleLeft, throttleRight);

  // Dual Flight Yokes
  const mkYoke = (x: number) => {
    const yg = new THREE.Group();
    yg.position.set(x, 0.45, -0.56);
    const colGeo = new THREE.CylinderGeometry(0.032, 0.038, 0.44, 12);
    const col = new THREE.Mesh(colGeo, metalMat);
    col.position.y = 0.22;
    const barGeo = new THREE.BoxGeometry(0.32, 0.04, 0.04);
    const bar = new THREE.Mesh(barGeo, yokeMat);
    bar.position.y = 0.43;
    const gripGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.17, 10);
    const gripL = new THREE.Mesh(gripGeo, yokeMat);
    gripL.position.set(-0.15, 0.5, 0);
    const gripR = new THREE.Mesh(gripGeo, yokeMat);
    gripR.position.set(0.15, 0.5, 0);
    yg.add(col, bar, gripL, gripR);
    disposables.push(colGeo, barGeo, gripGeo);
    return yg;
  };
  const yokeLeft = mkYoke(-0.62);
  const yokeRight = mkYoke(0.62);
  group.add(yokeLeft, yokeRight);

  // Windshield Canopy Pillars & Overhead Panel
  const pillarGeo = new THREE.BoxGeometry(0.08, 1.08, 0.12);
  const centerPillar = new THREE.Mesh(pillarGeo, windowFrameMat);
  centerPillar.position.set(0, 1.72, -1.04);
  centerPillar.rotation.x = 0.42;

  const leftPillar = new THREE.Mesh(pillarGeo, windowFrameMat);
  leftPillar.position.set(-1.32, 1.66, -0.82);
  leftPillar.rotation.set(0.36, 0.25, -0.18);

  const rightPillar = new THREE.Mesh(pillarGeo, windowFrameMat);
  rightPillar.position.set(1.32, 1.66, -0.82);
  rightPillar.rotation.set(0.36, -0.25, 0.18);
  group.add(centerPillar, leftPillar, rightPillar);
  disposables.push(pillarGeo);

  // Overhead Panel with illuminated status buttons
  const ovhGeo = new THREE.BoxGeometry(1.15, 0.08, 0.95);
  const overhead = new THREE.Mesh(ovhGeo, panelMat);
  overhead.position.set(0, 2.08, -0.35);
  overhead.rotation.x = 0.26;
  group.add(overhead);
  disposables.push(ovhGeo);

  const btnGeo = new THREE.BoxGeometry(0.045, 0.015, 0.045);
  const cyanLed = new THREE.MeshBasicMaterial({color: '#38BDF8'});
  const amberLed = new THREE.MeshBasicMaterial({color: '#F59E0B'});
  const whiteLed = new THREE.MeshBasicMaterial({color: '#E2E8F0'});
  disposables.push(btnGeo, cyanLed, amberLed, whiteLed);

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      const mat = (row + col) % 5 === 0 ? amberLed : (row + col) % 3 === 0 ? cyanLed : whiteLed;
      const b = new THREE.Mesh(btnGeo, mat);
      b.position.set(-0.38 + col * 0.15, -0.045, -0.28 + row * 0.18);
      overhead.add(b);
    }
  }

  // Floor & Side Consoles
  const floorGeo = new THREE.BoxGeometry(2.9, 0.08, 2.4);
  const floor = new THREE.Mesh(floorGeo, glareMat);
  floor.position.set(0, -0.04, -0.25);
  group.add(floor);
  disposables.push(floorGeo);

  const sideGeo = new THREE.BoxGeometry(0.34, 0.68, 1.9);
  const sideL = new THREE.Mesh(sideGeo, panelMat);
  sideL.position.set(-1.32, 0.34, -0.25);
  const sideR = new THREE.Mesh(sideGeo, panelMat);
  sideR.position.set(1.32, 0.34, -0.25);
  group.add(sideL, sideR);
  disposables.push(sideGeo);

  // Outside Horizon Terrain Grid & Altitude Cloud Deck visible through windshield
  const outsideWorld = new THREE.Group();
  const terrainGeo = new THREE.PlaneGeometry(420, 420);
  terrainGeo.rotateX(-Math.PI / 2);
  const terrainMat = new THREE.MeshStandardMaterial({color: '#0D1B2A', roughness: 0.95});
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.position.set(0, -14, -140);
  const terrainGrid = new THREE.GridHelper(320, 32, '#1E3A5F', '#152538');
  terrainGrid.position.set(0, -13.9, -140);
  outsideWorld.add(terrain, terrainGrid);
  disposables.push(terrainGeo, terrainMat);

  const cloudLayer = new THREE.Group();
  const cloudGeo = new THREE.SphereGeometry(6, 12, 8);
  cloudGeo.scale(2.8, 0.38, 1.6);
  const cloudMat = new THREE.MeshStandardMaterial({
    color: '#CBD5E1',
    transparent: true,
    opacity: 0.42,
    roughness: 0.9,
  });
  disposables.push(cloudGeo, cloudMat);
  for (let i = 0; i < 14; i++) {
    const puff = new THREE.Mesh(cloudGeo, cloudMat);
    puff.position.set(((i % 5) - 2) * 34 + (i % 2) * 10, -4, -55 - i * 14);
    cloudLayer.add(puff);
  }
  outsideWorld.add(cloudLayer);
  group.add(outsideWorld);

  // Subtle cyan cockpit instrument floodlight
  const deckLight = new THREE.PointLight('#38BDF8', 0.9, 4.5);
  deckLight.position.set(0, 1.75, -0.4);
  group.add(deckLight);

  return {
    group,
    yokeLeft,
    yokeRight,
    throttleLeft,
    throttleRight,
    hudGlass,
    outsideWorld,
    cloudLayer,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

export function buildAirportApronGroup(): {group: THREE.Group; dispose: () => void} {
  const group = new THREE.Group();
  const disposables: Array<{dispose: () => void}> = [];

  // Tarmac / Apron ground
  const apronGeo = new THREE.PlaneGeometry(340, 340);
  apronGeo.rotateX(-Math.PI / 2);
  const apronMat = new THREE.MeshStandardMaterial({
    color: '#1E2530',
    roughness: 0.92,
    metalness: 0.05,
  });
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.receiveShadow = true;
  group.add(apron);
  disposables.push(apronGeo, apronMat);

  // Active Runway Strip (with polygonOffset to prevent z-fighting)
  const rwyGeo = new THREE.PlaneGeometry(18, 280);
  rwyGeo.rotateX(-Math.PI / 2);
  const rwyMat = new THREE.MeshStandardMaterial({
    color: '#0F172A',
    roughness: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const runway = new THREE.Mesh(rwyGeo, rwyMat);
  runway.position.set(0, 0.02, -30);
  runway.receiveShadow = true;
  group.add(runway);
  disposables.push(rwyGeo, rwyMat);

  // Yellow Taxiway Guide Line & White Runway Centerline
  const yellowMat = new THREE.MeshBasicMaterial({
    color: '#F59E0B',
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const whiteMat = new THREE.MeshBasicMaterial({
    color: '#F8FAFC',
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const dashGeo = new THREE.PlaneGeometry(0.42, 4.5);
  dashGeo.rotateX(-Math.PI / 2);
  disposables.push(yellowMat, whiteMat, dashGeo);

  for (let z = -140; z <= 90; z += 11) {
    const dash = new THREE.Mesh(dashGeo, whiteMat);
    dash.position.set(0, 0.03, z);
    group.add(dash);
  }

  const taxiLineGeo = new THREE.PlaneGeometry(0.28, 120);
  taxiLineGeo.rotateX(-Math.PI / 2);
  const taxiLine = new THREE.Mesh(taxiLineGeo, yellowMat);
  taxiLine.position.set(14, 0.03, -20);
  group.add(taxiLine);
  disposables.push(taxiLineGeo);

  // Distant Terminal Concourse & Control Tower Silhouette
  const termGeo = new THREE.BoxGeometry(72, 8.5, 16);
  const termMat = new THREE.MeshStandardMaterial({color: '#334155', roughness: 0.55, metalness: 0.35});
  const terminal = new THREE.Mesh(termGeo, termMat);
  terminal.position.set(42, 4.25, -48);
  group.add(terminal);

  const towerShaftGeo = new THREE.CylinderGeometry(1.8, 2.5, 28, 12);
  const towerCabGeo = new THREE.CylinderGeometry(4.2, 3.0, 4.5, 12);
  const towerShaft = new THREE.Mesh(towerShaftGeo, termMat);
  towerShaft.position.set(52, 14, -74);
  const towerCab = new THREE.Mesh(towerCabGeo, new THREE.MeshBasicMaterial({color: '#38BDF8'}));
  towerCab.position.set(52, 29, -74);
  group.add(towerShaft, towerCab);
  disposables.push(termGeo, termMat, towerShaftGeo, towerCabGeo, towerCab.material);

  return {
    group,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
