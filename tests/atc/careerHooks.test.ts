// The Career's radio phrasing (docs/career.md "Integration", wave 4c): a company callsign ("Fable 12") is said in
// EASA and FAA forms and never abbreviated; with it the scripted home circuit is the school's transcript with only
// the callsign changed, and the home tower's sequencing answers use it too; a job's destination is named in the
// taxi request, the departure and leaving calls, the tower's take-off clearance asks for the leaving call (FAA:
// approves the departure toward it) and the inbound call at the destination says it is landing there; with no
// destination (absent or null) every call and answer is as before.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { callsFor, replyTo, readbackFor, runwayInUse, withDepartureNote, type RadioSituation } from '../../src/atc/calls';
import { both, callsign, companyCallsign } from '../../src/atc/phrases';
import { TrafficSystem } from '../../src/atc/TrafficSystem';
import { fieldPoint, generatedAirfields, HOME_AIRFIELD as H, type Airfield } from '../../src/world/airfields';
import { HOME_GROUND, resetRadios, type Station } from '../../src/instruments/dynamics/radios';
import { circuitPath, placeOnLeg, stepTraffic } from '../../src/atc/circuit';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';

vi.mock('../../src/ui/radioMenu', () => ({
  RadioMenu: class {
    open = false; items: { key?: string; label: string; detail: string }[] = []; root = { remove() {} };
    constructor(_layer: unknown, readonly onPick: (i: number) => void) {}
    show(_t: string, items: { label: string; detail: string }[]) { this.open = true; this.items = items; }
    hide() { this.open = false; }
  },
}));
(globalThis as { window?: unknown }).window = { addEventListener() {}, removeEventListener() {} };
(globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};

const { RadioSystem } = await import('../../src/atc/RadioSystem');

setEra('present');
setWorldSeed(0);
const ELM: Airfield = generatedAirfields()[0];
const name = (f: Airfield) => f.name.replace(/ (Aerodrome|Airstrip)$/, '');
const tower: Station = { field: H, kind: 'tower', frequency: H.frequency };
const ground: Station = { field: H, kind: 'ground', frequency: HOME_GROUND };
const ctaf: Station = { field: ELM, kind: 'traffic', frequency: ELM.frequency };

/** A situation at a point in a field's frame (along/across the low end's take-off direction). */
function at(station: Station, along: number, across: number, o: Partial<RadioSituation> = {}): RadioSituation {
  const p = fieldPoint(station.field, along, across);
  return {
    authority: 'easa', callsign: companyCallsign('Fable 12', 'easa'), station, contacted: false,
    north: p.north, east: p.east, altitude: station.field.elevation, onGround: true, groundSpeedKt: 0, heading: station.field.heading,
    windFromDeg: 250, windKt: 10, qnhHpa: 1015, landedAgoS: Infinity, atisLetter: 'C', ...o,
  };
}
const faa = (s: RadioSituation): RadioSituation => ({ ...s, authority: 'faa', callsign: companyCallsign('Fable 12', 'faa') });
const lines = (s: RadioSituation) => callsFor(s).map((c) => `${c.label} | ${c.line.text} | ${c.line.speak}`);

describe('the company callsign', () => {
  it('is the word and the flight number, digits for EASA, group form for the FAA, never abbreviated', () => {
    const e = companyCallsign('Fable 12', 'easa');
    expect(e.full).toEqual({ text: 'Fable 12', speak: 'Fable one two' });
    expect(e.short).toEqual(e.full);
    const f = companyCallsign('Fable 12', 'faa');
    expect(f.full).toEqual({ text: 'Fable 12', speak: 'Fable twelve' });
    expect(f.short).toEqual(f.full);
    expect(companyCallsign('Fable 9', 'faa').full.speak).toBe('Fable niner');
    expect(companyCallsign('Fable 40', 'faa').full.speak).toBe('Fable forty');
    expect(companyCallsign('Fable 123', 'faa').full.speak).toBe('Fable one twenty-three');
    expect(companyCallsign('Fable 1205', 'faa').full.speak).toBe('Fable twelve zero five');
    expect(companyCallsign('Fable 1205', 'easa').full.speak).toBe('Fable one two zero five');
  });

  it("is used by the tower's replies and readbacks", () => {
    const s = at(ground, 0, -200);
    expect(callsFor(s)[0].line.text).toBe('Fable Regional Ground, Fable 12, at the apron, request taxi for VFR flight, information C');
    expect(replyTo(s, 'taxi')!.text).toBe('Fable 12, taxi to holding point A4, runway 25, QNH 1015');
    expect(readbackFor(s, 'taxi')!.text).toBe('Taxi to holding point A4, runway 25, QNH 1015, Fable 12');
    expect(replyTo(faa(s), 'taxi')!.speak.startsWith('Fable twelve, ')).toBe(true);
  });
});

