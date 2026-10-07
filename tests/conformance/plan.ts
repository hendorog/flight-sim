// The conformance blocks as data: what each block measures (with the functions of tests/fdm/measure.ts) and the
// Band or Range every number is judged against, without the test runner. suite.ts registers a plan as vitest
// tests; scripts/aircraft-report.mjs runs the same plan in node and prints measured against target.
//
// A block measures once, in its first item that asks (once()); its items read that measurement. Blocks are in the
// quick tier (trims and short flights, every `vitest run`) or the flown tier (stalls, ground rolls, cruise and
// the climb table, systems, the flown engine cut: FS_AIRCRAFT).
//
// Loadings: performance at 'maxGross' (MTOW), stalls at 'forward', the twin block at 'aft' (contract 3.4).

import { DEG, FT } from '../../src/core/math';
import type { AircraftDefinition, MassDef } from '../../src/aircraft/types';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { at, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import {
  LOW_TERRAIN,
  bestClimb,
  bestGlide,
  carbHeatDrop,
  cruiseSpeed,
  engineCut,
  flapLever,
  gearDownClimbLoss,
  gearTransit,
  handsOff,
  impossibleClimb,
  landingRoll,
  magnetoDrop,
  maxLevelSpeed,
  minTime,
  oeiClimb,
  parkedDrift,
  pedalFraction,
  powerYaw,
  resetCost,
  restOnGround,
  rigPointRudder,
  runwayRig,
  stallRecovery,
  stallRun,
  staticRun,
  subStepCost,
  takeoffRoll,
  taxi,
  trimEnvelope,
  trimWheel,
  vmcaSecant,
  zeroThrustClimb,
  type AnyRig,
  type FailedSide,
  type VmcaResult,
} from '../fdm/measure';
import { OPEN_REQUESTS } from './requests';
import { isBand, range, type ConformanceTargets, type Limit, type SystemsTargets, type TwinTargets } from './targets';

/** Whether a measured value meets a limit (NaN never does). */
export function within(m: number, l: Limit): boolean {
  return isBand(l) ? Math.abs(m - l.target) <= l.tol : m >= l.min && m <= l.max;
}

/**
 * The verdict on one item: 'skip' while the limit's blockedBy request is open (met or not), else 'pass' / 'fail'.
 * `open`: the open request ids (default OPEN_REQUESTS).
 */
export function judge(m: number, l: Limit, open: readonly string[] = OPEN_REQUESTS): 'pass' | 'fail' | 'skip' {
  if (l.blockedBy !== undefined && open.includes(l.blockedBy)) return 'skip';
  return within(m, l) ? 'pass' : 'fail';
}

/** A number as the [conformance] lines print it. */
export const num = (v: number) => (v !== 0 && Math.abs(v) < 0.01 ? v.toExponential(2) : v.toFixed(2));

/** "target 53.00 +- 2.12 KCAS (POH)" / "0.20 .. 0.35 (source)". */
export function describeLimit(l: Limit, unit = ''): string {
  const u = unit ? ` ${unit}` : '';
  const text = isBand(l)
    ? `target ${num(l.target)} +- ${num(l.tol)}${u}`
    : l.min === -Infinity
      ? `< ${num(l.max)}${u}`
      : l.max === Infinity
        ? `> ${num(l.min)}${u}`
        : `${num(l.min)} .. ${num(l.max)}${u}`;
  return `${text} (${l.source}${l.blockedBy ? `; blocked by ${l.blockedBy}` : ''})`;
}

/** Measure once (in the first item that asks), remember a failure as well as a result. */
export function once<T>(f: () => T): () => T {
  let done = false, value: T, error: unknown;
  return () => {
    if (!done) {
      done = true;
      try {
        value = f();
      } catch (e) {
        error = e;
      }
    }
    if (error !== undefined) throw error;
    return value;
  };
}

/** The outcome of a check item: its report line and verdict ('skip' with the note that says why). */
export interface CheckResult {
  line: string;
  verdict: 'pass' | 'fail' | 'skip';
  note?: string;
}

/**
 * One item of a block. 'value': a number judged against a limit (a limit that depends on the definition is a
 * function: the labels are made before it loads). 'flag': a yes / no. 'check': a judgement of its own.
 */
export type PlanItem =
  | { kind: 'value'; label: string; value: () => number; limit: Limit | (() => Limit); unit: string }
  | { kind: 'flag'; label: string; value: () => boolean }
  | { kind: 'check'; label: string; run: () => CheckResult };

export type Tier = 'quick' | 'flown';

export interface PlanBlock {
  name: string;
  tier: Tier;
  items: PlanItem[];
}

const value = (label: string, v: () => number, limit: Limit | (() => Limit), unit: string): PlanItem => ({ kind: 'value', label, value: v, limit, unit });
const flag = (label: string, v: () => boolean): PlanItem => ({ kind: 'flag', label, value: v });

type LoadingName = keyof MassDef['loadings'];
/** The definition, read when a block measures (it may load after the plan is made). */
export type DefinitionOf = () => AircraftDefinition;

const rigOf = (def: DefinitionOf) => (loading: LoadingName, env = flatEnvironment()): AnyRig => makeRig({ def: def(), loading, env });
const lowRigOf = (def: DefinitionOf) => (loading: LoadingName = 'maxGross') => rigOf(def)(loading, flatEnvironment(undefined, LOW_TERRAIN));

/** Engines in the item names: the count comes from the targets (the names are made before the definition loads). */
const engineNames = (twin: boolean) => ({ engines: twin ? 2 : 1, name: (e: number) => (twin ? `, engine ${e + 1}` : '') });

// ------------------------------------------------------------------------------------------------ quick tier

/** Mass at the maxGross loading, the rest on the ground and the idle rpm. */
export function massBlock(t: Pick<ConformanceTargets, 'ground' | 'twin'>, def: DefinitionOf): PlanBlock {
  const rig = rigOf(def);
  const { engines, name } = engineNames(t.twin !== undefined);
  const m = once(() => ({ mass: rig('maxGross').fm.massProperties.mass, rest: restOnGround(rig('maxGross')) }));
  const items = [
    value('mass at the maxGross loading, kg', () => m().mass, () => ({ target: def().mass.maxTakeoff, tol: 0.5, source: 'MassDef.maxTakeoff' }), 'kg'),
    flag('at rest: every wheel on the ground, parking brake set', () => m().rest.allWheelsOnGround && m().rest.parkingBrake),
    value('rest height of the reference point', () => m().rest.height, t.ground.restHeightM, 'm'),
  ];
  for (let e = 0; e < engines; e++) items.push(value(`idle rpm on the ground${name(e)}`, () => m().rest.idleRpm[e], t.ground.idleRpm, 'rpm'));
  return { name: 'mass and rest', tier: 'quick', items };
}

/** Trim-ability and the hands-off cruise, on ONE rig in trim.test.ts's order (targets.ts `trim`). */
export function trimBlock(t: Pick<ConformanceTargets, 'trim' | 'handsOff'>, def: DefinitionOf): PlanBlock {
  const tr = t.trim, h = t.handsOff;
  const rig = rigOf(def);
  const r = once(() => {
    const one = rig('maxGross');
    const envelope = trimEnvelope(one, tr.cases);
    const wheel = trimWheel(one, tr.wheel);
    const pinned = tr.impossibleClimb ? impossibleClimb(one, tr.impossibleClimb) : undefined;
    return { envelope, wheel, pinned, handsOff: handsOff(one, { kt: h.kt, ftAboveField: h.ftAboveField, seconds: h.seconds }) };
  });
  const items: PlanItem[] = [];
  tr.cases.forEach((c, i) => {
    const name = `${c.kt} KTAS${c.flaps ? ` flaps ${c.flaps}` : ''}${c.fpaDeg ? ` path ${c.fpaDeg} deg` : ''}${c.engineRunning === false ? ' engine off' : ''}${c.ftMsl !== undefined ? ` ${c.ftMsl} ft` : c.ftAboveField !== undefined ? ` ${c.ftAboveField} ft AGL` : ''}`;
    items.push(flag(`trim converges: ${name}`, () => r().envelope[i].converged));
    items.push(value(`trim residual: ${name}`, () => r().envelope[i].residual, range(0, tr.maxResidual, 'trim tolerance'), ''));
    items.push(value(`body rate 0.5 s after the trim: ${name}`, () => r().envelope[i].rate / DEG, range(0, tr.maxRateDegS, 'steady start'), 'deg/s'));
  });
  const w = `trim at ${tr.wheel.kt} KTAS`;
  items.push(value(`${w}: yoke`, () => r().wheel.yoke, range(-5e-7, 5e-7, 'hands-off: the trim wheel holds it'), ''));
  items.push(value(`${w}: trim wheel`, () => r().wheel.wheel, range(-tr.wheel.maxWheel, tr.wheel.maxWheel, 'inside the wheel travel'), ''));
  items.push(value(`${w}: slip ball`, () => r().wheel.slipBall, range(-tr.wheel.maxBall, tr.wheel.maxBall, 'ball centred'), ''));
  items.push(value(`${w}: g along the body normal - cos(pitch)`, () => r().wheel.gLoadError, range(-5e-4, 5e-4, 'outputs describe the trimmed state'), 'g'));
  const p = tr.impossibleClimb;
  if (p) {
    const n = `${p.fpaDeg} deg climb asked at ${p.kt} KTAS`;
    items.push(flag(`${n}: the trim converges`, () => r().pinned!.converged));
    items.push(value(`${n}: throttle pinned`, () => r().pinned!.throttle, range(1, 1, 'full throttle'), ''));
    items.push(value(`${n}: flight path solved`, () => r().pinned!.fpaDeg, range(-Infinity, p.maxFpaDeg, 'below the asked path'), 'deg'));
  }
  items.push(value(`hands-off cruise ${h.seconds} s: altitude drift`, () => r().handsOff.altDriftM, h.altDriftM, 'm'));
  items.push(value(`hands-off cruise ${h.seconds} s: heading drift`, () => r().handsOff.headingDriftDeg, h.headingDriftDeg, 'deg'));
  items.push(value(`hands-off cruise ${h.seconds} s: max vertical speed`, () => r().handsOff.maxVsFpm, h.maxVsFpm, 'fpm'));
  items.push(value(`hands-off cruise ${h.seconds} s: TAS change`, () => r().handsOff.tasChange, h.tasChangeMps, 'm/s'));
  return { name: 'trim-ability and hands-off cruise', tier: 'quick', items };
}

/** Parked at idle, and the taxi (differential brake on a castering nosewheel). */
export function parkedTaxiBlock(g: Pick<ConformanceTargets['ground'], 'parkedDriftMm' | 'parkedRateDegS' | 'taxi'>, def: DefinitionOf): PlanBlock {
  const rig = rigOf(def);
  const p = once(() => parkedDrift(rig('maxGross')));
  const x = once(() => taxi(rig('maxGross')));
  return {
    name: 'parked and taxi',
    tier: 'quick',
    items: [
      value('parked at idle: drift in 30 s', () => p().drift * 1000, g.parkedDriftMm, 'mm'),
      value('parked at idle: largest body rate', () => p().maxRate / DEG, g.parkedRateDegS, 'deg/s'),
      flag('parked at idle: engines running, every wheel loaded', () => p().running && p().minWheelLoad > 0),
      value('taxi: mean pedal (castering: brake difference) to hold the centreline at 10 kt', () => x().meanSteer, g.taxi.meanSteer, ''),
      value('taxi: largest heading error', () => x().maxHeadingErrorDeg, g.taxi.maxHeadingErrorDeg, 'deg'),
      value('taxi: ground speed', () => x().groundSpeedKt, g.taxi.speedKt, 'kt'),
      value('taxi: turn radius, full right pedal (castering: and full right brake)', () => x().radius, g.taxi.radiusM, 'm'),
      value('taxi: largest yaw acceleration in the steady turn', () => x().maxYawAccel / DEG, g.taxi.maxYawAccelDegS2, 'deg/s^2'),
    ],
  };
}

function staticRunBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const rig = rigOf(def);
  const { engines, name } = engineNames(t.twin !== undefined);
  const s = once(() => staticRun(rig('maxGross')));
  const items: PlanItem[] = [];
  for (let e = 0; e < engines; e++) {
    const n = name(e);
    if (t.staticRun.rpm) items.push(value(`static rpm${n}`, () => s().rpm[e], t.staticRun.rpm, 'rpm'));
    if (t.staticRun.mapInHg) items.push(value(`static manifold pressure${n}`, () => s().mapInHg[e], t.staticRun.mapInHg, 'inHg'));
  }
  items.push(value('static run: ground speed on the parking brake', () => s().groundSpeed, t.staticRun.groundSpeed, 'm/s'));
  return { name: 'static run', tier: 'quick', items };
}

function maxLevelBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const m = t.maxLevel;
  const { engines, name } = engineNames(t.twin !== undefined);
  const r = once(() => maxLevelSpeed(lowRigOf(def)(), { altitude: 0, throttle: m.throttle, bracketKt: m.bracketKt }));
  const items = [value('max level speed, sea level', () => r().ktas, m.ktas, 'KTAS')];
  if (m.rpm) {
    const rpm = m.rpm;
    for (let e = 0; e < engines; e++) items.push(value(`rpm at max level speed${name(e)}`, () => r().rpm[e], rpm, 'rpm'));
  }
  return { name: 'maximum level speed', tier: 'quick', items };
}

function climbBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const c = t.climb;
  const r = once(() => {
    const climb = lowRigOf(def)();
    resetTo(climb, { position: at(300) });
    return bestClimb(climb, { altitude: 0, range: c.range, throttle: c.throttle });
  });
  return {
    name: 'climb',
    tier: 'quick',
    items: [value('best rate of climb, sea level', () => r().rocFpm, c.rocFpm, 'fpm'), value('Vy', () => r().vyKias, c.vyKias, 'KIAS')],
  };
}

function glideBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const g = t.glide;
  const r = once(() => bestGlide(lowRigOf(def)(), { altitude: 300, range: g.range, atKias: g.at?.kias, feathered: g.propeller === 'feathered' }));
  const items = [value('best glide ratio, engines dead', () => r().ratio, g.ratio, ''), value('best glide speed', () => r().bestKias, g.bestKias, 'KIAS')];
  if (g.at) items.push(value(`glide ratio at ${g.at.kias} KIAS`, () => r().ratioAt, g.at.ratio, ''));
  if (g.windmillingRpm) items.push(value('windmilling rpm at best glide', () => r().rpm[0], g.windmillingRpm, 'rpm'));
  return { name: 'glide', tier: 'quick', items };
}

function yawBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const y = t.yaw;
  const r = once(() => powerYaw(rigOf(def)('maxGross'), { ftAboveField: y.ftAboveField, resetKt: y.resetKt, climbKias: y.climbKias, steepKias: y.steep?.kias, cruiseKias: y.cruise?.kias, throttle: y.throttle }));
  const items = [value(`rudder for zero sideslip, full power at ${y.climbKias} KIAS`, () => r().climb, y.climb, '')];
  if (y.steep) items.push(value(`rudder for zero sideslip, full power at ${y.steep.kias} KIAS`, () => r().steep!, y.steep.rudder, ''));
  if (y.cruise) items.push(value(`rudder for zero sideslip, level at ${y.cruise.kias} KIAS`, () => r().cruise!, y.cruise.rudder, ''));
  if (y.rigPoint) {
    const p = y.rigPoint;
    const top = once(() => rigPointRudder(lowRigOf(def)(), p.bracketKt, p.resetKt));
    items.push(value('rudder for zero sideslip, full-throttle level at sea level', () => top().rudder, p.rudder, ''));
  }
  return { name: 'yaw from power', tier: 'quick', items };
}

/**
 * Cost against the C172S measured in the same run (the minimum of five rounds, the two rigs interleaved). `id` names
 * the type in the printed line. Flown tier: the ratios are judged in the gate's conformance run (FS_AIRCRAFT), not in
 * the default suite, where 30 other workers on the laptop made a single reset sample swing by 40 % (D-accept-D2-01).
 */
