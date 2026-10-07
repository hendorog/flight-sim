// The Flight School's type data of every aircraft (contract 3.9): each type's presentation carries an
// AircraftTypeDef, the simulator registers it with registerAircraftType, and lessons are flown only in
// SCHOOL_AIRCRAFT (decision D5). The generic checks run over the C172S and the five placeholders now (whose
// school data is the C172S's) and over the real defs once Stage D lands them.

import { describe, expect, it } from 'vitest';
import { AIRCRAFT_IDS, loadAircraft, loadPresentation } from '../../src/aircraft/registry';
import { C172S, flapDegForLever, flapLeverFor } from '../../src/training/aircraft/c172s';
import {
  DEFAULT_AIRCRAFT, getAircraftType, hasAircraftType, listAircraftTypes, registerAircraftType, SCHOOL_AIRCRAFT, schoolSupports,
} from '../../src/training/aircraft/registry';
import { registrationFor } from '../../src/training/career/logbook';
import { validateTrainingBlock } from '../../src/training/career/validate';
import { predSignals } from '../../src/training/engine/controls';
import { compile } from '../../src/training/engine/predicates';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { AircraftTypeDef, ChecklistId, RunSnapshot, SignalId, TrainingResumeBlock, VSpeedId } from '../../src/training/types';

const VSPEED_IDS: readonly VSpeedId[] = [
  'Vs0', 'Vs1', 'Vr', 'Vx', 'Vy', 'Vcc', 'Vglide', 'Va', 'Vfe10', 'VfeFull', 'Vno', 'Vne', 'Vapp', 'VappFlapsUp', 'Vref',
  'VshortField', 'Vcruise', 'Vslow', 'VsteepTurn', 'Vdescent', 'Vdownwind', 'Vtaxi',
];
const CHECKLIST_IDS: readonly ChecklistId[] = [
  'beforeStart', 'engineStart', 'afterStart', 'runup', 'beforeTakeoff', 'afterTakeoff', 'hasell', 'downwind', 'final',
  'afterLanding', 'shutdown', 'engineFailure', 'forcedLandingSecurity', 'nightLights',
];
const tel = new Telemetry();

/** Each aircraft id with its definition's engine count and placeholder flag and its presentation's school data. */
async function loadAll(): Promise<{ id: string; engines: 1 | 2; placeholder: boolean; type: AircraftTypeDef }[]> {
  return Promise.all(
    AIRCRAFT_IDS.map(async (id) => {
      const [def, pres] = await Promise.all([loadAircraft(id), loadPresentation(id)]);
      return { id, engines: def.engineCount, placeholder: def.placeholder === true, type: pres.training };
    }),
  );
}

describe('aircraft type data, every type (generic)', () => {
  it('each presentation registers its school data under the type\'s own id', { timeout: 30_000 }, async () => {
    for (const a of await loadAll()) {
      registerAircraftType(a.type);
      expect(getAircraftType(a.type.id), a.id).toBe(a.type);
      // A placeholder hands in the C172S's data; a real type's def carries its own id.
      if (a.placeholder) expect(a.type, a.id).toBe(C172S);
      else expect(a.type.id, a.id).toBe(a.id);
    }
    expect(getAircraftType()).toBe(C172S);
  });

  it('V-speeds: all 22 finite and in order; the 11 settings finite', { timeout: 30_000 }, async () => {
    for (const { id, type } of await loadAll()) {
      const v = type.vspeeds;
      expect(Object.keys(v).sort(), id).toEqual([...VSPEED_IDS].sort());
      for (const k of VSPEED_IDS) expect(Number.isFinite(v[k]) && v[k] > 0, `${id}.${k}`).toBe(true);
      expect(v.Vs0, id).toBeLessThanOrEqual(v.Vs1);
      expect(v.Vs1, id).toBeLessThan(v.Vx);
      expect(v.Vx, id).toBeLessThanOrEqual(v.Vy);
      expect(v.Vr, id).toBeGreaterThanOrEqual(v.Vs1);
      expect(v.VfeFull, id).toBeLessThanOrEqual(v.Vfe10);
      expect(v.Vfe10, id).toBeLessThanOrEqual(v.Vno);
      expect(v.Vno, id).toBeLessThan(v.Vne);
      expect(v.Vref, id).toBeLessThan(v.Vapp);
      expect(v.Vapp, id).toBeLessThanOrEqual(v.VappFlapsUp);
      expect(v.Vslow, id).toBeGreaterThan(v.Vs1);
      expect(Object.keys(type.settings), id).toHaveLength(11);
      for (const [k, n] of Object.entries(type.settings)) expect(Number.isFinite(n), `${id}.${k}`).toBe(true);
      if (type.vspeedsExt?.Vmca !== undefined) {
        const x = type.vspeedsExt;
        expect(x.Vmca, id).toBeLessThan(x.Vsse ?? Number.NaN);
        expect(x.Vsse, id).toBeLessThanOrEqual(x.Vyse ?? Number.NaN);
      }
    }
  });

  it('flap detents: levers monotone from 0 to 1, and flapLeverFor / flapDegForLever round-trip', { timeout: 30_000 }, async () => {
    for (const { id, type } of await loadAll()) {
      const d = type.flapDetentsDeg;
      expect(d[0], id).toBe(0);
      expect(type.flapLeverForDeg[d[0]], id).toBe(0);
      expect(type.flapLeverForDeg[d[d.length - 1]], id).toBe(1);
      for (let i = 1; i < d.length; i++) {
        expect(d[i], id).toBeGreaterThan(d[i - 1]);
        expect(type.flapLeverForDeg[d[i]], id).toBeGreaterThan(type.flapLeverForDeg[d[i - 1]]);
      }
      for (const deg of d) expect(flapDegForLever(type, flapLeverFor(type, deg)), `${id} ${deg} deg`).toBeCloseTo(deg, 9);
      const mid = (d[0] + d[1]) / 2;
      expect(flapDegForLever(type, flapLeverFor(type, mid)), `${id} ${mid} deg`).toBeCloseTo(mid, 9);
    }
  });

  it('the 14 checklists, unique item ids, predicates over signals that exist', { timeout: 30_000 }, async () => {
    for (const { id, type } of await loadAll()) {
      for (const c of CHECKLIST_IDS) expect(type.checklists[c]?.id, `${id}.${c}`).toBe(c);
      for (const list of Object.values(type.checklists)) {
        const ids = list.items.map((i) => i.id);
        expect(new Set(ids).size, `${id}.${list.id}`).toBe(ids.length);
        for (const it of list.items) {
          for (const p of [it.state, it.check]) {
            if (!p) continue;
            expect(() => compile(p), `${id}.${list.id}.${it.id}`).not.toThrow();
            for (const s of predSignals(p)) expect(tel.def(s as SignalId), `${id}.${list.id}.${it.id}: ${s}`).toBeDefined();
          }
        }
      }
    }
  });

  it('plain JSON; MEP iff two engines; only school types say the syllabus may be flown', { timeout: 30_000 }, async () => {
    for (const { id, engines, type } of await loadAll()) {
      expect(JSON.parse(JSON.stringify(type)), id).toEqual(type);
      expect(type.classRating === 'MEP', id).toBe(engines === 2);
      if (type.systems) expect(type.systems.engines, id).toBe(engines);
      if (type.school?.syllabus) expect(SCHOOL_AIRCRAFT, id).toContain(type.id);
      if (!schoolSupports(type.id)) expect(type.school?.reason, `${id}: the school's reason`).toBeTruthy();
    }
  });
});

