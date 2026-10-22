// The AH-56A's stage-2 definition data (AG): every number tested against its source tag (docs/ah56-sources.md). The
// behaviour is tests/rotorcraft/ah56*.test.ts; this file holds the data to its sources and the contracts other packages
// read (dimensions, facts, the gyro configurations, the wheel-rest data in `skids`).
import { describe, expect, it } from 'vitest';
import { AH56_DEFINITION as def } from '../../src/aircraft/ah56';
import { AH56_PRESENTATION } from '../../src/aircraft/ah56/presentation';
import { aircraftSummary } from '../../src/aircraft/registry';
import * as D from '../../src/aircraft/ah56/dimensions';
import { AH56_AMCS_NR_FRACTION, AH56_ENGINE_RATIO, AH56_NR_100, AH56_TAIL_RATIO, AH56_TORQUE_PCT_PER_NM } from '../../src/aircraft/ah56/facts';
import { AH56_BLADE, AH56_HUB, AH56_LOCK } from '../../src/aircraft/ah56/coning';
import { ah56Gear, AH56_REST_CONTACTS } from '../../src/aircraft/ah56/gear';
import { DEG, LB, v3 } from '../../src/core/math';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { governedRpm } from '../../src/physics/rotorcraft/definition';
import { wheelRestingPose } from '../../src/physics/rotorcraft/wheels';
import { createMassModel } from '../../src/physics';
import { definitionInconsistencies } from './consistency';

const r = def.rotorcraft!, g = r.controlGyro!;
const SLUG_FT2 = 1.3558179483314004, FT_LB = 1.3558179483314004, HP = 745.6998715822702;

describe('identity and the catalogue', () => {
  it('ah56, available (owner approved 2026-10-22), one engine; the facts the other packages own agree once they land', () => {
    expect(def.id).toBe('ah56');
    expect(aircraftSummary('ah56').available).toBe(true);
    expect(def.engineCount).toBe(1);
    // In this worktree the visual, the panel and the sound are still their packages' scaffold stubs (AX, PN, AU): only
    // their copies of a fact may disagree.
    const left = definitionInconsistencies(def, AH56_PRESENTATION, aircraftSummary('ah56'));
    expect(left.filter((s) => !/visual|audio|panel/.test(s))).toEqual([]);
  });
});

describe('main rotor and hub (P ASTA-72 pp 48-49, AMCS-73 pp 21-22; Hoh-74)', () => {
  it('4 x 7.808 m, chord 0.711 m (solidity 0.1159), -5 deg twist, precone 2 deg, polar inertia 13,217 kg m^2, 246 rpm', () => {
    expect(r.main.blades).toBe(4);
    expect(r.main.radius).toBeCloseTo(25.617 * 0.3048, 6);
    expect(4 * r.main.chord / (Math.PI * r.main.radius)).toBeCloseTo(0.1159, 3);
    expect(r.main.twist / DEG).toBeCloseTo(-5, 9);
    expect(r.main.inertia).toBeCloseTo(9748 * SLUG_FT2, 0);
    expect(r.nominalRpm).toBe(246);
    expect(r.shaftTilt).toBe(0);
  });

  it('hingeless: e 10 % R, nu 1.12, the spring derived from nu (consistency), Lock 6.4 about the shaft, no control phase', () => {
    const h = r.hubModel!;
    expect(h.kind).toBe('hingeless');
    if (h.kind !== 'hingeless') return;
    expect(h.equivalentHingeOffset / r.main.radius).toBeCloseTo(0.10, 9);
    expect(h.flapFrequency).toBe(1.12);
    expect(h.precone / DEG).toBeCloseTo(2, 9);
    expect(h.controlPhase).toBeUndefined();
    expect(h.coning!.hingeStiffness).toBeCloseTo(hingelessSpring(r), 6);
    // nu^2 = 1 + (e M_beta Omega^2 + K_beta) / (I_beta Omega^2) at 246 rpm.
    const b = hingelessBlade(r), w = 246 * Math.PI / 30;
    expect(Math.sqrt(1 + (AH56_HUB.equivalentHingeOffset * b.flapFirst * w * w + hingelessSpring(r)) / (b.flapInertia * w * w))).toBeCloseTo(1.12, 9);
    const lock = 1.225 * r.main.liftSlope * r.main.chord * r.main.radius ** 4 / AH56_BLADE.polar;
    expect(lock).toBeCloseTo(AH56_LOCK, 9);
  });

  it('drive ratios from the P rpms: Nf 13,600 / 246 = 55.28, tail rotor 1238 / 246 = 5.033', () => {
    expect(r.engineRatio).toBeCloseTo(13_600 / 246, 9);
    expect(AH56_ENGINE_RATIO).toBeCloseTo(55.28, 2);
    expect(r.tailRatio).toBeCloseTo(AH56_TAIL_RATIO, 12);
    expect(AH56_TAIL_RATIO).toBeCloseTo(5.033, 3);
  });
});

describe('T64-GE-716 and the transmission', () => {
  it('4330 shp maximum (P); 100 % torque = 3435 shp at 100 % Nf, 114 % = 3925 shp (P)', () => {
    const e = def.powerplant.engines[0].engine;
    expect(e.ratedPower / HP).toBeCloseTo(4330, 3);
    expect(e.ratedRpm).toBe(13_600);
    const torque100 = 3435 * HP / (13_600 * Math.PI / 30);
    expect(torque100 * AH56_TORQUE_PCT_PER_NM).toBeCloseTo(100, 9);
    expect(3925 / 3435 * 100).toBeCloseTo(114.3, 1);
    expect(r.systems.turboshaft!.torqueGauge).toBe('percent');
    expect(r.systems.turboshaft!.limits.mcpPsi).toBe(114);
  });
});

