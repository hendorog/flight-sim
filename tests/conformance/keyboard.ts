// The keyboard blocks of the conformance suite (contract 3.10, flown tier): a type flown against the REAL
// simulation (SimPhysics for its definition, real terrain and airport) through the real InputSystem with its
// input profile, by key presses only.
//
//   keyboardCircuit    take-off, left-hand circuit and landing with the assists on (describeKeyboardFlight's
//                      'circuit' block of tests/input/keyboardFlight.ts, flown with the type's options)
//   keyboardTaxi       castering types: a 90 degree turn from the hold short of connector A2 onto runway 07, inside
//                      the runway width; and the roll-out with B held in a 10 kt crosswind, within 5 m of the centre line
//   keyboardEngineOut  twins: an engine fails at Vyse + 10 kt in a full-power climb; the pilot holds the heading
//                      within 15 degrees, selects the dead engine and secures it, and establishes a climb at Vyse
//
// The pilots of keyboardTaxi and keyboardEngineOut work as keyboardPilot.ts's circuit pilot does: they look at the
// aircraft ten times a second and tap or hold a key to move each hold-position control toward where they want it,
// never pressing for less than 60 ms. A block takes the type as a registry id (loaded before its tests) or as a
// definition (the test-beds), and runs when FS_AIRCRAFT names `tier` (default the id) or is 'all'.

import { beforeAll, describe, expect, it } from 'vitest';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { loadAircraft } from '../../src/aircraft/registry';
import { clamp, DEG, FT, KT, RAD, wrapPi } from '../../src/core/math';
import { engineControl, setEngineControl, type AircraftId, type WeatherSettings } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { keyAuthority, type KeyAxisTuning } from '../../src/input/virtualYoke';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { buildScenario, kiasToTas, type Scenario } from '../../src/sim/scenarios';
import { HOLD_SHORT } from '../../src/world/airport/layout';
import { describeKeyboardFlight, type KeyboardFlightBands, type KeyboardFlightOptions } from '../input/keyboardFlight';
import { frame, FRAME, makeRig, pressTime, type KeyBackend, type KeyboardPilotOptions, type PilotTargets, type Rig } from '../input/keyboardPilot';
import { keyboardPilotTargets } from './keyboardTargets';
import { flownTier } from './suite';

/** How the pilot sees the aircraft: ten decisions a second; the shortest press, s. */
const DECIDE = 0.1;
const MIN_PRESS = 0.06;
const RWY = AIRPORT.runway;

export interface KeyboardBlockOptions {
  /** The type: a registry id (loaded before the tests) or a definition (a test-bed). */
  aircraft: AircraftId | AircraftDefinition;
  /** Name in the titles. Default: the id. */
  name?: string;
  /** The FS_AIRCRAFT entry that runs the block. Default: the id. */
  tier?: string;
  /** Overrides of the circuit pilot's targets (keyboardPilot.ts PilotTargets), over those of a registry id's
   *  targets file (keyboardTargets.ts). */
  targets?: Partial<PilotTargets>;
}

/** The keyboard pilot's options for a type: its input profile, reference speeds, rest height and simulation. */
export function keyboardPilotOptions(def: AircraftDefinition, targets?: Partial<PilotTargets>): KeyboardPilotOptions {
  return {
    profile: def.input,
    reference: def.reference,
    restHeight: def.geometry.restHeight,
    makePhysics: (o) => new SimPhysics({ ...o, aircraft: def }),
    ...(targets ? { targets } : {}),
  };
}

