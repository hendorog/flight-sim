import { describe, expect, it } from 'vitest';
import { HP } from '../../src/core/math';
import { PropulsionSystem } from '../../src/physics/propulsion';
import { PistonEngine } from '../../src/physics/propulsion/engine';
import { GPH_PER_KG_S, isa, makeInput, propEfficiency, run, runningSystem } from './helpers';

const F = (c: number): number => (c * 9) / 5 + 32;
const LONG = 60_000;

describe('full-throttle performance', () => {
  it('static rpm 2300-2400 and static thrust 1900-2300 N at sea level (POH)', () => {
    const out = run(runningSystem(2000), {}, 20);
    console.log(`static: ${out.engine.rpm.toFixed(0)} rpm, ${out.propeller.thrust.toFixed(0)} N, ${(out.engine.power / HP).toFixed(1)} hp, MAP ${out.engine.manifoldPressure.toFixed(2)} inHg`);
    expect(out.engine.rpm).toBeGreaterThan(2300);
    expect(out.engine.rpm).toBeLessThan(2400);
    expect(out.propeller.thrust).toBeGreaterThan(1900);
    expect(out.propeller.thrust).toBeLessThan(2300);
    expect(out.engine.manifoldPressure).toBeGreaterThan(28.5);
    expect(out.engine.manifoldPressure).toBeLessThan(29.92);
  });

  // A 76 in, 60 in pitch fixed-pitch McCauley reaches a propeller efficiency of ~0.82-0.85 near J 0.7-0.8. The bound
  // was 0.82 while the blade tips carried spurious wave drag (critical Mach from a suction peak measured from zero
  // lift instead of from the section's design lift, see propulsion/airfoil.ts): measured 0.829 at 110 KTAS now.
  it('at 110-120 KTAS the rpm approaches 2550-2700 with propeller efficiency 0.75-0.86', () => {
    for (const kt of [110, 115, 120]) {
      const out = run(runningSystem(2500), { ktas: kt }, 15);
      const eta = propEfficiency(out, kt);
      console.log(`${kt} KTAS SL full throttle: ${out.engine.rpm.toFixed(0)} rpm, ${(out.engine.power / HP).toFixed(1)} hp, thrust ${out.propeller.thrust.toFixed(0)} N, eta ${eta.toFixed(3)}, J ${out.propeller.advanceRatio.toFixed(3)}`);
      // The isolated propeller here meets the free stream; installed, the cowling's blockage slows the inflow
      // through the disc by ~2.5 % (aero/aeroModel.ts, discBlockage) and the rpm is ~1.5 % lower. Installed, full
      // throttle at sea level reaches 2,700 rpm at the POH's maximum level speed (~126 KTAS), so 110 KTAS here is
      // ~2,570 rpm. It was 2,640 (and 2,780 rpm at the maximum level speed) while the blade section's zero-lift
      // angle was the Clark Y's chord-line figure instead of the face's (propulsion/airfoil.ts).
      expect(out.engine.rpm).toBeGreaterThan(2550);
      expect(out.engine.rpm).toBeLessThan(2750);
      expect(eta).toBeGreaterThan(0.75);
      expect(eta).toBeLessThan(0.86);
    }
  });

  it('delivers the rated 180 hp at 2700 rpm, sea level, full throttle, full rich', () => {
    const engine = new PistonEngine();
    const input = {
      omega: (2700 * Math.PI) / 30,
      throttle: 1,
      mixture: 1,
      magnetos: 3 as const,
      ambientPressure: 101325,
      ambientTemperature: 288.15,
      ambientDensity: 1.225,
      ramPressure: 0,
      oilTemperature: 85,
      accessoryPower: 0,
    };
    for (let i = 0; i < 3; i++) engine.breathe(input);
    engine.burn(input, engine.fuelDemand);
    const power = (engine.indicatedTorque - engine.lossTorque) * input.omega;
    console.log(`rated: ${(power / HP).toFixed(1)} hp, indicated efficiency ${engine.indicatedEfficiency.toFixed(3)}, VE ${engine.induction.state.volumetricEfficiency.toFixed(3)}`);
    expect(power / HP).toBeCloseTo(180, 0);
    expect(engine.indicatedEfficiency).toBeGreaterThan(0.3);
    expect(engine.indicatedEfficiency).toBeLessThan(0.42);
  });

  it('lapses to about 75 % power near 8000 ft (full throttle, leaned to best power)', () => {
    let best = 0;
    let bestMix = 1;
    for (let mix = 1; mix >= 0.4; mix -= 0.05) {
      const out = run(runningSystem(2550), { ktas: 110, altitudeFt: 8000, controls: { mixture: mix } }, 10);
      if (out.engine.power > best) {
        best = out.engine.power;
        bestMix = mix;
      }
    }
    const fraction = best / (180 * HP);
    console.log(`8000 ft best power ${(best / HP).toFixed(1)} hp = ${(fraction * 100).toFixed(1)} % at mixture ${bestMix.toFixed(2)}`);
    expect(fraction).toBeGreaterThan(0.7);
    expect(fraction).toBeLessThan(0.8);
  });
});