export function costBlock(id: string, twin: boolean, def: DefinitionOf): PlanBlock {
  const r = once(() => {
    const own = rigOf(def)('maxGross'), ref = makeRig({ def: C172S_DEFINITION, loading: 'maxGross' });
    const kt = Math.min(def().reference.vcruise, 120);
    let step = Infinity, stepRef = Infinity;
    for (let i = 0; i < 5; i++) {
      step = Math.min(step, subStepCost(own, { kt }));
      stepRef = Math.min(stepRef, subStepCost(ref, { kt: 105 }));
    }
    let reset = Infinity, resetRef = Infinity;
    for (let i = 0; i < 5; i++) {
      reset = Math.min(reset, minTime(2, () => resetCost(own, { kt })));
      resetRef = Math.min(resetRef, minTime(2, () => resetCost(ref, { kt: 105 })));
    }
    console.log(`[conformance] ${id} cost: physics sub-step ${step.toFixed(1)} us (C172S ${stepRef.toFixed(1)} us); trim + ground reset ${reset.toFixed(1)} ms (C172S ${resetRef.toFixed(1)} ms) (absolute figures: judged at the gate)`);
    return { step: step / stepRef, reset: reset / resetRef };
  });
  return {
    name: 'cost (ratios to the C172S, minimum of five)',
    tier: 'flown',
    items: [
      value('physics sub-step cost / C172S', () => r().step, range(0, twin ? 2.3 : 1.3, twin ? 'contract 3.4 budget (twin < 2.3)' : 'contract 3.10 (single < 1.3)'), ''),
      value('trim + ground reset cost / C172S', () => r().reset, range(0, twin ? 2.6 : 1.3, 'contract 3.10'), ''),
    ],
  };
}

