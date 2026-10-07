// The float carburettor of the O-235-like test-bed (testbed.ts, the Cessna 152 pattern): carburettor heat and
// its rpm drop, carburettor ice (growth by the icing-probability law, the restriction it adds, melting under
// heat), and the two calibrations a definition can leave to the engine: the full-rich mixture from the
// take-off fuel flow, and the idle bypass from the idle speed.

import { describe, expect, it } from 'vitest';
import { HP } from '../../src/core/math';
import type { MoistureSample, PropulsionInput } from '../../src/physics/interfaces';
import { Powerplant } from '../../src/physics/propulsion';
import { AVGAS_100LL, type EngineDef } from '../../src/physics/propulsion/defs';
import { PistonEngine, type EngineInput } from '../../src/physics/propulsion/engine';
import { advance, isa, makeInput } from './helpers';
import { CARB_POWERPLANT, IO360_ENGINE, O235_ENGINE } from './testbed';

const RPM = Math.PI / 30;
const GPH = (3.785411784e-3 * AVGAS_100LL.density) / 3600;
const CARB = O235_ENGINE.induction.carburettor!;
const KELVIN = 273.15;

function carbSystem(): Powerplant {
  const sys = new Powerplant(CARB_POWERPLANT);
  sys.reset({ running: true, tanks: [30, 30], rpm: 2000 });
  return sys;
}

/** Steady rpm of `sys` at `input` with the carburettor heat at `heat`. */
function rpmWith(sys: Powerplant, input: PropulsionInput, heat: number): number {
  input.controls.carbHeat = heat;
  sys.reset({ running: true, tanks: [30, 30], rpm: 2000 });
  return sys.settle(input).engine.rpm;
}

describe('carburettor heat', () => {
  // c152.md, section 4: full heat at full throttle costs 150-200 rpm (POH section 7); at the 1700 rpm run-up,
  // roughly 50-100 rpm (school figure). The drop is the hotter, thinner air through the shroud's duct.
  it('drops 150-200 rpm at full throttle and 50-100 rpm at the 1700 rpm run-up, standing at sea level', () => {
    const sys = carbSystem();
    const input = makeInput({ controls: { fuelSelector: 'on', throttle: 1 } });
    const full = rpmWith(sys, input, 0) - rpmWith(sys, input, 1);
    // The run-up throttle: the one that gives 1700 rpm with the heat off.
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      input.controls.throttle = 0.5 * (lo + hi);
      if (rpmWith(sys, input, 0) < 1700) lo = input.controls.throttle;
      else hi = input.controls.throttle;
    }
    const runUp = rpmWith(sys, input, 0);
    const drop = runUp - rpmWith(sys, input, 1);
    console.log(`carburettor heat: ${full.toFixed(0)} rpm drop at full throttle, ${drop.toFixed(0)} rpm at the ${runUp.toFixed(0)} rpm run-up (throttle ${input.controls.throttle.toFixed(3)})`);
    expect(runUp).toBeCloseTo(1700, 0);
    expect(full).toBeGreaterThanOrEqual(150);
    expect(full).toBeLessThanOrEqual(200);
    expect(drop).toBeGreaterThanOrEqual(50);
    expect(drop).toBeLessThanOrEqual(100);
  }, 30_000);

  it('enriches the mixture: the float carburettor meters on the density at its own inlet', () => {
    // Metered fuel ~ sqrt(rho_inlet) while the air mass ~ rho_inlet, so heat raises the fuel-air ratio by about
    // sqrt(T_hot / T_cold) at the same throttle: 45 K on 288 K is +7.5 %.
    const sys = carbSystem();
    const input = makeInput({ ktas: 80, altitudeFt: 3000, controls: { fuelSelector: 'on', throttle: 0.7 } });
    input.controls.carbHeat = 0;
    sys.settle(input);
    const cold = sys.units[0].engine.phi;
    input.controls.carbHeat = 1;
    sys.settle(input);
    const hot = sys.units[0].engine.phi;
    const ratio = hot / cold;
    expect(ratio).toBeGreaterThan(1.03);
    expect(ratio).toBeLessThan(1.12);
  }, 30_000);

  it('is ignored by an engine without a carburettor', () => {
    const sys = new Powerplant({ ...CARB_POWERPLANT, engines: [{ ...CARB_POWERPLANT.engines[0], engine: { ...O235_ENGINE, induction: { ...O235_ENGINE.induction, carburettor: undefined } } }] });
    const input = makeInput({ controls: { fuelSelector: 'on', throttle: 1 } });
    expect(rpmWith(sys, input, 1)).toBe(rpmWith(sys, input, 0));
  }, 30_000);
});

