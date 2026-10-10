import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { R44_VISUAL as def } from '../../src/aircraft/r44/visual';
import { R44_PANEL } from '../../src/aircraft/r44/panel';
import { R44_ROTORCRAFT } from '../../src/aircraft/r44/rotorcraft';
import { LOWER_FIN_OUTLINE, TAIL_STINGER } from '../../src/aircraft/r44/dimensions';
import { r44ExteriorVisualClass } from '../../src/aircraft/r44/exterior';
import { R44RotorHead } from '../../src/aircraft/r44/exteriorRotor';
import { r44DetailMaterials, skinPatch } from '../../src/aircraft/r44/exteriorGeometry';
import { MAIN_HUB, MAIN_ROTOR_RADIUS, PANEL_CANVAS, PANEL_FACE, PANEL_OUTLINE, SEAT_CENTRES, SKID_Z } from '../../src/aircraft/r44/dimensions';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { FuselageShape } from '../../src/render/aircraft/fuselageShape';
import { RotorcraftVisual } from '../../src/render/aircraft/RotorcraftVisual';
import { cabinFloorGeometry, sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { makeWindowSdf } from '../../src/render/aircraft/livery';
import { frd } from '../../src/render/aircraft/geometry';
import { rotorBladeGeometry, TeeteringRotor } from '../../src/render/aircraft/rotorcraft/rotor';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { blankDocument, fakeContext, fakeMaterials, nonFinite } from './meshChecks';

const R44ExteriorVisual = r44ExteriorVisualClass(RotorcraftVisual, FuselageShape, sectionHalfWidth);

describe('R44 exterior and cabin', () => {
  it('roots the short stinger in the lower fin and shares its contact line with physics', () => {
    expect(R44_ROTORCRAFT.tailProtection!.stinger).toBe(TAIL_STINGER);
    expect(def.rotorcraftVisual!.guard).toEqual(TAIL_STINGER.map(p => [p.x, p.y, p.z]));
    const root = TAIL_STINGER[0], heel = LOWER_FIN_OUTLINE.slice(2);
    expect(root.y).toBe(heel[0].y);
    expect(root.x).toBeGreaterThan(heel[0].x); expect(root.x).toBeLessThan(heel[1].x);
    expect(root.z).toBeLessThan(heel[0].z);
    const length = TAIL_STINGER.slice(1).reduce((sum, p, i) => sum + frd(p.x, p.y, p.z)
      .distanceTo(frd(TAIL_STINGER[i].x, TAIL_STINGER[i].y, TAIL_STINGER[i].z)), 0);
    expect(length).toBeLessThan(0.5);
  });
  it('keeps the visual description cloneable for the texture worker', () => {
    expect(structuredClone(def)).toEqual(def);
    expect(JSON.parse(JSON.stringify(def)).cockpit.seats).toHaveLength(4);
  });

  it('retains four distinct door windows, opaque A/B posts and an opaque rear cabin roof', () => {
    const sdf = makeWindowSdf(def.glazing);
    for (const side of [-1, 1]) {
      expect(sdf(1.10, side * 0.62, -0.30)).toBeLessThan(-0.04);
      expect(sdf(0.35, side * 0.62, -0.30)).toBeLessThan(-0.04);
      expect(sdf(1.36, side * 0.62, -0.30)).toBeGreaterThan(0.015);
      expect(sdf(0.70, side * 0.62, -0.30)).toBeGreaterThan(0.015);
    }
    expect(sdf(0.8, 0, -0.72)).toBeGreaterThan(0);
    expect(sdf(1.8, 0, -0.50)).toBeLessThan(0);
  });

  it('fits the seat bases and a nonzero-width floor inside the loft', () => {
    const skin = new FuselageShape(0.015, -Infinity, def.fuselage);
    const floor = def.cockpit.floor;
    const g = cabinFloorGeometry(skin, floor.z, floor.x0, floor.x1), p = g.getAttribute('position');
    let usableRows = 0;
    for (let i = 0; i < p.count; i += 2) if (Math.abs(p.getX(i + 1) - p.getX(i)) > 0.80) usableRows++;
    expect(usableRows).toBeGreaterThan(25);
    def.cockpit.seats.forEach((seat, i) => {
      expect(seat.y).toBe(SEAT_CENTRES[i].y);
      expect(seat.z! + 0.21).toBeLessThan(floor.z);
      // Rounded bottom edges are inset from the cushion's maximum lateral width.
      for (const x of [seat.x - 0.05, seat.x - seat.depth + 0.05])
        expect(sectionHalfWidth(skin, x, seat.z! + 0.17)).toBeGreaterThan(Math.abs(seat.y) + seat.width / 2 - 0.035);
    });
    g.dispose();
  });

  it('faces both cowl decal meshes outward and keeps them on the curved shell', () => {
    const skin = new FuselageShape(0, -Infinity, def.fuselage);
    for (const side of [-1, 1]) {
      const g = skinPatch((x, z) => sectionHalfWidth(skin, x, z), side, -0.2, -0.65, -0.4, -0.22);
      const p = g.getAttribute('position'), n = g.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        expect(n.getX(i) * side).toBeGreaterThan(0.5);
        expect(Math.abs(p.getX(i)) - sectionHalfWidth(skin, -p.getZ(i), -p.getY(i))).toBeCloseTo(0.003, 6);
      }
      g.dispose();
    }
  });

  it('renders R44 12/36 inch main bands and the C029-3 4.1/3.8 inch tail bands', () => {
    const d = def.rotorcraftVisual!;
    d.main.paint!.bands.forEach((b, i) => expect(b.tipDistance / 0.0254).toBeCloseTo([12, 48, 84, 120][i], 10));
    d.tail.paint!.bands.forEach((b, i) => expect(b.tipDistance / 0.0254).toBeCloseTo(4.1 + i * 3.8, 10));
    const g = rotorBladeGeometry({ ...d.main, twist: 0 }), p = g.getAttribute('position'), c = g.getAttribute('color');
    // Read actual upper/lower skin colours away from the metallic leading edge and end caps.
    const colourAt = (tipDistance: number, upper: boolean) => {
      let selected = -1, error = Infinity;
      for (let i = 0; i < p.count; i++) {
        if ((upper ? 1 : -1) * p.getY(i) < 0.01 || Math.abs(p.getZ(i)) > 0.07) continue;
        const e = Math.abs(p.getX(i) - (MAIN_ROTOR_RADIUS - tipDistance));
        if (e < error) { selected = i; error = e; }
      }
      return new THREE.Color().fromArray(c.array, selected * 3).getHex();
    };
    expect(colourAt(0.65, true)).toBe(0xe4e6e1);
    expect(colourAt(1.5, true)).toBe(0xe1b536);
    expect(colourAt(0.65, false)).toBe(0x202225);
    g.dispose();
  });

  it.each([false, true])('keeps blade cuffs attached through sharp/blur transitions (tail=%s)', tail => {
    const d = def.rotorcraftVisual!, materials = r44DetailMaterials();
    const rotor = new TeeteringRotor(tail ? { ...d.tail, chord: [d.tail.chord, d.tail.chord], twist: 0, tail: true } : d.main, fakeMaterials());
    const head = new R44RotorHead(rotor, materials, tail), expected = new THREE.Matrix4();
    if (!tail) expect(rotor.group.getObjectByName('r44StationarySwashplate')!.parent).toBe(rotor.group);
    for (const rpm of [0, 40, 180, 406]) for (const pitch of [0.02, 0.22]) {
      rotor.update(1.3, rpm, pitch, 0.047); head.update();
      expect(nonFinite(rotor.group)).toBe(0);
      head.cuffs.forEach((cuff, i) => {
        rotor.blades.getMatrixAt(i * rotor.blades.count / 2, expected);
        expect(cuff.matrix.elements).toEqual(expected.elements);
      });
    }
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(materials).forEach(m => m.dispose());
  });

  it('assembles the detailed cabin without moving the frozen panel face, and disposes its resources', () => {
    vi.stubGlobal('document', blankDocument());
    const ctx = fakeContext(); ctx.state.rotorcraft = emptyRotorcraftState(); ctx.state.electrical.busVoltage = 28;
    const visual = new R44ExteriorVisual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: R44_PANEL });
    let disposed = false;
    try {
      ctx.controls.collective = 0.8; ctx.controls.aileron = 0.7; ctx.controls.elevator = -0.5; ctx.controls.rudder = 1;
      ctx.state.rotorcraft.rotorRpm = 406; ctx.state.rotorcraft.thrust = 11000;
      visual.update(ctx); visual.root.updateMatrixWorld(true);
      expect(nonFinite(visual.root)).toBe(0);
      expect(visual.main.group.position.distanceTo(frd(MAIN_HUB.x, MAIN_HUB.y, MAIN_HUB.z))).toBeLessThan(1e-8);
      const [origin, du, dv] = panelUvBasis(visual.panel.geometry)!;
      const centre = origin.clone().addScaledVector(du, 0.5).addScaledVector(dv, 0.5);
      expect(visual.panel.localToWorld(centre).distanceTo(frd(PANEL_FACE.centre.x, PANEL_FACE.centre.y, PANEL_FACE.centre.z))).toBeLessThan(1e-6);
      expect(du.length() / PANEL_CANVAS.w).toBeCloseTo(dv.length() / PANEL_CANVAS.h, 9);
      expect(def.rotorcraftVisual!.panel.outline).toBe(PANEL_OUTLINE);
      expect(visual.root.getObjectByName('r44HydraulicSwitch')!.parent).toBe(visual.cockpit.bar);
      expect(visual.cockpit.collectives).toHaveLength(2);
      expect(visual.cockpit.pedals).toHaveLength(4);
      // Detail feet/shoes must not silently create visual ground contacts below the shared skid datum.
      const exterior = visual.root.getObjectByName('r44ExteriorDetails')!;
      expect(new THREE.Box3().setFromObject(exterior).min.y).toBeGreaterThanOrEqual(-SKID_Z - 0.001);
      ctx.cameraMode = 'cockpit'; visual.update(ctx);
      expect(visual.cockpit.group.getObjectByName('occupants')!.visible).toBe(false);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      visual.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          // The shared shadow-only material is a module singleton reused by every aircraft.
          if (m.name !== 'shadowProxy') materials.add(m);
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
        }
      });
      const gSpies = [...geometries].map(g => [g.type, vi.spyOn(g, 'dispose')] as const);
      const mSpies = [...materials].map(m => [m.name, vi.spyOn(m, 'dispose')] as const);
      const tSpies = [...textures].map(t => [t.name || t.type.toString(), vi.spyOn(t, 'dispose')] as const);
      visual.dispose(); disposed = true;
      for (const [name, spy] of [...gSpies, ...mSpies, ...tSpies]) expect(spy, name).toHaveBeenCalled();
    } finally { if (!disposed) visual.dispose(); vi.unstubAllGlobals(); }
  });
});