describe('the destination', () => {
  const home = at(ground, 0, -200);

  it('changes nothing when absent or null, nor at the destination itself', () => {
    const plain = at(ground, 0, -200, { callsign: callsign('G-FSCK', 'C172', 'easa') });
    const withNull = { ...plain, destination: null };
    expect(lines(withNull)).toEqual(lines(plain));
    expect(replyTo(withNull, 'taxi')).toEqual(replyTo(plain, 'taxi'));
    expect(lines({ ...plain, destination: H })).toEqual(lines(plain));
    const rdy = at(tower, -H.length / 2 + 100, 0, { heading: H.heading + Math.PI, windFromDeg: 70, windKt: 6 });
    expect(replyTo({ ...rdy, destination: null }, 'ready')).toEqual(replyTo(rdy, 'ready'));
    const line = both('G-CK, runway 07, cleared for take-off');
    expect(withDepartureNote(rdy, line)).toBe(line);
    expect(withDepartureNote({ ...rdy, destination: H }, line)).toBe(line);
  });

  it('is named in the taxi request, EASA and FAA', () => {
    const s = { ...home, destination: ELM };
    expect(callsFor(s)[0].line.text).toBe(`Fable Regional Ground, Fable 12, at the apron, request taxi for VFR flight to ${name(ELM)}, information C`);
    expect(callsFor(faa(s))[0].line.text).toBe(`Fable Regional Ground, Fable 12, at the ramp, ready to taxi, VFR to ${name(ELM)}, information C`);
    // The answer is the usual one.
    expect(replyTo(s, 'taxi')).toEqual(replyTo(home, 'taxi'));
  });

  it("has the tower's take-off clearance ask for the leaving call (FAA: approve the departure toward it)", () => {
    const end = runwayInUse(H, 250, 10);
    const s = at(tower, (end === 0 ? -1 : 1) * (H.length / 2 - 100), 0, { destination: ELM });
    expect(callsFor(s)[0].id).toBe('ready');
    const e = replyTo(s, 'ready')!.text;
    expect(e).toBe('Fable 12, runway 25, cleared for take-off, wind 250 degrees 10 knots, report leaving the circuit');
    const f = replyTo(faa(s), 'ready')!.text;
    expect(f).toMatch(/^Fable 12, wind 250 at 10, runway 25, cleared for takeoff, (north|south|east|west|northeast|southeast|southwest|northwest) departure approved$/);
    // The readback stays the clearance and the runway.
    expect(readbackFor(s, 'ready')!.text).toBe('Runway 25, cleared for take-off, Fable 12');
  });

  it('is named in the leaving call', () => {
    // 6 km out on the far side from the field, climbing away from it.
    const p = fieldPoint(H, 6000, 0);
    const s = at(tower, 0, 0, { onGround: false, north: p.north, east: p.east, altitude: H.elevation + 600, heading: H.heading, destination: ELM });
    const leave = callsFor(s).find((c) => c.id === 'leaving')!;
    expect(leave.label).toBe(`Leaving the circuit for ${name(ELM)}`);
    expect(leave.line.text).toMatch(new RegExp(`^Fable Regional Tower, Fable 12, leaving the circuit to the [a-z-]+ for ${name(ELM)}, 2,[0-9]00 feet$`));
    expect(replyTo(s, 'leaving')!.text).toBe('Fable 12, frequency change approved');
    const plain = callsFor({ ...s, destination: undefined }).find((c) => c.id === 'leaving')!;
    expect(plain.label).toBe('Leaving the circuit');
    expect(plain.line.text).not.toContain(name(ELM));
  });

  it('is named by a departure from an uncontrolled field', () => {
    const end = runwayInUse(ELM, 250, 10);
    const s = at({ field: ELM, kind: 'traffic', frequency: ELM.frequency }, (end === 0 ? -1 : 1) * (ELM.length / 2 - 60), 0, { destination: H });
    expect(callsFor(s)[0].line.text).toBe(`${name(ELM)} Traffic, Fable 12, departing runway ${ELM.ids[end]} for Fable Regional`);
  });

  it('has the inbound call at the destination say it is landing there, uncontrolled and towered', () => {
    // 8 km from the field, heading for it.
    const toward = (f: Airfield, st: Station, o: Partial<RadioSituation> = {}) => {
      const p = fieldPoint(f, -8000, 0);
      return at(st, 0, 0, { onGround: false, north: p.north, east: p.east, altitude: f.elevation + 600, heading: f.heading, ...o });
    };
    const c = callsFor(toward(ELM, ctaf, { destination: ELM })).find((x) => x.id === 'inbound')!;
    expect(c.label).toBe(`Inbound to ${name(ELM)}`);
    expect(c.line.text).toMatch(new RegExp(`^${name(ELM)} Traffic, Fable 12, 4 miles [a-z-]+, [0-9,]+ feet, inbound to ${name(ELM)} for landing, joining (left|right) hand downwind runway \\d\\d$`));
    const cf = callsFor(faa(toward(ELM, ctaf, { destination: ELM }))).find((x) => x.id === 'inbound')!;
    expect(cf.line.text).toMatch(new RegExp(`, inbound for landing, will enter (left|right) downwind runway \\d\\d, ${name(ELM)}$`));
    // Not the destination: the plain inbound.
    const other = callsFor(toward(ELM, ctaf, { destination: H })).find((x) => x.id === 'inbound')!;
    expect(other.label).toBe(`Inbound, ${name(ELM)}`);
    expect(other.line.text).toContain(', inbound, joining');
    const t = callsFor(toward(H, tower, { destination: H })).find((x) => x.id === 'inbound')!;
    expect(t.line.text).toMatch(/^Fable Regional Tower, Fable 12, 4 miles [a-z-]+, [0-9,]+ feet, landing Fable Regional, request joining instructions, information C$/);
    const tf = callsFor(faa(toward(H, tower, { destination: H }))).find((x) => x.id === 'inbound')!;
    expect(tf.line.text).toMatch(/, inbound for landing at Fable Regional, information C$/);
    expect(replyTo(toward(H, tower, { destination: H }), 'inbound')).toEqual(replyTo(toward(H, tower), 'inbound'));
  });
});

