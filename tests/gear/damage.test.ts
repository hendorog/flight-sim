// Landing damage (physics/damage.ts, GearConfig.damage) on the seven aeroplanes. The leg loads of each type's
// damage block were set by the drops here: the type at MTOW on the gear rig, wings level, lift = weight, held in
// pitch only by C172S-like rate damping scaled with its pitch inertia; mains-first 5 degrees above the resting
// attitude, nose-first 1.5 degrees below it (the nose wheel then meets the ground at the sink rate). Each band
// test checks a drop a little below and a little above the type's research figure, and logs the sink rate
// at which the leg actually crossed each level (bisection). The spring mains (owner: stronger than the research's
// bands) bend at about 6 m/s and would collapse only beyond an 8 m/s drop's load, above the 7 m/s terrain impact,
// so their collapse is checked with the impact classification lifted. Then: the PA-38's tyre against the lower wing
// skin, a bent leg (lower and wider, no pull), propeller strikes, the gear-up slide, the collapsed nose that slides
// to a stop, and what is still a crash.

import { describe, expect, test } from 'vitest';
import { DEG, G0, KT, quat, v3 } from '../../src/core/math';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { C172S_DEFINITION } from '../../src/aircraft/c172s';
import { C152_DEFINITION } from '../../src/aircraft/c152';
import { PA38_DEFINITION } from '../../src/aircraft/pa38';
import { DA20_DEFINITION } from '../../src/aircraft/da20';
import { PA34_DEFINITION } from '../../src/aircraft/pa34';
import { C208_DEFINITION } from '../../src/aircraft/c208';
import { PC12_DEFINITION } from '../../src/aircraft/pc12';
import { ah56Gear } from '../../src/aircraft/ah56/gear';
import { BladeElementFlightModel } from '../../src/physics';
import { emptyDamage, type DamageState, type LegStatus } from '../../src/physics/damage';
import { C172_GEAR, type GearConfig } from '../../src/physics/gear';
import type { MassProperties } from '../../src/physics/massModel';
import { flatEnvironment } from '../fdm/helpers';
import { GearRig, planeEnvironment } from './rig';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[damage] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

interface Type {
  name: string;
  def: AircraftDefinition;
  /** Touchdown speed of the drops, m/s (about 1.15 Vso). */
  speed: number;
  /**
   * Sink rates, m/s: hard (V_lim), yield (bent / bottomed), collapse; mains-first at the CG. Research section 7 for
   * the oleo mains; the owner's stronger spring mains (yield 6 m/s; the ultimate load is an 8 m/s drop's without the
   * set, which the set's lower stance puts at 8.4-8.7 m/s, beyond the 7 m/s terrain impact).
   */
  mains: [number, number, number];
  /** The same for the nose leg, at the nose wheel's contact speed. */
  nose: [number, number, number];
  /** Yield status of the main legs. */
  mainYield: LegStatus;
}

const TYPES: Type[] = [
  { name: 'C172S', def: C172S_DEFINITION, speed: 25, mains: [2.62, 6.0, 8.4], nose: [1.68, 2.13, 3.66], mainYield: 'bent' },
  { name: 'C152', def: C152_DEFINITION, speed: 22, mains: [2.41, 6.0, 8.45], nose: [1.68, 2.13, 3.5], mainYield: 'bent' },
  { name: 'PA-38', def: PA38_DEFINITION, speed: 26, mains: [2.57, 6.0, 8.7], nose: [1.45, 1.83, 2.9], mainYield: 'bent' },
  { name: 'DA20', def: DA20_DEFINITION, speed: 24, mains: [2.6, 6.0, 8.5], nose: [1.45, 1.83, 2.9], mainYield: 'bent' },
  { name: 'PA-34', def: PA34_DEFINITION, speed: 31, mains: [2.85, 3.4, 4.6], nose: [1.68, 2.13, 3.05], mainYield: 'bottomed' },
  { name: 'C208', def: C208_DEFINITION, speed: 31, mains: [3.05, 6.0, 8.5], nose: [2.13, 2.74, 3.96], mainYield: 'bent' },
  { name: 'PC-12', def: PC12_DEFINITION, speed: 35, mains: [3.05, 3.7, 5.0], nose: [1.83, 2.29, 3.35], mainYield: 'bottomed' },
];

