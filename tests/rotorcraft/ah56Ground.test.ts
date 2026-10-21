// The AH-56A on its wheels in the flight model (AG, plan revision 2 section 7.2: G13, G15) and the wheeled rotorcraft's
// strike checks (RotorClearance, wheels.ts). The tail wheel's lock, turns and tracking are tests/gear/ah56TailWheel.test.ts
// (the 6-DOF gear rig); the -12 deg reverse-pitch part of the run-on stop is the pusher's (stage 4, AC).
import { describe, expect, it } from 'vitest';
import { DEG, FT, KT, quat, v3 } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { SCENARIO_IDS } from '../../src/sim/scenarios';
import { RotorClearance, wheelRestingPose } from '../../src/physics/rotorcraft/wheels';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_REFERENCE } from '../../src/aircraft/ah56/reference';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { d, gauges, gyroDef, pilot, report, rig, run } from './ah56Rig';

describe('G13: on the wheels', () => {
  it('a running ground reset rests on three wheels about level and stays there', () => {
    const r = rig({ onGround: true });
    const s0 = r.fm.state;
    expect(s0.wheels.every((w) => w.onGround)).toBe(true);
    run(r, 5);
    const s = r.fm.state;
    report('G13 ground rest (running, flat pitch, pedals centred)', { tailKN: s.wheels[0].load / 1e3, leftKN: s.wheels[1].load / 1e3,
      rightKN: s.wheels[2].load / 1e3, pitchDeg: s.pitch / DEG, rollDeg: s.roll / DEG, nrPct: gauges(r).nr, crashed: s.crashed });
    expect(s.crashed).toBe(false);
    expect(s.wheels.every((w) => w.onGround && w.load > 0)).toBe(true);
    expect(Math.abs(s.pitch)).toBeLessThan(1 * DEG);
    // The tail rotor's side force at flat pitch leans it toward the right main (the tyres react it below the CG).
    expect(Math.abs(s.roll)).toBeLessThan(5 * DEG);
  });

  it('vertical take-off to a hover and a vertical landing on the wheels', () => {
    const r = rig({ onGround: true });
    const fly = pilot(r);
    let airborne = false, maxHeight = 0, touchdown = NaN, t = 0;
    // A hover pilot: the drift held with bank and pitch (the hover hangs about 5 deg left wing low), the collective on a
    // 300 ft/min climb to 5 m and a 150 ft/min descent back to the wheels.
    run(r, 45, () => {
      t += 1 / 240;
      const s = r.fm.state, h = s.altitudeAGL - d.skids.z, v = quat.rotateInv(s.orientation, s.velocity);
      if (!s.onGround) airborne = true;
      maxHeight = Math.max(maxHeight, h);
      const bank = s.onGround ? s.roll : Math.max(-12 * DEG, Math.min(12 * DEG, -5 * DEG - 0.05 * v.y));
      const pitch = s.onGround ? s.pitch : Math.max(-8 * DEG, Math.min(8 * DEG, -0.05 * v.x));
      fly(1 / 240, pitch, bank);
      const climb = t < 25 && maxHeight < 5 ? 300 : -150;
      r.c.collective = Math.min(1, Math.max(0, (r.c.collective ?? 0) + 0.03 * (climb * FT / 60 - s.verticalSpeed) / 240));
      if (airborne && s.onGround && Number.isNaN(touchdown)) touchdown = Math.max(0, -s.verticalSpeed);
    });
    const s = r.fm.state;
    report('G13 vertical take-off and landing', { airborne, maxHeightM: maxHeight, touchdownSinkMs: touchdown, onGround: s.onGround,
      crashed: s.crashed, crash: (r.fm as unknown as { crashReason: string }).crashReason });
    expect(airborne).toBe(true);
    expect(maxHeight).toBeGreaterThan(3);
    expect(s.crashed).toBe(false);
    expect(s.onGround).toBe(true);
  });

  it('the gear cycles up and down in 3-8 s (ESTIMATE 6 s) in the hover', () => {
    const r = rig({ height: 300, gearDown: true });
    const fly = pilot(r);
    const cycle = (lever: 'up' | 'down') => {
      r.c.gearLever = lever;
      let t = 0, done = NaN;
      run(r, 12, () => {
        fly(1 / 240); t += 1 / 240;
        const g = r.fm.state.gear;
        if (Number.isNaN(done) && !g.inTransit && g.extension.every((x) => x === (lever === 'up' ? 0 : 1))) done = t;
      });
      return done;
    };
    const up = cycle('up'), down = cycle('down');
    report('G13 gear cycle', { upS: up, downS: down, target: '3-8' });
    for (const t of [up, down]) { expect(t).toBeGreaterThanOrEqual(3); expect(t).toBeLessThanOrEqual(8); }
  });

  it.fails('G13 KNOWN GAP: the gear-overspeed flag above 130 KCAS (flightModel.checkOverspeed does not run for a rotorcraft)', () => {
    // Contract request to TW (flightModel.ts checkStructure): run checkOverspeed's gear rule for a rotorcraft too.
    const r = rig({ kt: 140, gearDown: true });
    const fly = pilot(r);
    run(r, 3, () => fly(1 / 240));
    expect(r.fm.overspeed.gear).toBe(true);
  });

  it('from a 60 KCAS run-on landing, the wheel brakes stop it within 300 m (P: "main-gear brakes"; reverse pitch is stage 4)', () => {
    const r = rig({ kt: 60, height: d.skids.z + 1.0, gearDown: true });
    const fly = pilot(r);
    let touch = NaN, t = 0;
    const start = { ...r.fm.state.position };
    let from = start;
    run(r, 40, () => {
      t += 1 / 240;
      const s = r.fm.state;
      if (Number.isNaN(touch) && s.onGround) { touch = t; from = { ...s.position }; }
      if (Number.isNaN(touch)) {
        // Settle onto the wheels: hold the attitude, ease the collective down.
        fly(1 / 240, 0, 0);
        r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.05 / 240);
      } else {
        // On the wheels: collective down, the stick at the rest attitude, both brakes full.
        fly(1 / 240, 0, 0);
        r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.5 / 240);
        r.c.brakeLeft = r.c.brakeRight = 1;
      }
    });
    const s = r.fm.state, dist = Math.hypot(s.position.x - from.x, s.position.y - from.y);
    report('G13 run-on stop', { touchdownKias: 0, touchdownAtS: touch, stopDistanceM: dist, groundSpeedKt: s.groundSpeed / KT, target: '<= 300 m',
      crashed: s.crashed, pitchDeg: s.pitch / DEG });
    expect(s.crashed).toBe(false);
    expect(s.groundSpeed).toBeLessThan(0.5);
    expect(dist).toBeLessThanOrEqual(300);
  });

  it('the parking brake holds the aircraft at ground idle', () => {
    const r = rig({ onGround: true });
    r.c.throttle = d.systems.turboshaft!.grip.groundIdle;
    r.c.parkingBrake = true;
    const p0 = { ...r.fm.state.position };
    run(r, 20);
    const s = r.fm.state, drift = Math.hypot(s.position.x - p0.x, s.position.y - p0.y);
    report('G13 parking brake at ground idle', { driftM: drift, ngPct: gauges(r).ng, nrPct: gauges(r).nr });
    expect(drift).toBeLessThan(0.2);
  });
});

