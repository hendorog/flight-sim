// MD 500E (369E, 250-C20B): the definition's data against its sources (T2). Flight behaviour is tested in
// tests/rotorcraft/md500Systems.test.ts and md500Performance.test.ts.
import { describe, expect, it } from 'vitest';
import { FT, HP, LB } from '../../src/core/math';
import { MD500_DEFINITION as def } from '../../src/aircraft/md500';
import * as D from '../../src/aircraft/md500/dimensions';
import { MD500_ENGINE_RATED_W, MD500_ENGINE_RATIO, MD500_NR_100, MD500_NR_NOMINAL, MD500_N2_100_RPM, MD500_TAIL_RATIO,
  MD500_TWIST_GRIP, md500TorquePsi } from '../../src/aircraft/md500/facts';
import { MD500_ARTICULATED, OH6A_FLAP_INERTIA } from '../../src/aircraft/md500/articulated';
import { MD500_VNE, MD500_VNE_OAT_C, MD500_VNE_TABLES, MD500_SPEED_CORRECTIONS } from '../../src/aircraft/md500/limits';
import { configuredVne } from '../../src/physics/rotorcraft/limits';

const r = def.rotorcraft!, ts = r.systems.turboshaft!, engine = def.powerplant.engines[0].engine;
const LBF_FT = 1.3558179483314004;

describe('MD 500E definition', () => {
  it('is a turboshaft on a freewheel: no piston powerplant, carburettor, MAP placard, belt clutch or governor switch', () => {
    expect(engine.kind).toBe('freeTurbine');
    expect(engine.gearRatio).toBe(1);
    expect(engine.ratedRpm).toBe(MD500_N2_100_RPM);
    expect(engine.ratedPower).toBe(MD500_ENGINE_RATED_W);
    expect(engine.metering.kind).toBe('turbineFcu');
    expect(r.manifoldLimits).toBeUndefined();
    expect(r.systems.drive).toBe('freewheel');
    expect(def.input.threePositionClutch).toBeUndefined();
    expect(def.input.has.mixture || def.input.has.carbHeat || def.input.has.propeller).toBe(false);
    expect(def.input.twistGrip).toEqual(MD500_TWIST_GRIP);
    expect(def.controlDefaults.magnetos).toBe(0);
  });

  it('drive ratios and speeds (TCDS H3WE p12, EASA IM.E.052 p15, RFM 2-4): N2 6016 rpm = 100 %, Nr 477.7 rpm = 100 %, 492 rpm = 103 %', () => {
    expect(r.engineRatio).toBe(MD500_ENGINE_RATIO);
    expect(MD500_ENGINE_RATIO).toBeCloseTo(12.594, 3);
    expect(MD500_NR_100 * 1.03).toBeCloseTo(MD500_NR_NOMINAL, 6);
    expect(r.nominalRpm * r.engineRatio).toBeCloseTo(6196.5, 0);
    expect(r.tailRatio).toBe(MD500_TAIL_RATIO);
    expect(r.nominalRpm * r.tailRatio).toBeCloseTo(2933, 0);
  });

  it('torquemeter: 318 ft lbf = 87.2 psi and 297 ft lbf = 81.3 psi (TCDS p12); 87.2 psi at 103 % N2 is 375 shp', () => {
    expect(md500TorquePsi(318 * LBF_FT)).toBeCloseTo(87.2, 6);
    expect(md500TorquePsi(297 * LBF_FT)).toBeCloseTo(81.4, 1);
    const shp = 318 * LBF_FT * (1.03 * MD500_N2_100_RPM * Math.PI / 30) / HP;
    expect(shp).toBeCloseTo(375, -1);
    expect(ts.psiPerNm).toBe(md500TorquePsi(1));
  });

  it('rotor: five blades of R 4.023 m on the hub at STA 100 / WL 83; blade flap inertia the OH-6A 63.49 kg m^2 (F); polar 330-360 kg m^2 (ESTIMATE)', () => {
    expect(r.main.blades).toBe(5);
    expect(r.main.radius).toBeCloseTo(13.2 * FT, 6);
    expect(r.main.hub).toEqual(D.MAIN_HUB);
    expect(r.tail.hub).toEqual(D.TAIL_HUB);
    expect(MD500_ARTICULATED.blade.flapInertia).toBeCloseTo(OH6A_FLAP_INERTIA, 6);
    expect(r.main.inertia).toBeGreaterThan(330); expect(r.main.inertia).toBeLessThan(360);
  });

  it('rotor energy: tau = 2E/P is 4.5-5.0 s at 492 rpm and 200 kW, so 468 rpm comes in 0.15-0.35 s and 410 rpm in 0.7-1.2 s (docs/md500-flight-model.md)', () => {
    const inertia = r.main.inertia + r.tail.inertia * r.tailRatio ** 2, omega = MD500_NR_NOMINAL * Math.PI / 30;
    const energy = 0.5 * inertia * omega ** 2, tau = 2 * energy / 200e3;
    // Omega = Omega0 / (1 + t / tau) at fixed collective (power ~ Omega^3).
    const at = (rpm: number) => tau * (MD500_NR_NOMINAL / rpm - 1);
    expect(tau).toBeGreaterThan(4.5); expect(tau).toBeLessThan(5.0);
    expect(at(468)).toBeGreaterThan(0.15); expect(at(468)).toBeLessThan(0.35);
    expect(at(410)).toBeGreaterThan(0.7); expect(at(410)).toBeLessThan(1.2);
  });

  it('turboshaft: one ground-idle N1 for the grip and the fuel control; beep 97.5-104.5 %; ENGINE OUT at N1 55 % or Nr 468 rpm (RFM 3-3)', () => {
    const fcu = engine.turbine!.gasGenerator.fcu;
    expect(ts.plaNg.groundIdle).toBe(fcu.lowIdleNg); expect(fcu.highIdleNg).toBe(fcu.lowIdleNg);
    expect(ts.plaNg.fullOpen).toBe(fcu.maxNg);
    expect(ts.governor.setRange).toEqual([0.975, 1.045]);
    expect(ts.engineOut.n1Below).toBe(0.55);
    expect(ts.engineOut.nrBelow * r.referenceRpm).toBeCloseTo(468, 6);
    expect(r.systems.hornCollectiveMin).toBe(-1);
  });

  it('mass: the RFM 6-7 sample empty weight 1510 lb at STA 109.0, 3000 lb maximum, every loading inside the CG envelope (RFM 6-1)', () => {
    expect(def.mass.empty / LB).toBeCloseTo(1510, 6);
    expect(def.mass.maxTakeoff / LB).toBeCloseTo(3000, 6);
    const fuel = def.powerplant.fuel.tanks.reduce((s, t) => s + t.capacity, 0);
    const fuelX = def.powerplant.fuel.tanks[0].position.x;
    for (const [name, l] of Object.entries(def.mass.loadings)) {
      const m = def.mass.empty + l.payload + fuel;
      const x = (def.mass.empty * def.mass.emptyCg!.x + l.payload * l.payloadPosition.x + fuel * fuelX) / m;
      const station = 100 - x / 0.0254, lb = m / LB;
      const aft = 103.0 + (107.4 - 103.0) * (3000 - lb) / (3000 - 1538);
      expect(station, name).toBeGreaterThanOrEqual(99.0); expect(station, name).toBeLessThanOrEqual(aft);
    }
  });
});

