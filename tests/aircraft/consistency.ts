// One aircraft type is described by several objects (the definition with its geometry, systems, powerplant
// and factories; the presentation with its 3D model data, panel, sound and training type), written by
// different hands, and many facts appear in more than one of them: the hub of a propeller in six places, the
// flap detents in seven. Nothing in the types ties the copies together. definitionInconsistencies() does: it
// compares every copy of a fact it knows about and reports the ones that disagree.
//
// A member that is absent is not compared (the airframe visual of a type is filled in late), so the check holds
// for an unfinished type and tightens by itself as the type is completed.

import { expect } from 'vitest';
import type {
  AircraftDefinition,
  AircraftPresentation,
  AircraftSummary,
  AirframeVisualDef,
  GaugeDef,
} from '../../src/aircraft/types';
import { KT, RAD } from '../../src/core/math';
import { defaultControls, engineControl } from '../../src/core/types';

type Triple = readonly [number, number, number];
type Point = { x: number; y: number; z: number } | Triple;

const triple = (p: Point | undefined): Triple | undefined => (p === undefined ? undefined : 'x' in p ? [p.x, p.y, p.z] : p);
/** Equal within `tol` as a fraction of the larger value (at least of 1). */
const near = (a: number, b: number, tol = 1e-9): boolean => a === b || Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const show = (v: unknown): string => (typeof v === 'number' ? String(Number(v.toPrecision(9))) : JSON.stringify(v));

/**
 * Every fact of one aircraft type that its definition objects state differently, one line each; empty when
 * they agree. `row` is the type's catalogue row (compared only for a type that is no longer a placeholder).
 */
