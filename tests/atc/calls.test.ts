// Radio calls and phraseology (src/atc/calls.ts, phrases.ts): the runway in use, callsigns by authority, the calls
// offered where the aircraft is, and the home tower's answers.

import { describe, expect, it } from 'vitest';
import { activeFrame, atisText, callsFor, circuitLeg, replyTo, runwayInUse, type RadioSituation } from '../../src/atc/calls';
import { callsign, frequency, pressure, spell } from '../../src/atc/phrases';
import { fieldPoint, generatedAirfields, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { HOME_GROUND, type Station } from '../../src/instruments/dynamics/radios';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';

const H = HOME_AIRFIELD;
const tower: Station = { field: H, kind: 'tower', frequency: H.frequency };
const ground: Station = { field: H, kind: 'ground', frequency: HOME_GROUND };

/** A situation at a point in a field's frame (along/across the low end's take-off direction). */
function at(station: Station, along: number, across: number, o: Partial<RadioSituation> = {}): RadioSituation {
  const p = fieldPoint(station.field, along, across);
  return {
    authority: 'easa', callsign: callsign('G-FSCK', 'C172', 'easa'), station, contacted: false,
    north: p.north, east: p.east, altitude: station.field.elevation, onGround: true, groundSpeedKt: 0, heading: station.field.heading,
    windFromDeg: 250, windKt: 10, qnhHpa: 1015, landedAgoS: Infinity, atisLetter: 'C', ...o,
  };
}

describe('phraseology', () => {
  it('spells numbers and letters, frequencies and pressures by authority', () => {
    expect(spell('2FS')).toBe('two Foxtrot Sierra');
    expect(frequency(122.725, 'easa').speak).toBe('one two two decimal seven two five');
    expect(frequency(118.3, 'faa')).toEqual({ text: '118.3', speak: 'one one eight point three' });
    expect(pressure(1015, 'easa').text).toBe('QNH 1015');
    expect(pressure(1013.25, 'faa').text).toBe('altimeter 29.92');
  });

  it('forms callsigns: FAA maker and tail, EASA the registration and its abbreviation', () => {
    const faa = callsign('N172FS', 'C172', 'faa');
    expect(faa.full.text).toBe('Cessna 172FS');
    expect(faa.short.text).toBe('Cessna 2FS');
    const easa = callsign('G-FSCK', 'C172', 'easa');
    expect(easa.full.speak).toBe('Golf Foxtrot Sierra Charlie Kilo');
    expect(easa.short).toEqual({ text: 'G-CK', speak: 'Golf Charlie Kilo' });
  });
});

describe('runway in use and the circuit', () => {
  it('takes the end with the headwind, 07 in a calm', () => {
    expect(runwayInUse(H, 250, 10)).toBe(1);
    expect(runwayInUse(H, 70, 10)).toBe(0);
    expect(runwayInUse(H, 250, 1)).toBe(0);
  });

  it('places the legs of a left-hand circuit on runway 25', () => {
    // In runway 25's frame: downwind 900 m to the left (across < 0), flying the reciprocal.
    const hdg25 = H.heading + Math.PI;
    const p = (along: number, across: number) => fieldPoint(H, -along, -across);
    const leg = (along: number, across: number, hdg: number) => { const q = p(along, across); return circuitLeg(H, 1, q.north, q.east, hdg); };
    expect(leg(0, -900, hdg25 + Math.PI)).toBe('downwind');
    expect(leg(-1500, -500, hdg25 + Math.PI / 2)).toBe('base');
    expect(leg(-2000, 0, hdg25)).toBe('final');
    const q = p(-2000, 0);
    expect(activeFrame(H, 1, q.north, q.east).along).toBeCloseTo(-2000, 6);
  });
});

describe('calls and answers at the home field', () => {
  it('on the apron: request taxi on ground (with the ATIS letter), taxi to the holding point', () => {
    const s = at(ground, 0, -200);
    const calls = callsFor(s);
    expect(calls[0].id).toBe('taxi');
    expect(calls[0].line.text).toBe('Fable Regional Ground, G-FSCK, at the apron, request taxi for VFR flight, information C');
    expect(replyTo(s, 'taxi')!.text).toBe('G-CK, taxi to holding point A4, runway 25, QNH 1015');
    expect(replyTo({ ...s, station: tower }, 'taxi')!.text).toBe('G-CK, contact Ground 121.9');
  });

  it('just landed and off the runway: clear of the runway first, then to ground', () => {
    const s = at(tower, 0, -120, { landedAgoS: 40 });
    expect(callsFor(s)[0].id).toBe('clear');
    expect(replyTo(s, 'clear')!.text).toBe('G-CK, contact Ground 121.9');
  });

  it('lined up on 25: ready for departure, cleared for take-off with the wind', () => {
    const s = at(tower, 800, 0, { heading: H.heading + Math.PI });
    expect(callsFor(s)[0].id).toBe('ready');
    expect(replyTo(s, 'ready')!.text).toBe('G-CK, runway 25, cleared for take-off, wind 250 degrees 10 knots');
    expect(replyTo({ ...s, authority: 'faa', callsign: callsign('N172FS', 'C172', 'faa') }, 'ready')!.text).toBe('Cessna 2FS, wind 250 at 10, runway 25, cleared for takeoff');
  });

  it('airborne 15 km east heading for the field: inbound, told to join downwind', () => {
    const s = at(tower, 0, 0, { onGround: false, altitude: H.elevation + 600, heading: (270 * Math.PI) / 180 });
    s.east += 15000;
    const calls = callsFor(s);
    expect(calls[0].id).toBe('inbound');
    expect(calls[0].line.text).toMatch(/^Fable Regional Tower, G-FSCK, 8 miles east, 2,400 feet, request joining instructions, information C$/);
    expect(replyTo(s, 'inbound')!.text).toBe('G-CK, join left hand downwind runway 25, QNH 1015, report downwind');
  });

  it('the ATIS names the runway, wind and pressure', () => {
    expect(atisText(H, 'C', { windFromDeg: 250, windKt: 10, qnhHpa: 1015, visibilityM: 20000, authority: 'easa' }).text)
      .toBe('Fable Regional information C, runway in use 25, wind 250 degrees 10 knots, visibility 10 kilometres or more, QNH 1015, advise on initial contact you have information C');
  });
});

describe('a generated field', () => {
  setEra('present');
  setWorldSeed(0);
  it('is uncontrolled: position calls to "Traffic", no answer; FAA calls end with the name', () => {
    const f: Airfield = generatedAirfields()[0];
    const st: Station = { field: f, kind: 'traffic', frequency: f.frequency };
    const end = runwayInUse(f, 250, 10);
    const sgn = end === 0 ? 1 : -1;
    const hdg = f.heading + (end === 1 ? Math.PI : 0);
    const s = at(st, sgn * -2000, 0, { onGround: false, altitude: f.elevation + 150, heading: hdg });
    const calls = callsFor(s);
    expect(calls[0].id).toBe('final');
    expect(calls[0].line.text.startsWith(`${f.name.replace(/ (Aerodrome|Airstrip)$/, '')} Traffic, G-FSCK, final runway ${f.ids[end]}`)).toBe(true);
    expect(replyTo(s, 'final')).toBeNull();
    const faa = callsFor({ ...s, authority: 'faa', callsign: callsign('N172FS', 'C172', 'faa') })[0].line.text;
    expect(faa.endsWith(`, ${f.name.replace(/ (Aerodrome|Airstrip)$/, '')}`)).toBe(true);
    expect(calls.some((c) => c.id === 'radioCheck')).toBe(false);
  });
});
