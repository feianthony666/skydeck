import * as THREE from 'three';
import type {AirlineLivery} from '../data/aviationCatalog';
import type {AirportWeather, LiveFlight} from '../types/aviation';

export interface AvionicsTextureBundle {
  pfdCanvas: HTMLCanvasElement;
  pfdTexture: THREE.CanvasTexture;
  ndCanvas: HTMLCanvasElement;
  ndTexture: THREE.CanvasTexture;
  eicasCanvas: HTMLCanvasElement;
  eicasTexture: THREE.CanvasTexture;
  mcpCanvas: HTMLCanvasElement;
  mcpTexture: THREE.CanvasTexture;
}

export function createAvionicsTextures(maxAnisotropy: number): AvionicsTextureBundle {
  const mk = (w: number, h: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    return {canvas, texture};
  };

  const pfd = mk(512, 512);
  const nd = mk(512, 512);
  const eicas = mk(512, 512);
  const mcp = mk(512, 128);

  return {
    pfdCanvas: pfd.canvas,
    pfdTexture: pfd.texture,
    ndCanvas: nd.canvas,
    ndTexture: nd.texture,
    eicasCanvas: eicas.canvas,
    eicasTexture: eicas.texture,
    mcpCanvas: mcp.canvas,
    mcpTexture: mcp.texture,
  };
}

