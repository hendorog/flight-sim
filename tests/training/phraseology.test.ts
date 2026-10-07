// Phraseology (spec 3.7.3 and 2.6): every format in caption and spoken form, the examples the spec gives, the
// coach-preset template shapes ({dev:alt}, {Side}, {dir}), unknown names, and literal-text rewriting.

import { describe, expect, it } from 'vitest';
import { decimalWords, digitWords, numberWords, render, type RenderContext } from '../../src/training/speech/phraseology';

const ctx = (vars: Record<string, number | string>): RenderContext => ({ lookup: (n) => vars[n] });
const r = (tpl: string, vars: Record<string, number | string> = {}, speak?: string) => render(tpl, ctx(vars), speak);

describe('number words', () => {
  it('British cardinal numbers with "and"', () => {
    expect(numberWords(0)).toBe('zero');
    expect(numberWords(7)).toBe('seven');
    expect(numberWords(74)).toBe('seventy-four');
    expect(numberWords(100)).toBe('one hundred');
    expect(numberWords(160)).toBe('one hundred and sixty');
    expect(numberWords(160, true)).toBe('a hundred and sixty');
    expect(numberWords(260, true)).toBe('two hundred and sixty');
    expect(numberWords(1050)).toBe('one thousand and fifty');
    expect(numberWords(2450)).toBe('two thousand four hundred and fifty');
    expect(numberWords(3500)).toBe('three thousand five hundred');
    expect(numberWords(12500)).toBe('twelve thousand five hundred');
    expect(numberWords(-40)).toBe('minus forty');
    expect(numberWords(2_000_015)).toBe('two million and fifteen');
  });

  it('digits with ICAO niner, decimals', () => {
    expect(digitWords('070')).toBe('zero seven zero');
    expect(digitWords('1013')).toBe('one zero one three');
    expect(digitWords('119')).toBe('one one niner');
    expect(decimalWords(4.5)).toBe('four point five');
    expect(decimalWords(12)).toBe('twelve');
  });
});

describe('render: the spec examples', () => {
  it('caption written form, speech aviation phraseology (rule 7)', () => {
    expect(r('Climb to {alt:alt} at {vspeed.Vy:kt}.', { alt: 3500, 'vspeed.Vy': 74 })).toEqual({
      caption: 'Climb to 3,500 ft at 74 kt.',
      speak: 'Climb to three thousand five hundred feet at seventy-four knots.',
    });
  });

  it.each([
    ['{h:hdg}', { h: 70 }, '070', 'zero seven zero'],
    ['{h:hdg}', { h: 360 }, '360', 'three six zero'],
    ['{h:hdg}', { h: 0.2 }, '360', 'three six zero'],
    ['{h:hdg}', { h: -10 }, '350', 'three five zero'],
    ['{a:alt}', { a: 3500 }, '3,500 ft', 'three thousand five hundred feet'],
    ['{a:alt}', { a: 2450 }, '2,450 ft', 'two thousand four hundred and fifty feet'],
    ['{a:alt}', { a: 2487.4 }, '2,490 ft', 'two thousand four hundred and ninety feet'],
    ['{a:alt}', { a: 35 }, '35 ft', 'thirty-five feet'],
    ['{d:dev:alt}', { d: 160 }, '160 ft high', 'a hundred and sixty feet high'],
    ['{d:dev:alt}', { d: -40 }, '40 ft low', 'forty feet low'],
    ['{dev:alt}', { dev: 163 }, '160 ft high', 'a hundred and sixty feet high'],
    ['{s:kt}', { s: 74.4 }, '74 kt', 'seventy-four knots'],
    ['{s:kt}', { s: 1 }, '1 kt', 'one knot'],
    ['{v:fpm}', { v: 500 }, '500 fpm', 'five hundred feet per minute'],
    ['{v:fpm}', { v: -487 }, '-490 fpm', 'minus four hundred and ninety feet per minute'],
    ['{b:deg}', { b: 30 }, '30°', 'thirty degrees'],
    ['{n:rpm}', { n: 2300 }, '2,300 rpm', 'two thousand three hundred R P M'],
    ['{q:qnh}', { q: 1013 }, '1013', 'one zero one three'],
    ['{q:qnh}', { q: 998 }, '998', 'niner niner eight'],
    ['runway {w:rwy}', { w: 7 }, 'runway 07', 'runway zero seven'],
    ['{f:freq}', { f: 119.1 }, '119.1', 'one one niner decimal one'],
    ['{f:freq}', { f: 118.025 }, '118.025', 'one one eight decimal zero two five'],
    ['{d:nm}', { d: 4.5 }, '4.5 NM', 'four point five miles'],
    ['{d:nm}', { d: 12.4 }, '12 NM', 'twelve miles'],
    ['{d:nm}', { d: 1 }, '1 NM', 'one mile'],
    ['{m:min}', { m: 3 }, '3 min', 'three minutes'],
    ['{x:side}', { x: -0.4 }, 'left', 'left'],
    ['{x:side}', { x: 0.4 }, 'right', 'right'],
    ['{x:dir}', { x: 12 }, 'high', 'high'],
    ['{x:dir}', { x: -12 }, 'low', 'low'],
    ['{x}', { x: 41.6 }, '42', 'forty-two'],
  ])('%s with %o -> %s / %s', (tpl, vars, caption, speak) => {
    expect(r(tpl, vars)).toEqual({ caption, speak });
  });
});

