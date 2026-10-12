import { describe, expect, it } from 'vitest';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { createFlightModelFor } from '../../src/physics';
import { cloneControls } from '../../src/core/types';
import { DEG, KT, wrapPi } from '../../src/core/math';
import { HelicopterAutopilot } from '../../src/sim/rotorcraft/autopilot';
import { defaultAutopilotSettings } from '../../src/physics/autopilot';
import { DT, seaLevel } from './helpers';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { calmWeather } from '../fdm/helpers';

for (const def of [R22_DEFINITION, R44_DEFINITION, S269_DEFINITION]) describe(`${def.id} helicopter hold`, () => {
  for (const speed of [0, 60]) it(`flies ${speed ? 'cruise' : 'hover'}, captures height and heading`, () => {
    const fm = createFlightModelFor(def);
    fm.setLoading(def.mass.loadings.maxGross);
    fm.reset({ position: { x: 0, y: 0, z: -100 }, heading: 0, airspeed: speed*KT,
      onGround: false, engineRunning: true, fuelFraction: 1 }, seaLevel);
    const c = cloneControls(fm.trimControls), ap = new HelicopterAutopilot(def.rotorcraft!);
    const st = { ...defaultAutopilotSettings(), altitude: 100, heading: 0, airspeed: speed*KT };
    expect(ap.engage(fm.state, c)).toBe(true);
    let minRpm = Infinity, maxBank = 0;
    for (let i = 0; i < 35/DT; i++) {
      if (i === 5/DT) { st.altitude += 5; st.heading = 15*DEG; }
      expect(ap.update(DT, fm.state, c, st), ap.reason).toBe(true);
      fm.step(DT, c, seaLevel);
      minRpm = Math.min(minRpm, fm.state.rotorcraft!.rotorRpm/def.rotorcraft!.referenceRpm);
      maxBank = Math.max(maxBank, Math.abs(fm.state.roll));
    }
    console.info(def.id, speed, { altitude: fm.state.altitudeMSL, heading: fm.state.heading/DEG,
      speed: fm.state.groundSpeed/KT, distance: Math.hypot(fm.state.position.x, fm.state.position.y), minRpm, maxBank });
    expect(fm.state.crashed).toBe(false);
    expect(Math.abs(fm.state.altitudeMSL - st.altitude)).toBeLessThan(1.5);
    expect(Math.abs(wrapPi(fm.state.heading-st.heading))).toBeLessThan(3*DEG);
    expect(minRpm).toBeGreaterThan(0.9);
    expect(maxBank).toBeLessThan(20*DEG);
    if (!speed) { expect(fm.state.groundSpeed).toBeLessThan(0.8); expect(Math.hypot(fm.state.position.x, fm.state.position.y)).toBeLessThan(8); }
    else expect(Math.abs(fm.state.ias/KT-speed)).toBeLessThan(5);
  }, 60_000);
});

describe('shell helicopter autopilot', () => {
  it('uses A-key hold path, altitude knob, and never resumes hidden engaged hold', () => {
    const sim = new SimPhysics({ aircraft: R22_DEFINITION, weather: calmWeather() });
    sim.reset('cruise'); sim.setAutoflight(true);
    expect(sim.autoflight.engaged).toBe(true);
    const target = sim.autoflight.targetAltitude;
    expect(sim.autoflight.adjustAltitude(5)).toBeCloseTo(target+5);
    sim.step(2);
    expect(sim.autoflight.engaged).toBe(true);
    expect(sim.autoflight.exportState()).toBeNull();
    sim.setAutoflight(false); expect(sim.autoflight.engaged).toBe(false);
    sim.reset('runway'); sim.setAutoflight(true); expect(sim.autoflight.engaged).toBe(false);
  });
  it('refuses and disconnects abnormal RPM or engine failure without writing controls', () => {
    const sim = new SimPhysics({ aircraft: R22_DEFINITION, weather: calmWeather() }); sim.reset('cruise');
    sim.fm.state.rotorcraft!.rotorRpm = 10;
    const before = cloneControls(sim.controls); sim.setAutoflight(true);
    expect(sim.autoflight.engaged).toBe(false); expect(sim.controls).toEqual(before);
    sim.reset('cruise'); sim.setAutoflight(true); sim.fm.state.engine.running = false;
    sim.autoflight.update(DT, sim.state, sim.controls);
    expect(sim.autoflight.engaged).toBe(false); expect(sim.autoflight.helicopter!.reason).toContain('disconnected');
  });
});

