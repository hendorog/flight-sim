import { describe, expect, it } from 'vitest';
import { S269_DEFINITION as def } from '../../src/aircraft/s269';
import { S269_PRESENTATION as pres } from '../../src/aircraft/s269/presentation';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import { cloneControls, defaultControls } from '../../src/core/types';
import { createFlightModelFor } from '../../src/physics';
import { stingerClearance } from '../../src/physics/rotorcraft/skids';
import { makeInputRig } from '../input/testbed';
import { flatEnvironment, calmWeather } from '../fdm/helpers';
import { buildHotspots } from '../../src/instruments/hotspots';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';

const d = def.rotorcraft!;
function shaft(): EngineUnit {
  const e = { omega: 0, inertia: 0.6, shaftTorque: 0,
    get rpm() { return this.omega * 30 / Math.PI; }, state: { rpm: 0, power: 0, manifoldPressure: 0 } };
  return e as unknown as EngineUnit;
}

describe('269 integrated controls and independent systems', () => {
  it('uses bus voltage for clutch/trim motors, HOLD retains partial engagement, and forces act on the stick', () => {
    const r = new Rotorcraft(d), c = defaultControls(def), e = shaft(); r.reset(false);
    c.rotorClutchCommand = 'engage'; c.cyclicTrimPitch = 1; c.cyclicTrimRoll = -1;
    r.drive(5, c, e, undefined, undefined, 28);
    const belt = r.state.clutchEngagement, pitch = r.state.springTrim!.pitch;
    expect(belt).toBeGreaterThan(0); expect(pitch).toBeGreaterThan(0);
    expect(r.state.springTrim!.pitchForce).toBeGreaterThan(0);
    expect(c.elevator).toBe(0); // No invented aerodynamic trim moment/position override.
    c.rotorClutchCommand = 'hold'; r.drive(5, c, e, undefined, undefined, 0);
    expect(r.state.clutchEngagement).toBe(belt); expect(r.state.clutchLight).toBe(false);
    expect(r.state.clutchDisengaged).toBe(true); expect(r.state.springTrim!.pitch).toBe(pitch);
    c.rotorClutchCommand = 'release'; r.drive(5, c, e, undefined, undefined, 0);
    expect(r.state.clutchEngagement).toBe(belt);
    r.drive(5, c, e, undefined, undefined, 28); expect(r.state.clutchEngagement).toBe(0);
  });
  it('keyboard trim moves the released equilibrium and releases on key-up, while the clutch guard blocks Insert', () => {
    const rig = makeInputRig(def.input, { rotorClutch: true, rotorClutchCommand: 'engage', rotorClutchGuardOpen: false });
    const rotor = new Rotorcraft(d); rotor.reset(false); rig.s.rotorcraft = rotor.state;
    rig.tap('Insert'); expect(rig.c.rotorClutchCommand).toBe('engage');
    rig.c.rotorClutchGuardOpen = true;
    rig.tap('Insert'); expect(rig.c.rotorClutchCommand).toBe('hold');
    rig.input.keyDown('End'); rig.input.keyDown('Digit7');
    const engine = shaft();
    for (let i = 0; i < 60; i++) {
      rig.input.update(1 / 60, rig.ctx); rotor.drive(1 / 60, rig.c, engine, undefined, undefined, 28);
    }
    rig.input.keyUp('End'); rig.input.keyUp('Digit7'); rig.run(1 / 60);
    expect(rotor.state.springTrim!.roll).toBeGreaterThan(0);
    expect(rig.c.cyclicTrimPitch).toBe(0); expect(rig.c.cyclicTrimRoll).toBe(0);
    expect(rig.c.elevator).toBeCloseTo(rotor.state.springTrim!.pitch, 6);
    expect(rig.c.aileron).toBeCloseTo(rotor.state.springTrim!.roll, 6);
    expect(rig.c.elevatorTrim).toBe(0);
    expect(rig.c.rudderTrim).toBe(0);
    const roll = rotor.state.springTrim!.roll;
    const left = buildHotspots(pres.panel).find(h => h.id === 'trimLeft')!;
    left.press!(true, rig.c); rig.input.hold(left.hold!.action, true);
    rig.input.update(1 / 60, rig.ctx); rotor.drive(1 / 60, rig.c, engine, undefined, undefined, 28);
    expect(rotor.state.springTrim!.roll).toBeLessThan(roll);
    left.press!(false, rig.c); rig.input.hold(left.hold!.action, false); rig.run(1 / 60);
    expect(rig.c.cyclicTrimRoll).toBe(0);
  });
  it('mouse holds cyclic position as powered trim changes force, with bumpless pickup and release', () => {
    const rig = makeInputRig(def.input), rotor = new Rotorcraft(d), engine = shaft();
    rotor.reset(false); rig.s.rotorcraft = rotor.state;
    const pointer = rig.input as unknown as { mouseNx: number; mouseNy: number; mouseMoves: number };
    const cyclic = () => [rig.c.elevator, rig.c.aileron];
    const expectCyclic = (held: number[]) => cyclic().forEach((v, i) => expect(v).toBeCloseTo(held[i], 12));
    const move = (x: number, y: number) => {
      pointer.mouseNx = x; pointer.mouseNy = y; pointer.mouseMoves++;
      rig.input.update(1 / 60, rig.ctx);
    };
    const trim = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) {
        rig.input.update(1 / 60, rig.ctx); rotor.drive(1 / 60, rig.c, engine, undefined, undefined, 28);
      }
    };
    rig.input.keyDown('End'); rig.input.keyDown('Digit6'); trim(2);
    rig.input.keyUp('End'); rig.input.keyUp('Digit6'); rig.run(1 / 60);
    const initial = cyclic();
    expect(initial[0]).toBeGreaterThan(0); expect(initial[1]).toBeLessThan(0);
    rig.input.setMouseYoke(true); move(0.6, -0.6); // armed: keyboard still owns the stick
    expect(rig.input.getYokeIndicator().mouseArmed).toBe(true); expectCyclic(initial);
    move(0.08, -0.09); expectCyclic(initial); // off-centre pickup with trim already applied
    expect(rig.input.getYokeIndicator().mouseArmed).toBe(false);
    move(0.3, -0.25);
    const held = cyclic(), spring = rotor.state.springTrim!;
    const oldAnchor = [spring.pitch, spring.roll], oldForce = [spring.pitchForce, spring.rollForce];
    rig.input.keyDown('Home'); rig.input.keyDown('Digit7'); trim(3);
    expectCyclic(held); // no pointer movement throughout powered trimming
    expect(spring.pitch).toBeLessThan(oldAnchor[0]); expect(spring.roll).toBeGreaterThan(oldAnchor[1]);
    expect(spring.pitchForce).not.toBeCloseTo(oldForce[0]); expect(spring.rollForce).not.toBeCloseTo(oldForce[1]);
    rig.input.keyUp('Home'); rig.input.keyUp('Digit7');
    // Release between the physics tick and the next input update: consume even that last trim delta.
    rig.input.setMouseYoke(false); rig.run(0.5); expectCyclic(held);
    rig.input.setMouseYoke(true); move(-0.05, 0.06); expectCyclic(held);
    move(0.8, -0.8); expectCyclic([-1, 1]);
    move(-0.8, 0.8); expectCyclic([1, -1]);
    rig.input.setMouseYoke(false);
    rig.tap('Digit5'); rig.run(5); // keyboard recentre uses the new spring equilibrium
    expectCyclic([spring.pitch, spring.roll]);
  });
  it('drives transmission pressure in engine-out rotation and keeps tests, oil sensors and clutch signals independent', () => {
    const fm = createFlightModelFor(def), env = flatEnvironment(undefined, 0);
    fm.reset({ position: { x: 0, y: 0, z: -100 }, heading: 0, airspeed: 25,
      onGround: false, engineRunning: true }, env);
    const s = fm.state, c = cloneControls(fm.trimControls), t = s.rotorcraft!.transmission!;
    const li = { state: s, controls: c, fuelGal: [20], suctionInHg: 0 };
    s.electrical.busVoltage = 28;
    const lamps = () => Object.fromEntries(pres.instrumentSystems.lamps.map(l => [l.id, l.lit(li)]));
    s.engine.oilPressure = 0; s.engine.oilTemp = 200; t.oilPressurePsi = 15; t.oilTemperatureC = 50;
    expect(lamps().mrTransmission).toBe(false);
    t.oilPressurePsi = 0; expect(lamps().mrTransmission).toBe(true);
    t.oilPressurePsi = 15; t.oilTemperatureC = 115; expect(lamps().mrTransmission).toBe(true);
    t.oilTemperatureC = 50; t.tailChips = true; expect(lamps().trChip).toBe(true); t.tailChips = false;
    s.rotorcraft!.clutchLight = true; s.rotorcraft!.clutchDisengaged = false;
    expect(lamps().clutchDisengaged).toBe(false);
    const hotspots = buildHotspots(pres.panel);
    for (const lens of pres.panel.annunciator!.lamps!) {
      const h = hotspots.find(h => h.id === `${lens.id}Test`)!;
      h.press!(true, c); expect(Object.entries(lamps()).filter(([, on]) => on).map(([id]) => id)).toEqual([lens.id]);
      s.electrical.busVoltage = 0; expect(Object.values(lamps()).some(Boolean)).toBe(false);
      s.electrical.busVoltage = 28; h.press!(false, c);
    }
    const r = new Rotorcraft(d); r.reset(true); const e = shaft();
    c.rotorClutchCommand = 'release'; r.drive(1, c, e);
    expect(e.omega).toBe(0); expect(r.state.transmission!.oilPressurePsi).toBeGreaterThan(2.5);
    s.engine.running = false; expect(pres.instrumentSystems.hourmeterRunning!(s, c)).toBe(true);
    t.oilPressurePsi = 0; expect(pres.instrumentSystems.hourmeterRunning!(s, c)).toBe(false);
  });
  it('keeps cold parked skids clear of the short tail guard', () => {
    const fm = createFlightModelFor(def), env = flatEnvironment(undefined, 0);
    fm.reset({ position: { x: 0, y: 0, z: 0 }, heading: 0, airspeed: 0, onGround: true, engineRunning: false,
      fuelFraction: 0.5 }, env);
    const c = cloneControls(fm.trimControls);
    for (let i = 0; i < 5 * 240; i++) fm.step(1 / 240, c, env);
    expect(fm.state.rotorcraft!.tailContact).toBe('none');
    expect(stingerClearance(d, fm.state, env)).toBeGreaterThan(0.5);
    expect(fm.state.crashed).toBe(false);
  });
  it('deep-copies blade/system state and restores HOLD, with momentary commands released and old saves supported', () => {
    const weather = calmWeather(), sim = new SimPhysics({ aircraft: def, weather }); sim.reset('runway'); sim.step(0.1);
    sim.controls.rotorClutchCommand = 'hold'; sim.controls.cyclicTrimPitch = 1; sim.controls.lampTestId = 'lowFuel';
    const snap = sim.captureSnapshot({ weather, cameraMode: 'cockpit', quality: 'low', renderScale: null, resume: true });
    const a = snap.systems.rotorcraft!.articulated!;
    expect(a.blades[0]).not.toBe(sim.state.rotorcraft!.articulated!.blades[0]);
    const parsed = parseSnapshot(JSON.stringify(snap))!;
    expect(parsed.controls.cyclicTrimPitch).toBe(0); expect(parsed.controls.lampTestId).toBeUndefined();
    const copy = new SimPhysics({ aircraft: def, weather }); copy.restore(parsed);
    expect(copy.controls.rotorClutchCommand).toBe('hold');
    expect(copy.state.rotorcraft!.articulated).toEqual(a);
    expect(copy.state.rotorcraft!.transmission).toEqual(snap.systems.rotorcraft!.transmission);
    const broken = structuredClone(snap); broken.systems.rotorcraft!.articulated!.blades[0].flap = NaN;
    expect(parseSnapshot(JSON.stringify(broken))).toBeNull();
    delete snap.systems.rotorcraft!.articulated; delete snap.controls.rotorClutchCommand;
    snap.controls.rotorClutch = false;
    copy.restore(parseSnapshot(JSON.stringify(snap))!);
    expect(copy.controls.rotorClutchCommand).toBe('release');
    expect(copy.state.rotorcraft!.articulated!.blades).toHaveLength(3);
  });
});