describe('the hover readout (plan flights "AH-56 hover readout"): 20 s hands-off from the 15 m hover spawn, calm air', () => {
  const hover = (config: 'amcs' | 'ics') => {
    const weather = { ...defaultWeather(), windSpeedKt: 0, turbulence: 0, gustKt: 0 };
    const p = new SimPhysics({ aircraft: AH56_DEFINITION, weather, rotorcraftConfig: config });
    p.resetTo(hoverScenario(p.env, d), weather);
    const roll0 = p.state.roll;
    p.step(20);
    const s = p.state;
    report(`hover readout ${config} after 20 s hands-off`, { rollStartDeg: roll0 / DEG, rollDeg: s.roll / DEG, pitchDeg: s.pitch / DEG,
      groundSpeedKt: s.groundSpeed / KT, nrRpm: s.rotorcraft!.rotorRpm, target: 'roll -7..-2 (G9), Nr 239.85 / 246 +/- 2' });
    return s;
  };
  it('Nr and the gyro mode hold (AMCS 239.85, ICS 246 rpm +/- 2) and nothing crashes', () => {
    for (const config of ['amcs', 'ics'] as const) {
      const s = hover(config);
      expect(s.crashed).toBe(false);
      expect(s.rotorcraft!.controlGyro!.mode).toBe(config);
      expect(Math.abs(s.rotorcraft!.rotorRpm - (config === 'amcs' ? 239.85 : 246))).toBeLessThanOrEqual(2);
      const g = s.rotorcraft!.controlGyro!, t = gyroDef.configs[config].maxTilt;
      expect(g.pitch).toBeLessThanOrEqual(t.up); expect(g.pitch).toBeGreaterThanOrEqual(-t.down);
      expect(g.roll).toBeLessThanOrEqual(t.right); expect(g.roll).toBeGreaterThanOrEqual(-t.left);
    }
  }, 60000);
  it.fails('KNOWN GAP (RC contract request): the hands-off hover stays 2-7 deg left wing low for 20 s', () => {
    // The trim balances the rotor at exactly zero airspeed, where Rotorcraft.compute applies no main-rotor in-plane force
    // (`if (horizontal > 0)`, rotorcraft.ts). The first step's 1e-7 m/s of body velocity turns on the hingeless rotor's
    // hover in-plane force (about 330 N) along that arbitrary direction: 625 N m of roll and 236 N m of pitch the trim
    // never saw. The AMCS rate command then rolls the aircraft right at 0.2 deg/s and it diverges (+7.6 deg at 20 s; ICS
    // -21 deg). With the in-plane force faded in over the first 0.3 m/s (an experiment, not committed) the AMCS holds
    // -5.2 -> -5.5 deg and the ICS -5.1 -> -4.4 deg over the 20 s.
    for (const config of ['amcs', 'ics'] as const) {
      const s = hover(config);
      expect(s.roll).toBeLessThanOrEqual(-2 * DEG);
      expect(s.roll).toBeGreaterThanOrEqual(-7 * DEG);
    }
  }, 60000);
});