describe('altitude power lapse', () => {
  // Brake power at full throttle and 2700 rpm against the Gagg-Ferrar lapse P / P0 = 1.132 sigma - 0.132 (the standard
  // altitude correction for normally aspirated piston engines), with the volumetric efficiency growing as the square
  // root of the charge temperature (Heywood sec. 6.2.1): power ~ MAP rpm / sqrt(T).
  it('full-throttle power at 2700 rpm lapses with altitude as Gagg-Ferrar predicts (within 3 %)', () => {
    for (const ft of [4000, 8000, 12000]) {
      const engine = new PistonEngine();
      const atm = isa(ft * 0.3048);
      const input = {
        omega: (2700 * Math.PI) / 30,
        throttle: 1,
        mixture: 1,
        magnetos: 3 as const,
        ambientPressure: atm.pressure,
        ambientTemperature: atm.temperature,
        ambientDensity: atm.density,
        ramPressure: 0,
        oilTemperature: 85,
        accessoryPower: 0,
      };
      for (let i = 0; i < 3; i++) engine.breathe(input);
      // Best-power mixture (equivalence ratio 1.15).
      engine.burn(input, engine.induction.state.airFlow * (1 / 14.8) * 1.15);
      const power = (engine.indicatedTorque - engine.lossTorque) * input.omega;
      const sigma = atm.density / 1.225;
      const gaggFerrar = (1.132 * sigma - 0.132) * 180 * HP;
      console.log(`${ft} ft, 2700 rpm full throttle: ${(power / HP).toFixed(1)} hp, Gagg-Ferrar ${(gaggFerrar / HP).toFixed(1)} hp, MAP ${(engine.induction.state.manifoldPressure / 3386.39).toFixed(2)} inHg (ambient ${(atm.pressure / 3386.39).toFixed(2)})`);
      expect(Math.abs(power / gaggFerrar - 1)).toBeLessThan(0.03);
      // Manifold pressure at full throttle: ambient less ~0.5-1 inHg of inlet and throttle loss.
      const loss = (atm.pressure - engine.induction.state.manifoldPressure) / 3386.39;
      expect(loss).toBeGreaterThan(0.3);
      expect(loss).toBeLessThan(1.2);
    }
  });
});