describe('carburettor ice', () => {
  const cloud: MoistureSample = { dewPointSpread: 0, inCloud: true };

  /** A cruise-descent condition at 10 C outside (ISA +7 at 1000 ft), part throttle, in moisture `m`. */
  function icing(m: MoistureSample | undefined, throttle = 0.35, oatC = 10): { sys: Powerplant; input: PropulsionInput } {
    const sys = carbSystem();
    const input = makeInput({ ktas: 80, altitudeFt: 1000, controls: { fuelSelector: 'on', throttle } });
    input.atmosphere = { ...isa(305), temperature: oatC + KELVIN };
    input.atmosphere.density = input.atmosphere.pressure / (287.053 * input.atmosphere.temperature);
    input.moisture = m;
    sys.settle(input);
    return { sys, input };
  }

  it('grows by the law of 3.2 in saturated air: rate x humidity x temperature x power, and costs rpm', () => {
    const { sys, input } = icing(cloud);
    const rpm0 = sys.units[0].rpm;
    const out = advance(sys, input, 120);
    // In cloud between -2 and +15 C every factor but power is 1; power = lerp(1, 0.25, 0.35) = 0.7375.
    expect(out.engine.carbIce).toBeCloseTo(CARB.iceRatePerMin * 2 * (1 + (0.25 - 1) * 0.35), 9);
    // The blockage narrows the throttle body (0.6 x 0.1 of its area): the engine slows, and keeps slowing.
    const twoMinutes = out.engine.rpm;
    expect(rpm0 - twoMinutes).toBeGreaterThan(10);
    expect(twoMinutes - advance(sys, input, 120).engine.rpm).toBeGreaterThan(10);

    // Half as humid (spread 7.5 K of the 15 K that is dry): half the growth.
    const half = icing({ dewPointSpread: 7.5, inCloud: false });
    expect(advance(half.sys, half.input, 120).engine.carbIce).toBeCloseTo(CARB.iceRatePerMin * 2 * 0.7375 * 0.5, 9);
  }, 30_000);

  // review-Bm-propulsion F4: most of the venturi's cooling is fuel evaporating in it, and all of it needs air
  // flowing through it. Before, a parked engine collected 0.70 of ice in 10 min of saturated 10 C air, and so
  // did one windmilling with the mixture at cut-off.
  it('needs air flowing and fuel evaporating: none on a parked engine, none windmilling at cut-off at 10 C', () => {
    for (const [ktas, rpm] of [[0, 0], [70, 1500]]) {
      const sys = new Powerplant(CARB_POWERPLANT);
      const input = makeInput({ ktas, controls: { fuelSelector: 'on', throttle: 0, mixture: 0 } });
      input.atmosphere = { ...input.atmosphere, temperature: 10 + KELVIN };
      input.moisture = { dewPointSpread: 0, inCloud: false };
      sys.reset({ running: false, tanks: [30, 30], rpm });
      const out = advance(sys, input, 600);
      expect(out.engine.carbIce).toBe(0);
      expect(out.engine.rpm > 600).toBe(ktas > 0);
    }
    // At 0 C outside the expansion alone (about 5 K) takes the windmilling venturi below freezing.
    const cold = new Powerplant(CARB_POWERPLANT);
    const input = makeInput({ ktas: 70, controls: { fuelSelector: 'on', throttle: 0, mixture: 0 } });
    input.atmosphere = { ...input.atmosphere, temperature: KELVIN };
    input.moisture = cloud;
    cold.reset({ running: false, tanks: [30, 30], rpm: 1500 });
    expect(advance(cold, input, 60).engine.carbIce).toBeGreaterThan(0);
  }, 30_000);

  // review-Bm-propulsion F6: ice on the throttle plate alone cost a cruising engine 30 rpm for 43 % ice, and
  // almost nothing at full throttle, where the plate is no restriction. It also narrows the venturi throat, in
  // series with the plate: the gradual loss of 100-200 rpm that is the first sign in a fixed-pitch aircraft
  // (FAA AC 20-113).
  it('costs rpm at every throttle position, cruise and full throttle included', () => {
    const sys = carbSystem();
    const rpmAt = (throttle: number, ice: number): number => {
      sys.reset({ running: true, tanks: [30, 30], rpm: 2000 });
      (sys.units[0].engine as PistonEngine).induction.ice = ice;
      return sys.settle(makeInput({ ktas: 90, altitudeFt: 3000, controls: { fuelSelector: 'on', throttle } })).engine.rpm;
    };
    const rows: string[] = [];
    for (const [throttle, at70, atFull] of [[0.35, 100, 200], [0.6, 80, 150], [1, 50, 100]]) {
      const clean = rpmAt(throttle, 0);
      const loss70 = clean - rpmAt(throttle, 0.7), lossFull = clean - rpmAt(throttle, 1);
      rows.push(`throttle ${throttle}: ${clean.toFixed(0)} rpm clean, -${loss70.toFixed(0)} at ice 0.7, -${lossFull.toFixed(0)} at ice 1`);
      expect(loss70).toBeGreaterThan(at70);
      expect(lossFull).toBeGreaterThan(atFull);
    }
    console.log(rows.join('\n'));
  }, 30_000);

  it('does not form in dry air, without moisture, too warm or too cold', () => {
    for (const [m, oatC] of [[{ dewPointSpread: 15, inCloud: false }, 10], [undefined, 10], [cloud, 32], [cloud, -12]] as const) {
      const { sys, input } = icing(m, 0.35, oatC);
      expect(advance(sys, input, 60).engine.carbIce).toBe(0);
    }
  }, 30_000);

  it('is melted by full heat (the rpm drops, then rises: the POH sign of ice), and frozen in settle()', () => {
    const { sys, input } = icing(cloud, 0.35);
    advance(sys, input, 300);
    const iced = sys.units[0].state.carbIce;
    expect(iced).toBeGreaterThan(0.2);
    // settle() neither grows nor melts it.
    sys.settle(input);
    expect(sys.units[0].state.carbIce).toBe(iced);
    const snap = sys.capture()[0];
    expect(snap.carbIce).toBe(iced);

    input.controls.carbHeat = 1;
    const venturiC = 10 + CARB.heatRise - (CARB.venturiDropIdle + (CARB.venturiDropFull - CARB.venturiDropIdle) * 0.35);
    // Venturi above +2 C: melting at meltRatePerMin per 20 K of excess (the inlet is a little warmer than the OAT
    // with ram and induction heating ignored: this is the lower bound of the rate).
    const meltPerMin = (CARB.meltRatePerMin * (venturiC - 2)) / 20;
    let lowest = Infinity, iceGoneAt = NaN, rough = 0;
    const steps = Math.round(120 * 240);
    let t = 0, out = sys.step(input);
    for (let i = 0; i < steps; i++, t += 1 / 240) {
      out = sys.step(input);
      lowest = Math.min(lowest, out.engine.rpm);
      rough = Math.max(rough, (sys.units[0].engine as PistonEngine).roughness);
      expect(out.engine.roughness).toBe((sys.units[0].engine as PistonEngine).roughness);
      if (Number.isNaN(iceGoneAt) && out.engine.carbIce === 0) iceGoneAt = t;
    }
    expect(iceGoneAt).toBeLessThan(((iced / meltPerMin) * 60) * 1.05);
    expect(out.engine.rpm).toBeGreaterThan(lowest + 20);
    // The melt water's rough running is over ICE_WATER_SECONDS after the last ice (review-Bm-propulsion F7); the
    // engine state carries it to the audio (EngineState.roughness, request B-Bm-fix-propulsion-01).
    expect((sys.units[0].engine as PistonEngine).roughness).toBe(0);
    expect(rough).toBe(1);

    // A resume puts it back.
    const copy = carbSystem();
    copy.restore([snap]);
    expect(copy.capture()[0].carbIce).toBe(iced);
  }, 60_000);
});

