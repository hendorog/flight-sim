import { describe, expect, it } from 'vitest';
import { DEG, FT, HP, KT, quat } from '../../src/core/math';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import { r22Vne, R22_ROTOR_LIMITS } from '../../src/aircraft/r22/limits';
import { createFlightModelFor } from '../../src/physics';
import { flatEnvironment } from '../fdm/helpers';
import { DT, attitudePilot, rig, run } from './helpers';

const shaftHp = (r: ReturnType<typeof rig>) => r.fm.state.rotorcraft!.torque * r.fm.state.rotorcraft!.omega / d.transmissionEfficiency / HP;

describe('R22 performance and handling acceptance', () => {
  for (const gross of [true, false]) it(`${gross ? '1370 lb' : 'right-seat solo'} trim 0–100 KIAS: ETL lowers power and collective, speed needs forward cyclic and less left pedal`, () => {
    const trims = [0, 10, 20, 40, 53, 65, 80, 100].map(kt => {
      const r = rig(kt, gross), s = r.fm.state;
      expect(r.fm.lastTrim?.converged, `${kt} KIAS`).toBe(true);
      expect(r.fm.lastTrim!.residual).toBeLessThan(0.001);
      expect(s.rotorcraft!.mastBump).toBe(false);
      return { kt, hp: shaftHp(r), collective: r.c.collective!, cyclic: r.c.elevator, pedal: r.c.rudder,
        pitch: s.pitch, roll: s.roll };
    });
    const [hover, , , minimum, vy, , , fast] = trims;
    expect(minimum.hp).toBeLessThan(hover.hp * 0.8);
    expect(minimum.collective).toBeLessThan(hover.collective);
    expect(fast.collective).toBeGreaterThan(minimum.collective);
    expect(fast.cyclic).toBeLessThan(hover.cyclic);
    expect(fast.pitch).toBeLessThan(hover.pitch);
    expect(vy.pedal).toBeGreaterThan(hover.pedal);
    // Broad cross-checks, not measured power-curve points. POH ceiling/MAP checks below constrain
    // hover losses; the sourced flat-plate estimate constrains high-speed demand.
    expect(hover.hp).toBeGreaterThan(gross ? 100 : 85); expect(hover.hp).toBeLessThan(gross ? 131 : 110);
    expect(minimum.hp).toBeGreaterThan(55); expect(minimum.hp).toBeLessThan(80);
    expect(fast.hp).toBeGreaterThan(100); expect(fast.hp).toBeLessThan(131);
  }, 120000);

  it('hover CG: anti-torque needs left skid low; the right-seat solo pilot reduces that bank and changes nose attitude', () => {
    const gross = rig(0), solo = rig(0, false);
    expect(gross.fm.state.roll).toBeLessThan(-DEG);
    expect(solo.fm.massProperties.cgOffset.y).toBeGreaterThan(gross.fm.massProperties.cgOffset.y);
    expect(solo.fm.state.roll).toBeGreaterThan(gross.fm.state.roll);
    expect(solo.fm.state.pitch).toBeGreaterThan(gross.fm.state.pitch);
    // A small held displacement excites the helicopter's slow unstable hover mode, without a stability aid.
    const initial = gross.fm.state.pitch;
    gross.c.elevator += 0.01; run(gross, 2);
    expect(Math.abs(gross.fm.state.pitch - initial)).toBeLessThan(3 * DEG);
    const early = gross.fm.state.pitch;
    run(gross, 5);
    expect(gross.fm.state.angularVelocity.y).toBeLessThan(0);
    expect(gross.fm.state.pitch).toBeLessThan(early + 3 * DEG);
    expect(gross.fm.state.crashed).toBe(false);
  }, 120000);

  it('60 KIAS fixed controls: a nose-up disturbance returns toward trim; sideslip weathercocks and damps', () => {
    const pitch = rig(60), yaw = rig(60), trimPitch = pitch.fm.state.pitch;
    for (const [r, dp, dy] of [[pitch, 2 * DEG, 0], [yaw, 0, 3 * DEG]] as const) {
      const s = r.fm.state;
      r.fm.setKinematics({ position: s.position, velocity: s.velocity, angularVelocity: s.angularVelocity,
        orientation: quat.fromEuler(s.roll, s.pitch + dp, s.heading + dy) });
    }
    run(pitch, 5); run(yaw, 5);
    expect(Math.abs(pitch.fm.state.pitch - trimPitch)).toBeLessThan(0.7 * DEG);
    const air = quat.rotateInv(yaw.fm.state.orientation, yaw.fm.state.velocity);
    expect(Math.abs(Math.atan2(air.y, air.x))).toBeLessThan(0.7 * DEG);
    expect(Math.abs(yaw.fm.state.angularVelocity.z)).toBeLessThan(0.015);
  }, 120000);

  it('cruise power failure reaches 97% horn promptly; full-down collective at 65 KIAS autorotates in the power-off arc', () => {
    const held = rig(65); held.c.mixture = 0;
    let hornTime = 0;
    while (!held.fm.state.rotorcraft!.lowRpmHorn && hornTime < 2) { run(held, DT); hornTime += DT; }
    // POH says immediately, not a timed guarantee. This is the brief's engineering 0.3–1.3 s target.
    expect(hornTime).toBeGreaterThan(0.3); expect(hornTime).toBeLessThan(1.3);
    expect(held.fm.state.rotorcraft!.driveTorque).toBe(0);
    const auto = rig(65), pilot = attitudePilot(auto); auto.c.mixture = 0; auto.c.collective = 0;
    run(auto, 50, pilot);
    const s = auto.fm.state, pct = s.rotorcraft!.rotorRpm / d.referenceRpm * 100;
    expect(s.crashed).toBe(false);
    expect(s.ias / KT).toBeGreaterThan(62); expect(s.ias / KT).toBeLessThan(68);
    expect(pct).toBeGreaterThan(97); expect(pct).toBeLessThanOrEqual(R22_ROTOR_LIMITS.powerOff[1]);
    // POH 3-3 gives ~4:1 at 75 KIAS / 90% RPM; no 65-kt sink figure is published.
    // 1500±400 fpm is the brief's approximate target, explicitly not a POH datum.
    expect(-s.verticalSpeed / 0.00508).toBeGreaterThan(1100);
    expect(-s.verticalSpeed / 0.00508).toBeLessThan(1900);
    expect(auto.c.rudder).toBeGreaterThan(held.c.rudder);
    expect(s.rotorcraft!.lowRpmHorn).toBe(false);
  }, 120000);

  it('POH 2-11 Vne placard reduces 102 KIAS with altitude and temperature', () => {
    expect(r22Vne(0, 288.15)).toBe(102);
    expect(r22Vne(4000 * FT, 293.15)).toBe(94);
    expect(r22Vne(8000 * FT, 273.15)).toBeCloseTo(86);
    expect(r22Vne(10000 * FT, 313.15)).toBe(0);
    expect(r22Vne(6000 * FT, 288.15)).toBeCloseTo(88.5);
  });

  it('MM 10.250 full-down autorotation at 50 KIAS: gross weight needs higher RPM than light solo', () => {
    // Figure 10-15, sea-level chart readings, with ±3 percentage points for reading/model uncertainty.
    // POH 3-2 also warns that light weight may prevent reaching 97%; light does not imply overspeed.
    const rpm = [true, false].map(gross => {
      const r = rig(50, gross); r.c.mixture = 0; r.c.collective = 0;
      run(r, 50, attitudePilot(r, 50));
      expect(r.fm.state.crashed).toBe(false);
      expect(Math.abs(r.fm.state.ias / KT - 50)).toBeLessThan(3);
      return r.fm.state.rotorcraft!.rotorRpm / d.referenceRpm * 100;
    });
    expect(Math.abs(rpm[0] - 108.5)).toBeLessThan(3);
    expect(Math.abs(rpm[1] - 99)).toBeLessThan(3);
    expect(rpm[0]).toBeGreaterThan(rpm[1] + 5);
  }, 120000);

  it('POH hover ceilings: IGE increases margin; max-gross zero-wind ceilings bracket the charts within 2000 ft', () => {
    // Reading POH 5-6 / 5-10 ISA traces: ~9400 ft IGE (2 ft skid clearance), ~6500 ft OGE.
    // The ±2000 ft engineering tolerance exposes the unvalidated engine/wake model; it is not certification accuracy.
    for (const [ige, low, high] of [[false, 4500, 8500], [true, 7400, 11400]] as const) {
      const margin = (ft: number): number => {
        const fm = createFlightModelFor(R22_DEFINITION); fm.setLoading(R22_DEFINITION.mass.loadings.maxGross);
        const env = flatEnvironment(undefined, ft * FT);
        fm.reset({ position: { x: 0, y: 0, z: -(ft * FT + (ige ? d.skids.z + 2 * FT : 100)) },
          heading: 0, airspeed: 0, onGround: false, engineRunning: true }, env);
        const r = fm.state.rotorcraft!;
        // At a power deficit the trim throttle saturates. Compare delivered shaft power with actual demand.
        return Math.min(fm.state.engine.power, d.systems.takeoffPower) - r.torque * r.omega / d.transmissionEfficiency;
      };
      expect(margin(low)).toBeGreaterThan(-10); expect(margin(high)).toBeLessThan(-HP);
    }
  }, 120000);
});