export function drawPfd(
  bundle: AvionicsTextureBundle,
  flight: LiveFlight,
  bankDeg: number,
  weather?: AirportWeather,
) {
  const ctx = bundle.pfdCanvas.getContext('2d');
  if (!ctx) return;
  const W = 512;
  const H = 512;
  ctx.fillStyle = '#05080F';
  ctx.fillRect(0, 0, W, H);

  // FMA Top Bar
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(16, 12, W - 32, 42);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 12, W - 32, 42);

  ctx.font = 'bold 18px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#22C55E';
  ctx.fillText(flight.onGround ? 'TAXI' : 'THR REF', 98, 39);
  ctx.fillText(flight.onGround ? 'HDG' : 'LNAV', 256, 39);
  ctx.fillText(flight.onGround ? 'ALT' : 'VNAV PTH', 414, 39);

  // Artificial Horizon Clip Region
  const cx = 248;
  const cy = 245;
  const hw = 220;
  const hh = 220;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cx - hw / 2, cy - hh / 2, hw, hh, 16);
  ctx.clip();

  const pitchDeg = THREE.MathUtils.clamp(flight.verticalRateFpm / 220, -14, 14);
  const pitchPx = pitchDeg * 4.5;
  const rollRad = THREE.MathUtils.degToRad(-bankDeg);

  ctx.translate(cx, cy);
  ctx.rotate(rollRad);

  // Sky & Ground
  ctx.fillStyle = '#0284C7';
  ctx.fillRect(-300, -300 + pitchPx, 600, 300);
  ctx.fillStyle = '#78350F';
  ctx.fillRect(-300, pitchPx, 600, 300);

  // Horizon line
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-250, pitchPx);
  ctx.lineTo(250, pitchPx);
  ctx.stroke();

  // Pitch ladder
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '12px "JetBrains Mono", monospace';
  for (let p = -15; p <= 15; p += 5) {
    if (p === 0) continue;
    const py = pitchPx - p * 4.5;
    const half = p % 10 === 0 ? 34 : 18;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-half, py);
    ctx.lineTo(half, py);
    ctx.stroke();
    if (p % 10 === 0) {
      ctx.fillText(String(Math.abs(p)), -half - 16, py + 4);
      ctx.fillText(String(Math.abs(p)), half + 16, py + 4);
    }
  }
  ctx.restore();

  // Fixed Aircraft Reference Symbol
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - 42, cy);
  ctx.lineTo(cx - 14, cy);
  ctx.lineTo(cx - 14, cy + 10);
  ctx.moveTo(cx + 42, cy);
  ctx.lineTo(cx + 14, cy);
  ctx.lineTo(cx + 14, cy + 10);
  ctx.stroke();
  ctx.fillStyle = '#FACC15';
  ctx.fillRect(cx - 4, cy - 4, 8, 8);

  // Airspeed Tape (Left)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(16, 110, 88, 270);
  ctx.strokeStyle = '#475569';
  ctx.strokeRect(16, 110, 88, 270);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = 'bold 24px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(flight.groundSpeedKts)}`, 94, 253);
  ctx.font = '13px "JetBrains Mono", monospace';
  ctx.fillStyle = '#38BDF8';
  ctx.fillText('GS KT', 94, 130);

  // Altitude Tape (Right)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(386, 110, 110, 270);
  ctx.strokeStyle = '#475569';
  ctx.strokeRect(386, 110, 110, 270);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = 'bold 21px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${flight.altitudeFt.toLocaleString()}`, 488, 253);
  ctx.font = '13px "JetBrains Mono", monospace';
  ctx.fillStyle = '#22C55E';
  ctx.fillText(`${flight.verticalRateFpm >= 0 ? '+' : ''}${flight.verticalRateFpm} FPM`, 488, 132);
  ctx.fillStyle = '#38BDF8';
  ctx.fillText(weather?.altimeterHpa ? `QNH ${Math.round(weather.altimeterHpa)}` : 'STD 1013', 488, 370);

  // Heading Compass Tape (Bottom)
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(128, 412, 240, 68);
  ctx.strokeStyle = '#475569';
  ctx.strokeRect(128, 412, 240, 68);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 26px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${String(Math.round(flight.trueTrackDeg)).padStart(3, '0')}°`, 248, 456);
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillStyle = '#D946EF';
  ctx.fillText(`${flight.callsign} · ${flight.aircraftType}`, 248, 496);

  bundle.pfdTexture.needsUpdate = true;
}

export function drawNd(
  bundle: AvionicsTextureBundle,
  flight: LiveFlight,
  nearbyFlights: LiveFlight[],
) {
  const ctx = bundle.ndCanvas.getContext('2d');
  if (!ctx) return;
  const W = 512;
  const H = 512;
  ctx.fillStyle = '#04070D';
  ctx.fillRect(0, 0, W, H);

  const cx = 256;
  const cy = 310;
  const radius = 210;

  // Top telemetry header
  ctx.fillStyle = '#22C55E';
  ctx.font = 'bold 18px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`GS ${flight.groundSpeedKts} KT`, 22, 34);
  ctx.fillStyle = '#D946EF';
  ctx.textAlign = 'right';
  ctx.fillText(flight.origin && flight.destination ? `${flight.origin} → ${flight.destination}` : flight.callsign, W - 22, 34);

  // Range rings
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
  ctx.lineWidth = 1.5;
  for (const frac of [0.35, 0.68, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }

  // Compass rose ticks rotated by trueTrackDeg
  ctx.save();
  ctx.translate(cx, cy);
  const trkRad = THREE.MathUtils.degToRad(-flight.trueTrackDeg);
  for (let deg = 0; deg < 360; deg += 15) {
    const a = THREE.MathUtils.degToRad(deg) + trkRad - Math.PI / 2;
    const x1 = Math.cos(a) * (radius - 10);
    const y1 = Math.sin(a) * (radius - 10);
    const x2 = Math.cos(a) * radius;
    const y2 = Math.sin(a) * radius;
    if (y2 < 45) {
      ctx.strokeStyle = '#94A3B8';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (deg % 30 === 0) {
        ctx.fillStyle = '#CBD5E1';
        ctx.font = '14px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(deg / 10).padStart(2, '0'), Math.cos(a) * (radius - 26), Math.sin(a) * (radius - 26) + 5);
      }
    }
  }

  // Active route leg line (magenta)
  ctx.strokeStyle = '#D946EF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -radius * 0.85);
  ctx.stroke();

  // Plot nearby TCAS traffic relative to ownship
  for (const other of nearbyFlights.slice(0, 20)) {
    if (other.id === flight.id) continue;
    const dLat = (other.lat - flight.lat) * 60;
    const dLon = (other.lon - flight.lon) * 60 * Math.cos(THREE.MathUtils.degToRad(flight.lat));
    // Map +/- 60 nm into radius
    const scale = radius / 60;
    const wx = dLon * scale;
    const wy = -dLat * scale;
    // Rotate into heading-up coordinates
    const rx = wx * Math.cos(trkRad) - wy * Math.sin(trkRad);
    const ry = wx * Math.sin(trkRad) + wy * Math.cos(trkRad);
    if (Math.hypot(rx, ry) < radius - 14 && ry < 40) {
      const altDiff = Math.round((other.altitudeFt - flight.altitudeFt) / 100);
      ctx.strokeStyle = Math.abs(altDiff) < 20 ? '#F59E0B' : '#38BDF8';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx - 5, ry - 5, 10, 10);
      ctx.fillStyle = Math.abs(altDiff) < 20 ? '#F59E0B' : '#38BDF8';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${altDiff >= 0 ? '+' : ''}${altDiff}`, rx + 8, ry + 4);
    }
  }
  ctx.restore();

  // Ownship triangle
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx - 10, cy + 10);
  ctx.lineTo(cx + 10, cy + 10);
  ctx.closePath();
  ctx.stroke();

  // Mode & Source footer
  ctx.fillStyle = flight.isEstimated ? '#F59E0B' : '#38BDF8';
  ctx.font = 'bold 15px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(flight.isEstimated ? `DR-EST ±${flight.uncertaintyNm} NM` : `SRC ${flight.source.toUpperCase()}`, 22, H - 22);

  bundle.ndTexture.needsUpdate = true;
}