describe('MD 500E Vne placard (RFM Fig 2-6, 250-C20B, sheets 1-2): cell for cell', () => {
  const bands = [['light', 1900], ['medium', 2400], ['heavy', 2900]] as const;
  for (const [band, lb] of bands) it(`${band} band (${lb} lb)`, () => {
    const rows = MD500_VNE_TABLES[band];
    MD500_VNE_OAT_C.forEach((oat, i) => [0, 2, 4, 6, 8, 10, 12, 14, 16, 18].forEach((kft, j) => {
      const v = configuredVne(MD500_VNE, MD500_SPEED_CORRECTIONS, kft * 1000 * FT, oat + 273.15, { takeoffMass: lb * LB });
      expect(v, `${band} ${oat} C ${kft}k`).toBeCloseTo(rows[i][j], 6);
    }));
  });
  it('autorotation: chart - 22 kt, not below 85 / 90 / 95 kt by band, never above the chart, at most 130 KIAS; doors off 130', () => {
    const at = (lb: number, kft: number, oat: number, o: { powerOff?: boolean; doorsOff?: boolean } = {}) =>
      configuredVne(MD500_VNE, MD500_SPEED_CORRECTIONS, kft * 1000 * FT, oat + 273.15, { takeoffMass: lb * LB, ...o });
    expect(at(1900, 0, 15, { powerOff: true })).toBe(130);
    expect(at(1900, 12, 20, { powerOff: true })).toBe(85);
    expect(at(2400, 10, 10, { powerOff: true })).toBe(90);
    expect(at(2900, 8, 30, { powerOff: true })).toBe(88);
    expect(at(2900, 6, 10, { powerOff: true })).toBe(95);
    expect(at(2900, 0, 15, { doorsOff: true })).toBe(130);
  });
});
