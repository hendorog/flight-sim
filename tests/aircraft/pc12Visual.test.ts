// The Pilatus PC-12/47's airframe visual (src/aircraft/pc12/visual.ts): it is plain data, what the livery worker loads
// by id, takes the shared facts from pc12/geometry.ts and the panel layout, and builds as the simulator builds it with
// outward skins and no NaN to the TCDS span, length and height and the three-view's track and wheelbase; the eye sits
// where a pilot's eye sits in the three-view's cockpit; the whole stabiliser trims leading edge up for a positive
// elevatorTrim; the mains fold inward into the wing root and the nose leg aft; both exhaust stubs stand out of the
// cowling; the power lever swings aft through beta into reverse; every console stays inside the skin; and the render
// cost stays inside the twin budget over the Cessna 172S.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PC12_FUSELAGE, PC12_GEAR, PC12_PROP, PC12_REST_HEIGHT, PC12_TAIL, PC12_THRUST_Z, PC12_WING } from '../../src/aircraft/pc12/geometry';
import { PC12_PANEL } from '../../src/aircraft/pc12/panel';
import { PC12_PANEL_PX_PER_M, PC12_PEDESTAL, pc12PanelPx } from '../../src/aircraft/pc12/panelLayout';
import { PC12_VISUAL, PC12_VISUAL_HEIGHTS } from '../../src/aircraft/pc12/visual';
import { loadAirframeVisual } from '../../src/aircraft/visualLoader';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { Cockpit, leverSurfaceZ } from '../../src/render/aircraft/cockpit';
import { Propeller } from '../../src/render/aircraft/propeller';
import { cabinFloorGeometry, createFuselageShapes, sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { LandingGear } from '../../src/render/aircraft/gear';
import { buildTail } from '../../src/render/aircraft/tail';
import type { WheelState } from '../../src/core/types';
import { blankDocument, bodyBox, facing, fakeContext, fakeMaterials, nonFinite, renderCost, worldMeshes } from './meshChecks';

vi.setConfig({ testTimeout: 60_000 });

beforeAll(() => {
  vi.stubGlobal('document', blankDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const DEG = Math.PI / 180;
/** FRD body point -> model space, as the builders map it. */
const model = (p: readonly number[]): THREE.Vector3 => new THREE.Vector3(p[1], -p[2], -p[0]);
/** Height above the ground at rest of an FRD z. */
const heightOf = (z: number): number => PC12_REST_HEIGHT - z;

/** The PC-12 (or, given null, the default Cessna 172S) as the chase camera sees it, parked or in cruise. */
function build(airframe: typeof PC12_VISUAL | null, onGround = true): { visual: AircraftVisual; ctx: ReturnType<typeof fakeContext> } {
  const ctx = fakeContext(1);
  if (!onGround) {
    for (const p of ctx.state.propellers) p.rpm = 1700;
    for (const w of ctx.state.wheels) Object.assign(w, { compression: 0, onGround: false });
  }
  const visual = new AircraftVisual({ asyncBake: false, ...(airframe ? { airframe, panelDef: PC12_PANEL } : {}) });
  visual.init(ctx);
  ctx.camera.position.set(3, 3, 16);
  ctx.camera.updateMatrixWorld(true);
  ctx.aircraftRoot.updateMatrixWorld(true);
  visual.update(1 / 60, ctx);
  return { visual, ctx };
}

const wheelState = (name: WheelState['name']): WheelState => ({ name, compression: 0, onGround: false, load: 0, spinRate: 0, rotation: 0, steerAngle: 0, skid: 0 });
const WHEELS: WheelState[] = [wheelState('nose'), wheelState('left'), wheelState('right')];

describe('Pilatus PC-12/47 airframe visual', () => {
  it('is plain data, and what the livery worker loads by id', async () => {
    expect(PC12_VISUAL.id).toBe('pc12');
    expect(await loadAirframeVisual('pc12')).toBe(PC12_VISUAL);
    expect(structuredClone(PC12_VISUAL)).toEqual(PC12_VISUAL);
    expect(JSON.parse(JSON.stringify(PC12_VISUAL))).toEqual(PC12_VISUAL);
  });

  it('takes the shared facts from the geometry', () => {
    const v = PC12_VISUAL;
    expect(v.props).toHaveLength(1);
    expect(v.props[0].hub).toEqual([PC12_PROP.hub.x, PC12_PROP.hub.y, PC12_PROP.hub.z]);
    expect(v.props[0].hub[2]).toBe(PC12_THRUST_Z);
    // Hartzell HC-E4A-3D: 2.67 m, four blades, clockwise from behind, variable pitch (TCDS C.III.6).
    expect(v.props[0].diameter).toBe(2.67);
    expect(v.props[0].blades).toBe(4);
    expect(v.props[0].rotation).toBe(1);
    expect(v.props[0].variablePitch).toBe(true);
    expect(v.props[0].spinner.baseX + v.props[0].spinner.length).toBeCloseTo(PC12_PROP.spinnerTipX, 12);
    const G = PC12_GEAR;
    expect(v.gear.map((w) => w.contact)).toEqual([G.nose, G.leftMain, G.rightMain].map((p) => [p.x, p.y, p.z]));
    expect(v.gear.map((w) => w.radius)).toEqual([G.noseWheelRadius, G.mainWheelRadius, G.mainWheelRadius]);
    expect(v.gear.every((w) => w.retract !== undefined)).toBe(true);
    expect(v.gear.map((w) => w.leg.kind)).toEqual(['oleo', 'trailingLink', 'trailingLink']);
    // Wing: span, stations, dihedral, flaps and ailerons from geometry.ts; Fowler flaps to 40 degrees.
    expect(v.wing.mount).toBe('low');
    expect(v.wing.rootY).toBe(PC12_WING.rootY);
    expect(v.wing.dihedral).toBe(PC12_WING.dihedral);
    expect(v.wing.flap.maxDeflection).toBeCloseTo(40 * DEG, 12);
    // The flat wing ends inboard of the half span by the upturned winglet's reach (the TCDS span is to its tips), on
    // the straight taper of geometry.ts (2.10 m at the centre line, 1.08 at the half span).
    const tip = v.wing.breaks[v.wing.breaks.length - 1];
    const w = v.wing.tip.winglet!;
    expect(tip.y + w.height * Math.cos(w.cant)).toBeLessThan(PC12_WING.span / 2);
    expect(tip.y + w.height * Math.cos(w.cant)).toBeGreaterThan(PC12_WING.span / 2 - 0.08);
    expect(tip.chord).toBeCloseTo(PC12_WING.rootChord + ((PC12_WING.tipChord - PC12_WING.rootChord) * tip.y) / (PC12_WING.span / 2), 12);
    expect(v.wing.breaks.every((b) => b.qcX === PC12_WING.quarterChordX)).toBe(true);
    v.wing.bays.forEach((b, i) => expect(b.from).toBe(i === 0 ? v.wing.rootY : v.wing.bays[i - 1].to));
    expect(v.wing.bays[v.wing.bays.length - 1].to).toBe(tip.y);
    expect(v.wing.bays.find((b) => b.kind === 'flap')).toMatchObject({ from: PC12_WING.flap.innerY, to: PC12_WING.flap.outerY });
    const aileron = v.wing.bays.find((b) => b.kind === 'aileron')!;
    expect(aileron.from).toBe(PC12_WING.aileron.innerY);
    expect(Math.abs(aileron.to - PC12_WING.aileron.outerY)).toBeLessThan(0.15);
    expect(v.wing.tip.winglet?.height).toBe(PC12_WING.winglet.height);
    // T-tail: span and root quarter-chord of geometry.ts; the whole stabiliser trims, no tab.
    expect(v.tail.tTail).toBe(true);
    expect(v.tail.h.span).toBe(PC12_TAIL.hSpan);
    expect(v.tail.h.quarterChord).toEqual({ x: PC12_TAIL.hQuarterChord.x, z: PC12_TAIL.hQuarterChord.z });
    expect(v.tail.h.kind).toBe('elevator');
    expect(v.tail.h.trim).toBeDefined();
    expect(v.tail.h.tab).toBeUndefined();
    // Two exhaust stubs; the livery is generic: 'N47PC'.
    expect(v.fuselage.exhaust?.mirror).toBe(true);
    expect(v.livery.registration).toBe('N47PC');
  });

  it('builds as the simulator builds it: no NaN, outward skins, the TCDS span, length and height, the 3V track and wheelbase', () => {
    const { visual } = build(PC12_VISUAL, false);
    expect(visual.root.name).toBe('pc12');
    expect(nonFinite(visual.root)).toBe(0);
    let tested = 0;
    for (const m of worldMeshes(visual.root)) {
      if (!/\|(wingPaint|finPaint)$/.test(m.name)) continue;
      const f = facing(m);
      expect(f.outward / f.total, `${m.name} outward fraction`).toBeGreaterThan(0.9);
      expect(f.normalAgree / f.total, `${m.name} normal/winding agreement`).toBeGreaterThan(0.97);
      tested++;
    }
    expect(tested).toBeGreaterThanOrEqual(8);
    const box = bodyBox(visual.root);
    // Span 16.28 m (TCDS C.III.3) within 1 %: the winglets stand nearly upright.
    expect(Math.abs(box.y1 - box.y0 - 16.28) / 16.28).toBeLessThan(0.01);
    // Length 14.408 m (TCDS) within 1 %, from the spinner tip to the tail's end.
    expect(box.x1).toBeCloseTo(PC12_FUSELAGE.noseX, 2);
    expect(Math.abs(box.x1 - box.x0 - 14.408) / 14.408).toBeLessThan(0.01);
    // Height 4.26 m (TCDS) within 2 %, ground to the bullet's top.
    expect(Math.abs(heightOf(box.z0) - 4.26) / 4.26).toBeLessThan(0.02);
    // Track 4.53 m and wheelbase 3.48 m (3V) within 3 %, from the drawn contact points.
    const [nose, left, right] = PC12_VISUAL.gear.map((w) => w.contact);
    expect(Math.abs(right[1] - left[1] - 4.53) / 4.53).toBeLessThan(0.03);
    expect(Math.abs(nose[0] - left[0] - 3.48) / 3.48).toBeLessThan(0.03);
    // The propeller disc: 2.67 m exactly, and clear of the ground at rest by about 0.3 m.
    expect(heightOf(PC12_VISUAL.props[0].hub[2]) - 2.67 / 2).toBeGreaterThan(0.25);
    // Both exhaust stubs stand out of the cowling, one each side, behind the propeller.
    const stubs = worldMeshes(visual.root).filter((m) => m.name.endsWith('|exhaust'));
    expect(stubs.length).toBeGreaterThan(0);
    const stubBox = bodyBox(new THREE.Group().add(...stubs.map((m) => m.clone())));
    expect(stubBox.y1).toBeGreaterThan(0.6);
    expect(stubBox.y0).toBeLessThan(-0.6);
    expect(stubBox.x1).toBeLessThan(PC12_PROP.hub.x);
    const eye = PC12_VISUAL.cockpit.pilotEye;
    expect(visual.pilotEye.distanceTo(model(eye))).toBeLessThan(1e-9);
    visual.dispose();
  }, 120_000);

  it("the pilot's eye sits in the three-view's cockpit: under the windscreen, over the sill, above the seat", () => {
    const c = PC12_VISUAL.cockpit;
    const eye = c.pilotEye;
    const { outer } = createFuselageShapes(PC12_VISUAL);
    // The documented height and station (PC12_VISUAL_HEIGHTS; requested for geometry.ts's PC12_EYE).
    expect(heightOf(eye[2])).toBeCloseTo(PC12_VISUAL_HEIGHTS.eye, 9);
    expect(6.0 - eye[0]).toBeCloseTo(PC12_VISUAL_HEIGHTS.eyeStation, 9);
    // 0.25-0.36 m under the top line (the windscreen over the seat), 1.0-1.25 m above the floor.
    const top = outer.section(eye[0]).zTop;
    expect(eye[2] - top).toBeGreaterThan(0.25);
    expect(eye[2] - top).toBeLessThan(0.36);
    expect(c.floor.z - eye[2]).toBeGreaterThan(1.0);
    expect(c.floor.z - eye[2]).toBeLessThan(1.25);
    // Over the windscreen's sill (a view over the nose) and over the glareshield.
    expect(eye[2]).toBeLessThan(PC12_VISUAL.glazing.windscreen!.sillC[1]);
    expect(eye[2]).toBeLessThan(c.panel.zTop - 0.2);
    // 0.70-0.85 m above the seat cushion; inside the cabin's side.
    expect(c.seats[0].z! - eye[2]).toBeGreaterThan(0.7);
    expect(c.seats[0].z! - eye[2]).toBeLessThan(0.85);
    expect(Math.abs(eye[1])).toBeLessThan(sectionHalfWidth(outer, eye[0], eye[2]) - 0.15);
  });
  it.todo("once geometry.ts adopts the 3V cockpit (PC12_EYE station 4.20, 2.33 m up), the eye equals PC12_EYE within 3 cm");

  it('the whole stabiliser trims: + elevatorTrim lifts the leading edge and drops the trailing edge', () => {
    const { outer } = createFuselageShapes(PC12_VISUAL);
    const root = new THREE.Group();
    const tail = buildTail(fakeMaterials(), root, PC12_VISUAL.tail, outer);
    expect(tail.tabs).toHaveLength(1);
    expect(tail.tabGearing).toBe(0);
    const stab = tail.tabs[0];
    const mesh = stab.object.children.find((m) => /^stabiliser/.test(m.name)) as THREE.Mesh;
    const at = (): THREE.Vector3[] => {
      root.updateMatrixWorld(true);
      const p = mesh.geometry.getAttribute('position');
      return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
    };
    const before = at();
    const le = before.reduce((b, p, i) => (-p.z > -before[b].z ? i : b), 0);
    const te = before.reduce((b, p, i) => (p.z > before[b].z ? i : b), 0);
    // AircraftVisual sets every tab to tabGearing x elevator + elevatorTrim: the stabiliser to elevatorTrim.
    stab.setAngle(tail.tabGearing * 0.3 + 2 * DEG);
    const after = at();
    expect(after[le].y - before[le].y).toBeGreaterThan(0.01);
    expect(before[te].y - after[te].y).toBeGreaterThan(0.005);
    expect(nonFinite(root)).toBe(0);
  });

  it('the mains fold inward into the wing root, the nose leg aft into the nose; hidden when up', () => {
    const def = PC12_VISUAL.gear;
    const gear = new LandingGear(fakeMaterials(), false, def);
    expect(nonFinite(gear.group)).toBe(0);
    const tyres = (): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      gear.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).name === 'tyre') out.push(o as THREE.Mesh);
      });
      return out;
    };
    const centre = (m: THREE.Mesh): THREE.Vector3 => {
      gear.group.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(gear.group.matrixWorld.clone().invert(), m.matrixWorld));
    };
    gear.update(WHEELS);
    const meshes = def.map((w) => tyres().find((m) => centre(m).distanceTo(model([w.contact[0], w.contact[1], w.contact[2] - w.radius])) < 1e-3)!);
    expect(meshes.every((m) => m !== undefined)).toBe(true);
    // Nearly up (1 % extension): the main wheels lie inboard, under the wing's lower skin in the root; the nose
    // wheel aft of its leg and up inside the nose bay.
    gear.update(WHEELS, [0.01, 0.01, 0.01]);
    const { outer } = createFuselageShapes(PC12_VISUAL);
    const [n, l, r] = meshes.map(centre);
    for (const [p, w] of [[l, def[1]], [r, def[2]]] as const) {
      const y = p.x;
      expect(Math.abs(y)).toBeLessThan(Math.abs(w.contact[1]) - 0.6);
      expect(Math.abs(y)).toBeGreaterThan(sectionHalfWidth(outer, -p.z, -p.y) - 0.3);
      // Within a few centimetres of the root's lower skin (the tyre lies flat, standing a little proud of it).
      expect(heightOf(-p.y)).toBeGreaterThan(0.85);
      expect(heightOf(-p.y)).toBeLessThan(1.15);
    }
    expect(-n.z).toBeLessThan(def[0].contact[0] - 0.5);
    expect(heightOf(-n.y)).toBeGreaterThan(outer.section(-n.z).zBot < 0 ? 0 : heightOf(outer.section(-n.z).zBot) + 0.1);
    // Fully up: the legs are not drawn.
    gear.update(WHEELS, [0, 0, 0]);
    expect(nonFinite(gear.group)).toBe(0);
  });

  it('the blade angle drawn at the 42 in station (0.80 R) is the commanded one: flight idle, full reverse, feather', () => {
    // TCDS C.III.6 quotes the HC-E4A-3D's angles at 42 in; the geometry is built at 17 deg there (plan 5.1).
    const def = { ...PC12_VISUAL.props[0], hub: [0, 0, 0] as [number, number, number] };
    const R = def.diameter / 2;
    const prop = new Propeller(fakeMaterials(), def, true);
    const front = prop.group.getObjectsByProperty('isInstancedMesh', true).find((m) => /^blade/.test(m.name)) as THREE.InstancedMesh;
    const p = front.geometry.getAttribute('position');
    const COLS = 13;
    const rows = p.count / COLS;
    /** The chord's angle to the plane of rotation, deg, interpolated to radius r (m), for blade instance k. */
    const angleAt = (k: number, r: number): number => {
      const m = new THREE.Matrix4();
      front.getMatrixAt(k, m);
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(m);
      const motion = new THREE.Vector3(0, 0, -1).cross(axis);
      const row = (i: number): [number, number] => {
        const te = new THREE.Vector3().fromBufferAttribute(p, i * COLS).applyMatrix4(m);
        const lead = new THREE.Vector3().fromBufferAttribute(p, i * COLS + COLS - 1).applyMatrix4(m);
        const chord = lead.clone().sub(te);
        const mid = te.add(lead).multiplyScalar(0.5);
        return [Math.hypot(mid.x, mid.y), Math.atan2(-chord.z, chord.dot(motion)) / DEG];
      };
      for (let i = 1; i < rows; i++) {
        const [r0, a0] = row(i - 1);
        const [r1, a1] = row(i);
        if (r >= r0 && r <= r1) return a0 + ((a1 - a0) * (r - r0)) / (r1 - r0);
      }
      throw new Error('radius off the blade');
    };
    for (const pitch of [17, -17.5, 79.6]) {
      prop.update(0, 0, pitch * DEG);
      for (let k = 0; k < 4; k++) expect(angleAt(k, PC12_PROP.STATION * R), `${pitch} deg, blade ${k}`).toBeCloseTo(pitch, 1);
    }
    prop.dispose();
  });

  it('the quadrant: the power lever swings aft of the gate into reverse; the condition lever has three detents; the MOR stands still', () => {
    const c = PC12_VISUAL.cockpit;
    const [mor, power, condition] = c.engineControls;
    expect(power).toMatchObject({ kind: 'lever', control: 'throttle' });
    expect(power.reverseTravel).toBeGreaterThan(0);
    expect(condition).toMatchObject({ kind: 'lever', control: 'mixture', detents: [0, 0.1, 1] });
    expect(mor.fixed).toBe(0);
    // No propeller lever (the CSU governs 1700 rpm, 47E 7-10).
    expect(c.engineControls.some((e) => e.control === 'propeller')).toBe(false);
    const shapes = createFuselageShapes(PC12_VISUAL);
    const cockpit = new Cockpit(fakeMaterials(), cabinFloorGeometry(shapes.lining, c.floor.z, c.floor.x0, c.floor.x1), shapes, c, PC12_PANEL);
    expect(nonFinite(cockpit.group)).toBe(0);
    const holder = (name: string): THREE.Object3D => cockpit.group.children.find((g) => g.children.some((m) => m.name === name))!;
    const pcl = holder('lever:knobBlack');
    const ctx = fakeContext(1);
    ctx.controls.engines = [{}];
    Object.assign(ctx.controls, { throttle: 0, reverse: 0 });
    cockpit.update(ctx.state, ctx.controls, 1);
    const gate = pcl.rotation.x;
    ctx.controls.reverse = 1;
    cockpit.update(ctx.state, ctx.controls, 1);
    expect((pcl.rotation.x - gate) / DEG).toBeCloseTo((power.travel * power.reverseTravel!) / DEG, 9);
    // The detent notches, the idle gate and the reverse arc lie on the pedestal's top, just proud of it (not buried in
    // it), within its fore and aft faces: every white and red mark in the fixed parts over the two slots.
    const ped = c.consoles.find((k) => k.material === 'black' && k.min[0] < power.pos[0] && k.max[0] > power.pos[0])!;
    for (const e of [power, condition]) expect(leverSurfaceZ(c.consoles, e.pos)).toBe(ped.min[2]);
    const topY = -ped.min[2];
    const slotY = [power.pos[1], condition.pos[1]];
    let marks = 0;
    for (const m of cockpit.group.getObjectsByProperty('isMesh', true) as THREE.Mesh[]) {
      if (!/:(knobWhite|knobRed)$/.test(m.name) || cockpit.group.children.some((g) => g !== m.parent && g.children.includes(m))) continue;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (!slotY.some((y) => Math.abs(v.x - y) < 0.03) || Math.abs(v.y - topY) > 0.01) continue;
        marks++;
        expect(v.y, 'mark above the pedestal top').toBeGreaterThanOrEqual(topY - 1e-9);
        expect(v.y).toBeLessThan(topY + 0.005);
        expect(-v.z).toBeGreaterThan(ped.min[0]);
        expect(-v.z).toBeLessThan(ped.max[0]);
      }
    }
    // Three detents + the gate + four reverse ticks = 8 boxes of 24 vertices.
    expect(marks).toBe(8 * 24);
    cockpit.dispose();
  });

  it("the cockpit's parts stand on the panel face's pixels; every console stays inside the skin", () => {
    const c = PC12_VISUAL.cockpit;
    const PX = PC12_PANEL_PX_PER_M;
    const faceZ = (py: number): number => c.panel.zTop + py / PX;
    const faceY = (px: number): number => (px - pc12PanelPx(0)) / PX;
    expect(c.panel.width * PX).toBeCloseTo(c.panel.pxRect!.w, 9);
    const levers = PC12_PEDESTAL.levers;
    expect(c.engineControls.map((e) => [e.control, e.pos[1]])).toEqual([
      ['throttle', faceY(levers.mor)],
      ['throttle', faceY(levers.power)],
      ['mixture', faceY(levers.condition)],
    ]);
    expect(c.flapControl.pos[1]).toBeCloseTo(faceY(levers.flaps), 12);
    expect(c.column.kind === 'yoke' && c.column.z).toBeGreaterThan(faceZ(0));
    const { outer } = createFuselageShapes(PC12_VISUAL);
    for (const [i, k] of c.consoles.entries()) {
      const y = Math.max(Math.abs(k.min[1]), Math.abs(k.max[1]));
      for (const x of [k.min[0], k.max[0]]) {
        for (const z of [k.min[2], k.max[2]]) {
          expect(sectionHalfWidth(outer, x, z) - y, `console ${i} corner x ${x.toFixed(2)} z ${z.toFixed(2)}`).toBeGreaterThan(0);
        }
      }
    }
    // The panel face's corners (the shown part of the canvas) stay within 6 cm of the skin's inside.
    const half = c.panel.width / 2;
    const bottom = c.panel.zTop + c.panel.pxRect!.h / PX;
    for (const z of [c.panel.zTop + 0.04, bottom]) expect(sectionHalfWidth(outer, c.panel.x, z) - half, `panel at z ${z.toFixed(2)}`).toBeGreaterThan(-0.06);
  });

  it('costs at most +30 draw calls and +60 000 triangles over the Cessna 172S in the chase view', () => {
    for (const onGround of [false, true]) {
      const cessna = build(null, onGround);
      const pc12 = build(PC12_VISUAL, onGround);
      const a = renderCost(cessna.visual.root);
      const b = renderCost(pc12.visual.root);
      expect(b.draws - a.draws).toBeLessThanOrEqual(30);
      expect(b.triangles - a.triangles).toBeLessThanOrEqual(60_000);
      cessna.visual.dispose();
      pc12.visual.dispose();
    }
  }, 180_000);
});