type Identity = { registration: string; icaoType: string; callsign: string | null } | null;

/** A RadioSystem on a scripted rig: the identity and destination hooks given, a sequencing tower if asked for. */
function rig(o: { identity?: () => Identity; destination?: () => Airfield | null; towerReply?: unknown } = {}) {
  resetRadios();
  const said: string[] = [];
  const speech = { enqueue: (u: { actor: string; caption: string }) => said.push(`${u.actor}: ${u.caption}`), busy: () => false, idle: () => true, speaking: () => false, cancel() {} };
  const training = { speech, active: false, input: () => {}, radioIdentity: () => ({ authority: 'easa', registration: 'G-FSCK', icaoType: 'C172' }) };
  const state = { position: { x: 0, y: 0 }, onGround: false, groundSpeed: 0, track: 0, heading: 0, altitudeAGL: 0, altitudeMSL: 0 };
  const ctx = { state, scene: new THREE.Scene(), weather: { windDirectionDeg: 70, windSpeedKt: 6, qnhHpa: 1013, timeOfDay: 10, visibilityM: 20000 }, events: { on: () => () => {} }, paused: false };
  const radio = new RadioSystem({ training: training as never, readings: () => ({ avionicsPowered: true }) as never, layer: {} as never, traffic: () => [], comRadios: () => 2 as const, cdiSelect: () => false, ...o } as never);
  radio.init(ctx as never);
  const r = radio as unknown as { onKey: (e: unknown) => void; menu: { open: boolean; items: { label: string; detail: string }[] } };
  const key = (code: string) => r.onKey({ code, shiftKey: false, repeat: false, target: null, preventDefault() {}, stopImmediatePropagation() {} });
  const callOnce = (): void => {
    key('Space');
    if (!r.menu.open) return;
    for (const i of r.menu.items) said.push(`menu: ${i.label} | ${i.detail}`);
    if (r.menu.items.length) key('Digit1');
    else key('Escape');
  };
  return { radio, state, ctx, said, callOnce };
}