const massCache = new Map<AircraftDefinition, MassProperties>();
/** Mass, CG and inertia of the type at MTOW. */
function mtow(def: AircraftDefinition): MassProperties {
  let mp = massCache.get(def);
  if (!mp) {
    const l = def.mass.loadings.maxGross;
    mp = new BladeElementFlightModel(def, { payload: l.payload, payloadPosition: l.payloadPosition }).massProperties;
    massCache.set(def, mp);
  }
  return mp;
}

/** The type on the gear rig at MTOW, `config` (default: its own gear) at rest. */
function typeRig(def: AircraftDefinition, config: GearConfig = def.gear()): GearRig {
  const mp = mtow(def);
  const rig = new GearRig(planeEnvironment(), mp.mass, config, { x: mp.inertia.Ixx, y: mp.inertia.Iyy, z: mp.inertia.Izz });
  rig.cgOffset = { ...mp.cgOffset };
  rig.placeOnGround(0);
  return rig;
}

/** Wing lift = weight (body z) and C172S-like rate damping scaled with the type's pitch inertia. */
function liftEqualsWeight(rig: GearRig): void {
  const W = rig.mass * G0;
  const Mq = (3400 * rig.inertia.y) / 1346;
  rig.loads = (r) => ({ force: { x: 0, y: 0, z: -W }, moment: { x: -1500 * r.angularVelocity.x, y: -Mq * r.angularVelocity.y, z: -Mq * r.angularVelocity.z } });
}

/** The type's gear with the terrain-impact sink rate lifted out of reach (a leg's collapse above 7 m/s). */
function noImpact(def: AircraftDefinition): GearConfig {
  const g = def.gear();
  return { ...g, impact: { sinkRate: 99, speed: 99, steepSpeed: 99, steepPath: 1 } };
}

/** A drop of `t` at `sink` m/s: 'mains' first (5 degrees above the resting attitude) or 'nose' first (1.5 below). */
function drop(t: Type, sink: number, attitude: 'mains' | 'nose', seconds = 1.5, roll = 0, config?: GearConfig): GearRig {
  const rig = typeRig(t.def, config);
  const pose = rig.gear.restingPose(rig.mass, rig.cgOffset);
  rig.placeOnGround(0, 0.06);
  rig.orientation = quat.fromEuler(roll, pose.pitch + (attitude === 'mains' ? 5 : -1.5) * DEG, 0);
  rig.velocity = { x: t.speed, y: 0, z: sink };
  liftEqualsWeight(rig);
  rig.run(seconds);
  return rig;
}

const RANK: Record<LegStatus, number> = { ok: 0, hard: 1, bent: 2, bottomed: 2, collapsed: 3 };
const legOf = (rig: GearRig, i: number) => rig.output.damage!.legs[i];

