import {ChevronDown, ChevronUp, Eye, Gauge, Plane, Radio} from 'lucide-react';
import React, {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {resolveAircraftSpec, resolveAirlineLivery} from '../data/aviationCatalog';
import type {
  AirportWeather,
  CockpitCameraPreset,
  LiveFlight,
  ThreeViewMode,
} from '../types/aviation';
import {buildProceduralAircraft, type AircraftModelRefs} from '../three/aircraftBuilder';
import {
  createAvionicsTextures,
  drawEicas,
  drawMcp,
  drawNd,
  drawPfd,
  type AvionicsTextureBundle,
} from '../three/avionicsTextures';
import {buildAirportApronGroup, buildFlightDeckCockpit} from '../three/cockpitBuilder';

interface FlightDeck3DProps {
  flight: LiveFlight | null;
  allFlights: LiveFlight[];
  groundTraffic: LiveFlight[];
  nearestWeather?: AirportWeather;
  viewMode: ThreeViewMode;
  onViewModeChange: (mode: ThreeViewMode) => void;
  reducedMotion?: boolean;
}

const CAMERA_PRESETS: Record<
  CockpitCameraPreset,
  {pos: [number, number, number]; target: [number, number, number]; label: string}
> = {
  captain: {pos: [-0.62, 1.38, -0.05], target: [-0.55, 1.06, -1.35], label: 'Captain Seat'},
  hud: {pos: [-0.62, 1.46, -0.42], target: [-0.62, 1.43, -2.5], label: 'HUD Approach'},
  overhead: {pos: [0.0, 1.25, -0.15], target: [0.0, 2.08, -0.35], label: 'Overhead'},
  pedestal: {pos: [0.0, 1.35, -0.05], target: [0.0, 0.55, -0.58], label: 'Pedestal'},
};

export const FlightDeck3D: React.FC<FlightDeck3DProps> = ({
  flight,
  allFlights,
  groundTraffic,
  nearestWeather,
  viewMode,
  onViewModeChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [cockpitPreset, setCockpitPreset] = useState<CockpitCameraPreset>('captain');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  // Mutable refs so React state updates never tear down the WebGL context
  const stateRef = useRef({
    flight,
    allFlights,
    groundTraffic,
    nearestWeather,
    viewMode,
    cockpitPreset,
    transitionActive: false,
    desiredCamPos: new THREE.Vector3(-0.62, 1.38, -0.05),
    desiredTarget: new THREE.Vector3(-0.55, 1.06, -1.35),
  });

  stateRef.current.flight = flight;
  stateRef.current.allFlights = allFlights;
  stateRef.current.groundTraffic = groundTraffic;
  stateRef.current.nearestWeather = nearestWeather;
  stateRef.current.viewMode = viewMode;
  stateRef.current.cockpitPreset = cockpitPreset;

  const sceneRefs = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    controls?: OrbitControls;
    avionics?: AvionicsTextureBundle;
    cockpitGroup?: THREE.Group;
    exteriorRoot?: THREE.Group;
    taxiRoot?: THREE.Group;
    aircraftRefs?: AircraftModelRefs | null;
    taxiModels?: AircraftModelRefs[];
    maxAnisotropy: number;
    lastAircraftKey: string;
    lastTaxiHash: string;
  }>({maxAnisotropy: 1, lastAircraftKey: '', lastTaxiHash: ''});

  // Trigger camera glide when viewMode or cockpitPreset changes
  useEffect(() => {
    const s = stateRef.current;
    if (viewMode === 'cockpit') {
      const p = CAMERA_PRESETS[cockpitPreset];
      s.desiredCamPos.set(...p.pos);
      s.desiredTarget.set(...p.target);
    } else if (viewMode === 'exterior') {
      s.desiredCamPos.set(6.8, 3.1, 7.6);
      s.desiredTarget.set(0, 0.2, 0);
    } else {
      s.desiredCamPos.set(16, 7.5, 20);
      s.desiredTarget.set(0, 0.5, -6);
    }
    s.transitionActive = true;
  }, [viewMode, cockpitPreset]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || 640, container.clientHeight || 420);

    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => setContextLost(false);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B1526');
    scene.fog = new THREE.FogExp2('#0B1526', 0.008);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      52,
      (container.clientWidth || 640) / (container.clientHeight || 420),
      0.08,
      600,
    );
    camera.position.set(-0.62, 1.38, -0.05);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.target.set(-0.55, 1.06, -1.35);
    controls.addEventListener('start', () => {
      stateRef.current.transitionActive = false;
    });

    // Warm/cool 3-point aviation lighting rig
    const hemi = new THREE.HemisphereLight('#7DD3FC', '#1E293B', 0.85);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#FFF7ED', 1.65);
    keyLight.position.set(14, 22, 12);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#38BDF8', 0.65);
    rimLight.position.set(-12, 8, -16);
    scene.add(rimLight);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const avionics = createAvionicsTextures(maxAniso);

    // 1. Cockpit Root
    const cockpitRefs = buildFlightDeckCockpit(avionics);
    scene.add(cockpitRefs.group);

    // 2. Exterior Livery Root
    const exteriorRoot = new THREE.Group();
    const extShadowGeo = new THREE.CircleGeometry(3.8, 32);
    extShadowGeo.rotateX(-Math.PI / 2);
    const extShadowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const extShadow = new THREE.Mesh(extShadowGeo, extShadowMat);
    extShadow.position.y = -1.6;
    exteriorRoot.add(extShadow);
    scene.add(exteriorRoot);

    // 3. Ground Taxi Root
    const taxiRoot = new THREE.Group();
    const apron = buildAirportApronGroup();
    taxiRoot.add(apron.group);
    scene.add(taxiRoot);

    sceneRefs.current = {
      renderer,
      scene,
      camera,
      controls,
      avionics,
      cockpitGroup: cockpitRefs.group,
      exteriorRoot,
      taxiRoot,
      aircraftRefs: null,
      taxiModels: [],
      maxAnisotropy: maxAniso,
      lastAircraftKey: '',
      lastTaxiHash: '',
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    let frameId = 0;
    let lastTime = performance.now();
    let lastRenderTime = 0;
    let avionicsTimer = 0;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      if (document.hidden) {
        lastTime = now;
        frameId = window.setTimeout(tick, 500);
        return;
      }
      if (!isSoftwareGl && now - lastRenderTime < 1000 / 30) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      lastRenderTime = now;
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const s = stateRef.current;
      const refs = sceneRefs.current;

      // Toggle scene sub-roots cleanly
      cockpitRefs.group.visible = s.viewMode === 'cockpit';
      exteriorRoot.visible = s.viewMode === 'exterior';
      taxiRoot.visible = s.viewMode === 'taxi';

      // Adapt sky & fog to real METAR visibility & flight category
      const wx = s.nearestWeather;
      if (s.viewMode === 'cockpit' && s.flight && !s.flight.onGround) {
        const altRatio = Math.min(1, s.flight.altitudeFt / 36000);
        const skyColor = new THREE.Color('#1E3A5F').lerp(new THREE.Color('#071022'), altRatio);
        scene.background = skyColor;
        const visDensity = wx?.visibilitySm && wx.visibilitySm < 3 ? 0.032 : 0.006;
        (scene.fog as THREE.FogExp2).color.copy(skyColor);
        (scene.fog as THREE.FogExp2).density = visDensity;
      } else {
        const bg = new THREE.Color('#0B1526');
        scene.background = bg;
        (scene.fog as THREE.FogExp2).color.copy(bg);
        (scene.fog as THREE.FogExp2).density = wx?.visibilitySm && wx.visibilitySm < 3 ? 0.022 : 0.006;
      }

      // Smooth damped camera preset glide
      if (s.transitionActive) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, s.desiredCamPos.x, 7, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, s.desiredCamPos.y, 7, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, s.desiredCamPos.z, 7, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, s.desiredTarget.x, 7, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, s.desiredTarget.y, 7, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, s.desiredTarget.z, 7, dt);
        if (
          camera.position.distanceTo(s.desiredCamPos) < 0.015 &&
          controls.target.distanceTo(s.desiredTarget) < 0.015
        ) {
          s.transitionActive = false;
        }
      }
      controls.update();

      // Rebuild exterior aircraft when selected flight / livery / gear changes
      const activeFlight = s.flight;
      if (activeFlight) {
        const gearDown = activeFlight.onGround || activeFlight.altitudeFt < 2600;
        const acKey = `${activeFlight.icao24}-${activeFlight.airlineIcao}-${activeFlight.aircraftType}-${gearDown}`;
        if (acKey !== refs.lastAircraftKey) {
          if (refs.aircraftRefs) {
            exteriorRoot.remove(refs.aircraftRefs.group);
            refs.aircraftRefs.dispose();
          }
          const spec = resolveAircraftSpec(activeFlight.aircraftType);
          const livery = resolveAirlineLivery(activeFlight.airlineIcao, activeFlight.callsign);
          const model = buildProceduralAircraft(
            spec,
            livery,
            activeFlight.registration,
            refs.maxAnisotropy,
            gearDown,
          );
          exteriorRoot.add(model.group);
          refs.aircraftRefs = model;
          refs.lastAircraftKey = acKey;
        }

        // Animate exterior aircraft attitude, spinning turbofans & strobes
        if (refs.aircraftRefs) {
          const pitchTarget = THREE.MathUtils.clamp(activeFlight.verticalRateFpm / 4500, -0.22, 0.25);
          refs.aircraftRefs.group.rotation.x = THREE.MathUtils.damp(
            refs.aircraftRefs.group.rotation.x,
            pitchTarget,
            4,
            dt,
          );
          const rpm = activeFlight.onGround ? 6 : 22;
          for (const fan of refs.aircraftRefs.fanBlades) {
            fan.rotation.z += dt * rpm;
          }
          const pulse = Math.floor(now / 900) % 2 === 0;
          refs.aircraftRefs.strobeLight.visible = now % 1400 < 120;
          refs.aircraftRefs.beaconLight.visible = pulse;
        }

        // Animate cockpit flight controls, outside horizon/cloud altitude & refresh EFIS textures at ~5Hz
        const throttlePitch = activeFlight.onGround ? 0.2 : -0.35;
        cockpitRefs.throttleLeft.rotation.x = THREE.MathUtils.damp(cockpitRefs.throttleLeft.rotation.x, throttlePitch, 5, dt);
        cockpitRefs.throttleRight.rotation.x = THREE.MathUtils.damp(cockpitRefs.throttleRight.rotation.x, throttlePitch, 5, dt);
        const yokePitch = THREE.MathUtils.clamp(-activeFlight.verticalRateFpm / 8000, -0.14, 0.14);
        cockpitRefs.yokeLeft.rotation.x = THREE.MathUtils.damp(cockpitRefs.yokeLeft.rotation.x, yokePitch, 5, dt);
        cockpitRefs.yokeRight.rotation.x = THREE.MathUtils.damp(cockpitRefs.yokeRight.rotation.x, yokePitch, 5, dt);

        // Move exterior horizon terrain below cockpit proportionally to live altitude
        const terrainDrop = activeFlight.onGround ? 1.2 : THREE.MathUtils.clamp(2 + activeFlight.altitudeFt / 900, 2, 34);
        cockpitRefs.outsideWorld.position.y = THREE.MathUtils.damp(cockpitRefs.outsideWorld.position.y, -terrainDrop + 14, 3, dt);
        cockpitRefs.cloudLayer.visible = !activeFlight.onGround || Boolean(wx?.ceilingFt && wx.ceilingFt < 6000);
        const cloudDriftSpeed = Math.max(0.5, activeFlight.groundSpeedKts * 0.025);
        for (const puff of cockpitRefs.cloudLayer.children) {
          puff.position.z += dt * cloudDriftSpeed;
          if (puff.position.z > -15) puff.position.z = -240;
        }

        avionicsTimer += dt;
        if (avionicsTimer > 0.2) {
          avionicsTimer = 0;
          const bankSim = Math.sin(now * 0.0004) * (activeFlight.onGround ? 0 : 4.5);
          drawPfd(avionics, activeFlight, bankSim, wx);
          drawNd(avionics, activeFlight, s.allFlights);
          drawEicas(avionics, activeFlight);
          drawMcp(avionics, activeFlight);
        }
      }

      // Sync 3D Ground Taxi Traffic on airport apron
      if (s.viewMode === 'taxi') {
        const taxiSlice = (s.groundTraffic.length > 0 ? s.groundTraffic : s.flight ? [s.flight] : []).slice(0, 8);
        const taxiHash = taxiSlice.map((t) => `${t.icao24}-${t.aircraftType}-${t.airlineIcao}`).join('|');
        if (taxiHash !== refs.lastTaxiHash) {
          for (const old of refs.taxiModels ?? []) {
            taxiRoot.remove(old.group);
            old.dispose();
          }
          const created: AircraftModelRefs[] = [];
          const anchorLat = taxiSlice[0]?.lat ?? 40.08;
          const anchorLon = taxiSlice[0]?.lon ?? 116.6;

          taxiSlice.forEach((tf, idx) => {
            const spec = resolveAircraftSpec(tf.aircraftType);
            const liv = resolveAirlineLivery(tf.airlineIcao, tf.callsign);
            const m = buildProceduralAircraft(spec, liv, tf.registration, refs.maxAnisotropy, true);
            const dz = -(tf.lat - anchorLat) * 9000;
            const dx = (tf.lon - anchorLon) * 9000 * Math.cos(THREE.MathUtils.degToRad(anchorLat));
            // Clamp inside visible apron radius while preserving real relative geometry
            const clampedX = idx === 0 ? 0 : THREE.MathUtils.clamp(dx, -65, 65);
            const clampedZ = idx === 0 ? 0 : THREE.MathUtils.clamp(dz, -85, 65);
            m.group.position.set(clampedX, 0.9, clampedZ);
            m.group.rotation.y = THREE.MathUtils.degToRad(-tf.trueTrackDeg);
            taxiRoot.add(m.group);
            created.push(m);
          });
          refs.taxiModels = created;
          refs.lastTaxiHash = taxiHash;
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      cockpitRefs.dispose();
      apron.dispose();
      sceneRefs.current.aircraftRefs?.dispose();
      for (const tm of sceneRefs.current.taxiModels ?? []) tm.dispose();
      avionics.pfdTexture.dispose();
      avionics.ndTexture.dispose();
      avionics.eicasTexture.dispose();
      avionics.mcpTexture.dispose();
      extShadowGeo.dispose();
      extShadowMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const livery = flight ? resolveAirlineLivery(flight.airlineIcao, flight.callsign) : null;

  return (
    <div className="relative w-full h-full min-h-[420px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#0B1526]">
      {/* Dedicated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Top-Left Minimal Telemetry Header Overlay (Solid dark surface, no backdrop-blur over WebGL) */}
      <div className="pointer-events-none absolute top-4 left-4 z-10 flex flex-col gap-1 rounded-lg bg-[#080D16]/90 border border-slate-800 px-3.5 py-2.5 text-xs">
        {flight ? (
          <>
            <div className="flex items-center gap-2 font-mono font-semibold text-slate-100">
              <span className="text-sky-400">{flight.callsign}</span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span>{flight.aircraftType}</span>
              {livery && (
                <>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                  <span className="text-slate-300 font-sans font-medium">{livery.name}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400 tabular-nums">
              <span>{flight.onGround ? 'SURFACE TAXI' : `FL${Math.round(flight.altitudeFt / 100)}`}</span>
              <span aria-hidden="true">/</span>
              <span>{flight.groundSpeedKts} KT</span>
              <span aria-hidden="true">/</span>
              <span>HDG {String(Math.round(flight.trueTrackDeg)).padStart(3, '0')}°</span>
              {flight.origin && flight.destination && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="text-slate-200">{flight.origin} → {flight.destination}</span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="text-slate-300 font-medium">Select an aircraft on the radar to drive 3D EFIS & livery view</div>
        )}
      </div>

      {contextLost && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#080D16]/95 text-slate-200 text-sm">
          WebGL context paused — restoring 3D Flight Deck…
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Zero Viewport Occlusion) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[94vw]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-md bg-[#080D16]/92 border border-slate-700 px-3 py-1 text-[11px] font-medium text-slate-200 hover:text-white transition-colors whitespace-nowrap"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {dockCollapsed ? 'Show Deck Controls' : 'Hide Controls'}
        </button>

        {!dockCollapsed && (
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl bg-[#080D16]/95 border border-slate-800 px-3 py-2">
            {/* 3D Mode Switcher */}
            <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => onViewModeChange('cockpit')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'cockpit' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                Cockpit 3D
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('exterior')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'exterior' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plane className="w-3.5 h-3.5" />
                Livery 3D
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('taxi')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'taxi' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                Ground Taxi 3D
              </button>
            </div>

            {/* Cockpit Camera Presets */}
            {viewMode === 'cockpit' && (
              <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
                <Eye className="w-3.5 h-3.5 text-slate-400 mr-1" />
                {(Object.keys(CAMERA_PRESETS) as CockpitCameraPreset[]).map((presetKey) => (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => setCockpitPreset(presetKey)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      cockpitPreset === presetKey
                        ? 'bg-slate-800 text-sky-400 border border-sky-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {CAMERA_PRESETS[presetKey].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