describe('fuel flow', () => {
  it('about 10 gph at 75 % power leaned to best power; best economy leaner and cheaper; full-rich take-off 13-16 gph', () => {
    const rows: { mix: number; hp: number; gph: number; egt: number }[] = [];
    for (let mix = 1; mix >= 0.35; mix -= 0.025) {
      const out = run(runningSystem(2550), { ktas: 110, altitudeFt: 8000, controls: { mixture: mix } }, 12);
      rows.push({ mix, hp: out.engine.power / HP, gph: out.engine.fuelFlow * GPH_PER_KG_S, egt: out.engine.egt });
    }
    const bestPower = rows.reduce((a, b) => (b.hp > a.hp ? b : a));
    const peakEgt = rows.reduce((a, b) => (b.egt > a.egt ? b : a));
    const bestEconomy = rows.reduce((a, b) => (b.gph / b.hp < a.gph / a.hp ? b : a));
    const bsfc = (r: { hp: number; gph: number }): number => (r.gph * 6.0) / r.hp; // lb/hp/h
    console.log(
      `8000 ft: best power ${bestPower.hp.toFixed(1)} hp @ ${bestPower.gph.toFixed(2)} gph (BSFC ${bsfc(bestPower).toFixed(3)}), ` +
        `peak EGT ${F(peakEgt.egt).toFixed(0)} F @ ${peakEgt.gph.toFixed(2)} gph ${peakEgt.hp.toFixed(1)} hp, ` +
        `best economy BSFC ${bsfc(bestEconomy).toFixed(3)} @ ${bestEconomy.gph.toFixed(2)} gph`,
    );
    expect(bestPower.gph).toBeGreaterThan(9.5);
    expect(bestPower.gph).toBeLessThan(11.5);
    expect(peakEgt.gph).toBeLessThan(bestPower.gph);
    expect(bsfc(bestPower)).toBeGreaterThan(0.43);
    expect(bsfc(bestPower)).toBeLessThan(0.52);
    expect(bsfc(bestEconomy)).toBeLessThan(bsfc(bestPower) - 0.03);
    // Best power is rich of peak EGT by roughly 50-150 F.
    const rop = F(peakEgt.egt) - F(bestPower.egt);
    expect(rop).toBeGreaterThan(40);
    expect(rop).toBeLessThan(160);

    const takeoff = run(runningSystem(2300), { ktas: 50 }, 10);
    const gph = takeoff.engine.fuelFlow * GPH_PER_KG_S;
    console.log(`take-off full rich: ${gph.toFixed(1)} gph`);
    expect(gph).toBeGreaterThan(13);
    expect(gph).toBeLessThan(16);
  }, LONG);

  it('draws evenly from both tanks, from one tank when selected, and the totals match the fuel flow', () => {
    const sys = runningSystem(2400);
    const input = makeInput({ ktas: 100 });
    let left = 0;
    let right = 0;
    let burned = 0;
    for (let i = 0; i < 240 * 60; i++) {
      const out = sys.step(input);
      left += out.fuelUsed.left;
      right += out.fuelUsed.right;
      burned += out.engine.fuelFlow * input.dt;
    }
    expect(left).toBeCloseTo(right, 3);
    expect(left + right).toBeCloseTo(burned, 2);
    expect(sys.fuelLeft).toBeCloseTo(72 - left, 6);

    input.controls.fuelSelector = 'right';
    const before = sys.fuelLeft;
    for (let i = 0; i < 240 * 30; i++) sys.step(input);
    expect(sys.fuelLeft).toBe(before);
    expect(sys.fuelRight).toBeLessThan(72 - right - 0.05);
  });
});

describe('idle, mixture and magnetos', () => {
  it('idles at 600-700 rpm with the throttle closed', () => {
    const out = run(runningSystem(900), { controls: { throttle: 0 } }, 30);
    console.log(`idle: ${out.engine.rpm.toFixed(0)} rpm, MAP ${out.engine.manifoldPressure.toFixed(1)} inHg, ${(out.engine.fuelFlow * GPH_PER_KG_S).toFixed(2)} gph, oil ${out.engine.oilPressure.toFixed(0)} psi`);
    expect(out.engine.rpm).toBeGreaterThan(600);
    expect(out.engine.rpm).toBeLessThan(700);
    expect(out.engine.running).toBe(true);
  });

  it('stops the engine with the mixture at idle cut-off', () => {
    const sys = runningSystem(1000);
    run(sys, { controls: { throttle: 0.05 } }, 5);
    const out = run(sys, { controls: { throttle: 0.05, mixture: 0 } }, 10);
    console.log(`idle cut-off: ${out.engine.rpm.toFixed(0)} rpm after 10 s`);
    expect(out.engine.running).toBe(false);
    expect(out.engine.rpm).toBe(0);
    expect(out.engine.fuelFlow).toBe(0);
  });

  it('drops 50-150 rpm on a single magneto at the 1800 rpm run-up and dies with both off', () => {
    // Find the run-up throttle setting.
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 16; i++) {
      const t = 0.5 * (lo + hi);
      if (run(runningSystem(1800), { controls: { throttle: t } }, 8).engine.rpm > 1800) hi = t;
      else lo = t;
    }
    const drops: number[] = [];
    for (const mag of [1, 2] as const) {
      const sys = runningSystem(1800);
      const both = run(sys, { controls: { throttle: lo } }, 8).engine.rpm;
      const egtBoth = sys.thermal.egt;
      const single = run(sys, { controls: { throttle: lo, magnetos: mag } }, 8);
      drops.push(both - single.engine.rpm);
      expect(single.engine.egt).toBeGreaterThan(egtBoth);
    }
    console.log(`magneto drop at 1800 rpm: L ${drops[1].toFixed(0)} rpm, R ${drops[0].toFixed(0)} rpm`);
    for (const d of drops) {
      expect(d).toBeGreaterThan(50);
      expect(d).toBeLessThan(150);
    }
    const off = run(runningSystem(1800), { controls: { throttle: lo, magnetos: 0 } }, 10);
    expect(off.engine.running).toBe(false);
    expect(off.engine.rpm).toBe(0);
  }, LONG);
});

