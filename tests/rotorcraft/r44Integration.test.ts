import { describe, expect, it } from 'vitest';
import { R44_DEFINITION as def } from '../../src/aircraft/r44';
import { R44_VISUAL } from '../../src/aircraft/r44/visual';
import { R44_PANEL } from '../../src/aircraft/r44/panel';
import { R44_UI } from '../../src/aircraft/r44/ui';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_MAP, r44Map, r44Vne } from '../../src/aircraft/r44/limits';
import { FT, KT, LB } from '../../src/core/math';
import { cloneControls, defaultControls } from '../../src/core/types';
import { createFlightModelFor } from '../../src/physics';
import { placardMap } from '../../src/physics/rotorcraft/limits';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { lampSwitchedOn } from '../../src/render/aircraft/lights';
import { buildHotspots } from '../../src/instruments/hotspots';
import { InputSystem } from '../../src/input/InputSystem';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';
import { FRAME, makeRig } from '../input/keyboardPilot';
import { calmWeather, flatEnvironment } from '../fdm/helpers';

const DT = 1 / 240;
const world = flatEnvironment(undefined, 0), env = { ...world, atmosphere: () => world.atmosphere(0) };
function flight(running = true, ground = true, departureLb = 2500) {
  const fm = createFlightModelFor(def);
  const loading = def.mass.loadings.maxGross;
  fm.setLoading({ ...loading, payload: loading.payload - (2500 - departureLb) * LB });
  fm.reset({ position: { x: 0, y: 0, z: ground ? 0 : -300 }, heading: 0,
    airspeed: ground ? 0 : 60 * KT, onGround: ground, engineRunning: running, fuelFraction: 1 }, env);
  return { fm, c: cloneControls(fm.trimControls) };
}