/** The definition a block flies, set in its beforeAll; and its pilot options (filled in the same place). */
function typeOf(o: KeyboardBlockOptions): { id: string; name: string; tier: string; def: () => AircraftDefinition; options: KeyboardPilotOptions } {
  const id = typeof o.aircraft === 'string' ? o.aircraft : o.aircraft.id;
  const name = o.name ?? id;
  let def: AircraftDefinition | undefined = typeof o.aircraft === 'string' ? undefined : o.aircraft;
  // makePhysics is set now, so the rig is built for a type from the first test on; the rest arrives in beforeAll.
  const options: KeyboardPilotOptions = { makePhysics: (p) => new SimPhysics({ ...p, aircraft: def! }) };
  beforeAll(async () => {
    if (!def) def = await loadAircraft(o.aircraft as AircraftId);
    const own = typeof o.aircraft === 'string' ? await keyboardPilotTargets(id) : undefined;
    Object.assign(options, keyboardPilotOptions(def, own || o.targets ? { ...own, ...o.targets } : undefined));
  });
  return { id, name, tier: o.tier ?? id, def: () => def!, options };
}

// ------------------------------------------------------------------------------------------------ circuit

/**
 * Take-off, left-hand circuit and landing, keys only, assists on, in light turbulence and in a 10 kt crosswind
 * (keyboardFlight.ts 'circuit'). `bands`: the circuit bands that differ from the Cessna 172S's.
 */
export function keyboardCircuit(o: KeyboardBlockOptions & { bands?: Partial<KeyboardFlightBands['circuit']> }): void {
  const tier = o.tier ?? (typeof o.aircraft === 'string' ? o.aircraft : o.aircraft.id);
  describe.runIf(flownTier(tier))(`keyboard circuit: ${o.name ?? tier} (flown tier)`, () => {
    const t = typeOf(o);
    const flight: KeyboardFlightOptions = Object.assign(t.options, { name: t.name, blocks: ['circuit'] as const, bands: { circuit: o.bands ?? {} } });
    describeKeyboardFlight(flight);
  });
}

// ------------------------------------------------------------------------------------------------ the key pilot

/** One key worked like a human: pressed for a while, then let go (keyboardPilot.ts Key). */
class HeldKey {
  private until = -1;
  private down = false;
  since = 0;
  constructor(
    private readonly input: KeyBackend,
    readonly code: string,
    private readonly shift = false,
  ) {}

  press(now: number, seconds: number): void {
    this.until = Math.max(this.until, now + Math.max(MIN_PRESS, seconds));
    if (!this.down) {
      this.input.keyDown(this.code, this.shift);
      this.down = true;
      this.since = now;
    }
  }

  release(): void {
    this.until = -1;
    if (this.down) this.input.keyUp(this.code);
    this.down = false;
  }

  tick(now: number): void {
    if (this.down && now >= this.until) this.release();
  }

  get isDown(): boolean {
    return this.down;
  }
}

/** The keys a pilot works, and the skill of moving a hold-position control toward a wanted position. */
function keyPilot(r: Rig) {
  const keys: HeldKey[] = [];
  const key = (code: string, shift = false): HeldKey => {
    const k = new HeldKey(r.input, code, shift);
    keys.push(k);
    return k;
  };
  let now = 0;
  return {
    key,
    /** Advance the pilot's clock (before each frame): presses that are due end. */
    tick(t: number): void {
      now = t;
      for (const k of keys) k.tick(t);
    },
    /** Move a control toward `want` with the key pair (neg, pos), as the control-position widget shows it. */
    moveTo(neg: HeldKey, pos: HeldKey, current: number, want: number, tuning: KeyAxisTuning, dead: number): void {
      const gap = want - current;
      if (Math.abs(gap) <= dead) {
        neg.release();
        pos.release();
        return;
      }
      const [k, other] = gap > 0 ? [pos, neg] : [neg, pos];
      other.release();
      const held = k.isDown ? now - k.since : 0;
      k.press(now, pressTime(gap, r.physics.renderState.ias, tuning, held, DECIDE + 0.02));
    },
    releaseAll(): void {
      for (const k of keys) k.release();
    },
  };
}

/** A rig of the type at a scenario of its own (the InputSystem hears the reset, as in the app). */
function rigAt(options: KeyboardPilotOptions, scenario: (r: Rig) => Scenario, weather: Partial<WeatherSettings>): Rig {
  const r = makeRig({ turbulence: 0, windSpeedKt: 0, gustKt: 0, ...weather }, options);
  r.physics.resetTo(scenario(r), r.weather);
  r.ctx.events.emit('reset', { scenario: r.physics.scenario.id });
  return r;
}

