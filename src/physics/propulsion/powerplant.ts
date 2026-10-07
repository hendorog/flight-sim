// The complete powerplant of an aircraft, built from its definition: the engine units (engineUnit.ts), ONE
// fuel system and ONE electrical bus. By default one unit, fed from two tanks, with one alternator: what the
// Cessna 172S has. A twin is two units on the same tanks (each through its own feed and selector) and the same
// bus (each with its own alternator and starter).
//
// Each step:
//   1. electrics  -> bus voltage, starter torques, alternator shaft loads
//   2. induction  -> manifold pressure, air flow, metered fuel demand      (every unit.breathe)
//   3. fuel       -> fuel actually delivered (lines, pumps, selectors, tanks)
//   4. combustion -> indicated torque and losses                           (every unit.finish, with 5 to 7)
//   5. propeller  -> thrust, torque, P-factor loads from the BEMT maps
//   6. shaft      -> I domega/dt = Q_indicated + Q_starter - Q_losses - Q_prop, and the governor
//   7. thermal    -> EGT, CHT, oil temperature and pressure
// and the units' forces, moments and angular momenta are summed for the airframe.

import type { Vec3 } from '../../core/math';
import { engineControl } from '../../core/types';
import type { EngineSnapshot, Powerplant as PowerplantSeam, PowerplantResetOptions, PropulsionInput, PropulsionOutput } from '../interfaces';
import { C172_POWERPLANT } from './c172Powerplant';
import type { PowerplantDef } from './defs';
import { ElectricalSystem } from './electrical';
import { EngineUnit } from './engineUnit';
import { FuelSystem } from './fuelSystem';
import type { Propeller } from './propeller';
import { propellerCharacteristicsFor } from './propellerMap';

/** settle(): time step, s, and the shaft acceleration below which the speed counts as steady, rad/s^2. */
const SETTLE_DT = 1 / 30;
const SETTLE_TOLERANCE = 1e-5;
/** settle(): evaluations of a governed unit at its held speed (the exhaust back pressure lags a step behind the air flow). */
const SETTLE_HELD_PASSES = 3;
/** settle(): the blade angle is searched in steps of this from the fine stop, rad, then bisected to this tolerance. */
const SETTLE_PITCH_STEP = (2 * Math.PI) / 180;
const SETTLE_PITCH_TOLERANCE = 1e-7;
const RPM_TO_RAD_S = (2 * Math.PI) / 60;
/** Slow states of a unit that settle() puts back. */
const SAVED_PER_UNIT = 8;

/** Element i of an option that is one value for all engines or one per engine. */
function perEngine<T extends number | boolean>(value: T | readonly T[], i: number): T {
  return typeof value === 'object' ? value[i] : value;
}

/**
 * Tabulate every propeller map of a powerplant definition now (a constant-speed propeller: all its slices), so
 * that none is built on first use inside the frame loop. For the application, while an aircraft loads; returns
 * the number of maps built.
 */
export function prebuildPropellers(def: PowerplantDef): number {
  let built = 0;
  for (const install of def.engines) built += propellerCharacteristicsFor(install.propeller).prebuild();
  return built;
}

export class Powerplant implements PowerplantSeam {
  readonly units: readonly EngineUnit[];
  readonly fuel: FuelSystem;
  readonly electrical: ElectricalSystem;

  readonly engineCount: number;
  /** Hub positions, reference-point body axes. */
  readonly hubs: readonly Vec3[];
  /** Usable capacity of each tank, kg, in the definition's order. */
  readonly tankCapacities: readonly number[];
  private readonly output: PropulsionOutput;
  /** Crank speed of every engine at the start of the step, rpm and rad/s. */
  private readonly crankRpm: number[];
  private readonly crankOmega: number[];
  private readonly demand: number[];
  /** Per engine: the alternators it drives (indices into the definition's list). */
  private readonly alternatorsOf: readonly (readonly number[])[];
  /** Units with an engine control unit (their ECUs and glow plugs load the bus, and live on it). */
  private readonly fadecUnits: readonly EngineUnit[];
  // settle() scratch.
  private readonly saved: Float64Array;
  private readonly savedTanks: number[];
  private readonly before: Float64Array;
  private readonly d1: Float64Array;
  private readonly d2: Float64Array;
  private readonly sinceJump: Int32Array;
  private readonly held: EngineUnit[] = [];

