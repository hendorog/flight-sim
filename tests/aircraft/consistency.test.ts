// Every aircraft type states its facts once: the copies of a fact in the definition, the presentation and
// the catalogue agree (consistency.ts). Runs for all six ids, so a type is held to it from the day its
// placeholder is replaced.

import { describe, expect, it } from 'vitest';
import { C172S_DEFINITION } from '../../src/aircraft/c172s/index';
import { C172S_PRESENTATION } from '../../src/aircraft/c172s/presentation';
import { aircraftSummary, loadAircraft, loadPresentation } from '../../src/aircraft/registry';
import type { AircraftDefinition, AircraftPresentation } from '../../src/aircraft/types';
import { DEG } from '../../src/core/math';
import { AIRCRAFT_IDS } from '../../src/core/types';
import { assertDefinitionConsistent, definitionInconsistencies } from './consistency';

describe('one fact, one value', () => {
  it.each(AIRCRAFT_IDS)('%s: the definition, the presentation and the catalogue row agree', async (id) => {
    assertDefinitionConsistent(await loadAircraft(id), await loadPresentation(id), aircraftSummary(id));
  });

  // The check must be able to fail: each line is the C172S with ONE copy of one fact changed.
  const d = C172S_DEFINITION;
  const p = C172S_PRESENTATION;
  const cases: [string, Partial<AircraftDefinition>, Partial<AircraftPresentation>, RegExp][] = [
    ['a second engine in the definition only', { engineCount: 2 }, {}, /engine count/],
    ['a propeller moved in the shared geometry', { geometry: { ...d.geometry, propellers: [{ ...d.geometry.propellers[0], hub: { x: 1, y: 2, z: 0 } }] } }, {}, /hub of propeller 0 \(y\)/],
    ['three blades in the sound profile', {}, { audio: { ...p.audio, engines: [{ ...p.audio.engines[0], prop: { ...p.audio.engines[0].prop, blades: 3 } }] } }, /blades of propeller 0/],
    ['more elevator travel in the control system', { controls: { ...d.controls, elevator: { ...d.controls.elevator, maxUp: 30 * DEG } } }, {}, /elevator up travel/],
    ['a flap detent the keyboard does not have', { controls: { ...d.controls, flaps: { ...d.controls.flaps, detents: [0, d.controls.flaps.maxDeflection] } } }, {}, /number of flap detents/],
    ['a flap maximum the sound does not know', {}, { audio: { ...p.audio, flapMaxRad: 40 * DEG } }, /flap maximum/],
    ['retractable in the geometry only', { geometry: { ...d.geometry, gear: { ...d.geometry.gear, retractable: true } } }, {}, /retractable gear/],
    ['a main wheel moved in the shared geometry', { geometry: { ...d.geometry, gear: { ...d.geometry.gear, leftMain: { ...d.geometry.gear.leftMain, y: -2 } } } }, {}, /contact point of the left wheel \(y\)/],
    ['a castering nosewheel the scripted pilot steers by rudder', { controls: { ...d.controls, steering: { kind: 'castering' } } }, {}, /castering nosewheel/],
    ['a propeller lever on a fixed-pitch type', { input: { ...d.input, has: { ...d.input.has, propeller: true } } }, {}, /propeller lever/],
    ['a selector position the feed does not have', { input: { ...d.input, fuelSelectorCycle: ['on', 'off'] } }, {}, /selector key reaches 'on'/],
    ['instruments that die at another voltage', {}, { instrumentSystems: { ...p.instrumentSystems, busDeadVolts: 9 } }, /bus-dead voltage/],
    ['a Vne the training type does not know', { reference: { ...d.reference, vne: 170 } }, {}, /speed vne/],
    ['an airspeed red line that is not Vne', {}, { panel: { ...p.panel, gauges: p.panel.gauges.map((g) => (g.kind === 'asi' ? { ...g, marks: { ...g.marks, redLine: 170 } } : g)) } }, /airspeed red line/],
    ['a wing area the strip model does not have', { geometry: { ...d.geometry, wing: { ...d.geometry.wing, area: 20 } } }, {}, /reference area/],
    ['a maximum take-off mass the loadings exceed', { mass: { ...d.mass, maxTakeoff: 1000 } }, {}, /maxGross payload/],
    ['an eye the cockpit does not have', { geometry: { ...d.geometry, fuselage: { ...d.geometry.fuselage, pilotEye: { x: 0, y: 0, z: 0 } } } }, {}, /pilot's eye/],
    ['another id on the presentation', {}, { id: 'c152' }, /^c172s: id:/],
  ];
  it.each(cases)('finds %s', (_what, def, pres, expected) => {
    const found = definitionInconsistencies({ ...d, ...def }, { ...p, ...pres }, aircraftSummary('c172s'));
    expect(found.some((line) => expected.test(line)), found.join('\n')).toBe(true);
  });
});