// ------------------------------------------------------------------------------------------------ taxi

export interface KeyboardTaxiBands {
  /** Distance from the centre line either way once on the runway, at most, m (the runway is 30 m wide). */
  turnAcross: number;
  /** Heading error and distance from the centre line 20 s after the turn began, degrees and m. */
  lineUpHeading: number;
  lineUpAcross: number;
  /** Roll-out with B held, 10 kt crosswind: largest distance from the centre line, m. */
  rolloutAcross: number;
}

export const KEYBOARD_TAXI_BANDS: KeyboardTaxiBands = { turnAcross: RWY.width / 2 - 2, lineUpHeading: 5, lineUpAcross: 3, rolloutAcross: 5 };

/**
 * Castering nosewheel: the turn onto the runway from the hold short of A2 with the rudder keys (which steer with the
 * toe brakes) and throttle taps; the roll-out with B held in a 10 kt crosswind, steered by the assist alone.
 */
export function keyboardTaxi(o: KeyboardBlockOptions & { bands?: Partial<KeyboardTaxiBands> }): void {
  const B = { ...KEYBOARD_TAXI_BANDS, ...o.bands };
  const tier = o.tier ?? (typeof o.aircraft === 'string' ? o.aircraft : o.aircraft.id);
  describe.runIf(flownTier(tier))(`keyboard taxi: ${o.name ?? tier} (flown tier)`, () => {
    const t = typeOf(o);

    it('a 90 degree turn from the hold onto the runway stays inside the runway width', () => {
      const hold = HOLD_SHORT.find((h) => h.name === 'A2')!;
      const r = rigAt(
        t.options,
        (rg) => {
          const sc = buildScenario('runway', rg.physics.env, t.def());
          return { ...sc, title: 'Holding short of runway 07 at A2', ic: { ...sc.ic, position: { x: hold.north, y: hold.east, z: sc.ic.position.z }, heading: hold.heading } };
        },
        {},
      );
      const s = r.physics.renderState, c = r.physics.controls;
      const p = keyPilot(r);
      const AXES = t.def().input.assists.axes;
      const [rudL, rudR, thrUp, thrDn, brakes, parking] = [p.key('KeyZ'), p.key('KeyX'), p.key('F3'), p.key('F2'), p.key('KeyB'), p.key('KeyB', true)];
      parking.press(0, 0.1);
      let next = 0, turnAt = -1, overshoot = -Infinity, nearest = Infinity, onRunway = false;
      let rc = runwayCoords(s.position.x, s.position.y);
      for (let time = 0; time < 60 && !s.crashed; time += FRAME) {
        p.tick(time);
        rc = runwayCoords(s.position.x, s.position.y);
        if (time >= next) {
          next = time + DECIDE;
          // Ahead to the centre line, then along it toward a point 15 m ahead: the turn begins about one turn
          // radius before the centre line, as a pilot judges it.
          const turning = rc.across > -12;
          if (turning && turnAt < 0) turnAt = time;
          const want = turning ? RWY.heading - Math.atan2(rc.across, 15) : hold.heading;
          const err = wrapPi(want - s.heading);
          p.moveTo(rudL, rudR, c.rudder, clamp(2.5 * err - 1.5 * s.angularVelocity.z, -1, 1), AXES.rudder, 0.05);
          // Walking pace in the turn, a little faster before it: throttle taps, the brakes when too fast.
          const e = (turning ? 6 : 8) - s.groundSpeed / KT;
          if (e > 1) thrUp.press(time, MIN_PRESS);
          else if (e < -1) thrDn.press(time, MIN_PRESS);
          if (e < -3) brakes.press(time, DECIDE + 0.02);
        }
        frame(r);
        // On the runway once the main wheels are inside its edge; from then on it must not leave either edge.
        if (rc.across > -RWY.width / 2 + 2) onRunway = true;
        if (onRunway) {
          overshoot = Math.max(overshoot, rc.across);
          nearest = Math.min(nearest, rc.across);
        }
        if (turnAt >= 0 && time - turnAt > 20) break;
      }
      p.releaseAll();
      const headingErr = Math.abs(wrapPi(s.heading - RWY.heading)) * RAD;
      console.log(`[keyboard] ${t.name} taxi turn: once on the runway ${nearest.toFixed(2)} .. ${overshoot.toFixed(2)} m from the centre line, then ${rc.across.toFixed(2)} m, heading error ${headingErr.toFixed(1)} deg`);
      expect(s.crashed).toBe(false);
      expect(onRunway).toBe(true);
      expect(overshoot).toBeLessThan(B.turnAcross);
      expect(-nearest).toBeLessThan(B.turnAcross);
      expect(headingErr).toBeLessThan(B.lineUpHeading);
      expect(Math.abs(rc.across)).toBeLessThan(B.lineUpAcross);
    }, 60_000);

    it('the roll-out with B held in a 10 kt crosswind stays within 5 m of the centre line', () => {
      // A rolling take-off on 07 with hands and feet off to a little under Vr, then idle and B held to a stop:
      // the assist steers with the brakes the pilot is already holding (contract 3.6 'differentialBrake').
      const r = rigAt(t.options, (rg) => buildScenario('runway', rg.physics.env, t.def()), { windDirectionDeg: 160, windSpeedKt: 10 });
      const s = r.physics.renderState;
      const vr = t.def().reference.vr;
      r.input.keyDown('KeyB', true); // parking brake off
      frame(r);
      r.input.keyUp('KeyB');
      r.input.keyDown('F4');
      frame(r);
      r.input.keyUp('F4');
      let time = 0;
      for (; time < 60 && s.ias / KT < 0.85 * vr; time += FRAME) frame(r);
      const kias = s.ias / KT;
      r.input.keyDown('F1');
      frame(r);
      r.input.keyUp('F1');
      r.input.keyDown('KeyB');
      let maxAcross = 0;
      for (time = 0; time < 60 && s.groundSpeed > 0.2 && !s.crashed; time += FRAME) {
        frame(r);
        maxAcross = Math.max(maxAcross, Math.abs(runwayCoords(s.position.x, s.position.y).across));
      }
      r.input.keyUp('KeyB');
      console.log(`[keyboard] ${t.name} roll-out from ${kias.toFixed(1)} KIAS with B held: largest across ${maxAcross.toFixed(2)} m, stopped in ${time.toFixed(1)} s`);
      expect(s.crashed).toBe(false);
      expect(s.groundSpeed).toBeLessThan(0.2);
      expect(maxAcross).toBeLessThan(B.rolloutAcross);
    }, 60_000);
  });
}