  /** `propellers`: per engine, a propeller to use instead of one made from the definition. */
  constructor(readonly def: PowerplantDef = C172_POWERPLANT, propellers: readonly (Propeller | undefined)[] = []) {
    const n = def.engines.length;
    if (n < 1) throw new Error('Powerplant: at least one engine');
    if (def.fuel.feeds.length !== n) throw new Error(`Powerplant: ${n} engines need ${n} fuel feeds, not ${def.fuel.feeds.length}`);
    this.units = def.engines.map((install, i) => new EngineUnit(install, i, propellers[i]));
    this.fuel = new FuelSystem(def.fuel);
    this.electrical = new ElectricalSystem(def.electrical, n === 1 ? def.engines[0].engine.starter : def.engines.map((install) => install.engine.starter));
    this.engineCount = n;
    this.hubs = this.units.map((unit) => unit.hub);
    this.tankCapacities = def.fuel.tanks.map((tank) => tank.capacity);
    this.crankRpm = this.units.map(() => 0);
    this.crankOmega = this.units.map(() => 0);
    this.demand = this.units.map(() => 0);
    this.alternatorsOf = this.units.map((_, i) => def.electrical.alternators.flatMap((alternator, a) => (alternator.engine === i ? [a] : [])));
    this.fadecUnits = this.units.filter((unit) => unit.install.engine.fadec !== undefined);
    this.saved = new Float64Array(n * SAVED_PER_UNIT);
    this.savedTanks = def.fuel.tanks.map(() => 0);
    this.before = new Float64Array(n);
    this.d1 = new Float64Array(n);
    this.d2 = new Float64Array(n);
    this.sinceJump = new Int32Array(n);
    const first = this.units[0];
    this.output = {
      force: { x: 0, y: 0, z: 0 },
      moment: { x: 0, y: 0, z: 0 },
      engine: first.state,
      propeller: first.propState,
      slipstream: first.slipstream,
      angularMomentum: { x: 0, y: 0, z: 0 },
      fuelUsed: { left: 0, right: 0 },
      // The lists hold the SAME objects as the singular fields; tanks are in the definition's order.
      engines: this.units.map((unit) => unit.state),
      propellers: this.units.map((unit) => unit.propState),
      slipstreams: this.units.map((unit) => unit.slipstream),
      tanks: def.fuel.tanks.map(() => 0),
      electrical: { busVoltage: 0, batteryCharge: 1, alternatorAmps: 0, batteryAmps: 0, alternators: def.electrical.alternators.map(() => 0) },
    };
    this.reset({ running: false, tanks: this.tankCapacities });
  }

  /** Live usable fuel per tank, kg, in the definition's order (the output's list, kept current). */
  get tankQuantities(): ArrayLike<number> {
    return this.output.tanks;
  }

  /** Battery state of charge, 0..1. */
  get batteryCharge(): number {
    return this.electrical.charge;
  }

  set batteryCharge(charge: number) {
    this.electrical.reset(charge);
  }

  /** Tabulate every propeller map of this powerplant now (see prebuildPropellers). */
  prebuild(): number {
    return prebuildPropellers(this.def);
  }

  private publishTanks(): void {
    const tanks = this.output.tanks;
    const quantities = this.fuel.quantities;
    for (let k = 0; k < tanks.length; k++) tanks[k] = quantities[k];
  }

  /**
   * `rpm` is crank speed. `feathered[i]`: unit i starts stopped on its feather stop (a propeller that cannot
   * feather ignores it); every other constant-speed propeller starts on its fine stop, and settle() then finds
   * the blade angle of the condition.
   */
  reset(o: PowerplantResetOptions): void {
    const oat = o.oat ?? 288.15;
    this.fuel.reset(o.tanks);
    this.electrical.reset(o.batteryCharge ?? 1);
    for (const unit of this.units) {
      const running = perEngine(o.running, unit.index);
      const rpm = o.rpm === undefined ? (running ? unit.install.engine.groundStartRpm : 0) : perEngine(o.rpm, unit.index);
      unit.reset(rpm, o.warm ?? running, oat, o.feathered !== undefined && o.feathered[unit.index] === true);
    }
    for (const unit of this.fadecUnits) this.electrical.glowing[unit.index] = this.electrical.ecuOn[unit.index] = false;
    this.publishTanks();
  }