describe('calibrations solved at construction', () => {
  const probe = (def: EngineDef, rpm: number): EngineInput => ({
    omega: rpm * RPM,
    throttle: 1,
    mixture: 1,
    magnetos: 3,
    ambientPressure: 101325,
    ambientTemperature: 288.15,
    ambientDensity: 1.225,
    ramPressure: 0,
    oilTemperature: 80,
    accessoryPower: 0,
  });

  it('meters the take-off fuel flow at full rich and full throttle, and rates the engine at its power', () => {
    for (const def of [O235_ENGINE, IO360_ENGINE]) {
      expect(def.metering.kind === 'fadecDiesel' || def.metering.fullRichPhi === undefined).toBe(true);
      const engine = new PistonEngine(def);
      const input = probe(def, def.ratedRpm);
      engine.breathe(input);
      engine.breathe(input);
      const takeoff = def.metering.kind === 'fadecDiesel' ? 0 : def.metering.takeoffFuelFlow!;
      // (The calibration ran with the oil at its reference temperature and the exhaust lag of two passes: 0.1 %.)
      expect(engine.fuelDemand / takeoff).toBeCloseTo(1, 3);
      engine.burn(input, engine.fuelDemand);
      // The rating: brake power at rated speed, sea level, full throttle (110 hp at 2550; 200 hp at 2700).
      expect(((engine.indicatedTorque - engine.lossTorque) * input.omega) / def.ratedPower).toBeCloseTo(1, 3);
      console.log(`${def.name}: ${(engine.fuelDemand / GPH).toFixed(2)} US gal/h at ${((engine.indicatedTorque - engine.lossTorque) * input.omega / HP).toFixed(1)} hp`);
    }
  });

  it('opens the idle bypass so that the engine idles at its idle speed on its own propeller', () => {
    // O-235: 600 rpm (c152.md); IO-360: 650 rpm (pa34.md); warm, throttle closed, full rich, sea level, standing.
    for (const def of [CARB_POWERPLANT, { ...CARB_POWERPLANT, engines: [{ ...CARB_POWERPLANT.engines[0], engine: IO360_ENGINE }] }]) {
      const sys = new Powerplant(def);
      sys.reset({ running: true, tanks: [30, 30], rpm: 1000 });
      const out = sys.settle(makeInput({ controls: { fuelSelector: 'on', throttle: 0 } }));
      expect(Math.abs(out.engine.rpm - def.engines[0].engine.idleRpm)).toBeLessThan(15);
      expect(out.engine.running).toBe(true);
    }
  }, 30_000);
});
