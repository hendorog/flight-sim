// Compact projection of the same spherical float for the fixed panel. No independent dynamics.
import { DEG, wrapPi } from '../../core/math';
import type { AircraftId } from '../../core/types';
import { compassCorrectionCard, type CompassReading } from '../dynamics/magneticCompass';
import type { Rect } from '../panelDef';

export function drawMagneticCompass(g: CanvasRenderingContext2D, r: CompassReading, bounds: Rect, aircraft: AircraftId): void {
  g.save(); g.translate(bounds.x, bounds.y); g.scale(bounds.w / 176, bounds.h / 164);
  g.fillStyle = '#18201f'; g.fillRect(0, 0, 176, 164);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e1ddcb'; g.font = 'bold 10px sans-serif'; g.fillText('MAGNETIC COMPASS', 88, 10);
  g.save(); g.translate(88, 66);
  const bowl = g.createRadialGradient(-15, -20, 2, 0, 0, 52);
  bowl.addColorStop(0, '#476356'); bowl.addColorStop(0.60, '#18372e'); bowl.addColorStop(1, '#040907');
  g.beginPath(); g.arc(0, 0, 49, 0, Math.PI * 2); g.fillStyle = bowl; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#59635d'; g.stroke();
  g.beginPath(); g.arc(0, 0, 45, 0, Math.PI * 2); g.clip();
  const project = (azimuth: number, latitude: number): [number, number, number] => {
    const x = Math.sin(azimuth) * Math.cos(latitude), y = Math.sin(latitude), z = Math.cos(azimuth) * Math.cos(latitude);
    const py = Math.cos(r.pitch) * y - Math.sin(r.pitch) * z;
    const pz = Math.sin(r.pitch) * y + Math.cos(r.pitch) * z;
    const px = Math.cos(r.roll) * x + Math.sin(r.roll) * py;
    const yy = -Math.sin(r.roll) * x + Math.cos(r.roll) * py;
    const scale = 46 * 4 / (4 - pz);
    return [px * scale, -yy * scale, pz];
  };
  g.fillStyle = g.strokeStyle = '#fff1c4';
  for (let h = 0; h < 360; h += 5) {
    const angle = wrapPi(r.heading - h * DEG);
    const major = h % 30 === 0;
    const a = project(angle, 14 * DEG), b = project(angle, (major ? 4 : 9) * DEG);
    if (a[2] < 0.20 || b[2] < 0.20) continue;
    g.lineWidth = major ? 1.7 : 0.9;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    if (major) {
      const p = project(angle, -8 * DEG);
      g.save(); g.translate(p[0], p[1]); g.rotate(r.roll); g.scale(Math.max(0.25, Math.cos(angle)), 1);
      g.font = 'bold 17px Arial, sans-serif';
      g.fillText(({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[h] ?? String(h / 10), 0, 0); g.restore();
    }
  }
  g.strokeStyle = '#ffcb77'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -28); g.lineTo(0, 26); g.stroke();
  g.strokeStyle = '#e5f5e52e'; g.lineWidth = 3; g.beginPath(); g.arc(-3, -2, 39, -2.6, -1.0); g.stroke();
  g.restore();
  g.fillStyle = '#dcd7bd'; g.fillRect(3, 121, 170, 40); g.fillStyle = '#19271f'; g.font = 'bold 7px monospace';
  const entries = compassCorrectionCard(aircraft);
  for (let half = 0; half < 2; half++) {
    const y = 127 + half * 18;
    g.fillText('FOR', 17, y); g.fillText('STEER', 17, y + 8);
    entries.slice(half * 6, half * 6 + 6).forEach((e, i) => {
      g.fillText(String(e.for).padStart(3, '0'), 45 + i * 23, y);
      g.fillText(String(e.steer).padStart(3, '0'), 45 + i * 23, y + 8);
    });
  }
  g.restore();
}