  /**
   * Starting point of settle() for a trim evaluation: every unit that is not feathered turns at crank speed
   * `crankRpm`, running or not (a windmilling propeller has two steady states near its stopping speed, and this
   * is what picks "turning"); a feathered unit is stopped on its feather stop.
   */
  primeForTrim(crankRpm: number): void {
    const omega = crankRpm * RPM_TO_RAD_S;
    for (const unit of this.units) unit.prime(omega / unit.gearRatio);
  }

  /** Shaft power of engine i at its present state (its last step), W. */
  brakePower(i = 0): number {
    return this.units[i].state.power;
  }

  /** Per-engine state for a resume snapshot. */
  capture(): EngineSnapshot[] {
    return this.units.map((unit) => unit.capture());
  }

  /** Put the engines into the states of a snapshot (tanks and battery are restored through reset() and batteryCharge). */
  restore(engines: readonly EngineSnapshot[]): void {
    for (const unit of this.units) {
      const snap = engines[unit.index];
      if (snap) unit.restore(snap);
    }
  }

  /**
   * Run the powerplant at a fixed operating condition (input.dt is ignored) until every shaft is steady, for
   * trim and initialisation. Returns the steady output (the instance's reused output object).
   *
   * A fixed-pitch unit is stepped: the shaft converges with its own time constant (>= 0.3 s), so the large step
   * is stable. A constant-speed unit that is turning is solved instead, because a governor has no such simple
   * approach to its steady state: the shaft is held at the governed speed and the blade angle found at which
   * the propeller takes exactly the torque the engine gives there. If no angle between the stops does (too
   * little power for the fine stop, or too much for the coarse one), the blades are put on that stop and the
   * unit is stepped like a fixed-pitch one. A unit that is stopped stays on its present blade angle; one with
   * feather selected (and the latches clear) goes to the feather stop, stopped.
   *
   * LEFT at the solution are the fast states: shaft speed, blade angle, the lagged torque of a FADEC engine.
   * RESTORED are tank contents, battery charge, temperatures, carburettor ice, glow and ECU-backup timers and
   * the accumulator charge; the feather latch is set as the solution's speed and blade angle require. So the
   * result depends only on the input and the state at the call (temperatures matter through oil friction).
   */
  settle(input: PropulsionInput, maxSeconds = 60): PropulsionOutput {
    const units = this.units;
    const n = units.length;
    const saved = this.saved;
    const savedTanks = this.savedTanks;
    const quantities = this.fuel.quantities;
    for (let k = 0; k < savedTanks.length; k++) savedTanks[k] = quantities[k];
    const charge = this.electrical.charge;
    for (let i = 0; i < n; i++) {
      const unit = units[i];
      const th = unit.thermal;
      const o = i * SAVED_PER_UNIT;
      saved[o] = th.egt;
      saved[o + 1] = th.cht;
      saved[o + 2] = th.oilTemp;
      saved[o + 3] = th.oilPressure;
      saved[o + 4] = th.coolantTemp;
      saved[o + 5] = th.gearboxTemp;
      const engine = unit.engine;
      if ('backupUsed' in engine) {
        saved[o + 6] = engine.backupUsed;
        saved[o + 7] = engine.glowSeconds;
      }
      unit.steady = true;
    }
    const dt = input.dt;
    input.dt = SETTLE_DT;
    this.fuel.steady = true;

    // Constant-speed units: which are solved at their governed speed.
    const held = this.held;
    held.length = 0;
    for (let i = 0; i < n; i++) {
      const unit = units[i];
      const governor = unit.governor;
      if (!governor) continue;
      unit.command(input.controls);
      governor.relatch(unit.omega);
      if (unit.featherCommanded && !governor.latched) {
        governor.toFeather();
        unit.omega = 0;
      } else if (unit.omega > 0 && !unit.featherCommanded) {
        this.before[i] = unit.omega;
        unit.omega = unit.governedSpeed;
        unit.shaftHeld = true;
        held.push(unit);
      }
    }

    let out = this.step(input);
    for (let pass = 0; pass < SETTLE_HELD_PASSES && held.length > 0; pass++) {
      for (let h = held.length - 1; h >= 0; h--) {
        const unit = held[h];
        if (this.solveBladeAngle(unit)) continue;
        // No balance between the stops: the blades are on one, and the shaft finds its own speed from where it was.
        unit.shaftHeld = false;
        if (unit.governor!.pitch <= unit.governor!.def.fineStop) unit.omega = this.before[unit.index];
        held.splice(h, 1);
      }
      out = this.step(input);
    }

    // The shaft speed approaches its steady value geometrically (explicit steps on a first-order lag), so every
    // few steps the sequence is extrapolated to its limit (Aitken's delta-squared), which cuts the ~200 steps a
    // start 20-30 % away from the answer needs to a few dozen; the final steps still run to the tolerance.
    const { before, d1, d2, sinceJump } = this;
    d1.fill(NaN);
    d2.fill(NaN);
    sinceJump.fill(0);
    for (let t = SETTLE_DT; t < maxSeconds; t += SETTLE_DT) {
      for (let i = 0; i < n; i++) before[i] = units[i].omega;
      out = this.step(input);
      let steady = true;
      for (let i = 0; i < n; i++) {
        if (!(Math.abs(units[i].omega - before[i]) < SETTLE_TOLERANCE * SETTLE_DT)) steady = false;
      }
      if (steady) break;
      for (let i = 0; i < n; i++) {
        const unit = units[i];
        if (unit.shaftHeld) continue;
        d2[i] = d1[i];
        d1[i] = unit.omega - before[i];
        if (++sinceJump[i] >= 3 && unit.omega > 0) {
          const ratio = d1[i] / d2[i];
          if (ratio > 0.2 && ratio < 0.97) {
            unit.omega = Math.max(0, unit.omega + (d1[i] * ratio) / (1 - ratio));
            sinceJump[i] = 0;
            d1[i] = d2[i] = NaN;
          }
        }
      }
    }
    input.dt = dt;
    this.fuel.steady = false;
    this.fuel.restore(savedTanks);
    this.publishTanks();
    this.electrical.reset(charge);
    for (let i = 0; i < n; i++) {
      const unit = units[i];
      const th = unit.thermal;
      const o = i * SAVED_PER_UNIT;
      th.egt = saved[o];
      th.cht = saved[o + 1];
      th.oilTemp = saved[o + 2];
      th.oilPressure = th.oilGaugePsi = saved[o + 3];
      th.coolantTemp = saved[o + 4];
      th.gearboxTemp = saved[o + 5];
      const engine = unit.engine;
      if ('backupUsed' in engine) {
        engine.backupUsed = saved[o + 6];
        engine.glowSeconds = saved[o + 7];
      }
      unit.steady = false;
      unit.shaftHeld = false;
      unit.governor?.relatch(unit.omega);
    }
    return out;
  }