import { hoverScenario } from '../../src/sim/rotorcraft/starts';
for (const def of [R22_DEFINITION, R44_DEFINITION, S269_DEFINITION]) it(`${def.id} flyable hover start, acceleration, turn and return to hover with adaptation enabled`, () => {
  const sim = new SimPhysics({ aircraft: def, weather: calmWeather() });
  sim.autoflightOnReset = true; sim.resetTo(hoverScenario(sim.env, def.rotorcraft!));
  expect(sim.autoflight.engaged).toBe(true);
  const ap = sim.autoflight.helicopter!; ap.adaptive = true;
  const startAlt = sim.state.altitudeMSL;
  const startHeading = sim.controls.headingBugDeg;
  const points = [];
  let oldRpm = sim.state.engine.rpm, rpmTrend = 0;
  for (let t = 0; t < 110; t++) {
    if (t === 10) sim.autoflight.autopilot.settings.airspeed = 40*KT;
    if (t === 40) { sim.controls.headingBugDeg = (startHeading+45)%360; sim.autoflight.adjustAltitude(10); }
    if (t === 70) sim.autoflight.autopilot.settings.airspeed = 0;
    // S269 has no installed governor: the pilot, not the autopilot, works the grip.
    if (def.rotorcraft!.systems.governorInstalled === false) {
      for (let i = 0; i < 240; i++) {
        const rpm = sim.state.engine.rpm;
        rpmTrend += ((rpm-oldRpm)/DT-rpmTrend)*(1-Math.exp(-DT/0.3)); oldRpm = rpm;
        sim.controls.throttle = Math.max(0, Math.min(1, sim.controls.throttle +
          Math.max(-0.1, Math.min(0.1, 0.0003*(2650-rpm)-0.0004*rpmTrend))*DT));
        sim.step(DT);
      }
    } else sim.step(1);
    expect(sim.state.crashed).toBe(false);
    expect(sim.autoflight.engaged, `${t}s ${ap.reason}`).toBe(true);
    expect(ap.rollModel.scale).toBeGreaterThanOrEqual(0.8);
    expect(ap.rollModel.scale).toBeLessThanOrEqual(1.2);
    if ([39, 69, 109].includes(t)) points.push({ t, speed: sim.state.groundSpeed/KT,
      altitude: sim.state.altitudeMSL-startAlt, status: ap.status, rollScale: ap.rollModel.scale,
      pitchScale: ap.pitchModel.scale });
  }
  console.info(def.id, 'transition', points);
  expect(Math.abs(sim.state.altitudeMSL-startAlt-10)).toBeLessThan(2);
  expect(sim.state.groundSpeed).toBeLessThan(1);
}, 90_000);

it('holds hover position and height in moderate crosswind and gusts', () => {
  const sim = new SimPhysics({ aircraft: R22_DEFINITION,
    weather: calmWeather({ windSpeedKt: 8, windDirectionDeg: 270, gustKt: 3, turbulence: 0.1 }) });
  sim.resetTo(hoverScenario(sim.env, R22_DEFINITION.rotorcraft!)); sim.setAutoflight(true);
  const start = { ...sim.state.position }, altitude = sim.state.altitudeMSL;
  sim.step(45);
  expect(sim.autoflight.engaged).toBe(true); expect(sim.state.crashed).toBe(false);
  expect(Math.hypot(sim.state.position.x-start.x, sim.state.position.y-start.y)).toBeLessThan(8);
  expect(Math.abs(sim.state.altitudeMSL-altitude)).toBeLessThan(2);
}, 60_000);