describe('the control gyro configurations (P ASTA-72 App C; AMCS-73 App C)', () => {
  it('ICS: 45 slug-ft^2 turning with the rotor, +/-15 deg, 278 / 337 ft-lb per inch over 11.0 x 7.5 in, 4100 ft-lb/rad, 2 x 44 in-lb/(rad/s)', () => {
    const c = g.configs.ics;
    expect(c.inertia).toBeCloseTo(45 * SLUG_FT2, 9);
    expect(c.spinRatio).toBe(1);
    for (const v of Object.values(c.maxTilt)) expect(v / DEG).toBeCloseTo(15, 9);
    expect(c.stickMoment.longitudinal / (c.stickTravel.longitudinal / 0.0254)).toBeCloseTo(278 * FT_LB, 6);
    expect(c.stickMoment.lateral / (c.stickTravel.lateral / 0.0254)).toBeCloseTo(337 * FT_LB, 6);
    expect(2 * c.stickTravel.longitudinal / 0.0254).toBeCloseTo(11.0, 9);
    expect(2 * c.stickTravel.lateral / 0.0254).toBeCloseTo(7.5, 9);
    expect(c.spring).toBeCloseTo(4100 * FT_LB, 6);
    expect(c.damping).toBeCloseTo(88 / 12 * FT_LB, 6);
    expect(c.feedbackRotation / DEG).toBeCloseTo(33, 9);
    expect(c.feedback.mode).toBe('featheringMoment');
    if (c.feedback.mode === 'featheringMoment') {
      expect(c.feedback.sweep / DEG).toBeCloseTo(4, 9);
      expect(c.feedback.droop / DEG).toBeCloseTo(3 + 10 / 60, 9);
    }
    expect(c.nominalRpmFraction).toBe(1);
  });

  it('AMCS: 1.5 slug-ft^2, the labelled stops, 9.9 x 5.8 in; momentum fixed at the ICS value (ESTIMATE); 97.5 % Nr; +7 deg gauge', () => {
    const a = g.configs.amcs, c = g.configs.ics;
    expect(a.inertia).toBeCloseTo(1.5 * SLUG_FT2, 9);
    expect(a.maxTilt.up / DEG).toBeCloseTo(10.11, 9); expect(a.maxTilt.down / DEG).toBeCloseTo(18.05, 9);
    expect(a.maxTilt.right / DEG).toBeCloseTo(12.27, 9); expect(a.maxTilt.left / DEG).toBeCloseTo(18.08, 9);
    expect(2 * a.stickTravel.longitudinal / 0.0254).toBeCloseTo(9.9, 9);
    expect(2 * a.stickTravel.lateral / 0.0254).toBeCloseTo(5.8, 9);
    const w = AH56_NR_100 * Math.PI / 30;
    expect(a.inertia * a.spinRatio * w * AH56_AMCS_NR_FRACTION).toBeCloseTo(c.inertia * c.spinRatio * w, 6);
    expect(a.spinRatio * AH56_NR_100 * AH56_AMCS_NR_FRACTION).toBeCloseTo(7380, -1);
    expect(a.feedback.mode).toBe('flapping');
    expect(a.cyclicPerTilt).toBe(1);
    expect(governedRpm(r, 'amcs')).toBeCloseTo(239.85, 9);
    expect(a.collectiveIndicatedOffset / DEG).toBeCloseTo(7, 9);
    expect(g.default).toBe('amcs');
  });
});

describe('mass, CG and gear', () => {
  it('18,300 lb at FS 298.0 (P AMCS-73 p 37); empty 12,874 lb; maximum 20,500 lb', () => {
    const m = createMassModel(def.mass, def.powerplant.fuel.tanks);
    const p = m.properties({ ...def.mass.loadings.typical, tanks: def.powerplant.fuel.tanks.map((t) => t.capacity) });
    expect(p.mass / LB).toBeCloseTo(18_300, 0);
    expect(D.FS_REF - p.cgOffset.x / 0.0254).toBeCloseTo(298.0, 1);
    expect(def.mass.empty / LB).toBeCloseTo(12_874, 6);
    expect(def.mass.maxTakeoff / LB).toBeCloseTo(20_500, 6);
  });

  it('retractable tail-wheel gear: the tail wheel in the "nose" slot (lockable, castering, "Tail"), mains with brakes; skids.z is the rest contact', () => {
    const gear = ah56Gear();
    expect(def.geometry.gear.retractable).toBe(true);
    expect(gear.retract).toBeDefined();
    expect(r.landingGear).toBe('wheels');
    expect(gear.wheels[0].label).toBe('Tail');
    expect(gear.wheels[0].position.x).toBeLessThan(0);
    expect(gear.wheels[0].steering?.mode).toBe('castering');
    expect(gear.wheels[0].steering?.lock).toBeDefined();
    expect(gear.wheels[1].brake).toBe('left'); expect(gear.wheels[2].brake).toBe('right');
    expect(Math.abs(r.skids.z - def.geometry.gear.leftMain.z)).toBeLessThan(0.01);
    expect(def.geometry.gear.nose).toEqual(AH56_REST_CONTACTS.tail);
    // Mains 30 in ahead of the CG (FS 268, 3V), track 62 in (D).
    expect(D.FS_REF - D.MAIN_GEAR.x / 0.0254).toBeCloseTo(268, 6);
    expect(2 * D.MAIN_GEAR.halfTrack / 0.0254).toBeCloseTo(62, 6);
    const pose = wheelRestingPose(def.geometry.gear, def.mass.empty, v3.zero());
    expect(pose.pitch).toBeCloseTo(0, 9); expect(pose.roll).toBeCloseTo(0, 9);
    expect(pose.height).toBeCloseTo(D.GROUND_Z, 9);
  });
});