// ------------------------------------------------------------------------------------------------ twin

const SIDES: readonly [FailedSide, string][] = [
  [0, 'left engine failed'],
  [1, 'right engine failed'],
];

/**
 * The twin blocks (contract 3.4 "Engine-out trim", 3.10): pedal fractions, Vmca and the one-engine climb in the
 * quick tier, the flown engine cut in the flown tier. `id` names the type in the printed lines.
 */
export function twinBlocks(id: string, w: TwinTargets, def: DefinitionOf): PlanBlock[] {
  const aft = () => makeRig({ def: def(), loading: 'aft', env: flatEnvironment(undefined, LOW_TERRAIN) });
  const throttle = w.throttle ?? 1;

  const trims = once(() =>
    SIDES.map(([failed]) => {
      const rg = aft();
      const base = { failed, propeller: 'windmilling' as const, altitude: 0, throttle };
      const at110 = pedalFraction(rg, { ...base, kcas: 1.1 * w.vmcaKcas });
      const atVyse = pedalFraction(rg, { ...base, kcas: w.vyseKcas });
      const vmca: VmcaResult = vmcaSecant(rg, { ...base, startKcas: w.vyseKcas });
      return { at110, atVyse, vmca };
    }),
  );
  const pedal: PlanItem[] = [];
  for (const [failed, side] of SIDES) {
    pedal.push(value(`pedal at 1.10 x Vmca (${(1.1 * w.vmcaKcas).toFixed(1)} KCAS), ${side}, windmilling`, () => trims()[failed].at110, w.pedalAt110Vmca, ''));
    pedal.push(value(`pedal at Vyse (${w.vyseKcas} KCAS), ${side}, windmilling`, () => trims()[failed].atVyse, w.pedalAtVyse, ''));
    pedal.push({
      kind: 'check',
      label: `Vmca by secant, ${side}`,
      run: () => {
        const v = trims()[failed].vmca;
        const line = `[conformance] ${id} Vmca, ${side}: ${v.limit}-limited at ${num(v.kcas)} KCAS | ${describeLimit(w.vmca, 'KCAS')} (points ${v.points.map(([k, p]) => `${k.toFixed(1)}:${p.toFixed(3)}`).join(' ')})`;
        // A stall-limited Vmca is judged on the two pedal fractions only (contract 3.4).
        if (v.limit === 'stall') return { line, verdict: 'pass' };
        const verdict = judge(v.kcas, w.vmca);
        return { line, verdict, note: `blocked by ${w.vmca.blockedBy}: Vmca ${num(v.kcas)} KCAS` };
      },
    });
  }
  pedal.push({
    kind: 'check',
    label: `left vs right (critical engine: ${w.criticalEngine})`,
    run: () => {
      const [l, rt] = trims();
      const line = `[conformance] ${id} left vs right: pedal at 1.10 x Vmca ${num(l.at110)} / ${num(rt.at110)}; Vmca ${l.vmca.limit} ${num(l.vmca.kcas)} / ${rt.vmca.limit} ${num(rt.vmca.kcas)} KCAS (${w.sides.source})`;
      let ok: boolean;
      if (w.criticalEngine === 'none') {
        const bothRudder = l.vmca.limit === 'rudder' && rt.vmca.limit === 'rudder';
        ok = (bothRudder && Math.abs(l.vmca.kcas - rt.vmca.kcas) <= w.sides.vmcaKt) || Math.abs(l.at110 - rt.at110) <= w.sides.pedal;
      } else if (w.criticalEngine === 'left') ok = l.at110 > rt.at110;
      else ok = rt.at110 > l.at110;
      return { line, verdict: ok ? 'pass' : 'fail' };
    },
  });

  const oeiThrottle = w.oeiThrottle ?? 1;
  const cowl = (failed: FailedSide) => (w.oeiCowlFlaps ? (failed === 0 ? w.oeiCowlFlaps.leftFailed : w.oeiCowlFlaps.rightFailed) : undefined);
  const climbs = once(() =>
    SIDES.map(([failed]) => {
      const rg = aft();
      const base = { failed, kcas: w.vyseKcas, throttle: oeiThrottle, cowlFlaps: cowl(failed) };
      const rows = w.oeiClimb.map((row) => oeiClimb(rg, { ...base, propeller: 'feathered', altitude: row.altitudeFt * FT }));
      const feathered = oeiClimb(rg, { ...base, propeller: 'feathered', altitude: 0 });
      const windmilling = oeiClimb(rg, { ...base, propeller: 'windmilling', altitude: 0 });
      const zeroThrust = w.zeroThrust ? zeroThrustClimb(rg, { dead: failed, setting: w.zeroThrust.controls, kcas: w.vyseKcas, altitude: 0, throttle: oeiThrottle, cowlFlaps: cowl(failed) }) : NaN;
      return { rows, loss: feathered - windmilling, zeroThrust: zeroThrust - feathered };
    }),
  );
  const oei: PlanItem[] = [];
  for (const [failed, side] of SIDES) {
    w.oeiClimb.forEach((row, i) => oei.push(value(`OEI climb at Vyse, ${row.altitudeFt} ft, ${side}, feathered`, () => climbs()[failed].rows[i], row.fpm, 'fpm')));
    oei.push(value(`OEI climb lost windmilling instead of feathered, ${side}`, () => climbs()[failed].loss, w.windmillingLossFpm, 'fpm'));
    if (w.zeroThrust) {
      const z = w.zeroThrust;
      oei.push(value(`zero-thrust setting against feathered, ${side}`, () => climbs()[failed].zeroThrust, range(-z.withinFpm, z.withinFpm, z.source, z.blockedBy), 'fpm'));
    }
  }

  const cuts = once(() => SIDES.map(([failed]) => engineCut(makeRig({ def: def(), loading: 'aft' }), { failed, kcas: w.vmcaKcas + 5 })));
  const cut: PlanItem[] = [];
  for (const [failed, side] of SIDES) {
    cut.push(value(`engine cut at Vmca + 5 kt, ${side}: largest heading change`, () => cuts()[failed].maxHeadingChangeDeg, w.engineCut.maxHeadingChangeDeg, 'deg'));
    const minVs = w.engineCut.minVerticalSpeedFpm;
    if (minVs === undefined) cut.push(flag(`engine cut at Vmca + 5 kt, ${side}: recovered, no crash`, () => cuts()[failed].recovered));
    else {
      // A marginal twin cannot hold its height with the dead engine windmilling: judged on its own capability.
      cut.push(value(`engine cut at Vmca + 5 kt, ${side}: vertical speed at the end, windmilling`, () => cuts()[failed].verticalSpeedFpm, minVs, 'fpm'));
      cut.push(flag(`engine cut at Vmca + 5 kt, ${side}: no crash`, () => !cuts()[failed].crashed));
    }
  }

  return [
    { name: 'twin: pedal fractions and Vmca', tier: 'quick', items: pedal },
    { name: 'twin: one-engine climb', tier: 'quick', items: oei },
    { name: 'twin: engine cut', tier: 'flown', items: cut },
  ];
}

