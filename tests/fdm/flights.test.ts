// Complete flights flown by the autopilot plus a scripted pilot: an engine-out glide to a landing, and a
// take-off, circuit and landing on runway 07.

import { describe, expect, it } from 'vitest';
import { DEG, FT, KT, wrapPi } from '../../src/core/math';
import type { AircraftState, ControlInputs } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { Autopilot } from '../../src/physics';
import { ELEVATION, FRAME, at, kt, makeRig, report, resetTo, type Rig } from './helpers';

const RWY = AIRPORT.runway;
const HALF_LENGTH = RWY.length / 2;

/** Heading that converges onto a line through the runway centre with course `course`, offset `offset` m to its right. */
function trackHeading(s: AircraftState, course: number, offset = 0): number {
  const c = runwayCoords(s.position.x, s.position.y);
  // Cross-track error relative to a line parallel to the runway (course either way along it).
  const along = Math.cos(course - RWY.heading) > 0 ? 1 : -1;
  const cross = (c.across - offset) * along;
  return course - Math.atan2(cross, 250) * 0.8;
}

/**
 * Flare and roll-out: from a height that grows with the sink rate, idle and raise the nose with falling
 * height to the touchdown attitude; after touchdown lower the nose, flaps up, brake and hold the centreline.
 */
class Lander {
  touchdown: { along: number; across: number; sink: number; kias: number } | null = null;
  stopped = false;
  private flareStart = NaN;

  private flareHeight = NaN;

  update(s: AircraftState, c: ControlInputs, ap: Autopilot): void {
    const agl = s.altitudeAGL - 1.25;
    if (!this.touchdown) {
      // Start the flare higher the faster the descent (about 3 s before touchdown).
      const flareHeight = Number.isNaN(this.flareHeight) ? Math.max(6, -3 * s.verticalSpeed) : this.flareHeight;
      if (agl < flareHeight) {
        c.throttle = 0;
        if (Number.isNaN(this.flareStart)) {
          this.flareStart = s.pitch;
          this.flareHeight = flareHeight;
        }
        // Touchdown attitude: about 7 degrees above the approach attitude, short of a tail strike.
        const touchdownPitch = Math.min(this.flareStart + 7 * DEG, 10 * DEG);
        ap.settings = {
          ...ap.settings,
          vertical: 'pitch',
          pitch: this.flareStart + (touchdownPitch - this.flareStart) * Math.min(1, 1 - agl / flareHeight),
        };
      }
      ap.update(FRAME, s, c);
      if (s.wheels[1].onGround || s.wheels[2].onGround) {
        const rc = runwayCoords(s.position.x, s.position.y);
        this.touchdown = { along: rc.along, across: rc.across, sink: -s.verticalSpeed, kias: kt(s.ias) };
      }
      return;
    }
    c.throttle = 0;
    c.elevator = 0;
    c.aileron = 0;
    c.flaps = 0;
    const rc = runwayCoords(s.position.x, s.position.y);
    const desired = RWY.heading - Math.atan2(rc.across, 60);
    c.rudder = Math.max(-1, Math.min(1, 4 * wrapPi(desired - s.heading) - 1.5 * s.angularVelocity.z));
    c.brakeLeft = c.brakeRight = s.groundSpeed > 1 ? 0.8 : 1;
    this.stopped ||= s.groundSpeed < 0.3;
  }
}

function onRunway(p: { along: number; across: number }): boolean {
  return Math.abs(p.along) < HALF_LENGTH && Math.abs(p.across) < RWY.width / 2;
}

