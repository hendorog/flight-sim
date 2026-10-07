// Windsocks (FAA L-807 size 2: 12 ft long, 36 in throat, five alternating orange/white bands) and the
// segmented circle with landing-strip and traffic-pattern indicators.
//
// The sock is a chain of five frustum segments. A sock is built so that 3 kt of wind lifts one band: each
// segment's angle below the horizontal eases from hanging (about 75 degrees) to straight as the wind passes
// 3, 6, 9, 12, 15 kt. Wind comes from ctx.env.wind at the sock (so gusts and turbulence show), low-pass
// filtered for the sock's inertia, with a small travelling flutter.

import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import { KT, smoothstep } from '../../core/math';
import { AIRPORT } from '../../core/world';
import { BatchSet, boxGeo, cylGeo, placement } from './geom';
import { localToNed, SEGMENTED_CIRCLE, WINDSOCKS } from './layout';
import { LIGHT_COLORS, localToWorld, type LightSpec } from './lights';
import type { MaterialKey } from './materials';

const SOCK_LENGTH = 12 * 0.3048;
const THROAT_R = 18 * 0.0254;
const TAIL_R = 0.45 * THROAT_R;
const BANDS = 5;
const HANG = 1.3; // rad below horizontal when there is no wind
const FILTER_TAU = 1.2; // s

interface Sock {
  pos: { x: number; y: number; z: number };
  head: THREE.Object3D;
  segments: THREE.Object3D[];
  wind: THREE.Vector2; // filtered horizontal wind, NED north/east, m/s
  phase: number;
}

export class Windsocks {
  readonly group = new THREE.Group();
  readonly lights: LightSpec[] = [];
  private readonly socks: Sock[] = [];
  private readonly fabric: THREE.MeshStandardMaterial[];
  private readonly poleMaterial = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.45, metalness: 0.6 });
  private readonly tmp = new THREE.Vector2();

  constructor() {
    this.group.name = 'windsocks';
    this.fabric = [0xff4d0a, 0xf2f2ee].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0 }),
    );
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.08, 1, 8).translate(0, 0.5, 0);
    const ringGeo = new THREE.TorusGeometry(THROAT_R, 0.02, 6, 20);
    WINDSOCKS.forEach((w, i) => {
      const height = w.main ? 6.1 : 4.6;
      const n = localToNed(w.u, w.v);
      const base = localToWorld(w.u, w.v, 0);
      const pole = new THREE.Mesh(poleGeo, this.poleMaterial);
      pole.position.copy(base);
      pole.scale.set(1, height, 1);
      pole.castShadow = true;
      this.group.add(pole);

      const head = new THREE.Object3D();
      head.position.set(base.x, base.y + height, base.z);
      this.group.add(head);
      // Throat hoop, offset from the pivot so the sock clears the pole.
      const ring = new THREE.Mesh(ringGeo, this.poleMaterial);
      ring.position.z = -0.25;
      head.add(ring);
      const segLen = SOCK_LENGTH / BANDS;
      const segments: THREE.Object3D[] = [];
      let parent: THREE.Object3D = head;
      for (let k = 0; k < BANDS; k++) {
        const r0 = THROAT_R + ((TAIL_R - THROAT_R) * k) / BANDS;
        const r1 = THROAT_R + ((TAIL_R - THROAT_R) * (k + 1)) / BANDS;
        const joint = new THREE.Object3D();
        joint.position.z = k === 0 ? -0.25 : -segLen;
        const g = new THREE.CylinderGeometry(r1, r0, segLen, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -segLen / 2);
        const mesh = new THREE.Mesh(g, this.fabric[k % 2]);
        mesh.castShadow = true;
        joint.add(mesh);
        parent.add(joint);
        segments.push(joint);
        parent = joint;
      }
      this.socks.push({ pos: { x: n.north, y: n.east, z: -(AIRPORT.elevation + height) }, head, segments, wind: new THREE.Vector2(), phase: i * 1.7 });
      // Lit windsock: floodlamps at the head (night only) and a red obstruction light on the main pole.
      this.lights.push({ position: localToWorld(w.u, w.v, height + 0.35), colorA: LIGHT_COLORS.flood, lens: 0.15, cd: 60, cdDay: 0 });
      if (w.main) this.lights.push({ position: localToWorld(w.u, w.v, height + 0.6), colorA: LIGHT_COLORS.red, lens: 0.15, cd: 32.5, cdDay: 32.5 });
    });
  }

  update(dt: number, ctx: SimContext, night: number): void {
    const a = dt > 0 ? 1 - Math.exp(-dt / FILTER_TAU) : 0;
    for (const f of this.fabric) f.emissiveIntensity = 0.5 * night; // floodlit fabric, ~5 cd/m^2
    for (const s of this.socks) {
      const w = ctx.env.wind(s.pos, ctx.simTime);
      if (s.wind.lengthSq() === 0) s.wind.set(w.x, w.y);
      else s.wind.lerp(this.tmp.set(w.x, w.y), a);
      const speedKt = s.wind.length() / KT;
      // Sock points downwind: heading of the air velocity. three rotation.y = -heading puts -z on it.
      if (speedKt > 0.3) s.head.rotation.y = -Math.atan2(s.wind.y, s.wind.x);
      const t = ctx.simTime;
      const flutter = Math.min(speedKt / 15, 1.2) * 0.06;
      let prev = 0;
      s.segments.forEach((seg, k) => {
        const extended = smoothstep(3 * k - 1, 3 * (k + 1) + 1, speedKt);
        const droop = HANG * (1 - extended);
        const wave = Math.sin(t * (4 + speedKt * 0.6) - k * 1.1 + s.phase);
        seg.rotation.x = -(droop - prev) + flutter * wave * (0.3 + 0.2 * k);
        seg.rotation.y = flutter * 0.7 * Math.sin(t * (3 + speedKt * 0.5) - k * 0.9 + s.phase * 2);
        prev = droop;
      });
    }
  }

  dispose(): void {
    for (const f of this.fabric) f.dispose();
    this.poleMaterial.dispose();
  }
}

/** Segmented circle (100 ft diameter) around the main windsock, with landing strip and left-traffic indicators. */
export function buildSegmentedCircle(b: BatchSet<MaterialKey>): void {
  const { u, v, radius } = SEGMENTED_CIRCLE;
  const segs = 16;
  const color = 0xd8d8d0;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const len = ((2 * Math.PI * radius) / segs) * 0.62;
    b.get('paint').add(boxGeo(1.0, 0.15, len), placement(v + Math.sin(a) * radius, 0.075, -(u + Math.cos(a) * radius), Math.PI / 2 - a), color);
  }
  // Landing strip indicators along the runway axis, and traffic pattern indicators (base-leg side = left).
  for (const end of [-1, 1]) {
    const inner = radius + 3, outer = radius + 3 + 9;
    const cu = u + end * (inner + outer) / 2;
    b.get('paint').add(boxGeo(1.0, 0.15, outer - inner), placement(v, 0.075, -cu), color);
    // Landing on 07 (from the -u end) with left traffic: base leg on the -v side, and vice versa.
    const side = end < 0 ? -1 : 1;
    b.get('paint').add(boxGeo(6, 0.15, 1.0), placement(v + side * 3.5, 0.075, -(u + end * outer)), color);
  }
}