describe('starting and windmilling', () => {
  it('starts from cold with the starter and settles at a fast idle', () => {
    const sys = new PropulsionSystem();
    sys.reset({ running: false, fuelLeft: 72, fuelRight: 72 });
    const input = makeInput({ controls: { throttle: 0.1, starter: true } });
    let firedAt = -1;
    let crankAmps = 0;
    let crankVolts = 0;
    for (let i = 0; i < 240 * 5; i++) {
      const out = sys.step(input);
      if (i === 24) {
        crankAmps = sys.electrical.state.starterAmps;
        crankVolts = out.electrical.busVoltage;
      }
      if (out.engine.running && firedAt < 0) {
        firedAt = i * input.dt;
        input.controls.starter = false;
      }
    }
    const out = run(sys, { controls: { throttle: 0.1 } }, 20);
    console.log(`start: running after ${firedAt.toFixed(2)} s, cranking ${crankAmps.toFixed(0)} A at ${crankVolts.toFixed(1)} V, then ${out.engine.rpm.toFixed(0)} rpm, oil ${out.engine.oilPressure.toFixed(0)} psi (cold)`);
    expect(firedAt).toBeGreaterThan(0);
    expect(firedAt).toBeLessThan(3);
    expect(crankAmps).toBeGreaterThan(100);
    expect(crankVolts).toBeLessThan(24);
    expect(out.engine.running).toBe(true);
    expect(out.engine.rpm).toBeGreaterThan(900);
    expect(out.engine.rpm).toBeLessThan(1500);
    expect(out.engine.oilPressure).toBeGreaterThan(80);
  });

  it('cranks a cold engine at about 200 rpm on about 200 A (series-wound starter)', () => {
    const sys = new PropulsionSystem();
    sys.reset({ running: false, fuelLeft: 72, fuelRight: 72 });
    // Mixture at idle cut-off so it cannot fire: pure cranking.
    const input = makeInput({ controls: { throttle: 0.1, mixture: 0, starter: true } });
    let rpm05 = 0;
    for (let i = 0; i < 240 * 4; i++) {
      const out = sys.step(input);
      if (i === 120) rpm05 = out.engine.rpm;
    }
    const rpm = sys.rpm;
    const amps = sys.electrical.state.starterAmps;
    console.log(`cranking: ${rpm05.toFixed(0)} rpm after 0.5 s, ${rpm.toFixed(0)} rpm after 4 s on ${amps.toFixed(0)} A`);
    expect(rpm05).toBeGreaterThan(60);
    expect(rpm).toBeGreaterThan(150);
    expect(rpm).toBeLessThan(260);
    expect(amps).toBeGreaterThan(150);
    expect(amps).toBeLessThan(250);
  });

  it('does not start with the magnetos off or the master switch off', () => {
    for (const controls of [{ magnetos: 0 as const }, { masterBattery: false }]) {
      const sys = new PropulsionSystem();
      sys.reset({ running: false, fuelLeft: 72, fuelRight: 72 });
      const out = run(sys, { controls: { throttle: 0.1, starter: true, ...controls } }, 30);
      expect(out.engine.running).toBe(false);
    }
  });

  it('windmills at a plausible rpm in a dead-engine glide, stops near the stall, and restarts in flight', () => {
    const glide = run(runningSystem(1200), { ktas: 68, controls: { throttle: 0, mixture: 0 } }, 40);
    console.log(`dead-engine glide 68 KTAS: windmilling ${glide.engine.rpm.toFixed(0)} rpm, thrust ${glide.propeller.thrust.toFixed(0)} N`);
    expect(glide.engine.running).toBe(false);
    expect(glide.engine.rpm).toBeGreaterThan(600);
    expect(glide.engine.rpm).toBeLessThan(1300);
    expect(glide.propeller.thrust).toBeLessThan(-100);

    const slow = run(runningSystem(1200), { ktas: 48, controls: { throttle: 0, mixture: 0 } }, 40);
    console.log(`dead-engine at 48 KTAS: ${slow.engine.rpm.toFixed(0)} rpm`);
    expect(slow.engine.rpm).toBe(0);

    const sys = runningSystem(1200);
    run(sys, { ktas: 68, controls: { throttle: 0, mixture: 0 } }, 20);
    const restarted = run(sys, { ktas: 68, controls: { throttle: 0.5, mixture: 1 } }, 10);
    expect(restarted.engine.running).toBe(true);
    expect(restarted.engine.rpm).toBeGreaterThan(2000);
  });

  it('starves when the selector is turned off, after the fuel in the lines is used', () => {
    const sys = runningSystem(2400);
    run(sys, { ktas: 100 }, 5);
    const input = makeInput({ ktas: 100, controls: { fuelSelector: 'off' } });
    let stoppedAt = -1;
    for (let i = 0; i < 240 * 60 && stoppedAt < 0; i++) {
      if (sys.step(input).engine.fuelFlow === 0) stoppedAt = i * input.dt;
    }
    console.log(`selector OFF at full power: fuel flow stops after ${stoppedAt.toFixed(1)} s`);
    expect(stoppedAt).toBeGreaterThan(3);
    expect(stoppedAt).toBeLessThan(30);
    const out = run(sys, { ktas: 100, controls: { fuelSelector: 'off' } }, 10);
    expect(out.engine.running).toBe(false);
    expect(out.engine.rpm).toBeGreaterThan(600); // windmilling
  });
});