  /**
   * settle(): the blade angle at which the propeller of a unit held at its governed speed takes the torque the
   * engine gave in the step just made. Propeller torque rises with blade angle, so the first crossing above the
   * fine stop is found by stepping and then bisected. False when the balance lies beyond a stop: the blades are
   * then left ON that stop.
   */
  private solveBladeAngle(unit: EngineUnit): boolean {
    const governor = unit.governor!;
    const { fineStop, coarseStop } = governor.def;
    const torque = unit.shaftTorque;
    let lo = fineStop;
    if (unit.propellerTorqueAt(lo) >= torque) {
      governor.pitch = fineStop;
      return false;
    }
    let hi = lo;
    do {
      lo = hi;
      hi = Math.min(lo + SETTLE_PITCH_STEP, coarseStop);
    } while (unit.propellerTorqueAt(hi) < torque && hi < coarseStop);
    if (unit.propellerTorqueAt(hi) < torque) {
      governor.pitch = coarseStop;
      return false;
    }
    while (hi - lo > SETTLE_PITCH_TOLERANCE) {
      const mid = 0.5 * (lo + hi);
      if (unit.propellerTorqueAt(mid) < torque) lo = mid;
      else hi = mid;
    }
    governor.pitch = 0.5 * (lo + hi);
    return true;
  }