describe('R44 shared integration', () => {
  it.each([def, R22_DEFINITION])('$id keeps the LOW RPM light on with collective down, but mutes the horn', aircraft => {
    const rotor = new Rotorcraft(aircraft.rotorcraft!), c = defaultControls(aircraft);
    const fm = createFlightModelFor(aircraft), engine = fm.powerplant.units[0];
    rotor.reset(false); c.masterBattery = true; c.collective = 0;
    rotor.drive(0, c, engine);
    expect(rotor.state.lowRpmLight).toBe(true); expect(rotor.state.lowRpmHorn).toBe(false);
    c.collective = 0.1; rotor.drive(0, c, engine);
    expect(rotor.state.lowRpmLight).toBe(true); expect(rotor.state.lowRpmHorn).toBe(true);
    c.masterBattery = false; rotor.drive(0, c, engine);
    expect(rotor.state.lowRpmLight).toBe(false); expect(rotor.state.lowRpmHorn).toBe(false);
    c.masterBattery = true; rotor.state.omega = aircraft.rotorcraft!.referenceRpm * Math.PI / 30;
    rotor.drive(0, c, engine);
    expect(rotor.state.lowRpmLight).toBe(false); expect(rotor.state.lowRpmHorn).toBe(false);
  });

  it('reports configured Vne through the real flight state and HUD, retaining departure weight after fuel burn', () => {
    const { fm, c } = flight(true, false, 2250);
    fm.step(0.1, c, env);
    const r = fm.state.rotorcraft!;
    expect(r.takeoffMass / LB).toBeCloseTo(2250, 2);
    expect(r.vneKias).toBe(120);
    // Remove fuel through the supported systems restore to stand in for a long fuel burn.
    const saved = fm.captureSystems(); saved.tanks = [0, 0];
    fm.restoreSystems(saved, c, 0); fm.step(DT, c, env);
    expect(fm.state.mass / LB).toBeLessThan(2200);
    expect(r.takeoffMass).toBe(saved.rotorcraft!.takeoffMass);
    expect(r.vneKias).toBe(120);
    c.rotorDoorsOff = true; fm.step(DT, c, env); expect(r.vneKias).toBe(100);
    c.rotorDoorsOff = false; c.rotorClutch = false; c.mixture = 0;
    fm.step(0.1, c, env); expect(r.driveTorque).toBe(0); expect(r.vneKias).toBe(100);
    expect(R44_UI.hud.readouts.find(d => d.label === 'VNE')!.text(fm.state)).toBe('100 KIAS');
    expect(r44Vne(0, 288.15, { takeoffMass: 2000 * LB, aboveMcp: true })).toBe(100);
  });

  it('treats interior full-throttle MAP cells consistently in the solver and HUD', () => {
    expect(placardMap(R44_MAP, 10000 * FT, 283.15)).toBe(Infinity);
    expect(r44Map(9000 * FT, 283.15)).toBeCloseTo(20.4, 10);
    expect(r44Map(11000 * FT, 303.15)).toBe(Infinity);
    const { fm, c } = flight();
    const rotor = new Rotorcraft(def.rotorcraft!); rotor.reset(true);
    const e = fm.powerplant.units[0]; e.state.power = 0; e.state.manifoldPressure = 23;
    rotor.drive(0.1, c, e, { ...world.atmosphere(11000 * FT), temperature: 283.15 });
    expect(rotor.state.takeoffPowerSeconds).toBe(0);
    fm.state.staticPressure = world.atmosphere(11000 * FT).pressure; fm.state.oat = 283.15;
    expect(R44_UI.hud.readouts.find(d => d.label === 'MCP')!.text(fm.state)).toBe('FULL THROTTLE');
  });

  it('primes independently of cranking and runs the pump only with clutch selection and oil pressure', () => {
    const { fm, c } = flight(false), pp = fm.powerplant;
    Object.assign(c, { masterBattery: true, alternator: false, rotorClutch: false, fuelPump: true, mixture: 1, throttle: 0.05 });
    fm.step(DT, c, env); expect(fm.state.engine.auxFuelPressure).toBe(0); // manual switch is not the R44 circuit
    const initialFilm = pp.fuel.film;
    c.fuelPrime = true;
    for (let t = 0; t < 1; t += DT) fm.step(DT, c, env);
    expect(fm.state.engine.auxFuelPressure).toBeGreaterThan(20);
    expect(pp.fuel.film).toBeGreaterThan(initialFilm);
    expect(fm.state.engine.rpm).toBe(0); expect(c.starter).toBe(false);
    c.fuelPrime = false; fm.step(DT, c, env); expect(fm.state.engine.auxFuelPressure).toBe(0);
    c.rotorClutch = true; fm.step(DT, c, env); expect(fm.state.engine.auxFuelPressure).toBe(0);
    const running = flight();
    running.fm.step(0.1, running.c, env);
    expect(running.fm.state.engine.auxFuelPressure).toBeGreaterThan(20);
    running.c.rotorClutch = false; running.fm.step(DT, running.c, env);
    expect(running.fm.state.engine.auxFuelPressure).toBe(0);
    expect(running.fm.state.engine.fuelPressure).toBeGreaterThan(20); // mechanical feed still live
    running.c.rotorClutch = true; running.c.masterBattery = false; running.fm.step(DT, running.c, env);
    expect(running.fm.state.engine.auxFuelPressure).toBe(0);
  });

  it('maps J and the key hotspot to momentary PRIME, and keeps S independent of ignition selection', () => {
    const rig = makeRig({ turbulence: 0, windSpeedKt: 0 });
    const input = new InputSystem({ profile: def.input }); input.attach(rig.ctx);
    const c = rig.ctx.controls; c.fuelPump = false; c.magnetos = 0;
    input.keyDown('KeyJ'); input.update(FRAME, rig.ctx);
    expect(c.fuelPrime).toBe(true); expect(c.fuelPump).toBe(false); expect(c.starter).toBe(false); expect(c.magnetos).toBe(3);
    input.keyUp('KeyJ'); input.update(FRAME, rig.ctx); expect(c.fuelPrime).toBe(false);
    const key = buildHotspots(R44_PANEL).find(h => h.id === 'magnetos')!;
    c.magnetos = 3; input.hold(key.springHold!.action, true); input.update(FRAME, rig.ctx);
    expect(c.fuelPrime).toBe(true); expect(key.value!(c)).toBe('PRIME');
    input.releaseAll(); input.update(FRAME, rig.ctx); expect(c.fuelPrime).toBe(false);
    c.magnetos = 0; input.keyDown('KeyS'); input.update(FRAME, rig.ctx);
    expect(c.starter).toBe(true); expect(c.magnetos).toBe(0); expect(c.fuelPrime).toBe(false);
    input.releaseAll();
  });

  it('maps the red lamp to STROBE and both landing lamps to LAND with the clutch interlock', () => {
    const c = defaultControls(def), lamp = (id: string) => R44_VISUAL.lamps.find(l => l.id === id);
    c.lights.beacon = true; c.lights.strobe = false;
    expect(lampSwitchedOn(lamp('beacon'), c)).toBe(false);
    c.lights.beacon = false; c.lights.strobe = true;
    expect(lampSwitchedOn(lamp('beacon'), c)).toBe(true);
    c.lights.landing = true; c.lights.taxi = false; c.rotorClutch = false;
    for (const id of ['landing', 'taxi']) expect(lampSwitchedOn(lamp(id), c)).toBe(false);
    c.rotorClutch = true;
    for (const id of ['landing', 'taxi']) expect(lampSwitchedOn(lamp(id), c)).toBe(true);
    c.lights.landing = false;
    for (const id of ['landing', 'taxi']) expect(lampSwitchedOn(lamp(id), c)).toBe(false);
  });

  it('round-trips departure mass/light state and migrates old saves without holding PRIME', () => {
    const weather = calmWeather(), sim = new SimPhysics({ aircraft: def, weather }); sim.reset('cruise');
    sim.state.rotorcraft!.takeoffMass = 2400 * LB; sim.controls.fuelPrime = true;
    const snap = sim.captureSnapshot({ weather, cameraMode: 'cockpit', quality: 'low', renderScale: 1, resume: true });
    const parsed = parseSnapshot(JSON.stringify(snap))!;
    expect(parsed.controls.fuelPrime).toBe(false);
    const copy = new SimPhysics({ aircraft: def, weather }); copy.restore(parsed);
    expect(copy.state.rotorcraft!.takeoffMass).toBe(2400 * LB);
    const old = JSON.parse(JSON.stringify(snap));
    delete old.systems.rotorcraft.takeoffMass; delete old.systems.rotorcraft.lowRpmLight;
    expect(parseSnapshot(JSON.stringify(old))).not.toBeNull();
    copy.restore(parseSnapshot(JSON.stringify(old))!);
    expect(copy.state.rotorcraft!.takeoffMass).toBeGreaterThan(0);
    expect(copy.controls.fuelPrime).toBe(false);
  });
});