describe('school types and the registry (D5)', () => {
  it('the school flies the C172S only; the default type is unchanged', () => {
    expect(SCHOOL_AIRCRAFT).toEqual(['c172s']);
    expect(DEFAULT_AIRCRAFT).toBe('c172s');
    expect(schoolSupports('c172s')).toBe(true);
    for (const id of AIRCRAFT_IDS.filter((x) => x !== 'c172s')) expect(schoolSupports(id), id).toBe(false);
    expect(listAircraftTypes()[0]).toBe(C172S);
  });

  it('registerAircraftType adds a type under its id and never replaces the built-in C172S', () => {
    const syn: AircraftTypeDef = {
      ...structuredClone(C172S), id: 'syn-twin', name: 'Synthetic twin', icaoType: 'SYN2', registration: 'G-SYNT', classRating: 'MEP',
      registrations: { faa: 'N2SYN' }, school: { syllabus: false, reason: 'Twin-engine training is not available yet.' },
    };
    expect(hasAircraftType('syn-twin')).toBe(false);
    registerAircraftType(syn);
    expect(getAircraftType('syn-twin')).toBe(syn);
    expect(listAircraftTypes()).toContain(syn);
    expect(() => registerAircraftType({ ...syn, id: 'c172s' })).toThrow(/built-in/);
    registerAircraftType(C172S);
    expect(getAircraftType('c172s')).toBe(C172S);
    expect(() => getAircraftType('pa28')).toThrow();
    // Logbook registration: the type's own by authority, else its single registration; the C172S's pair stays.
    expect(registrationFor(syn, 'faa')).toBe('N2SYN');
    expect(registrationFor(syn, 'easa')).toBe('G-SYNT');
    expect(registrationFor(C172S, 'easa')).toBe('G-FSCK');
    expect(registrationFor(C172S, 'faa')).toBe('N172FS');
  });

  it('a training resume block carries its type through validation; a block without one is unchanged', () => {
    const run: RunSnapshot = {
      lessonId: 'L04', lessonVersion: 1, attemptId: 'a1', phaseId: 'practiceClimb', phaseRepeat: 0, stepId: 'climb', stepAttempt: 1,
      vars: {}, authority: 'student', holds: null, exercises: {}, faults: [], interventions: 0, handbacks: 0, phaseRetries: 0,
      flightTimer: { times: { blockS: 0, airborneS: 0, nightS: 0, instrumentS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0 }, blockOn: false, airborne: false, offGroundS: 0, onGroundS: 0 },
      startedAt: '2026-09-01T10:00:00.000Z', elapsedSimS: 0, weatherSeed: 1,
    };
    const block: TrainingResumeBlock = { lessonId: 'L04', lessonVersion: 1, run, start: { kind: 'ground', spot: 'parking', engine: 'cold' }, checkpoint: null };
    const plain = validateTrainingBlock(JSON.parse(JSON.stringify(block)));
    expect(plain).toEqual(block);
    expect(plain && 'aircraftId' in plain).toBe(false);
    expect(validateTrainingBlock({ ...block, aircraftId: 'c152' })).toEqual({ ...block, aircraftId: 'c152' });
    expect(validateTrainingBlock({ ...block, aircraftId: 7 })).toBeNull();
  });
});
