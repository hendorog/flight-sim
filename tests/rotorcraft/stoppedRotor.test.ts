import { describe, expect, it } from 'vitest';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { quat, v3 } from '../../src/core/math';
import { defaultControls } from '../../src/core/types';
import type { BodyState } from '../../src/physics/interfaces';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { SkidGear } from '../../src/physics/rotorcraft/skids';
import { DT, seaLevel } from './helpers';

describe.each([R22_DEFINITION, R44_DEFINITION, S269_DEFINITION])('$id stopped and slow rotor', (aircraft) => {
  const d = aircraft.rotorcraft!;
  const body = (): BodyState => ({ time: 0, position: { x: 0, y: 0, z: -d.skids.z },
    orientation: quat.identity(), velocityBody: v3.zero(), angularVelocity: v3.zero(),
    cgOffset: v3.zero(), mass: aircraft.mass.maxTakeoff });

  it('does not settle a stopped rotor into rotating-rotor blowback in a crosswind', () => {
    const r = new Rotorcraft(d), c = defaultControls(aircraft), b = body();
    for (const wind of [{ x: 3, y: -2, z: 0.1 }, { x: -8, y: 6, z: -0.2 }]) {
      r.reset(false);
      r.settle(b, wind, 1.225, d.skids.z, c);
      for (let i = 0; i < 5 / DT; i++) r.compute(b, wind, 1.225, d.skids.z, c, DT);
      expect(r.state.omega).toBe(0);
      // The articulated cosine-to-forward convention can publish negative zero.
      expect(Math.abs(r.state.flapForward)).toBe(0); expect(Math.abs(r.state.flapRight)).toBe(0);
      expect(r.state.coning).toBe(0); expect(r.state.mastBump).toBe(false);
    }
  });

  if (d.hubModel?.kind !== 'articulated') it('bounds low-RPM teeter at the mechanical stop, including body-axis transport at zero RPM', () => {
    const r = new Rotorcraft(d), c = defaultControls(aircraft), b = body();
    // A held 10 RPM in wind exercises the very large advance ratio during early spool-up.
    for (const rpm of [0, 10]) {
      r.reset(false); r.state.omega = rpm * Math.PI / 30; r.state.rotorRpm = rpm;
      b.angularVelocity.x = -0.5;
      for (let i = 0; i < 5 / DT; i++) r.compute(b, { x: 3, y: -2, z: 0 }, 1.225, d.skids.z, c, DT);
      expect(r.state.teeterAngle).toBeCloseTo(d.teeterLimit, 8);
      expect(Math.atan(Math.hypot(r.state.flapForward, r.state.flapRight))).toBeCloseTo(d.teeterLimit, 8);
      expect(r.state.mastBump).toBe(false);
    }
  });

  it.each([false, true])('requires blade contact with a raised surface, running=%s', (running) => {
    const r = new Rotorcraft(d), gear = new SkidGear(d), b = body(), c = defaultControls(aircraft);
    r.reset(running);
    // Isolate the forward blade tip; skids/cabin/tail remain above flat ground. A stopped blade
    // is still solid: an RPM guard on the strike check would incorrectly let it pass through this patch.
    const tip = v3.add(b.position, { x: d.main.hub.x + d.main.radius, y: d.main.hub.y, z: d.main.hub.z });
    const check = (clearance: number) => gear.compute({ body: b, controls: c, dt: DT,
      env: { ...seaLevel, groundElevation: (x, y) => Math.hypot(x - tip.x, y - tip.y) < 0.02 ? -tip.z - clearance : 0 } }, r.state);
    expect(check(0.001).crash).toBe('');
    expect(check(-0.001).crash).toBe('Main rotor strike');
  });
});
