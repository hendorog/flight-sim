// A wet compass with a genuinely spherical rotating float behind a curved glass window.
import * as THREE from 'three';
import type { AircraftId } from '../../core/types';
import { compassCorrectionCard, type CompassReading } from '../../instruments/dynamics/magneticCompass';
import type { FRD } from './airframe/types';
import { frd } from './geometry';

export function compassLabel(degrees: number): string {
  return ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[degrees] ?? String(degrees / 10);
}

export class BallCompass {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly float = new THREE.Group();
  private readonly card: THREE.Mesh;
  private readonly cardMaterial: THREE.MeshStandardMaterial;
  private readonly lubberMaterial: THREE.MeshStandardMaterial;

  constructor(pos: FRD, aircraft: AircraftId, mount: 'header' | 'glareshield' = 'header') {
    this.group.name = 'magneticCompass'; this.group.position.copy(frd(...pos));
    const material = (opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial(opts); this.materials.push(m); return m;
    };
    const shell = material({ name: 'compassHousing', color: 0x242c28, roughness: 0.64, metalness: 0.2, side: THREE.DoubleSide });
    const metal = material({ color: 0x737870, roughness: 0.38, metalness: 0.8 });
    const black = material({ color: 0x050807, roughness: 0.85 });
    const add = (geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z); this.group.add(m); return m;
    };
    // Bowl behind an open circular aperture, its axis facing aft (+Z) toward the pilot.
    const bowl = new THREE.SphereGeometry(0.046, 64, 32, 0, Math.PI * 2, 0.98, Math.PI - 0.98);
    bowl.rotateX(Math.PI / 2);
    add(bowl, shell);
    add(new THREE.TorusGeometry(0.0405, 0.0048, 12, 80), shell, 0, 0, 0.026);
    add(new THREE.TorusGeometry(0.0378, 0.001, 8, 80), metal, 0, 0, 0.029);
    const up = mount === 'header' ? 1 : -1;
    add(new THREE.BoxGeometry(0.022, 0.044, 0.015), shell, 0, up * 0.059, -0.023);
    add(new THREE.BoxGeometry(0.060, 0.006, 0.042), shell, 0, up * 0.080, -0.018);

    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#10221e'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = g.strokeStyle = '#fff2c9'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 76px Arial, sans-serif';
    for (let h = 0; h < 360; h += 5) {
      // SphereGeometry front (+Z) has u=1/4. Positive Y rotation exposes decreasing u.
      const x = ((0.25 - h / 360 + 1) % 1) * canvas.width;
      const major = h % 30 === 0;
      for (const dx of [-canvas.width, 0, canvas.width]) {
        g.lineWidth = major ? 5 : 3;
        g.beginPath(); g.moveTo(x + dx, 432); g.lineTo(x + dx, major ? 490 : 462); g.stroke();
        if (major) g.fillText(compassLabel(h), x + dx, 554);
      }
    }
    const texture = this.texture(canvas);
    this.cardMaterial = material({ name: 'compassCard', map: texture, roughness: 0.48, metalness: 0.05,
      emissiveMap: texture, emissive: 0xffdf9e, emissiveIntensity: 0 });
    this.card = new THREE.Mesh(new THREE.SphereGeometry(0.036, 96, 48), this.cardMaterial);
    this.card.name = 'compassBall'; this.float.name = 'compassFloat'; this.float.add(this.card); this.group.add(this.float);
    this.lubberMaterial = material({ color: 0xffe2aa, emissive: 0xffb75e, roughness: 0.5, emissiveIntensity: 0 });
    add(new THREE.BoxGeometry(0.00065, 0.045, 0.0006), this.lubberMaterial, 0, 0.001, 0.039);
    // Slight amber/green liquid tint, convex glass highlight. Low opacity preserves small graduations.
    const glass = new THREE.MeshPhysicalMaterial({ name: 'compassGlass', color: 0xc0dacd, roughness: 0.09,
      metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, clearcoat: 1,
      clearcoatRoughness: 0.08, envMapIntensity: 0.45, side: THREE.FrontSide });
    this.materials.push(glass);
    const lens = new THREE.SphereGeometry(0.052, 64, 24, 0, Math.PI * 2, 0, 0.81);
    lens.rotateX(Math.PI / 2);
    add(lens, glass, 0, 0, -0.009).name = 'compassGlass';
    // N/S and E/W compensators below the window, each with a recessed screwdriver slot.
    add(new THREE.BoxGeometry(0.060, 0.010, 0.018), shell, 0, -0.043, 0.015);
    for (const x of [-0.020, 0.020]) {
      add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0018, 20).rotateX(Math.PI / 2), metal, x, -0.043, 0.025);
      add(new THREE.BoxGeometry(0.0045, 0.00065, 0.0002), black, x, -0.043, 0.026);
    }
    const placard = document.createElement('canvas'); placard.width = 1200; placard.height = 300;
    const p = placard.getContext('2d')!;
    p.fillStyle = '#ece5cc'; p.fillRect(0, 0, 1200, 300); p.fillStyle = '#182522';
    p.font = 'bold 35px monospace'; p.textAlign = 'center'; p.textBaseline = 'middle';
    const entries = compassCorrectionCard(aircraft);
    for (let half = 0; half < 2; half++) {
      const y = half * 145;
      p.fillText('FOR', 76, y + 44); p.fillText('STEER', 76, y + 104);
      entries.slice(half * 6, half * 6 + 6).forEach((entry, i) => {
        p.fillText(String(entry.for).padStart(3, '0'), 242 + i * 170, y + 44);
        p.fillText(String(entry.steer).padStart(3, '0'), 242 + i * 170, y + 104);
      });
    }
    const placardMat = material({ name: 'compassDeviationCard', map: this.texture(placard), roughness: 0.85 });
    add(new THREE.BoxGeometry(0.103, 0.029, 0.003), shell, 0, -0.068, 0.010);
    add(new THREE.PlaneGeometry(0.098, 0.0245), placardMat, 0, -0.068, 0.012).name = 'compassDeviationCard';
  }

  private texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8; this.textures.push(texture); return texture;
  }
  update(reading: CompassReading, backlight = 0): void {
    // Body FRD -> model: pitch about +X, roll about -Z. Tilt the parent before rotating the ball.
    this.float.rotation.set(reading.pitch, 0, -reading.roll, 'ZXY');
    this.card.rotation.y = reading.heading;
    this.cardMaterial.emissiveIntensity = backlight;
    this.lubberMaterial.emissiveIntensity = backlight;
  }
  dispose(): void { this.textures.forEach(t => t.dispose()); this.materials.forEach(m => m.dispose()); }
}