export function drawEicas(bundle: AvionicsTextureBundle, flight: LiveFlight) {
  const ctx = bundle.eicasCanvas.getContext('2d');
  if (!ctx) return;
  const W = 512;
  const H = 512;
  ctx.fillStyle = '#05080F';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#38BDF8';
  ctx.font = 'bold 20px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('EICAS / SYSTEMS', 24, 38);
  ctx.fillStyle = '#94A3B8';
  ctx.textAlign = 'right';
  ctx.fillText(flight.registration || flight.icao24, W - 24, 38);

  const n1Pct = flight.onGround ? (flight.groundSpeedKts > 5 ? 34.2 : 21.8) : THREE.MathUtils.clamp(68 + flight.groundSpeedKts / 22, 72, 94.5);
  const egt = flight.onGround ? 415 : Math.round(585 + n1Pct * 1.4);

  const drawGauge = (cx: number, cy: number, label: string, val: string, pct: number, color: string) => {
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, 62, Math.PI * 0.75, Math.PI * 2.15);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, 62, Math.PI * 0.75, Math.PI * (0.75 + 1.4 * Math.min(1, pct / 100)));
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(val, cx, cy + 8);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText(label, cx, cy + 36);
  };

  drawGauge(138, 155, 'N1 ENG 1', `${n1Pct.toFixed(1)}%`, n1Pct, '#22C55E');
  drawGauge(374, 155, 'N1 ENG 2', `${(n1Pct - 0.3).toFixed(1)}%`, n1Pct - 0.3, '#22C55E');

  // Gear & Flaps Matrix
  const gearDown = flight.onGround || flight.altitudeFt < 2600;
  const flaps = flight.onGround ? 'FLAPS 1+F' : flight.altitudeFt < 5000 ? 'FLAPS 1' : 'FLAPS UP';

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(24, 270, W - 48, 210);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 270, W - 48, 210);

  ctx.font = 'bold 18px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#CBD5E1';
  ctx.fillText(`EGT: ${egt}°C / ${egt - 4}°C`, 44, 312);
  ctx.fillText(`SQUAWK: ${flight.squawk || '2000'}`, 44, 350);
  ctx.fillStyle = gearDown ? '#22C55E' : '#38BDF8';
  ctx.fillText(`GEAR: ${gearDown ? 'DOWN (3 GREEN)' : 'UP & LOCKED'}`, 44, 390);
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(`CONFIG: ${flaps}`, 44, 430);
  ctx.fillStyle = flight.isEstimated ? '#F59E0B' : '#22C55E';
  ctx.fillText(`DATALINK: ${flight.isEstimated ? 'DEAD-RECKON EST' : 'LIVE ADS-B LOCK'}`, 44, 464);

  bundle.eicasTexture.needsUpdate = true;
}