/** Lowest sink rate (to 0.02 m/s) in [lo, hi] at which leg `i` reaches `status` in a drop. */
function threshold(t: Type, attitude: 'mains' | 'nose', i: number, status: LegStatus, lo = 0.5, hi = 6.95, config?: GearConfig): number {
  const reached = (s: number) => RANK[legOf(drop(t, s, attitude, 1.5, 0, config), i).status] >= RANK[status];
  if (!reached(hi)) return NaN;
  while (hi - lo > 0.02) {
    const mid = 0.5 * (lo + hi);
    if (reached(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

describe('sink-rate bands at MTOW', () => {
  for (const t of TYPES) {
    test(`${t.name}: mains-first`, () => {
      const [hard, yieldAt, collapse] = t.mains;
      const below = (s: number) => drop(t, s - 0.15, 'mains');
      const above = (s: number) => drop(t, s + 0.15, 'mains');
      // Beyond the 7 m/s terrain impact a collapse is found with the impact classification lifted.
      const beyond = collapse > 7 ? noImpact(t.def) : undefined;
      report(`${t.name} mains-first`, {
        hard: threshold(t, 'mains', 1, 'hard'), yield: threshold(t, 'mains', 1, t.mainYield),
        collapse: threshold(t, 'mains', 1, 'collapsed', 0.5, beyond ? 9.5 : 6.95, beyond),
        noseHard: threshold(t, 'mains', 0, 'hard'), noseYield: threshold(t, 'mains', 0, 'bottomed'), noseCollapse: threshold(t, 'mains', 0, 'collapsed'),
      });
      expect(legOf(below(hard), 1).status).toBe('ok');
      expect(legOf(above(hard), 1).status).toBe('hard');
      expect(above(hard).output.damage!.events.map((e) => e.text)).toContain('Hard landing: inspection required');
      expect(RANK[legOf(below(yieldAt), 1).status]).toBeLessThan(2);
      expect(legOf(above(yieldAt), 1).status).toBe(t.mainYield);
      if (beyond) {
        // The hardest arrival short of a terrain impact bends the mains but does not break them.
        const hardest = drop(t, 6.95, 'mains');
        expect(legOf(hardest, 1).status).toBe(t.mainYield);
        expect(hardest.output.crash).toBe('');
        expect(legOf(drop(t, collapse - 0.15, 'mains', 1.5, 0, beyond), 1).status).toBe(t.mainYield);
        expect(legOf(drop(t, collapse + 0.15, 'mains', 1.5, 0, beyond), 1).status).toBe('collapsed');
        // At that energy it is a terrain impact, the crash it always was.
        const impact = drop(t, 7.2, 'mains');
        expect(impact.output.crashKind).toBe('impact');
        return;
      }
      expect(legOf(below(collapse), 1).status).toBe(t.mainYield);
      // Collapse: damage, not a crash (the energy test still says landing below 7 m/s).
      const broken = drop(t, Math.min(collapse + 0.15, 6.95), 'mains');
      expect(legOf(broken, 1).status).toBe('collapsed');
      expect(broken.output.crash).toBe('');
      expect(broken.output.wheels[1].load).toBe(0);
      expect(broken.output.wheels[1].compression).toBeGreaterThanOrEqual(t.def.gear().damage!.legs[1].collapsedCompression);
    }, 120000);

    test(`${t.name}: nose-first`, () => {
      const [hard, yieldAt, collapse] = t.nose;
      report(`${t.name} nose-first`, { hard: threshold(t, 'nose', 0, 'hard'), yield: threshold(t, 'nose', 0, 'bottomed'), collapse: threshold(t, 'nose', 0, 'collapsed') });
      expect(legOf(drop(t, hard - 0.15, 'nose'), 0).status).toBe('ok');
      expect(legOf(drop(t, hard + 0.15, 'nose'), 0).status).toBe('hard');
      expect(legOf(drop(t, yieldAt + 0.15, 'nose'), 0).status).toBe('bottomed');
      expect(legOf(drop(t, collapse - 0.15, 'nose'), 0).status).toBe('bottomed');
      const broken = drop(t, collapse + 0.15, 'nose', 3);
      expect(legOf(broken, 0).status).toBe('collapsed');
      expect(broken.output.crash).toBe('');
    }, 60000);
  }

  test('the nose gear fails before the mains in a mains-first arrival (light singles)', () => {
    for (const t of TYPES.slice(0, 4)) {
      const nose = threshold(t, 'mains', 0, 'collapsed');
      const main = threshold(t, 'mains', 1, 'collapsed', 0.5, 9.5, noImpact(t.def));
      report(`${t.name} mains-first collapse order`, { nose, main });
      // The nose folds below the terrain impact; the mains outlast every arrival short of it.
      expect(nose).toBeLessThan(7);
      expect(nose).toBeLessThan(main);
      expect(legOf(drop(t, 6.95, 'mains'), 1).status).not.toBe('collapsed');
    }
  }, 180000);

  test('PA-38: a hard arrival flexes the leaf mains up until the tyres strike the lower wing skin, short of bending them', () => {
    const t = TYPES[2];
    const stopAt = 5.2;
    const skin = /^(Left|Right) wheel struck the lower wing skin/;
    const struck = (rig: GearRig) => rig.output.damage!.events.filter((e) => skin.test(e.text));
    const reaches = (s: number) => struck(drop(t, s, 'mains')).length > 0;
    let lo = 3;
    let hi = 6.95;
    while (hi - lo > 0.02) {
      const mid = 0.5 * (lo + hi);
      if (reaches(mid)) hi = mid;
      else lo = mid;
    }
    const below = drop(t, stopAt - 0.15, 'mains');
    const above = drop(t, stopAt + 0.15, 'mains');
    const ev = struck(above);
    report('PA-38 wing-skin stop', { sink: hi, peakLoad: above.output.damage!.legs[1].peakLoad, events: above.output.damage!.events.map((e) => e.text).join('; ') });
    expect(struck(below)).toEqual([]);
    expect(ev.map((e) => [e.item, e.severity])).toEqual([['leftMain', 'damage'], ['rightMain', 'damage']]);
    // Struck, not bent or broken, and not a crash.
    expect(above.output.damage!.legs[1].status).toBe('hard');
    expect(above.output.damage!.legs[2].status).toBe('hard');
    expect(above.output.damage!.legs[1].set).toBe(0);
    expect(above.output.crash).toBe('');
    // One event per wheel however long it bears on the skin.
    expect(struck(drop(t, 6.5, 'mains')).length).toBe(2);
  }, 60000);

  test('a light aircraft loads its legs less: no damage scaling with weight', () => {
    const t = TYPES[0];
    const heavy = drop(t, 3, 'mains');
    const rig = new GearRig(planeEnvironment(), 900, t.def.gear(), heavy.inertia);
    rig.cgOffset = { ...heavy.cgOffset };
    const pose = rig.gear.restingPose(rig.mass, rig.cgOffset);
    rig.placeOnGround(0, 0.06);
    rig.orientation = quat.fromEuler(0, pose.pitch + 5 * DEG, 0);
    rig.velocity = { x: t.speed, y: 0, z: 3 };
    liftEqualsWeight(rig);
    rig.run(1.5);
    report('C172S 3 m/s mains-first peak main load', { mtow: legOf(heavy, 1).peakLoad, at900kg: legOf(rig, 1).peakLoad });
    expect(legOf(rig, 1).peakLoad).toBeLessThan(legOf(heavy, 1).peakLoad);
  });
});

describe('after the damage', () => {
  const C172 = TYPES[0];

  test('a drop with the left wing low bends the left main only; the bent leg sits lower on a wider track and hardly pulls', () => {
    const bent = drop(C172, 6, 'mains', 1.5, -6 * DEG);
    const d = bent.output.damage!;
    report('left-wing-low 6 m/s', { left: d.legs[1].status, set: d.legs[1].set, toeDeg: d.legs[1].toe / DEG, right: d.legs[2].status });
    expect(d.legs[1].status).toBe('bent');
    expect(d.legs[1].set).toBeGreaterThan(0.01);
    expect(d.legs[1].toe).toBe(0);
    expect(RANK[d.legs[2].status]).toBeLessThan(2);
    // The left leg's damage alone (this drop also folded the nose).
    const left = emptyDamage(1);
    left.legs[1] = { ...d.legs[1] };

    // Rolling at 15 m/s, hands and feet off, thrust holding the speed: heading change over 6 s, and the attitude.
    const rollOut = (damage: DamageState | null) => {
      const rig = typeRig(C172.def);
      if (damage) rig.gear.restoreDamage(damage);
      rig.placeOnGround(0);
      if (damage) rig.gear.restoreDamage(damage);
      rig.velocity = { x: 15, y: 0, z: 0 };
      rig.external = { force: { x: 0, y: 0, z: 0 }, point: v3.zero() };
      rig.loads = (r) => {
        r.external!.force.x = Math.max(0, Math.min(3000, 600 + 3000 * (15 - r.velocityBody().x)));
        return { force: v3.zero(), moment: v3.zero() };
      };
      rig.run(6);
      const e = rig.euler();
      const h = e.heading;
      return { heading: (h > Math.PI ? h - 2 * Math.PI : h) / DEG, east: rig.position.y, roll: e.roll / DEG, track: rig.output.wheels[1].onGround };
    };
    const straight = rollOut(null);
    const lower = rollOut(left);
    report('roll-out, 6 s at 15 m/s', { straightHeadingDeg: straight.heading, bentHeadingDeg: lower.heading, bentEast: lower.east, straightRollDeg: straight.roll, bentRollDeg: lower.roll });
    expect(Math.abs(straight.heading)).toBeLessThan(0.5);
    // The leg yielded the way it flexes, up and outboard: the left wing sits lower...
    expect(lower.roll - straight.roll).toBeLessThan(-0.2);
    // ...on a wider track (its extended contact point moved outboard along the leg axis)...
    const axis = C172_GEAR.wheels[1].axis;
    expect(axis.y * d.legs[1].set).toBeLessThan(0);
    // ...and the aircraft hardly pulls (no toe change).
    expect(Math.abs(lower.heading)).toBeLessThan(1);
    expect(Math.abs(lower.east)).toBeLessThan(0.5);
  }, 30000);

  test('a collapsed nose: the aircraft slides to a stop on its nose, propeller struck and the engine stopped, no crash', () => {
    const rig = drop(C172, C172.nose[2] + 0.3, 'nose', 0.01);
    rig.propPower = [0.05];
    // Wing lift (vertical) falls with the speed squared from lift = weight at the touchdown speed and attitude,
    // and with the pitch attitude to none at 3 degrees nose down (the wing at zero lift); rate damping.
    const W = rig.mass * G0;
    const lift = (r: GearRig) => Math.min(1, (v3.len(r.velocity) / C172.speed) ** 2) * Math.min(1, Math.max(0, (r.euler().pitch + 3 * DEG) / (2 * DEG)));
    rig.loads = (r) => ({
      force: quat.rotateInv(r.orientation, { x: 0, y: 0, z: -W * lift(r) }),
      moment: { x: -1500 * r.angularVelocity.x, y: -3400 * r.angularVelocity.y, z: -3400 * r.angularVelocity.z },
    });
    rig.run(25, (o) => o.crash !== '');
    const o = rig.output;
    const d = o.damage!;
    report('collapsed nose slide', { speed: v3.len(rig.velocity), pitchDeg: rig.euler().pitch / DEG, north: rig.position.x, events: d.events.map((e) => e.text).join('; ') });
    expect(o.crash).toBe('');
    expect(d.legs[0].status).toBe('collapsed');
    expect(d.airframe.nose).toBe('damage');
    expect(d.props[0]).toEqual({ struck: true, stopped: true });
    expect(d.events.map((e) => e.text)).toEqual(['Hard landing: inspection required', 'Firewall buckled by the nose gear', 'Nose gear collapsed', 'Propeller strike: engine stopped']);
    expect(v3.len(rig.velocity)).toBeLessThan(0.3);
    expect(rig.euler().pitch).toBeLessThan(-3 * DEG);
    expect(o.onGround).toBe(true);
    // Slid well over 30 m on the cowling (research: 90-180 m from 40 kt at 0.12-0.25 g; this one started at 25 m/s).
    expect(rig.position.x).toBeGreaterThan(30);
    expect(o.wheels[0].compression).toBeGreaterThanOrEqual(C172_GEAR.damage!.legs[0].collapsedCompression);
  }, 30000);

  test('propeller strikes: a light tip strike runs on; a long, deep or high-power strike digs in', () => {
    const tip = C172_GEAR.propellers[0];
    /** The aircraft held nose down so that the lowest blade tip is `depth` under the ground, for `steps` calls. */
    const strike = (depth: number, steps: number, power: number) => {
      const rig = new GearRig(planeEnvironment(), 1100, C172_GEAR);
      rig.propPower = [power];
      rig.orientation = quat.fromEuler(0, -27 * DEG, 0);
      const below = quat.rotate(rig.orientation, { x: tip.hub.x, y: 0, z: tip.hub.z + tip.radius }).z;
      rig.position = { x: 0, y: 0, z: -(120 + below - depth) };
      rig.velocity = { x: 25, y: 0, z: 0 };
      for (let i = 0; i < steps; i++) {
        const p = { ...rig.position };
        rig.step();
        rig.position = p;
        rig.velocity = { x: 25, y: 0, z: 0 };
        rig.angularVelocity = v3.zero();
      }
      return rig.output;
    };
    const light = strike(0.01, 6, 0.1);
    report('tip strike', { events: light.damage!.events.map((e) => e.text).join('; ') });
    expect(light.crash).toBe('');
    expect(light.damage!.props[0]).toEqual({ struck: true, stopped: false });
    expect(light.damage!.events.map((e) => [e.severity, e.text])).toEqual([['damage', 'Propeller strike: engine and propeller inspection required']]);
    expect(strike(0.01, 60, 0.1).damage!.props[0].stopped).toBe(true);
    expect(strike(0.06, 2, 0.1).damage!.props[0].stopped).toBe(true);
    const power = strike(0.01, 2, 0.7).damage!;
    expect(power.props[0].stopped).toBe(true);
    expect(power.events.map((e) => e.severity)).toEqual(['disabling']);
  });

  test('a tip strike in the flight model leaves the engine running; a dug-in strike stops it (piston); a PT6 keeps its gas generator', () => {
    const run = (def: AircraftDefinition, stop: boolean) => {
      const l = def.mass.loadings.maxGross;
      const fm = new BladeElementFlightModel(def, { payload: l.payload, payloadPosition: l.payloadPosition });
      const env = flatEnvironment();
      fm.reset({ position: { x: 0, y: 0, z: -(120 + 2) }, heading: 0, airspeed: 0, onGround: true, engineRunning: true }, env);
      const controls = { ...fm.trimControls };
      const damage = emptyDamage(1);
      if (stop) damage.props[0] = { struck: true, stopped: true };
      fm.restoreDamage(damage);
      for (let i = 0; i < 240 * 3; i++) fm.step(1 / 240, controls, env);
      return fm;
    };
    const runs = run(C172S_DEFINITION, false);
    const stops = run(C172S_DEFINITION, true);
    const pt6 = run(C208_DEFINITION, true);
    report('engine after strike', { runsRpm: runs.state.engine.rpm, stoppedRpm: stops.state.engine.rpm, pt6PropRpm: pt6.state.propeller.rpm, pt6Ng: pt6.state.engine.ng ?? NaN });
    expect(runs.state.engine.rpm).toBeGreaterThan(500);
    expect(stops.state.engine.rpm).toBe(0);
    expect(stops.state.engine.running).toBe(false);
    expect(pt6.state.propeller.rpm).toBe(0);
    expect(pt6.state.engine.ng).toBeGreaterThan(40);
    expect(pt6.state.engine.running).toBe(true);
  }, 30000);

  test('a gear-up landing at landing energy is damage: belly slide, both propellers struck and stopped', () => {
    const t = TYPES[4];
    const rig = typeRig(t.def);
    rig.extension = [0, 0, 0];
    rig.propPower = [0.05, 0.05];
    rig.orientation = quat.fromEuler(0, 3 * DEG, 0);
    rig.position = { x: 0, y: 0, z: -(120 + 2.2) };
    rig.velocity = { x: 75 * KT, y: 0, z: 1 };
    const W = rig.mass * G0;
    rig.loads = (r) => ({ force: quat.rotateInv(r.orientation, { x: 0, y: 0, z: -W * Math.min(1, (r.velocityBody().x / (75 * KT)) ** 2) }), moment: v3.scale(r.angularVelocity, -20000) });
    rig.run(20, (o) => o.crash !== '');
    const d = rig.output.damage!;
    report('PA-34 gear-up', { speed: v3.len(rig.velocity), north: rig.position.x, events: d.events.map((e) => e.text).join('; ') });
    expect(rig.output.crash).toBe('');
    expect(d.airframe.belly).toBe('disabling');
    expect(d.events.some((e) => /^Gear-up landing \(/.test(e.text))).toBe(true);
    expect(d.props).toEqual([{ struck: true, stopped: true }, { struck: true, stopped: true }]);
    expect(v3.len(rig.velocity)).toBeLessThan(0.5);
    expect(rig.output.onGround).toBe(true);
  }, 30000);

  test('wingtip and tail touches at landing energy are damage; a scrape within the tail tolerance is an inspection', () => {
    const rig = typeRig(C172.def);
    rig.orientation = quat.fromEuler(-35 * DEG, 0, 0);
    const tipPos = C172_GEAR.structure[0].position;
    rig.position = { x: 0, y: 0, z: -(120 + quat.rotate(rig.orientation, v3.sub(tipPos, rig.cgOffset)).z + 0.05) };
    rig.run(1.5);
    expect(rig.output.crash).toBe('');
    expect(rig.output.damage!.airframe.wingtipLeft).toBe('damage');

    // Gentle over-rotation onto the tail tie-down (the gear test's servo): an inspection, not a strike.
    const gentle = typeRig(C172.def);
    gentle.loads = (r) => ({ force: v3.zero(), moment: { x: 0, y: 50000 * (0.25 - r.angularVelocity.y), z: 0 } });
    gentle.run(4);
    expect(gentle.output.crash).toBe('');
    expect(gentle.output.damage!.airframe.tail).toBe('inspection');
  });
});

describe('still a crash', () => {
  test('a terrain impact (> 7 m/s), flipping over and water end the flight as before', () => {
    const t = TYPES[0];
    const hard = drop(t, 8, 'mains');
    expect(hard.output.crash).toMatch(/^Terrain impact at \d+ kt, 1\d{3} fpm descent/);
    expect(hard.output.crashKind).toBe('impact');

    const over = typeRig(t.def);
    over.orientation = quat.fromEuler(Math.PI, 0, 0);
    over.position = { x: 0, y: 0, z: -(120 + 1.0) };
    over.run(1.5);
    expect(over.output.crash).toBe('Aircraft flipped over');

    const water = new GearRig(planeEnvironment('water'), 1100, C172_GEAR);
    water.placeOnGround(0, 0.1);
    water.run(1);
    expect(water.output.crash).toMatch(/water/);
  });

  test('the AH-56A has no damage block: its overloaded leg still crashes', () => {
    const gear = ah56Gear();
    expect(gear.damage).toBeUndefined();
    const rig = new GearRig(planeEnvironment(), 8301, gear);
    expect(rig.gear.damageState).toBeNull();
  });
});

describe('the flight model', () => {
  test('keeps integrating after damage; capture, clear on setKinematics, restore (legs, seized engine)', () => {
    const def = C172S_DEFINITION;
    const l = def.mass.loadings.maxGross;
    const fm = new BladeElementFlightModel(def, { payload: l.payload, payloadPosition: l.payloadPosition });
    const env = flatEnvironment();
    fm.reset({ position: { x: 0, y: 0, z: -(120 + 300) }, heading: 0, airspeed: 30, onGround: false, engineRunning: true }, env);
    const controls = { ...fm.trimControls, throttle: 0 };
    // Flat at 4.5 m/s: the nose folds.
    fm.setKinematics({ position: { x: 0, y: 0, z: -(120 + 1.25 + 0.6) }, orientation: quat.fromEuler(0, 0, 0), velocity: { x: 28, y: 0, z: 4.5 }, angularVelocity: v3.zero() });
    const seen: string[] = [];
    for (let i = 0; i < 240 * 10; i++) {
      fm.step(1 / 240, controls, env);
      for (const e of fm.damageEvents) seen.push(e.text);
    }
    const s = fm.state;
    report('flight model flat 4.5 m/s', { crash: s.crashReason || 'none', speed: v3.len(s.velocity), rpm: s.engine.rpm, events: seen.join('; ') });
    expect(s.crashed).toBe(false);
    expect(s.damage).toBeDefined();
    expect(s.damage!.legs[0].status).toBe('collapsed');
    expect(s.damage!.props[0].stopped).toBe(true);
    expect(s.engine.rpm).toBe(0);
    expect(seen).toEqual(s.damage!.events.map((e) => e.text));
    expect(s.wheels[0].compression).toBeGreaterThanOrEqual(C172_GEAR.damage!.legs[0].collapsedCompression);

    const saved = fm.captureDamage()!;
    expect(saved).toEqual(s.damage);
    expect(saved).not.toBe(s.damage);
    const at = { position: { ...s.position }, orientation: { ...s.orientation }, velocity: v3.zero(), angularVelocity: v3.zero() };
    fm.setKinematics(at);
    expect(fm.state.damage!.events).toEqual([]);
    expect(fm.state.damage!.legs[0].status).toBe('ok');
    fm.restoreDamage(saved);
    fm.step(1 / 240, controls, env);
    expect(fm.damageEvents).toEqual([]);
    expect(fm.state.damage).toEqual(saved);
    expect(fm.state.wheels[0].load).toBe(0);
    expect(fm.powerplant.units[0].seized).toBe(true);
    // A new flight clears it all.
    fm.reset({ position: { x: 0, y: 0, z: -(120 + 2) }, heading: 0, airspeed: 0, onGround: true, engineRunning: true }, env);
    expect(fm.state.damage!.events).toEqual([]);
    expect(fm.powerplant.units[0].seized).toBe(false);
  }, 30000);
});