/** The home circuit flown from early upwind to a full stop, the first call picked at every leg (identityHook's script). */
function circuit(o: { identity?: () => Identity; destination?: () => Airfield | null } = {}): string {
  const { radio, state, said, callOnce } = rig(o);
  const path = circuitPath(H, 0);
  const s = placeOnLeg(path, 0, 0.1);
  const sync = (): void => {
    Object.assign(state.position, { x: s.north, y: s.east });
    state.heading = state.track = s.heading;
    state.groundSpeed = s.speed;
    state.altitudeAGL = s.height;
    state.altitudeMSL = H.elevation + s.height;
    state.onGround = s.onGround;
  };
  sync();
  let legChanges = 0;
  callOnce();
  for (let t = 0; t < 900 && legChanges < 5; t += 0.1) {
    const c = stepTraffic(path, s, 0.1);
    sync();
    radio.update(0.1);
    if (c !== null) {
      legChanges++;
      for (let k = 0; k < 30; k++) radio.update(0.1);
      callOnce();
    }
  }
  Object.assign(state, { onGround: true, altitudeAGL: 0, altitudeMSL: H.elevation, groundSpeed: 15 });
  for (let k = 0; k < 40; k++) radio.update(0.1);
  callOnce();
  for (let k = 0; k < 40; k++) radio.update(0.1);
  return said.join('\n');
}

describe('the radio with the Career hooks', () => {
  beforeEach(() => resetRadios());

  it('flies the circuit as the school does with only the callsign changed to the company one', () => {
    const school = circuit();
    const career = circuit({ identity: () => ({ registration: 'G-GKQQ', icaoType: 'C152', callsign: 'Fable 12' }) });
    expect(career).toContain('tower: Fable 12, runway 07, cleared to land');
    expect(career).not.toMatch(/G-[A-Z]/);
    expect(school.replace(/G-FSCK|G-CK/g, 'Fable 12')).toBe(career);
    // A destination away from the circuit changes none of the circuit's calls.
    expect(circuit({ identity: () => ({ registration: 'G-GKQQ', icaoType: 'C152', callsign: 'Fable 12' }), destination: () => ELM })).toBe(career);
    expect(circuit({ destination: () => null })).toBe(school);
  });

  it("gets the sequencing tower's clearance with the company callsign and the departure note", () => {
    const run = (destination: (() => Airfield | null) | undefined) => {
      const player = () => ({ registration: 'G-GKQQ', icaoType: 'C152', callsign: 'Fable 12' });
      const traffic = new TrafficSystem({ authority: () => 'easa', homeTraffic: () => false, player });
      let towerReply: unknown = null;
      const { radio, state, ctx, said, callOnce } = rig({ identity: player, destination, towerReply: (c: never, i: never) => (towerReply as (c: never, i: never) => unknown)(c, i) });
      traffic.init(ctx as never);
      towerReply = (c: never, i: never) => traffic.towerReply(c, i);
      // Lined up at the start of runway 07, stopped.
      const p = fieldPoint(H, -H.length / 2 + 60, 0);
      Object.assign(state, { position: { x: p.north, y: p.east }, onGround: true, groundSpeed: 0, heading: H.heading, track: H.heading, altitudeAGL: 0, altitudeMSL: H.elevation });
      callOnce();
      for (let k = 0; k < 30; k++) radio.update(0.1);
      return said.filter((l) => !l.startsWith('menu:'));
    };
    const plain = run(undefined);
    expect(plain).toEqual(['student: Fable Regional Tower, Fable 12, ready for departure', 'tower: Fable 12, runway 07, cleared for take-off, wind 070 degrees 6 knots']);
    expect(run(() => ELM)).toEqual([plain[0], `${plain[1]}, report leaving the circuit`]);
    expect(run(() => null)).toEqual(plain);
  });
});