export function drawMcp(bundle: AvionicsTextureBundle, flight: LiveFlight) {
  const ctx = bundle.mcpCanvas.getContext('2d');
  if (!ctx) return;
  const W = 512;
  const H = 128;
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  const fields = [
    {label: 'IAS/MACH', val: String(Math.round(flight.groundSpeedKts)).padStart(3, '0')},
    {label: 'HDG/TRK', val: String(Math.round(flight.trueTrackDeg)).padStart(3, '0')},
    {label: 'ALTITUDE', val: String(Math.round(flight.altitudeFt / 100) * 100).padStart(5, '0')},
    {label: 'VERT SPD', val: `${flight.verticalRateFpm >= 0 ? '+' : ''}${flight.verticalRateFpm}`},
  ];

  fields.forEach((f, idx) => {
    const x = 18 + idx * 124;
    ctx.fillStyle = '#030712';
    ctx.fillRect(x, 36, 112, 64);
    ctx.strokeStyle = '#1F2937';
    ctx.strokeRect(x, 36, 112, 64);
    ctx.fillStyle = '#9CA3AF';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(f.label, x + 56, 24);
    ctx.fillStyle = '#F59E0B';
    ctx.font = 'bold 24px "JetBrains Mono", monospace';
    ctx.fillText(f.val, x + 56, 76);
  });

  bundle.mcpTexture.needsUpdate = true;
}

export function createAirlineLiveryTexture(
  livery: AirlineLivery,
  registration: string,
  maxAnisotropy: number,
  photoUrl?: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Upper fuselage + belly split
  ctx.fillStyle = livery.fuselageHex;
  ctx.fillRect(0, 0, 512, 164);
  ctx.fillStyle = livery.bellyHex;
  ctx.fillRect(0, 164, 512, 92);

  // Accent cheatline
  ctx.fillStyle = livery.accentHex;
  ctx.fillRect(0, 154, 512, 10);

  if (livery.icao === 'UAE') {
    ctx.fillStyle = '#16A34A';
    ctx.fillRect(0, 146, 512, 5);
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(0, 151, 512, 3);
  } else if (livery.icao === 'KLM') {
    ctx.fillStyle = '#0284C7';
    ctx.fillRect(0, 150, 512, 14);
  } else if (livery.icao === 'QFA') {
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(0, 150, 512, 6);
  } else if (livery.icao === 'THA') {
    ctx.fillStyle = '#7E22CE';
    ctx.fillRect(0, 148, 512, 8);
  } else if (livery.icao === 'TGW') {
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(0, 150, 512, 7);
  }

  // Cabin passenger windows
  ctx.fillStyle = '#0F172A';
  for (let x = 58; x < 458; x += 15) {
    ctx.beginPath();
    ctx.roundRect(x, 96, 8, 12, 3);
    ctx.fill();
  }

  // Airline title & registration
  ctx.fillStyle = livery.titleColor;
  ctx.font = 'bold 26px "Outfit", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(livery.name.toUpperCase(), 62, 74);

  if (registration) {
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(registration, 456, 140);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;

  if (photoUrl) {
    const photo = new Image();
    photo.crossOrigin = 'anonymous';
    photo.referrerPolicy = 'no-referrer';
    photo.onload = () => {
      try {
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        tex.needsUpdate = true;
      } catch {
        // Keep the accurate airline-color fallback if the image host blocks canvas access.
      }
    };
    photo.src = photoUrl;
  }
  return tex;
}