// ------------------------------------------------------------------------------------------------ flown tier

function stallBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const items: PlanItem[] = [];
  for (const [name, s] of [['clean', t.stall.clean], ['landing flap', t.stall.landing]] as const) {
    const r = once(() => stallRun(rigOf(def)('forward'), { flapLever: flapLever(def(), s.flapDeg), entryKt: s.entryKt }));
    items.push(value(`stall speed ${name} (flaps ${s.flapDeg}), forward CG (V_S1g)`, () => r().vs1g, s.vs1gKcas, 'KCAS'));
    items.push(value(`stall warning margin ${name}`, () => r().warningCas - r().vs1g, s.warningMarginKt, 'kt'));
  }
  return { name: 'stalls', tier: 'flown', items };
}

function stallRecoveryBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const s = t.stallRecovery;
  const r = once(() => stallRecovery(rigOf(def)('maxGross'), { entryKias: s.entryKias }));
  return {
    name: 'stall recovery',
    tier: 'flown',
    items: [
      flag('stall recovery: the wing stalled while the stick was held back', () => r().stalledFraction > 0.2),
      value('stall recovery: time to unstall after the stick goes forward', () => r().recoveryTime, s.recoveryS, 's'),
      flag('stall recovery: no crash', () => !r().crashed),
    ],
  };
}