export function definitionInconsistencies(def: AircraftDefinition, pres: AircraftPresentation, row?: AircraftSummary): string[] {
  const out: string[] = [];
  const id = def.id;
  const fail = (what: string): void => void out.push(`${id}: ${what}`);

  /** All the numbers given (absent ones skipped) are the same number. */
  const sameNumber = (what: string, values: Record<string, number | undefined>, tol = 1e-9): void => {
    const given = Object.entries(values).filter((e): e is [string, number] => e[1] !== undefined);
    if (given.some(([, v]) => !near(v, given[0][1], tol))) fail(`${what}: ${given.map(([k, v]) => `${k} ${show(v)}`).join(', ')}`);
  };
  /** All the points given are the same point. */
  const samePoint = (what: string, values: Record<string, Point | undefined>): void => {
    for (const axis of [0, 1, 2] as const) {
      sameNumber(`${what} (${'xyz'[axis]})`, Object.fromEntries(Object.entries(values).map(([k, p]) => [k, triple(p)?.[axis]])), 1e-6);
    }
  };
  /** All the values given are the same (compared as text: ids, kinds, flags). */
  const same = (what: string, values: Record<string, unknown>): void => {
    const given = Object.entries(values).filter(([, v]) => v !== undefined);
    if (given.some(([, v]) => show(v) !== show(given[0][1]))) fail(`${what}: ${given.map(([k, v]) => `${k} ${show(v)}`).join(', ')}`);
  };
  const check = (ok: boolean, what: string): void => {
    if (!ok) fail(what);
  };

  const g = def.geometry;
  const pp = def.powerplant;
  const aero = def.aero();
  const gear = def.gear();
  const controls = defaultControls(def);
  // The airframe visual is filled in late: every part of it may still be missing.
  const visual: Partial<AirframeVisualDef> = pres.visual;
  const cockpit: Partial<AirframeVisualDef['cockpit']> = visual.cockpit ?? {};
  const audio = pres.audio;
  const n = def.engineCount;
  const gauges: readonly GaugeDef[] = pres.panel.gauges;

  // ------------------------------------------------------------------------------------------ identity
  same('id', { definition: def.id, presentation: pres.id, visual: visual.id });
  if (def.placeholder !== true) {
    same('id of the panel and the training type', { definition: def.id, panel: pres.panel.id, training: pres.training.id });
    same('ICAO type', { definition: def.icaoType, training: pres.training.icaoType });
    if (row) {
      same('catalogue row', {
        definition: [def.id, def.name, def.shortName, def.engineCount],
        catalogue: [row.id, row.name, row.shortName, row.engineCount],
      });
    }
  }

  // ------------------------------------------------------------------------------------------ one of everything per engine
  sameNumber('engine count', {
    engineCount: n,
    'powerplant.engines': pp.engines.length,
    'powerplant.fuel.feeds': pp.fuel.feeds.length,
    'geometry.propellers': g.propellers.length,
    'aero().propellers': aero.propellers.length,
    'gear().propellers': gear.propellers.length,
    'visual.props': visual.props?.length,
    'audio.engines': audio.engines.length,
    'defaultControls().engines': controls.engines.length,
    'input.engines': def.input.engines,
    'instrumentSystems.engines': pres.instrumentSystems.engines,
    'panel.ignition.engines': pres.panel.ignition.kind === 'key' ? undefined : pres.panel.ignition.engines,
  });
  for (const gauge of gauges) if (gauge.kind === 'engineDisplay') sameNumber(`engines of gauge '${gauge.id}'`, { engineCount: n, gauge: gauge.engines });
  pp.electrical.alternators.forEach((a, i) => check(a.engine >= 0 && a.engine < n, `alternator ${i} is driven by engine ${a.engine}, of ${n}`));
  for (const vac of pres.instrumentSystems.vacuum?.engines ?? []) check(vac >= 0 && vac < n, `a vacuum pump is driven by engine ${vac}, of ${n}`);

  for (let i = 0; i < Math.min(n, pp.engines.length, g.propellers.length); i++) {
    const unit = pp.engines[i];
    const shared = g.propellers[i];
    const station = aero.propellers[i];
    const disc = gear.propellers[i];
    const prop = visual.props?.[i];
    const voice = audio.engines[i];
    samePoint(`hub of propeller ${i}`, { geometry: shared.hub, powerplant: unit.hub, 'aero()': station?.hub, 'gear()': disc?.hub, visual: prop?.hub });
    sameNumber(`diameter of propeller ${i}`, {
      geometry: shared.diameter,
      powerplant: unit.propeller.diameter,
      'aero() (2 x radius)': station ? 2 * station.radius : undefined,
      'gear() (2 x radius)': disc ? 2 * disc.radius : undefined,
      visual: prop?.diameter,
      audio: voice?.prop.diameterM,
    });
    sameNumber(`blades of propeller ${i}`, { geometry: shared.blades, powerplant: unit.propeller.blades, visual: prop?.blades, audio: voice?.prop.blades });
    sameNumber(`rotation of propeller ${i}`, { geometry: shared.rotation, powerplant: unit.rotation, visual: prop?.rotation });
    if (prop) same(`variable pitch of propeller ${i}`, { powerplant: unit.propeller.pitchControl.kind === 'constantSpeed', visual: prop.variablePitch });
    if (voice) {
      // The sound needs the power to the kilowatt, not to the watt.
      sameNumber(`rated power of engine ${i}`, { powerplant: unit.engine.ratedPower, audio: voice.engine.ratedPowerW }, 5e-3);
      sameNumber(`gear ratio of engine ${i}`, { powerplant: unit.engine.gearRatio, audio: voice.engine.gearRatio });
      sameNumber(`cylinders of engine ${i}`, { powerplant: unit.engine.cylinders, audio: voice.engine.cylinders });
      same(`engine ${i} is a diesel`, { powerplant: unit.engine.kind === 'dieselFadec', audio: voice.engine.combustion === 'diesel' });
    }
    same(`engine ${i}: FADEC`, { 'engine.kind': unit.engine.kind === 'dieselFadec', 'engine.fadec': unit.engine.fadec !== undefined, 'input.ignition': def.input.ignition === 'engineMaster' });
  }

  // ------------------------------------------------------------------------------------------ control travels
  sameNumber('elevator up travel', { geometry: g.hTail.elevator.maxUp, controls: def.controls.elevator.maxUp });
  sameNumber('elevator down travel', { geometry: g.hTail.elevator.maxDown, controls: def.controls.elevator.maxDown });
  sameNumber('aileron up travel', { geometry: g.wing.aileron.maxUp, controls: def.controls.aileron.maxUp });
  sameNumber('aileron down travel', { geometry: g.wing.aileron.maxDown, controls: def.controls.aileron.maxDown });
  sameNumber('rudder travel', { geometry: g.vTail.rudder.maxDeflection, controls: def.controls.rudder.maxDeflection });
  sameNumber('rudder travel to the right', {
    geometry: g.vTail.rudder.maxRight ?? g.vTail.rudder.maxDeflection,
    controls: def.controls.rudder.maxRight ?? def.controls.rudder.maxDeflection,
  });

  // ------------------------------------------------------------------------------------------ flaps
  const flaps = def.controls.flaps;
  const detents = flaps.detents;
  sameNumber('flap maximum', {
    'controls.flaps.maxDeflection': flaps.maxDeflection,
    'last detent': detents[detents.length - 1],
    geometry: g.wing.flap.maxDeflection,
    visual: visual.wing?.flap.maxDeflection,
    audio: audio.flapMaxRad,
  });
  check(detents[0] === 0 && detents.every((d, i) => i === 0 || d > detents[i - 1]), `flap detents ascend from 0: ${show(detents)}`);
  sameNumber('number of flap detents', {
    'controls.flaps.detents': detents.length,
    'input.flapDetents': def.input.flapDetents.length,
    'limits.vfeCas': def.limits.vfeCas.length,
    'reference.vfe + 1': def.reference.vfe.length + 1,
    'training.flapDetentsDeg': def.placeholder === true ? undefined : pres.training.flapDetentsDeg.length,
  });
  detents.forEach((d, i) => {
    sameNumber(`lever value of flap detent ${i}`, { 'detent / maxDeflection': d / flaps.maxDeflection, 'input.flapDetents': def.input.flapDetents[i] });
    if (def.placeholder === true) return;
    const deg = pres.training.flapDetentsDeg[i];
    sameNumber(`flap detent ${i}, degrees`, { controls: d * RAD, training: deg }, 1e-6);
    if (deg !== undefined) sameNumber(`training lever value of flaps ${deg}`, { 'input.flapDetents': def.input.flapDetents[i], 'training.flapLeverForDeg': pres.training.flapLeverForDeg[deg] });
  });
  same('electric flaps', { 'controls.flaps.drive': flaps.drive.kind === 'electric', 'audio.flapMotor': audio.flapMotor });
  check(def.limits.vfeCas[0] === Infinity, `limits.vfeCas[0] (clean) is ${show(def.limits.vfeCas[0])}, not Infinity`);
  def.reference.vfe.forEach((kias, k) => {
    // Indicated against calibrated: the two may differ by the position error at that flap setting.
    const cas = def.limits.vfeCas[k + 1];
    if (cas !== undefined) check(Math.abs(cas / KT - kias) <= 6, `flap limit of detent ${k + 1}: limits.vfeCas ${show(cas / KT)} kt, reference.vfe ${kias} KIAS`);
  });

  // ------------------------------------------------------------------------------------------ landing gear
  const contacts = [g.gear.nose, g.gear.leftMain, g.gear.rightMain];
  const radii = [g.gear.noseWheelRadius, g.gear.mainWheelRadius, g.gear.mainWheelRadius];
  gear.wheels.forEach((w, i) => {
    samePoint(`contact point of the ${w.name} wheel`, { geometry: contacts[i], 'gear()': w.position, visual: visual.gear?.[i].contact });
    sameNumber(`radius of the ${w.name} wheel`, { geometry: radii[i], 'gear()': w.tyre.radius, visual: visual.gear?.[i].radius }, 1e-6);
  });
  const retractable = g.gear.retractable;
  same('retractable gear', {
    'geometry.gear.retractable': retractable,
    'gear().retract': gear.retract !== undefined,
    'input.has.gear': def.input.has.gear,
    'audio.gear': audio.gear !== null,
    'visual.gear[].retract': visual.gear ? visual.gear.every((w) => w.retract !== undefined) : undefined,
    'limits.vleCas': def.limits.vleCas !== undefined,
    'reference.vle': def.reference.vle !== undefined,
  });
  if (retractable) {
    gear.wheels.forEach((w) => check(w.stowed !== undefined, `retractable, but the ${w.name} wheel has no stowed position`));
    check(gauges.some((gauge) => gauge.kind === 'gearLights'), 'retractable, but the panel has no gear lights');
  }
  const steering = gear.wheels[0].steering;
  const castering = def.controls.steering.kind === 'castering';
  same('castering nosewheel', {
    'controls.steering': castering,
    'gear() nosewheel': steering ? steering.mode === 'castering' : undefined,
    'input.assists.steering': def.input.assists.steering.kind === 'differentialBrake',
    'sim.autoflight.steering': def.sim.autoflight.steering.kind === 'differentialBrake',
  });
  if (!castering && steering) sameNumber('nosewheel angle at full pedal', { geometry: g.gear.maxNoseSteer, 'gear()': steering.maxCommand });

  // ------------------------------------------------------------------------------------------ tail
  same('T-tail', { geometry: g.hTail.mount === 'tTail', visual: visual.tail?.tTail });
  same('stabilator', { geometry: g.hTail.allMoving, visual: visual.tail ? visual.tail.h.kind === 'stabilator' : undefined });
  const pitchTrim = def.controls.pitchTrim;
  if (pitchTrim.kind === 'antiServoTab') {
    check(g.hTail.allMoving, 'an anti-servo tab (controls.pitchTrim), but geometry.hTail is not all-moving');
    if (visual.tail?.h.tab) sameNumber('anti-servo tab gearing', { controls: pitchTrim.gearing, visual: visual.tail.h.tab.gearing ?? 0 });
  }
  if (visual.tail) {
    sameNumber('tailplane span', { geometry: g.hTail.span, visual: visual.tail.h.span });
    sameNumber('tailplane root quarter-chord x', { geometry: g.hTail.quarterChord.x, visual: visual.tail.h.quarterChord.x });
    sameNumber('tailplane tip quarter-chord x', {
      geometry: g.hTail.tipQuarterChordX ?? g.hTail.quarterChord.x,
      visual: visual.tail.h.tipQuarterChordX ?? visual.tail.h.quarterChord.x,
    });
  }

  // ------------------------------------------------------------------------------------------ levers against mechanisms
  const has = def.input.has;
  pp.engines.forEach((unit, i) => {
    const e = unit.engine;
    const pitch = unit.propeller.pitchControl;
    const fadec = e.fadec !== undefined;
    same(`mixture lever (engine ${i})`, { 'input.has.mixture': has.mixture, powerplant: e.metering.kind !== 'fadecDiesel' });
    // A FADEC engine governs its own propeller: no propeller lever, feathering by the engine master.
    same(`propeller lever (engine ${i})`, { 'input.has.propeller': has.propeller, powerplant: pitch.kind === 'constantSpeed' && !fadec });
    same(`feathering by the propeller lever (engine ${i})`, { 'input.has.feather': has.feather, powerplant: pitch.kind === 'constantSpeed' && pitch.feather !== undefined && !fadec });
    same(`carburettor heat (engine ${i})`, { 'input.has.carbHeat': has.carbHeat, powerplant: e.induction.carburettor !== undefined });
    same(`alternate air (engine ${i})`, { 'input.has.alternateAir': has.alternateAir, powerplant: e.induction.alternateAir !== undefined });
    same(`cowl flaps (engine ${i})`, { 'input.has.cowlFlaps': has.cowlFlaps, powerplant: e.thermal.cowlFlapClosedFactor !== 1 });
    const feed = pp.fuel.feeds[i];
    if (!feed) return;
    same(`electric fuel pump (engine ${i})`, { 'input.has.fuelPump': has.fuelPump, powerplant: feed.auxPump !== undefined });
    for (const [position, tanks] of Object.entries(feed.positions)) {
      for (const tank of tanks ?? []) check(tank >= 0 && tank < pp.fuel.tanks.length, `feed ${i}, selector '${position}' draws tank ${tank}, of ${pp.fuel.tanks.length}`);
    }
    for (const position of def.input.fuelSelectorCycle) {
      if (position !== 'off') check(feed.positions[position] !== undefined, `the selector key reaches '${position}', which feed ${i} does not have`);
    }
    const start = engineControl(controls, i, 'fuelSelector');
    check(feed.positions[start] !== undefined, `the default fuel selector position '${start}' shuts feed ${i}`);
  });
  same('cockpit rudder trim', { 'input.has.rudderTrim': has.rudderTrim, 'controls.rudder.trim': def.controls.rudder.trim !== undefined });

  // ------------------------------------------------------------------------------------------ electrical
  const el = pp.electrical;
  sameNumber('bus-dead voltage', { 'powerplant.electrical': el.busDeadVolts, instrumentSystems: pres.instrumentSystems.busDeadVolts });
  const volts: Record<string, number | undefined> = {
    'electrical.lowVoltsLamp': el.lowVoltsLamp,
    'electrical.busDeadVolts': el.busDeadVolts,
    'audio.busPoweredV': audio.busPoweredV,
    'controls.flaps.drive.minVolts': flaps.drive.kind === 'electric' ? flaps.drive.minVolts : undefined,
    'controls.trimDrive.minVolts': def.controls.trimDrive?.minVolts,
    'gear().retract.minBusVolts': gear.retract?.minBusVolts,
  };
  pp.fuel.feeds.forEach((feed, i) => (volts[`feed ${i} auxPump.minVolts`] = feed.auxPump?.minVolts));
  pp.engines.forEach((unit, i) => (volts[`engine ${i} fadec.minBusVolts`] = unit.engine.fadec?.minBusVolts));
  for (const [what, v] of Object.entries(volts)) {
    if (v !== undefined) check(v < el.regulatorVolts && v > el.nominalVolts / 2, `${what} is ${show(v)} V on a ${el.nominalVolts} V system regulated at ${show(el.regulatorVolts)} V`);
  }
  check(el.overVolts > el.regulatorVolts, `electrical.overVolts ${show(el.overVolts)} is not above the regulator's ${show(el.regulatorVolts)} V`);

  // ------------------------------------------------------------------------------------------ speeds
  const r = def.reference;
  for (const gauge of gauges) {
    if (gauge.kind !== 'asi') continue;
    // Within a knot: the reference speeds are whole knots, a dial marked in mph gives fractions.
    const KNOT = 1 / 100;
    sameNumber('airspeed red line', { 'reference.vne': r.vne, 'asi.redLine': gauge.marks.redLine }, KNOT);
    sameNumber('airspeed blue line', { 'reference.vyse': r.vyse, 'asi.blueLine': gauge.marks.blueLine }, KNOT);
    sameNumber('airspeed red radial', { 'reference.vmca': r.vmca, 'asi.redRadial': gauge.marks.redRadial }, KNOT);
  }
  if (n === 2) check(r.vmca !== undefined && r.vyse !== undefined, 'a twin without reference.vmca or reference.vyse');
  const ascending: [string, number | undefined][] = [['vs0', r.vs0], ['vs1', r.vs1], ['vx', r.vx], ['vy', r.vy], ['vno', r.vno], ['vne', r.vne]];
  ascending.forEach(([name, v], i) => {
    const before = ascending[i - 1];
    if (before && v !== undefined && before[1] !== undefined) check(before[1] <= v, `reference.${before[0]} ${before[1]} is above reference.${name} ${v}`);
  });
  if (r.vmca !== undefined && r.vyse !== undefined) check(r.vmca < r.vyse, `reference.vmca ${r.vmca} is not below reference.vyse ${r.vyse}`);
  r.vfe.forEach((v, k) => check(k === 0 || v <= r.vfe[k - 1], `reference.vfe rises with flap: ${show(r.vfe)}`));
  check(def.limits.diveSpeedCas > r.vne * KT, `limits.diveSpeedCas ${show(def.limits.diveSpeedCas / KT)} kt is not above Vne ${r.vne}`);
  if (def.placeholder !== true) {
    const v = pres.training.vspeeds;
    const pairs: [string, number | undefined, number | undefined][] = [
      ['vs0', r.vs0, v.Vs0], ['vs1', r.vs1, v.Vs1], ['vr', r.vr, v.Vr], ['vx', r.vx, v.Vx], ['vy', r.vy, v.Vy], ['vglide', r.vglide, v.Vglide],
      ['va', r.va, v.Va], ['vno', r.vno, v.Vno], ['vne', r.vne, v.Vne], ['vapp', r.vapp, v.Vapp], ['vref', r.vref, v.Vref],
      ['vcruise', r.vcruise, v.Vcruise], ['vdownwind', r.vdownwind, v.Vdownwind],
    ];
    for (const [name, reference, training] of pairs) sameNumber(`speed ${name}`, { reference, training });
    sameNumber('positive limit load factor', { limits: def.limits.loadFactorPositive, training: pres.training.limits.gPos });
    sameNumber('negative limit load factor', { limits: def.limits.loadFactorNegative, training: pres.training.limits.gNeg });
  }

  // ------------------------------------------------------------------------------------------ geometry against its two readers
  samePoint("pilot's eye", { geometry: g.fuselage.pilotEye, visual: cockpit.pilotEye });
  sameNumber('reference area', { geometry: g.wing.area, 'aero()': aero.referenceArea });
  sameNumber('reference span', { geometry: g.wing.span, 'aero()': aero.referenceSpan });
  sameNumber('reference chord', { geometry: g.wing.meanChord, 'aero()': aero.referenceChord });
  const stripArea = aero.wing.reduce((sum, s) => sum + s.area, 0);
  check(Math.abs(stripArea / g.wing.area - 1) <= 0.03, `the wing strips of aero() cover ${show(stripArea)} m^2, geometry.wing.area is ${show(g.wing.area)} m^2`);
  const breaks = g.wing.breaks;
  if (breaks) {
    check(breaks.length >= 2 && breaks[0].y === 0 && breaks.every((b, i) => i === 0 || b.y >= breaks[i - 1].y), `geometry.wing.breaks ascend in y from 0: ${show(breaks.map((b) => b.y))}`);
    sameNumber('root chord', { 'geometry.wing.rootChord': g.wing.rootChord, 'first break': breaks[0]?.chord });
    sameNumber('tip chord', { 'geometry.wing.tipChord': g.wing.tipChord, 'last break': breaks[breaks.length - 1]?.chord });
    if (visual.wing) {
      // Station by station; the two stations of a step may stand a few millimetres apart in the visual.
      const shared = breaks.filter((b) => b.y > g.wing.rootY);
      const drawn = visual.wing.breaks.filter((b) => b.y > g.wing.rootY);
      sameNumber('wing stations outboard of the root', { geometry: shared.length, visual: drawn.length });
      shared.slice(0, drawn.length).forEach((b, i) => {
        check(Math.abs(b.y - drawn[i].y) <= 0.005, `wing station ${i} outboard of the root: geometry y ${show(b.y)}, visual y ${show(drawn[i].y)}`);
        sameNumber(`chord at wing station y = ${show(b.y)}`, { geometry: b.chord, visual: drawn[i].chord }, 1e-6);
        sameNumber(`quarter-chord x at wing station y = ${show(b.y)}`, { geometry: b.qcX, visual: drawn[i].qcX }, 1e-6);
      });
    }
  }
  if (visual.wing) {
    same('wing mount', { geometry: g.wing.mount, visual: visual.wing.mount });
    sameNumber('wing root station', { geometry: g.wing.rootY, visual: visual.wing.rootY });
    sameNumber('dihedral', { geometry: g.wing.dihedral, visual: visual.wing.dihedral });
    same('winglet', { geometry: g.wing.winglet !== undefined, visual: visual.wing.tip.winglet !== undefined });
  }
  const segments = g.wing.flap.segments;
  if (segments) {
    sameNumber('inboard end of the flap', { 'geometry.wing.flap.innerY': g.wing.flap.innerY, 'first segment': segments[0]?.innerY });
    sameNumber('outboard end of the flap', { 'geometry.wing.flap.outerY': g.wing.flap.outerY, 'last segment': segments[segments.length - 1]?.outerY });
  }

  // ------------------------------------------------------------------------------------------ mass
  const m = def.mass;
  const fuel = pp.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
  const gross = m.empty + m.loadings.maxGross.payload + fuel * (m.loadings.maxGross.fuelFraction ?? 1);
  check(Math.abs(gross - m.maxTakeoff) <= 1, `empty + maxGross payload + fuel is ${show(gross)} kg, mass.maxTakeoff is ${show(m.maxTakeoff)} kg`);
  check(m.maxLanding <= m.maxTakeoff, `mass.maxLanding ${show(m.maxLanding)} is above mass.maxTakeoff ${show(m.maxTakeoff)}`);
  for (const [name, l] of Object.entries(m.loadings)) {
    const mass = m.empty + l.payload + fuel * (l.fuelFraction ?? 1);
    check(mass <= m.maxTakeoff + 1, `loading '${name}' weighs ${show(mass)} kg, above mass.maxTakeoff ${show(m.maxTakeoff)} kg`);
  }
  sameNumber('air-data reference mass', { 'airData.referenceMass': def.airData.calibration.length > 0 ? def.airData.referenceMass : undefined, 'mass.maxTakeoff': m.maxTakeoff });

  return out;
}

/** Fails the running test with every fact the definition objects of one type state differently. */
export function assertDefinitionConsistent(def: AircraftDefinition, pres: AircraftPresentation, row?: AircraftSummary): void {
  expect(definitionInconsistencies(def, pres, row)).toEqual([]);
}
