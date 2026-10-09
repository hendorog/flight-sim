import { describe, expect, it } from 'vitest';
import { DEG, KT, quat, v3 } from '../../src/core/math';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { cloneControls, defaultControls } from '../../src/core/types';
import type { BodyState } from '../../src/physics/interfaces';
import { createFlightModelFor } from '../../src/physics';
import { SkidGear, stingerClearance } from '../../src/physics/rotorcraft/skids';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { ScriptedPilot, observePilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { DT, rig, seaLevel } from './helpers';
import { writeTrace } from './scriptedPilot';

describe('R22 skid shoes and terrain', () => {
  it('touches the stinger before skids/rotor in a low nose-high flare and applies a real reaction', () => {
    const body: BodyState = { time: 0, position: v3.zero(), orientation: quat.fromEuler(0, 25 * DEG, 0),
      velocityBody: quat.rotateInv(quat.fromEuler(0, 25 * DEG, 0), { x: 0, y: 0, z: 0.2 }),
      angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 621 };
    body.position.z = stingerClearance(d, body, seaLevel) + 0.005;
    const rotor = emptyRotorcraftState(), gear = new SkidGear(d);
    const g = gear.compute({ body, env: seaLevel, dt: DT, controls: defaultControls(R22_DEFINITION) }, rotor);
    expect(g.onGround).toBe(false); expect(g.crash).toBe('');
    expect(rotor.tailContact).toBe('stinger-touch');
    expect(stingerClearance(d, body, seaLevel)).toBeCloseTo(-0.005, 8);
    expect(quat.rotate(body.orientation, g.force).z).toBeLessThan(0);
    expect(g.moment.y).toBeLessThan(0); // lifts the tail; no attitude lock
    expect(v3.dot(g.force, body.velocityBody)).toBeLessThan(0);
    body.position.z -= 0.2;
    gear.compute({ body, env: seaLevel, dt: DT, controls: defaultControls(R22_DEFINITION) }, rotor);
    expect(rotor.tailContact).toBe('stinger-touch'); // visible after separation
  });

  it('distinguishes a hard stinger impact, lower fin contact and tail rotor strike', () => {
    const pose = quat.fromEuler(0, 25 * DEG, 0);
    const body: BodyState = { time: 0, position: v3.zero(), orientation: pose,
      velocityBody: quat.rotateInv(pose, { x: 0, y: 0, z: 2 }), angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 621 };
    body.position.z = stingerClearance(d, body, seaLevel) + 0.005;
    const gear = new SkidGear(d), rotor = emptyRotorcraftState();
    const input = { body, env: seaLevel, dt: DT, controls: defaultControls(R22_DEFINITION) };
    expect(gear.compute(input, rotor).crash).toBe('Tail stinger impact');
    expect(rotor.tailContact).toBe('stinger-impact');
    // A raised patch under the fin, then the rotor. Each point queries the actual terrain.
    const fin = d.tailProtection!.fin[2], finWorld = v3.add(body.position, quat.rotate(pose, fin));
    input.env = { ...seaLevel, groundElevation: (x, y) => Math.hypot(x - finWorld.x, y - finWorld.y) < 0.02 ? -finWorld.z + 0.001 : 0 };
    expect(gear.compute(input, rotor).crash).toBe('Lower tail fin strike');
    expect(rotor.tailContact).toBe('fin-strike');
    const hubWorld = v3.add(body.position, quat.rotate(pose, d.tail.hub));
    input.env = { ...seaLevel, groundElevation: (x, y) => Math.hypot(x - hubWorld.x, y - hubWorld.y) < 0.02 ? -hubWorld.z + 0.001 : 0 };
    expect(gear.compute(input, rotor).crash).toBe('Tail rotor strike');
    expect(rotor.tailContact).toBe('rotor-strike');
  });
  it('opposes motion and applies the entire ground reaction at the contacts below the CG', () => {
    const body: BodyState = { time: 0, position: { x: 0, y: 0, z: -d.skids.z + 0.02 },
      orientation: quat.identity(), velocityBody: { x: 10, y: 0, z: 0 }, angularVelocity: v3.zero(),
      cgOffset: { x: 0.1, y: 0, z: -0.1 }, mass: 621 };
    const forces = ['grass', 'runway'].map(surface => {
      const gear = new SkidGear(d), env = { ...seaLevel, surface: () => surface as 'grass' | 'runway' };
      const g = gear.compute({ body, env, dt: DT, controls: defaultControls(R22_DEFINITION) });
      const normal = -g.force.z;
      expect(g.force.x / normal).toBeCloseTo(-d.skids.surfaces![surface as 'grass' | 'runway']!.sliding, 6);
      expect(v3.dot(g.force, body.velocityBody)).toBeLessThan(0);
      // Equal front/rear compression makes the normal force act at their midpoint. Friction adds a
      // nose-down moment, never a CG-level force or an artificial attitude constraint.
      const normalMoment = ((d.skids.front + d.skids.rear) / 2 - body.cgOffset.x) * normal;
      expect(g.moment.y - normalMoment).toBeCloseTo((d.skids.z - body.cgOffset.z) * g.force.x, 6);
      const repeated = gear.compute({ body, env, dt: 0, controls: defaultControls(R22_DEFINITION) });
      expect(repeated.force).toEqual(g.force);
      return g.force.x;
    });
    expect(Math.abs(forces[0])).toBeLessThan(Math.abs(forces[1]));
  });

  for (const surface of ['grass', 'runway'] as const) for (const speed of [20, 35])
    it(`${speed} kt run-on on ${surface}: aft cyclic keeps the skids level through the stop`, () => {
      const r = rig(speed), env = { ...seaLevel, surface: () => surface };
      // An airborne, power-off run-on fixture. Only the initial pose/velocity is set; the pilot then
      // uses the same attitude/hand-rate controller as the demo, without touching model state.
      r.fm.setKinematics({ position: { x: 0, y: 0, z: -1.3 }, orientation: quat.fromEuler(0, 2 * DEG, 0),
        velocity: { x: speed * KT, y: 0, z: 0.5 }, angularVelocity: v3.zero() });
      r.c.collective = 0.25; r.c.elevator = 0.1; r.c.mixture = 0;
      const pilot = new ScriptedPilot(observePilot(r.fm.state), r.c);
      let contact: { time: number; x: number; gs: number; sink: number } | undefined;
      let distance = 0, stoppedAt: number | undefined, maxPitch = 0, maxRoll = 0, aftCyclic = 0;
      for (let i = 0; i < 40 / DT && !r.fm.state.crashed; i++) {
        const before = r.c.elevator;
        pilot.slide(DT, observePilot(r.fm.state), r.c);
        expect(Math.abs(r.c.elevator - before)).toBeLessThanOrEqual(0.8 * DT + 1e-12);
        r.fm.step(DT, r.c, env);
        const s = r.fm.state;
        if (r.fm.touchdowns.length) contact ??= { time: i * DT, x: s.position.x,
          gs: s.groundSpeed / KT, sink: r.fm.touchdowns[0].sinkRate };
        if (contact) {
          distance = s.position.x - contact.x;
          maxPitch = Math.max(maxPitch, Math.abs(s.pitch)); maxRoll = Math.max(maxRoll, Math.abs(s.roll));
          aftCyclic = Math.max(aftCyclic, r.c.elevator);
          if (s.groundSpeed < 0.1 && r.c.collective === 0) { stoppedAt = i * DT; break; }
        }
      }
      writeTrace(`runon-${surface}-${speed}`, { contact, stoppedAt, distance, maxPitch, maxRoll, aftCyclic, damage: r.fm.state.crashReason });
      expect(contact).toBeDefined(); expect(contact!.gs).toBeGreaterThan(speed - 1);
      expect(stoppedAt).toBeDefined(); expect(distance).toBeGreaterThan(speed === 20 ? 10 : 40);
      expect(distance).toBeLessThan(180);
      expect(aftCyclic).toBeGreaterThan(0.1);
      expect(maxPitch / DEG).toBeLessThan(4); expect(maxRoll / DEG).toBeLessThan(4);
      expect(r.fm.state.crashReason).toBe(''); expect(r.fm.state.onGround).toBe(true);
    });

  for (const surface of ['grass', 'runway'] as const)
    it(`parks on a six-degree ${surface} slope without steady creep`, () => {
      const slope = Math.tan(6 * DEG), env = { ...seaLevel, surface: () => surface,
        groundElevation: (_x: number, y: number) => y * slope,
        groundNormal: () => v3.normalize({ x: 0, y: -slope, z: -1 }) };
      const fm = createFlightModelFor(R22_DEFINITION);
      fm.reset({ position: v3.zero(), heading: 0, airspeed: 0, onGround: true, engineRunning: false }, env);
      fm.setKinematics({ position: { x: 0, y: 0, z: -d.skids.z }, orientation: quat.fromEuler(-6 * DEG, 0, 0),
        velocity: v3.zero(), angularVelocity: v3.zero() });
      const c = cloneControls(fm.trimControls); c.collective = 0;
      for (let i = 0; i < 10 / DT; i++) fm.step(DT, c, env);
      const position = { ...fm.state.position };
      for (let i = 0; i < 50 / DT; i++) fm.step(DT, c, env);
      expect(v3.len(v3.sub(fm.state.position, position))).toBeLessThan(1e-5);
      expect(fm.state.groundSpeed).toBeLessThan(1e-6);
      expect(fm.state.onGround).toBe(true); expect(fm.state.crashed).toBe(false);
    });

  it('a large sideways drift can roll over on turf while the same straight touchdown settles', () => {
    const trials = [0, 10].map(drift => {
      const r = rig(0), env = { ...seaLevel, surface: () => 'grass' as const };
      r.fm.setKinematics({ position: { x: 0, y: 0, z: -1 }, orientation: quat.fromEuler(5 * DEG, 0, 0),
        velocity: { x: 0, y: drift, z: 0.7 }, angularVelocity: v3.zero() });
      r.c.collective = 0.4; r.c.aileron = 0;
      let contacts = 0;
      for (let i = 0; i < 5 / DT && !r.fm.state.crashed; i++) {
        r.fm.step(DT, r.c, env); if (r.fm.state.onGround) contacts++;
      }
      return { s: r.fm.state, contacts };
    });
    expect(trials[0].s.crashed).toBe(false); expect(Math.abs(trials[0].s.roll)).toBeLessThan(DEG);
    expect(trials[1].contacts).toBeGreaterThan(240);
    expect(trials[1].s.roll).toBeGreaterThan(40 * DEG);
    expect(trials[1].s.crashReason).toBe('Main rotor strike');
  });
});