/** Take-off and landing ground rolls (on a castering nosewheel: steered with the brakes). */
export function groundRollBlock(t: Pick<ConformanceTargets, 'takeoff' | 'landing'>, def: DefinitionOf): PlanBlock {
  const to = t.takeoff, la = t.landing;
  const r = once(() => takeoffRoll(runwayRig(def(), 'maxGross'), { flapLever: flapLever(def(), to.flapDeg), rotateKias: to.rotateKias, pitch: to.pitchDeg * DEG, staticRunUp: to.staticRunUp, controls: to.controls }));
  const l = once(() => landingRoll(runwayRig(def(), 'maxGross'), { approachKt: la.approachKt, flapLever: flapLever(def(), la.flapDeg), touchdownPitch: la.touchdownPitchDeg * DEG, brake: la.brake }));
  return {
    name: 'take-off and landing',
    tier: 'flown',
    items: [
      value(`take-off ground roll, flaps ${to.flapDeg}, rotate ${to.rotateKias} KIAS`, () => r().roll, to.groundRollM, 'm'),
      flag('take-off: no crash, climbing', () => !r().crashed && r().climbing),
      value(`landing ground roll, flaps ${la.flapDeg}, ${la.brake === undefined ? 'maximum braking' : `brakes ${la.brake}`}`, () => l().roll, la.groundRollM, 'm'),
      flag('landing: no crash', () => !l().crashed),
    ],
  };
}

function cruiseClimbBlock(t: ConformanceTargets, def: DefinitionOf): PlanBlock {
  const items: PlanItem[] = [];
  const c = t.cruise;
  if (c) {
    const r = once(() => cruiseSpeed(lowRigOf(def)(), { altitude: c.altitudeFt * FT, powerFraction: c.powerFraction, bracketKt: c.bracketKt, leanAtKt: c.leanAtKt, resetKt: c.resetKt }));
    items.push(value(`${c.powerFraction * 100} % cruise at ${c.altitudeFt} ft`, () => r().ktas, c.ktas, 'KTAS'));
    items.push(value(`  power fraction reached`, () => r().powerFraction, c.powerFractionReached, ''));
    if (c.rpm) items.push(value(`  rpm at ${c.powerFraction * 100} % cruise`, () => r().rpm[0], c.rpm, 'rpm'));
  }
  const table = t.climb.table;
  if (table) {
    // One rig through the rows, reset once at 300 m (performance.test.ts).
    const r = once(() => {
      const climb = lowRigOf(def)();
      resetTo(climb, { position: at(300) });
      return table.rows.map((row) => bestClimb(climb, { altitude: row.ft * FT, range: table.range, throttle: t.climb.throttle, leanAtKt: table.leanAtKt, leanTo: 0.4 }));
    });
    table.rows.forEach((row, i) => items.push(value(`best rate of climb, ${row.ft} ft ISA`, () => r()[i].rocFpm, row.fpm, 'fpm')));
  }
  return { name: 'cruise and climb at altitude', tier: 'flown', items };
}