describe('take-off trim', () => {
  it('after rotation the aircraft climbs hands-off at about 70-75 KIAS on the take-off trim', () => {
    const rig = makeRig();
    resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0 });
    const s = rig.fm.state, c = rig.controls;
    c.parkingBrake = false;
    c.throttle = 1;
    let airborne = NaN;
    const ias: number[] = [];
    rig.run(90, (t) => {
      // Rudder holds the heading on the roll and in the climb (the pilot's feet); the yoke rotates at 55 KIAS
      // to ~8 degrees and is released 3 s after lift-off. Wings held level.
      c.rudder = Math.max(-1, Math.min(1, 0.1 - 3 * wrapPi(s.heading) - s.angularVelocity.z));
      c.aileron = Math.max(-1, Math.min(1, -2 * s.roll - 0.5 * s.angularVelocity.x));
      if (Number.isNaN(airborne)) {
        c.elevator = kt(s.ias) > 55 ? Math.max(-0.5, Math.min(0.5, 0.15 + 0.08 * (8 - s.pitch / DEG))) : 0;
        if (!s.onGround && s.altitudeAGL > 3) airborne = t;
      } else if (t - airborne < 3) {
        c.elevator = Math.max(-0.5, Math.min(0.5, 0.08 * (8 - s.pitch / DEG)));
      } else {
        c.elevator = 0;
        if (t - airborne > 10) ias.push(kt(s.ias));
      }
    });
    const mean = ias.reduce((a, b) => a + b, 0) / ias.length;
    report('hands-off climb on the take-off trim: mean IAS from 10 s after lift-off (phugoid averaged)', mean, '70-75', 'KIAS');
    report('  take-off trim wheel', rig.fm.trimControls.elevatorTrim, 'nose-up of neutral', '');
    expect(Number.isNaN(airborne)).toBe(false);
    expect(s.crashed).toBe(false);
    expect(mean).toBeGreaterThan(68);
    expect(mean).toBeLessThan(78);
    expect(Math.min(...ias)).toBeGreaterThan(55);
  }, 60000);
});

