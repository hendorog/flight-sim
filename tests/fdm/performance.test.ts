// POH performance at maximum gross weight, ISA: static rpm, maximum level speed, 75 % cruise at 8000 ft,
// best rate of climb and Vy, and the dead-engine glide.
//
// Steady-state points come from the flight model's own trim (the full aerodynamic, propeller and engine
// models at a steady shaft speed); the climb is also flown dynamically with the autopilot as a cross-check. The
// measurements are those of measure.ts, which the per-type conformance suite (tests/conformance) makes for every type.

import { describe, expect, it } from 'vitest';
import { FT, KT } from '../../src/core/math';
import { Autopilot } from '../../src/physics';
import { C172, at, flatEnvironment, fpm, kt, makeRig, report, resetTo } from './helpers';
import { LOW_TERRAIN, bestClimb, bestGlide, cruiseSpeed, maxLevelSpeed, staticRun } from './measure';

const POH = C172.poh;

describe('POH performance (max gross, ISA)', () => {
  it('static rpm at full throttle is 2300-2400', () => {
    const run = staticRun(makeRig());
    const rpm = run.rpm[0];
    report('static rpm', rpm, 2350, 'rpm');
    expect(rpm).toBeGreaterThanOrEqual(POH.staticRpm[0]);
    expect(rpm).toBeLessThanOrEqual(POH.staticRpm[1]);
    // The parking brake holds full power.
    expect(run.groundSpeed).toBeLessThan(0.05);
  }, 30000);

  it('maximum level speed at sea level is 126 KTAS', () => {
    const level = maxLevelSpeed(makeRig({ env: flatEnvironment(undefined, LOW_TERRAIN) }), { altitude: 0 });
    report('max level speed, sea level, full throttle', level.ktas, POH.maxSpeedSeaLevelKtas, 'KTAS');
    const rpm = level.rpm[0];
    report('  rpm at max level speed', rpm, 'about 2700', 'rpm');
    expect(Math.abs(level.ktas / POH.maxSpeedSeaLevelKtas - 1)).toBeLessThan(0.05);
    // Full throttle in level flight at sea level runs at about the red line (2,700). It was 2,783 rpm (128 KTAS)
    // while the blade section's zero-lift angle was its chord-line figure instead of the face's
    // (propulsion/airfoil.ts): the propeller absorbed too little power at cruise advance ratios.
    expect(rpm).toBeGreaterThan(2650);
    expect(rpm).toBeLessThan(2720);
  }, 60000);

  it('75 % power cruise at 8000 ft (leaned to best power) is 124 KTAS', () => {
    const cruise = cruiseSpeed(makeRig({ env: flatEnvironment(undefined, LOW_TERRAIN) }), { altitude: 8000 * FT, powerFraction: 0.75, leanAtKt: 115, resetKt: 120 });
    report('75 % cruise at 8000 ft', cruise.ktas, POH.cruise75pct8000ftKtas, 'KTAS');
    report('  best-power mixture lever', cruise.mixture, 'lean of full rich', '');
    report('  rpm at 75 % cruise', cruise.rpm[0], '2600-2700', 'rpm');
    // Measured -2.8 % (120.5 KTAS at 2,607 rpm). With one drag polar and the same propeller efficiency, the
    // POH's 126 KTAS on full power at sea level and 124 KTAS on 75 % at 8000 ft would need 87 % power at
    // 8000 ft; the model sides with the sea-level figure and the climb. See the integration report.
    expect(Math.abs(cruise.ktas / POH.cruise75pct8000ftKtas - 1)).toBeLessThan(0.07);
    expect(cruise.powerFraction).toBeCloseTo(0.75, 2);
  }, 120000);

  it('best rate of climb is 730 fpm at Vy = 74 KIAS', () => {
    const rig = makeRig({ env: flatEnvironment(undefined, LOW_TERRAIN) });
    resetTo(rig, { position: at(300) });
    const { rocFpm, vyKias: vy } = bestClimb(rig, { altitude: 0, range: { fromKt: 60, toKt: 90 } });
    report('best rate of climb, sea level', rocFpm, POH.climbRateSeaLevelFpm, 'fpm');
    report('Vy', vy, POH.vyKias, 'KIAS');
    // Measured +3.6 % (756 fpm). Was +7.9 % (788 fpm) while the blade section's zero-lift angle was its chord-line
    // figure instead of the face's (propulsion/airfoil.ts: the propeller absorbed too little power, so it climbed
    // at higher rpm) and full rich was only 1.2 % below best power (propulsion/combustion.ts: the POH chart, flown
    // full rich below 3,000 ft and leaned above, loses only 133 fpm from sea level to 4,000 ft).
    expect(Math.abs(rocFpm / POH.climbRateSeaLevelFpm - 1)).toBeLessThan(0.05);
    // The climb-rate curve is very flat around its peak (within 1 % from 72 to 84 KTAS), so Vy is poorly
    // conditioned: measured 80 KIAS (+8 %) since the slipstream's axial increment follows the propeller shaft
    // (Glauert) instead of the skewed wake, which removed a vertical jet component that had lifted the inner
    // wing at low speed and high power. The climb rate itself is within 2 %.
    expect(Math.abs(vy / POH.vyKias - 1)).toBeLessThan(0.1);
  }, 60000);

  // C172S POH fig. 5-6, maximum rate of climb at 2550 lb, full throttle, mixture leaned above 3000 ft for maximum
  // rpm: 685/620/555 fpm at 4000 ft, 465/405/345 at 8000 ft and 255/195/135 at 12000 ft for -20/0/20 C, linearly
  // interpolated to the ISA temperature (7.1, -0.8 and -8.8 C).
  it('climb at altitude matches the POH table (ISA): 597 fpm at 4000 ft, 408 at 8000 ft, 221 at 12000 ft', () => {
    const rig = makeRig({ env: flatEnvironment(undefined, LOW_TERRAIN) });
    resetTo(rig, { position: at(300) });
    const table = [
      { ft: 4000, fpm: 597 },
      { ft: 8000, fpm: 408 },
      { ft: 12000, fpm: 221 },
    ];
    for (const row of table) {
      // Leaned for maximum rpm (best power): the mixture that gives the steepest full-throttle climb at 80 KTAS.
      const { rocFpm, vyKias: vy } = bestClimb(rig, { altitude: row.ft * FT, range: { fromKt: 60, toKt: 95 }, leanAtKt: 80, leanTo: 0.4 });
      report(`best rate of climb, ${row.ft} ft ISA`, rocFpm, row.fpm, 'fpm');
      report(`  Vy at ${row.ft} ft`, vy, 'POH 72-73', 'KIAS');
      expect(Math.abs(rocFpm / row.fpm - 1)).toBeLessThan(0.04);
    }
  }, 120000);

  it('a climb flown by the autopilot at Vy matches the trimmed rate', () => {
    const rig = makeRig({ env: flatEnvironment(undefined, LOW_TERRAIN) });
    resetTo(rig, { position: at(-150), airspeed: 74 * KT, flightPathAngle: 0.1 });
    const trimmedRoc = 74 * KT * Math.sin(rig.fm.lastTrim!.flightPathAngle);
    const ap = new Autopilot();
    ap.settings = { ...ap.settings, lateral: 'heading', heading: 0, vertical: 'airspeed', airspeed: POH.vyKias * KT };
    rig.controls.throttle = 1;
    rig.run(10, () => ap.update(1 / 60, rig.fm.state, rig.controls));
    // 60 s of climb centred on sea level.
    const h0 = rig.fm.state.altitudeMSL;
    rig.run(60, () => ap.update(1 / 60, rig.fm.state, rig.controls));
    const roc = (rig.fm.state.altitudeMSL - h0) / 60;
    report('autopilot Vy climb through sea level', fpm(roc), POH.climbRateSeaLevelFpm, 'fpm');
    report('  trimmed climb at 74 KTAS', fpm(trimmedRoc), POH.climbRateSeaLevelFpm, 'fpm');
    expect(Math.abs(kt(rig.fm.state.ias) - POH.vyKias)).toBeLessThan(2);
    expect(Math.abs(fpm(roc) / POH.climbRateSeaLevelFpm - 1)).toBeLessThan(0.08);
  }, 60000);

  it('dead-engine glide: best L/D 9 at 68 KIAS with the propeller windmilling', () => {
    const glide = bestGlide(makeRig({ env: flatEnvironment(undefined, LOW_TERRAIN) }), { altitude: 300, range: { fromKt: 60, toKt: 82 }, atKias: POH.bestGlideKias });
    const { ratio: bestLd, bestKias } = glide;
    const rpm = glide.rpm[0];
    // The POH gives the glide as 1.5 NM per 1000 ft of height (9.11:1); C172.poh.glideRatio is that rounded to 9.
    const pohGlide = (1.5 * 1852) / (1000 * FT);
    report('best glide ratio, engine dead', bestLd, pohGlide, '');
    report('best glide speed', bestKias, POH.bestGlideKias, 'KIAS');
    report('  windmilling rpm at best glide', rpm, 'windmilling', 'rpm');
    expect(rpm).toBeGreaterThan(300);
    // Measured +6.9 % against 9.11 (9.74; was 9.67 when the blade section's zero-lift angle was its chord-line
    // figure: a blade 0.7 deg coarser windmills at lower rpm, with ~1 % less drag). The POH's 1.5 NM per 1000 ft
    // is a rounded, conservative figure; the airframe alone reaches L/D ~11.5, and the windmilling propeller (~200 N, the power the dead
    // engine's friction and pumping absorb) costs the rest. The propeller now meets the wing's upwash, which
    // slows its axial inflow slightly and tilts its normal force forward, and the slipstream's (here: the
    // windmilling wake's) axial deficit follows the shaft; both lower the glide drag by ~1 % each.
    expect(Math.abs(bestLd / pohGlide - 1)).toBeLessThan(0.08);
    // The L/D curve is very flat (L/D at 68 KIAS is within 2 % of the maximum): the windmilling drag rises
    // less than V^2 because engine friction holds the propeller back at low speed, which moves the maximum
    // up to ~76 KIAS. Measured +12 %.
    expect(Math.abs(bestKias / POH.bestGlideKias - 1)).toBeLessThan(0.15);
    const ld68 = glide.ratioAt;
    report('glide ratio at 68 KIAS', ld68, pohGlide, '');
    expect(Math.abs(ld68 / pohGlide - 1)).toBeLessThan(0.08);
  }, 120000);
});