describe('render: coach preset shapes (spec 3.6.3)', () => {
  it("speed rung: \"Speed's {dir}, {asiKt:kt}.\"", () => {
    expect(r("Speed's {dir}, {asiKt:kt}.", { dir: 'fast', asiKt: 81 })).toEqual({
      caption: "Speed's fast, 81 kt.", speak: "Speed's fast, eighty-one knots.",
    });
  });

  it('{Side} capitalises a lower-case side variable', () => {
    expect(r('{Side} rudder: step on the ball.', { side: 'left' }).caption).toBe('Left rudder: step on the ball.');
  });

  it('choice names like {up/down} and {close/wide} are plain variables', () => {
    expect(r('Nose {up/down} a touch.', { 'up/down': 'up' }).caption).toBe('Nose up a touch.');
    expect(r("You're {close/wide} on downwind.", { 'close/wide': 'wide' }).speak).toBe("You're wide on downwind.");
  });

  it('glidepath: "You\'re {dev:alt} on the slope. Check the PAPI."', () => {
    expect(r("You're {dev:alt} on the slope. Check the PAPI.", { dev: -120 })).toEqual({
      caption: "You're 120 ft low on the slope. Check the PAPI.",
      speak: "You're a hundred and twenty feet low on the slope. Check the PAPI.",
    });
  });
});

describe('render: unknown names, speak override, literal text', () => {
  it("unknown names are '?' in captions and skipped in speech", () => {
    expect(r('Rate {vsiFpm:fpm}, we want {target:fpm}.', { target: 500 })).toEqual({
      caption: 'Rate ?, we want 500 fpm.', speak: 'Rate, we want five hundred feet per minute.',
    });
    expect(r('{nope:alt}.', {}).speak).toBe('.');
    expect(r('Bank {x:deg}', { x: Number.NaN }).caption).toBe('Bank ?');
  });

  it('an unknown format is treated like an unknown name', () => {
    expect(r('{a:furlongs}', { a: 3 }).caption).toBe('?');
  });

  it('speakTemplate replaces the template for speech only', () => {
    expect(r('QNH {q:qnh}', { q: 1013 }, 'Set the pressure to {q:qnh}')).toEqual({
      caption: 'QNH 1013', speak: 'Set the pressure to one zero one three',
    });
  });

  it('spells out units and V-speeds written literally in the caption text', () => {
    expect(r('Begin the level-off at 10 % of the rate: 50 ft early at 500 fpm.').speak).toBe(
      'Begin the level-off at ten percent of the rate: fifty feet early at five hundred feet per minute.');
    expect(r('Climb at Vy, then Vx. Approach at Vref, flaps below Vfe; 2,300 RPM, 30° bank, 1 NM.').speak).toBe(
      'Climb at V Y, then V X. Approach at V ref, flaps below V F E; two thousand three hundred R P M, thirty degrees bank, one mile.');
    expect(r('Very good, 1000 ft AGL.').speak).toBe('Very good, one thousand feet A G L.');
  });

  it('literal rewriting leaves captions untouched and does not touch numbers inside words', () => {
    const out = r('Climb at Vy to 3,500 ft (L04).');
    expect(out.caption).toBe('Climb at Vy to 3,500 ft (L04).');
    expect(out.speak).toBe('Climb at V Y to three thousand five hundred feet (L04).');
  });

  it('string variables holding numbers take the requested format', () => {
    expect(r('{a:alt}', { a: '2500' })).toEqual({ caption: '2,500 ft', speak: 'two thousand five hundred feet' });
  });
});
