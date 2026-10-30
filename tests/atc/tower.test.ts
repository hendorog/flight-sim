// The home tower's sequencing (src/atc/tower.ts): numbers and traffic to follow, landing clearances only for number
// one with the runway free (continue, then the clearance), departures held for arrivals close in, go-arounds at 400 ft,
// and the AI aircraft told to follow on downwind.

import { describe, expect, it } from 'vitest';
import { HomeTower, type TowerAircraft, type TowerView } from '../../src/atc/tower';
import { callsign, type Authority } from '../../src/atc/phrases';

const me = (p: Partial<TowerAircraft>, a: Authority = 'easa'): TowerAircraft => ({
  id: 'player', callsign: callsign('G-ABFS', 'C152', a), type: 'Cessna', height: 300, onGround: false, onRunway: false, leg: 'downwind', remaining: 6000, along: -1500, ...p,
});
const ai = (p: Partial<TowerAircraft>, a: Authority = 'easa'): TowerAircraft => ({
  id: 'G-TRAF', callsign: callsign('G-TRAF', 'PA38', a), type: 'Piper', height: 150, onGround: false, onRunway: false, leg: 'base', remaining: 3500, along: -3700, ...p,
});
const view = (aircraft: TowerAircraft[], authority: Authority = 'easa'): TowerView => ({ authority, windFromDeg: 70, windKt: 8, aircraft });

describe('the home tower', () => {
  it('numbers the player behind traffic on base and says whom to follow', () => {
    const t = new HomeTower();
    const r = t.call(view([me({}), ai({})]), 'player', 'downwind', 'fullStop')!;
    expect(r.line.text).toBe('G-FS, number two, follow the Piper on base, report final');
    expect(r.readback!.text).toBe('Number two, following the Piper, G-FS');
    const one = t.call(view([me({})]), 'player', 'downwind', 'fullStop')!;
    expect(one.line.text).toBe('G-FS, number one, report final');
  });

  it('clears an FAA landing in sequence', () => {
    const t = new HomeTower();
    const r = t.call(view([me({}, 'faa'), ai({}, 'faa')], 'faa'), 'player', 'downwind', 'touchAndGo')!;
    expect(r.line.text).toMatch(/number two, follow the Piper on base, runway 07, cleared touch-and-go$/);
    expect(r.readback!.text).toMatch(/^Following the Piper, cleared touch-and-go, runway 07, /);
  });

  it('tells the player to continue with one ahead, then clears the landing once the runway is free', () => {
    const t = new HomeTower();
    const p = me({ leg: 'final', remaining: 3000, height: 250, along: -3800 });
    const r = t.call(view([p, ai({ leg: 'final', remaining: 1200, along: -2000 })]), 'player', 'final', 'fullStop')!;
    expect(r.line.text).toBe('G-FS, continue approach, one ahead');
    // The traffic on the runway: still waiting.
    expect(t.update(view([p, ai({ leg: null, onGround: true, onRunway: true, remaining: Infinity })])).messages).toHaveLength(0);
    // Off again on its touch and go: cleared.
    const out = t.update(view([p, ai({ leg: 'upwind', remaining: 9000, height: 60, along: 600 })]));
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].to).toBe('player');
    expect(out.messages[0].line.text).toMatch(/^G-FS, runway 07, cleared to land, wind/);
    expect(out.messages[0].readback!.text).toBe('Runway 07, cleared to land, G-FS');
  });

  it('sends a cleared arrival round when the runway is occupied at 400 ft, the player only once it has called', () => {
    const t = new HomeTower();
    const short = me({ leg: 'final', remaining: 1500, height: 100 });
    const blocked = ai({ leg: null, onGround: true, onRunway: true, remaining: Infinity });
    expect(t.update(view([short, blocked])).messages).toHaveLength(0);
    t.call(view([me({ leg: 'final', remaining: 4000, height: 300 })]), 'player', 'final', 'fullStop');
    const out = t.update(view([short, blocked]));
    expect(out.messages.map((m) => m.line.text)).toEqual(['G-FS, go around, runway occupied']);
    // Once only.
    expect(t.update(view([short, blocked])).messages).toHaveLength(0);
  });

  it('sends the AI round itself, and tells it to follow on downwind until the one ahead is well down final', () => {
    const t = new HomeTower();
    const out = t.update(view([me({ onGround: true, onRunway: true, leg: null, remaining: Infinity }), ai({ id: 'G-TRAF', leg: 'final', height: 100, remaining: 1500 })]));
    expect(out.goAround).toEqual(['G-TRAF']);
    const behind = ai({ leg: 'downwind', remaining: 7000, along: -3400 });
    expect(t.update(view([me({ leg: 'base', remaining: 3500, along: -3700 }), behind])).follow).toEqual(['G-TRAF']);
    expect(t.update(view([me({ leg: 'final', remaining: 2000, along: -3000 }), behind])).follow).toEqual(['G-TRAF']);
    expect(t.update(view([me({ leg: 'final', remaining: 1000, along: -2200 }), behind])).follow).toEqual([]);
  });

  it('holds a departure for traffic on final, then clears the take-off', () => {
    const t = new HomeTower();
    const hp = me({ onGround: true, leg: null, remaining: Infinity, height: 0 });
    const r = t.call(view([hp, ai({ leg: 'final', remaining: 2000 })]), 'player', 'ready')!;
    expect(r.line.text).toBe('G-FS, hold position, traffic on final');
    expect(r.readback!.text).toBe('Holding position, G-FS');
    expect(t.update(view([hp, ai({ leg: null, onGround: true, onRunway: true, remaining: Infinity })])).messages).toHaveLength(0);
    const out = t.update(view([hp, ai({ leg: 'upwind', remaining: 9000 })]));
    expect(out.messages[0].line.text).toMatch(/^G-FS, runway 07, cleared for take-off, wind/);
    expect(out.messages[0].readback!.text).toBe('Runway 07, cleared for take-off, G-FS');
    // FAA at the holding point: hold short.
    const f = new HomeTower().call(view([me({ onGround: true, leg: null, remaining: Infinity }, 'faa'), ai({ leg: 'final', remaining: 2000 }, 'faa')], 'faa'), 'player', 'ready')!;
    expect(f.line.text).toMatch(/hold short runway 07, traffic on final$/);
  });
});