describe('complete flights', () => {
  it('engine-out glide from 1500 ft to a landing on the runway', () => {
    const rig = makeRig();
    // 1500 ft above the field, 4.5 km before the runway centre on the extended centreline, engine dead.
    const d = 4500;
    resetTo(rig, {
      position: at(ELEVATION + 1500 * FT, -d * Math.cos(RWY.heading), -d * Math.sin(RWY.heading)),
      heading: RWY.heading,
      airspeed: 68 * KT,
      engineRunning: false,
    });
    const s = rig.fm.state;
    const c = rig.controls;
    const ap = new Autopilot();
    ap.settings = { ...ap.settings, lateral: 'heading', vertical: 'airspeed', airspeed: 68 * KT };
    const lander = new Lander();
    rig.run(240, () => {
      ap.settings.heading = trackHeading(s, RWY.heading);
      lander.update(s, c, ap);
      return lander.stopped || s.crashed;
    });
    expect(s.engine.running).toBe(false);
    expect(s.crashed).toBe(false);
    const td = lander.touchdown!;
    report('engine-out landing: touchdown distance from the runway centre', td.along, `within +-${HALF_LENGTH}`, 'm');
    report('engine-out landing: touchdown sink rate', td.sink, '< 1.5', 'm/s');
    report('engine-out landing: touchdown speed', td.kias, 'about 50', 'KIAS');
    expect(onRunway(td)).toBe(true);
    expect(td.sink).toBeLessThan(1.5);
    expect(lander.stopped).toBe(true);
  }, 120000);

  it('take-off, left-hand circuit at 1000 ft and landing on runway 07, flown by the autopilot', () => {
    const rig: Rig = makeRig();
    // Line up on the threshold of runway 07.
    const start = -HALF_LENGTH + 30;
    resetTo(rig, { onGround: true, position: at(0, start * Math.cos(RWY.heading), start * Math.sin(RWY.heading)), heading: RWY.heading });
    const s = rig.fm.state;
    const c = rig.controls;
    c.parkingBrake = false;
    c.throttle = 1;
    const ap = new Autopilot();
    const patternAlt = ELEVATION + 1000 * FT;
    const downwind = wrapPi(RWY.heading + Math.PI);
    const lander = new Lander();
    let phase = 'roll';
    const phases: string[] = [phase];
    let tPhase = 0;
    let maxBank = 0, minIasAirborne = Infinity, downwindAltErr = 0;
    // Level off at pattern altitude; the throttle then holds 90 KIAS.
    const levelOff = (agl: number) => {
      if (ap.settings.vertical === 'airspeed' && agl > patternAlt - ELEVATION - 30) {
        ap.settings = { ...ap.settings, vertical: 'altitude', altitude: patternAlt, verticalSpeed: 3, autothrottle: true, airspeed: 90 * KT };
      }
    };
    const next = (p: string) => {
      phase = p;
      phases.push(p);
      tPhase = s.time;
    };
    rig.run(900, () => {
      const rc = runwayCoords(s.position.x, s.position.y);
      const agl = s.altitudeMSL - ELEVATION;
      if (!s.onGround) {
        maxBank = Math.max(maxBank, Math.abs(s.roll));
        minIasAirborne = Math.min(minIasAirborne, kt(s.ias));
      }
      switch (phase) {
        case 'roll': {
          // Centreline on the rudder; rotate at 55 KIAS to 8 degrees.
          const desired = RWY.heading - Math.atan2(rc.across, 60);
          c.rudder = Math.max(-1, Math.min(1, 4 * wrapPi(desired - s.heading) - 1.5 * s.angularVelocity.z));
          c.elevator = kt(s.ias) > 55 ? Math.max(-1, Math.min(1, 5 * (8 * DEG - s.pitch) - 1.5 * s.angularVelocity.y + 0.3)) : 0;
          if (agl > 1.25 + 15) {
            c.rudder = 0;
            ap.reset();
            ap.settings = { ...ap.settings, lateral: 'heading', heading: RWY.heading, vertical: 'airspeed', airspeed: 74 * KT, maxBank: 20 * DEG };
            next('climb');
          }
          break;
        }
        case 'climb':
          ap.settings.heading = trackHeading(s, RWY.heading);
          if (agl > 700 * FT) {
            ap.settings.heading = wrapPi(RWY.heading - Math.PI / 2);
            next('crosswind');
          }
          break;
        case 'crosswind':
          levelOff(agl);
          if (rc.across < -900) next('downwind');
          break;
        case 'downwind':
          levelOff(agl);
          ap.settings.heading = trackHeading(s, downwind, -900);
          if (s.time - tPhase > 30) downwindAltErr = Math.max(downwindAltErr, Math.abs(s.altitudeMSL - patternAlt));
          // Abeam the threshold: slow to 75 KIAS with flaps 10; turn base 1.2 km past it.
          if (rc.along < -HALF_LENGTH + 300) {
            ap.settings.airspeed = 75 * KT;
            c.flaps = 1 / 3;
          }
          if (rc.along < -HALF_LENGTH - 1200) {
            ap.settings = { ...ap.settings, heading: wrapPi(RWY.heading + Math.PI / 2), vertical: 'verticalSpeed', verticalSpeed: -2.5, autothrottle: true, airspeed: 70 * KT };
            c.flaps = 2 / 3;
            next('base');
          }
          break;
        case 'base':
          if (rc.across > -250) {
            ap.settings = { ...ap.settings, heading: RWY.heading, airspeed: 65 * KT };
            c.flaps = 1;
            next('final');
          }
          break;
        case 'final': {
          ap.settings.heading = trackHeading(s, RWY.heading);
          // 3 degree glide path to a point 150 m past the threshold.
          const toAim = -HALF_LENGTH + 150 - rc.along;
          const pathHeight = Math.max(toAim, 0) * Math.tan(3 * DEG);
          ap.settings.verticalSpeed = -s.groundSpeed * Math.tan(3 * DEG) + 0.1 * (pathHeight - (agl - 1.25));
          if (agl - 1.25 < 6) {
            ap.settings.autothrottle = false;
            next('landing');
          }
          break;
        }
        case 'landing':
          ap.settings.heading = trackHeading(s, RWY.heading);
          lander.update(s, c, ap);
          if (lander.stopped) next('stopped');
          break;
      }
      if (phase !== 'roll' && phase !== 'landing' && phase !== 'stopped') ap.update(FRAME, s, c);
      return phase === 'stopped' || s.crashed || s.time - tPhase > 300;
    });
    const td = lander.touchdown;
    report('circuit: phases flown', phases.length, phases.join(' > '), '');
    report('circuit: largest bank', maxBank / DEG, '< 30', 'deg');
    report('circuit: largest altitude error on the settled downwind leg', downwindAltErr, '< 30', 'm');
    report('circuit: lowest airspeed in the air', minIasAirborne, '> 55', 'KIAS');
    if (td) {
      report('circuit: touchdown along / across the runway', td.along, `${td.across.toFixed(1)} m across`, 'm');
      report('circuit: touchdown sink rate', td.sink, '< 1.5', 'm/s');
    }
    expect(s.crashed).toBe(false);
    expect(phase).toBe('stopped');
    expect(td && onRunway(td)).toBe(true);
    expect(td!.sink).toBeLessThan(1.5);
    const rc = runwayCoords(s.position.x, s.position.y);
    expect(onRunway(rc)).toBe(true);
    expect(maxBank).toBeLessThan(30 * DEG);
    expect(downwindAltErr).toBeLessThan(30);
  }, 180000);
});