describe('temperatures and pressures', () => {
  it('stays within the green arcs in a 15-minute Vy climb and in 75 % cruise', () => {
    const climb = run(runningSystem(2400), { ktas: 74 }, 900);
    const cruise = run(runningSystem(2550), { ktas: 115, altitudeFt: 8000, controls: { mixture: 0.7 } }, 900);
    for (const [name, o] of [
      ['climb', climb],
      ['cruise', cruise],
    ] as const) {
      console.log(`${name}: EGT ${F(o.engine.egt).toFixed(0)} F, CHT ${F(o.engine.cht).toFixed(0)} F, oil ${F(o.engine.oilTemp).toFixed(0)} F ${o.engine.oilPressure.toFixed(0)} psi, fuel ${o.engine.fuelPressure.toFixed(1)} psi`);
      expect(F(o.engine.cht)).toBeGreaterThan(300);
      expect(F(o.engine.cht)).toBeLessThan(500);
      expect(F(o.engine.oilTemp)).toBeGreaterThan(150);
      expect(F(o.engine.oilTemp)).toBeLessThan(245);
      expect(o.engine.oilPressure).toBeGreaterThan(50);
      expect(o.engine.oilPressure).toBeLessThan(90);
      expect(F(o.engine.egt)).toBeGreaterThan(1150);
      expect(F(o.engine.egt)).toBeLessThan(1550);
    }
    expect(climb.engine.cht).toBeGreaterThan(cruise.engine.cht);
  }, LONG);

  it('heats the cylinder heads with a time constant of minutes and cools a stopped engine slowly', () => {
    const sys = new PropulsionSystem();
    sys.reset({ running: true, fuelLeft: 72, fuelRight: 72, rpm: 2300, oat: isa(0).temperature });
    sys.thermal.reset(false, 288.15);
    const t60 = run(sys, { ktas: 74 }, 60).engine.cht;
    const t600 = run(sys, { ktas: 74 }, 540).engine.cht;
    console.log(`CHT from cold in a climb: ${F(t60).toFixed(0)} F after 1 min, ${F(t600).toFixed(0)} F after 10 min`);
    expect(t60).toBeLessThan(0.7 * t600);
    expect(t600).toBeGreaterThan(150);
  }, LONG);

});