// ------------------------------------------------------------------------------------------------ engine out

export interface KeyboardEngineOutBands {
  /** Largest heading change after the failure, degrees. */
  heading: number;
  /** Vertical speed averaged over the last 15 s, at least, ft/min. */
  climbFpm: number;
  /** Airspeed in the last 15 s within this of Vyse, kt. */
  speedKt: number;
}

export const KEYBOARD_ENGINE_OUT_BANDS: KeyboardEngineOutBands = { heading: 15, climbFpm: 0, speedKt: 10 };

/**
 * Twins: an engine fails (its fuel is cut) at Vyse + 10 kt in a full-power climb, 1000 ft above the field. The
 * pilot reacts after a second: rudder toward the live engine to hold the heading, wings within a few degrees of
 * level (a little toward the live engine), pitch for Vyse; then identifies the dead engine by the foot that is
 * idle, selects it (8 / 9), closes its throttle, feathers it (Shift+F) or switches its ENGINE MASTER off, and pulls
 * its mixture to cut-off: keys only. Each engine fails in its own test.
 */
export function keyboardEngineOut(o: KeyboardBlockOptions & { bands?: Partial<KeyboardEngineOutBands> }): void {
  const B = { ...KEYBOARD_ENGINE_OUT_BANDS, ...o.bands };
  const tier = o.tier ?? (typeof o.aircraft === 'string' ? o.aircraft : o.aircraft.id);
  describe.runIf(flownTier(tier))(`keyboard engine-out: ${o.name ?? tier} (flown tier)`, () => {
    const t = typeOf(o);

    it.each([0, 1] as const)('engine %i fails at Vyse + 10 kt: heading held, engine secured with keys, climbing', (failed) => {
      const def = t.def();
      const vyse = def.reference.vyse!;
      const alt = AIRPORT.elevation + 1000 * FT;
      const r = rigAt(
        t.options,
        (rg) => {
          const sc = buildScenario('cruise', rg.physics.env, def);
          return { ...sc, title: 'Climb at Vyse + 10 kt', ic: { ...sc.ic, position: { ...sc.ic.position, z: -alt }, airspeed: kiasToTas(vyse + 10, alt, rg.physics.env), flightPathAngle: 0, flaps: 0 } };
        },
        {},
      );
      const s = r.physics.renderState, c = r.physics.controls;
      const p = keyPilot(r);
      const AXES = def.input.assists.axes;
      const has = def.input.has;
      const k = {
        left: p.key('ArrowLeft'),
        right: p.key('ArrowRight'),
        back: p.key('ArrowDown'),
        fwd: p.key('ArrowUp'),
        rudL: p.key('KeyZ'),
        rudR: p.key('KeyX'),
        full: p.key('F4'),
        idle: p.key('F1'),
        select: [p.key('Digit8'), p.key('Digit9')],
        feather: p.key('KeyF', true),
        masterOff: p.key('Digit1'),
        lean: p.key('KeyM'),
      };
      const h0 = s.heading, pitch0 = s.pitch;
      // The fuel is cut at `cutAt` (not a pilot action); the engine winds down as its line runs dry, and the pilot
      // notices at `notice`: the nose swinging 2 degrees off the heading, or the engine stopped.
      const cutAt = 5, reaction = 1, identify = 3, end = 75;
      let notice = Infinity, stop = Infinity, next = 0, rudRef = 0, elevRef = c.elevator, speedPitch = 0, maxHeading = 0, dead = -1, step = 0;
      let vsSum = 0, vsN = 0, minKias = Infinity, maxKias = -Infinity;
      for (let time = 0; time < end && !s.crashed; time += FRAME) {
        p.tick(time);
        if (time < FRAME) k.full.press(time, 0.1);
        if (time >= cutAt && engineControl(c, failed, 'fuelSelector') !== 'off') setEngineControl(c, failed, 'fuelSelector', 'off');
        if (time >= cutAt && stop === Infinity && !s.engines[failed].running) stop = time;
        if (time >= cutAt && notice === Infinity && (stop < Infinity || Math.abs(wrapPi(s.heading - h0)) > 2 * DEG)) notice = time;
        if (time >= next) {
          next = time + DECIDE;
          const kias = s.ias / KT;
          const reacting = time > notice + reaction;
          // Pitch for Vyse + 10 before the failure, Vyse after it: nose up when fast, and slowly more (keyboardPilot.ts
          // pitchForSpeed) from the attitude the climb began at.
          const e = kias - (reacting ? vyse : vyse + 10);
          speedPitch = clamp(speedPitch + e * 0.015 * DEG, -6 * DEG, 6 * DEG);
          const Le = keyAuthority(s.ias, AXES.elevator);
          const pitchErr = pitch0 + clamp(e * 0.35 * DEG, -5 * DEG, 5 * DEG) + speedPitch - s.pitch;
          elevRef = clamp(elevRef + Le * 0.2 * pitchErr * DECIDE, -0.5, 0.6);
          p.moveTo(k.fwd, k.back, c.elevator, elevRef + Le * clamp(3 * pitchErr - 2.5 * s.angularVelocity.y, -0.25, 0.3), AXES.elevator, 0.008);
          // Wings level before the failure; after it, 3 degrees toward the live engine (the rudder's side).
          const bank = reacting ? 3 * DEG * Math.sign(c.rudder) : 0;
          const La = keyAuthority(s.ias, AXES.aileron);
          p.moveTo(k.left, k.right, c.aileron, La * clamp(1.5 * (bank - s.roll) - 0.5 * s.angularVelocity.x, -0.4, 0.4), AXES.aileron, 0.012);
          // The heading with the rudder (in the full-power climb as well: the power yaws a co-rotating twin); between
          // the failure and the pilot's reaction the feet stay where they were.
          if (time < notice || reacting) {
            const err = wrapPi(h0 - s.heading);
            rudRef = clamp(rudRef + 0.8 * err * DECIDE, -1, 1);
            p.moveTo(k.rudL, k.rudR, c.rudder, clamp(rudRef + 3 * err - 1.5 * s.angularVelocity.z, -1, 1), AXES.rudder, 0.02);
          } else {
            k.rudL.release();
            k.rudR.release();
          }
          // Identify (dead foot, dead engine), verify, secure: one key a decision, the mixture until it is at cut-off.
          if (time > notice + identify && step < 4) {
            if (dead < 0) dead = c.rudder > 0 ? 0 : 1;
            if (step === 3 && has.mixture && engineControl(c, dead, 'mixture') > 0) k.lean.press(time, DECIDE + 0.02);
            else {
              if (step === 0) k.select[dead].press(time, 0.1);
              else if (step === 1) k.idle.press(time, 0.1);
              else if (step === 2 && has.feather) k.feather.press(time, 0.1);
              else if (step === 2 && def.input.ignition === 'engineMaster') k.masterOff.press(time, 0.1);
              step++;
            }
          }
          if (time > end - 15) {
            vsSum += s.verticalSpeed;
            vsN++;
            minKias = Math.min(minKias, kias);
            maxKias = Math.max(maxKias, kias);
          }
        }
        frame(r);
        if (time > cutAt) maxHeading = Math.max(maxHeading, Math.abs(wrapPi(s.heading - h0)));
      }
      p.releaseAll();
      frame(r);
      const climb = (vsSum / vsN / FT) * 60;
      const secured = {
        selected: r.input.engineSelection,
        throttle: engineControl(c, failed, 'throttle'),
        propeller: engineControl(c, failed, 'propeller'),
        mixture: engineControl(c, failed, 'mixture'),
        engineMaster: engineControl(c, failed, 'engineMaster'),
        rpm: s.engines[failed].rpm,
        live: s.engines[1 - failed].running,
      };
      console.log(`[keyboard] ${t.name} engine ${failed} out (noticed ${(notice - cutAt).toFixed(1)} s, stopped ${(stop - cutAt).toFixed(1)} s after its fuel was cut): largest heading change ${(maxHeading * RAD).toFixed(1)} deg, climb ${climb.toFixed(0)} fpm, ${minKias.toFixed(1)}-${maxKias.toFixed(1)} KIAS, ${JSON.stringify(secured)}`);
      expect(stop).toBeLessThan(end - 30);
      expect(s.crashed).toBe(false);
      expect(maxHeading * RAD).toBeLessThan(B.heading);
      expect(secured.selected).toBe(failed);
      expect(secured.throttle).toBe(0);
      if (has.feather) expect(secured.propeller).toBe(0);
      if (has.mixture) expect(secured.mixture).toBe(0);
      if (def.input.ignition === 'engineMaster') expect(secured.engineMaster).toBe(false);
      expect(secured.live).toBe(true);
      expect(climb).toBeGreaterThan(B.climbFpm);
      expect(Math.max(Math.abs(minKias - vyse), Math.abs(maxKias - vyse))).toBeLessThan(B.speedKt);
    }, 60_000);
  });
}