/** Magneto and carburettor-heat drops, gear transit and the gear-down climb loss (each where the targets have it). */
export function systemsBlock(sys: SystemsTargets, def: DefinitionOf): PlanBlock {
  const rig = rigOf(def);
  const items: PlanItem[] = [];
  if (sys.magnetoDrop) {
    const m = sys.magnetoDrop;
    const r = once(() => magnetoDrop(rig('maxGross'), { rpm: m.rpm }));
    items.push(value(`magneto drop at ${m.rpm} rpm, left magneto`, () => r()[0], m.drop, 'rpm'));
    items.push(value(`magneto drop at ${m.rpm} rpm, right magneto`, () => r()[1], m.drop, 'rpm'));
    items.push(value(`magneto drop difference`, () => Math.abs(r()[0] - r()[1]), m.difference, 'rpm'));
  }
  if (sys.carbHeat) {
    const c = sys.carbHeat;
    const r = once(() => carbHeatDrop(rig('maxGross'), { runUpRpm: c.runUpRpm }));
    items.push(value('carburettor heat rpm drop, full throttle static', () => r().fullThrottle, c.fullThrottle, 'rpm'));
    items.push(value(`carburettor heat rpm drop at ${c.runUpRpm} rpm`, () => r().runUp, c.runUp, 'rpm'));
  }
  if (sys.gearTransit) {
    const g = sys.gearTransit;
    const r = once(() => gearTransit(rig('maxGross'), { kias: g.kias }));
    items.push(value('gear retraction time', () => r().up, g.up, 's'));
    items.push(value('gear extension time', () => r().down, g.down, 's'));
  }
  if (sys.gearDownClimb) {
    const g = sys.gearDownClimb;
    const r = once(() => gearDownClimbLoss(lowRigOf(def)(), { kcas: g.kcas, altitude: 0, throttle: g.throttle }));
    items.push(value(`climb lost with the gear down at ${g.kcas} KCAS`, () => r(), g.lossFpm, 'fpm'));
  }
  return { name: 'systems', tier: 'flown', items };
}

/** Every block of a type, in the suite's order: the quick tier, the twin blocks, then the flown tier. */
export function conformancePlan(t: ConformanceTargets, def: DefinitionOf): PlanBlock[] {
  const blocks: PlanBlock[] = [
    massBlock(t, def),
    trimBlock(t, def),
    parkedTaxiBlock(t.ground, def),
    staticRunBlock(t, def),
    maxLevelBlock(t, def),
    climbBlock(t, def),
    glideBlock(t, def),
    yawBlock(t, def),
    costBlock(t.aircraft, t.twin !== undefined, def),
  ];
  if (t.twin) blocks.push(...twinBlocks(t.aircraft, t.twin, def));
  blocks.push(stallBlock(t, def), stallRecoveryBlock(t, def), groundRollBlock(t, def), cruiseClimbBlock(t, def));
  if (t.systems) blocks.push(systemsBlock(t.systems, def));
  return blocks;
}

/** One measured row of a plan run outside the test runner (aircraft-report). */
export interface PlanRow {
  block: string;
  label: string;
  /** The measured number (NaN for a flag or check), or the error a measurement threw. */
  measured: number;
  /** The limit as describeLimit prints it, 'yes / no' for a flag, the check's line. */
  limit: string;
  unit: string;
  verdict: 'pass' | 'fail' | 'skip' | 'error';
  error?: string;
}

/** Run one block's items in order and return a row per item (errors are rows, not throws). */
export function runBlock(b: PlanBlock): PlanRow[] {
  return b.items.map((it): PlanRow => {
    const row = { block: b.name, label: it.label };
    try {
      if (it.kind === 'value') {
        const limit = typeof it.limit === 'function' ? it.limit() : it.limit;
        const m = it.value();
        return { ...row, measured: m, limit: describeLimit(limit, it.unit), unit: it.unit, verdict: judge(m, limit) };
      }
      if (it.kind === 'flag') {
        const ok = it.value();
        return { ...row, measured: NaN, limit: ok ? 'yes' : 'NO', unit: '', verdict: ok ? 'pass' : 'fail' };
      }
      const r = it.run();
      return { ...row, measured: NaN, limit: r.line, unit: '', verdict: r.verdict };
    } catch (e) {
      return { ...row, measured: NaN, limit: '', unit: '', verdict: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  });
}