  /**
   * Advance the powerplant by input.dt and return forces, moments and gauge values. The returned object and
   * everything inside it are owned by this instance and overwritten by the next call; copy what must persist.
   */
  step(input: PropulsionInput): PropulsionOutput {
    const { controls, dt } = input;
    const out = this.output;
    const units = this.units;
    const n = units.length;
    const rpm = this.crankRpm;
    const omega = this.crankOmega;
    for (let i = 0; i < n; i++) {
      rpm[i] = units[i].rpm;
      omega[i] = units[i].omega * units[i].gearRatio;
    }
    const airAt = input.airVelocityAt;

    // 1. Electrical system and starters.
    const elec = this.electrical.step(dt, controls, rpm, omega);

    // 2. Induction of every unit.
    const demand = this.demand;
    for (let i = 0; i < n; i++) {
      const unit = units[i];
      const air = airAt !== undefined ? airAt[i] : input.airVelocityBody;
      demand[i] = unit.install.engine.fadec
        ? unit.breathe(input, air, elec.alternatorShaftPowers[i], elec.busVoltage, this.alternatorLive(i, input))
        : unit.breathe(input, air, elec.alternatorShaftPowers[i]);
    }

    // 3-7. The fuel each feed delivers, then the rest of every unit.
    const fuel = this.fuel;
    fuel.beginStep();
    for (let i = 0; i < n; i++) {
      const unit = units[i];
      const air = airAt !== undefined ? airAt[i] : input.airVelocityBody;
      const fed = fuel.stepFeed(i, dt, demand[i], engineControl(controls, i, 'fuelSelector'), rpm[i], engineControl(controls, i, 'fuelPump'), elec.busVoltage, unit.thermal.cht);
      unit.finish(input, air, fed.delivered, elec.starterTorques[i]);
      unit.state.fuelFlow = fed.metered;
      unit.state.fuelPressure = fed.pressurePsi;
    }
    for (const unit of this.fadecUnits) {
      const engine = unit.engine;
      if ('ecuPowered' in engine) {
        this.electrical.glowing[unit.index] = engine.glowing;
        this.electrical.ecuOn[unit.index] = engine.ecuPowered;
      }
    }

    // Forces and moments about the CG, and the angular momentum of the rotors (signed: a counter-rotating pair cancels).
    const first = units[0];
    out.force.x = first.force.x;
    out.force.y = first.force.y;
    out.force.z = first.force.z;
    out.moment.x = first.moment.x;
    out.moment.y = first.moment.y;
    out.moment.z = first.moment.z;
    out.angularMomentum.x = first.angularMomentum.x;
    out.angularMomentum.y = first.angularMomentum.y;
    out.angularMomentum.z = first.angularMomentum.z;
    for (let i = 1; i < n; i++) {
      const unit = units[i];
      out.force.x += unit.force.x;
      out.force.y += unit.force.y;
      out.force.z += unit.force.z;
      out.moment.x += unit.moment.x;
      out.moment.y += unit.moment.y;
      out.moment.z += unit.moment.z;
      out.angularMomentum.x += unit.angularMomentum.x;
      out.angularMomentum.y += unit.angularMomentum.y;
      out.angularMomentum.z += unit.angularMomentum.z;
    }

    out.fuelUsed.left = fuel.usedLeft;
    out.fuelUsed.right = fuel.usedRight;
    this.publishTanks();
    out.electrical.busVoltage = elec.busVoltage;
    out.electrical.batteryCharge = elec.batteryCharge;
    out.electrical.alternatorAmps = elec.alternatorAmps;
    for (let a = 0; a < elec.alternators.length; a++) out.electrical.alternators[a] = elec.alternators[a];
    // ElectricalSystem reports + = discharging; the contract (and the ammeter) use + = charging.
    out.electrical.batteryAmps = -elec.batteryAmps;
    return out;
  }

  /** An alternator driven by engine i is switched on and turning fast enough to deliver (it then feeds that engine's ECU directly). */
  private alternatorLive(i: number, input: PropulsionInput): boolean {
    if (!engineControl(input.controls, i, 'alternator')) return false;
    const alternators = this.def.electrical.alternators;
    for (const a of this.alternatorsOf[i]) if (this.crankRpm[i] >= alternators[a].cutInRpm) return true;
    return false;
  }
}