describe('G15: every scenario spawns on the wheels and survives 5 s, in both configurations', () => {
  for (const config of [undefined, 'ics'] as const) for (const id of SCENARIO_IDS) it(`${id} (${config ?? 'amcs default'})`, () => {
    const p = new SimPhysics({ aircraft: AH56_DEFINITION, weather: { ...defaultWeather(), turbulence: 0, gustKt: 0 }, ...(config ? { rotorcraftConfig: config } : {}) });
    p.reset(id);
    p.step(5);
    const s = p.state;
    expect(s.crashed).toBe(false);
    expect(s.rotorcraft!.controlGyro!.mode).toBe(config ?? 'amcs');
    if (id === 'runway' || id === 'apron') expect(s.wheels.every((w) => w.onGround)).toBe(true);
  }, 60000);
});

describe('RotorClearance (the wheeled rotorcraft\'s strike checks, extracted from the skids)', () => {
  const pose = wheelRestingPose(AH56_DEFINITION.geometry.gear, 8301, v3.zero());
  const body = (rollDeg: number) => ({ time: 0, position: { x: 0, y: 0, z: -pose.height }, orientation: quat.fromEuler(rollDeg * DEG, 0, 0),
    velocityBody: v3.zero(), angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 8301 });
  it('level on the wheels: clear; rolled far over: the main rotor strikes', () => {
    const c = new RotorClearance(d), s = emptyRotorcraftState();
    expect(c.check(body(0), s, pose.height)).toBeNull();
    const rolled = c.check(body(40), s, pose.height * Math.cos(40 * DEG));
    report('RotorClearance', { level: 'clear', rolled40: rolled ?? 'clear', restHeightM: pose.height, gearLimitKcas: AH56_REFERENCE.gearKcas });
    expect(rolled).toBe('Main rotor strike');
  });
});
