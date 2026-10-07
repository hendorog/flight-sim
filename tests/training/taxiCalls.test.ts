// Round 7, item 8: the taxi calls checked against position with a student who STAYS ON THE YELLOW LINE.
// L02 is flown headless from cold and dark (real flight model, runner, telemetry, speech scheduler) by the
// AutoStudent, whose taxi driver follows the route centreline by pure pursuit (tests/training/autoStudent.ts
// taxiPursuitLaw). Every caption is stamped with where the aircraft was when it was said (along-route
// distance, cross-track, ground speed), and each call is checked against the route's geometry:
//   - the track: within 2 m of the centreline at 8-12 kt;
//   - every turn: one advance call naming it and its direction, 30-60 m before it (the first turn, 26 m from
//     the stand, in the call made before moving off), and one "turn now" call 5-20 m before it, right way;
//   - the holding point call and HOLD SHORT on the panel before the hold line.
// FS_TAXI_OUT=<file> writes the transcript with positions.

import { describe, expect, it } from 'vitest';
import { TaxiGuide } from '../../src/training/engine/taxiGuide';
import { buildTaxiRoute, spokenTaxiway } from '../../src/training/geo/taxiRoute';
import { createTaxiProvider } from '../../src/training/telemetry/providers/taxi';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { TaxiGuideModel, TaxiRoute, TelemetrySources } from '../../src/training/types';
import { PARKING } from '../../src/world/airport/layout';
import { flyLesson, lesson } from './conformanceRun';

/** node:fs, loaded at run time (the project builds without node's types). */
const loadFs = async (): Promise<{ writeFileSync(path: string, data: string): void }> =>
  (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(path: string, data: string): void };

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

interface Said { t: number; text: string; s: number; xt: number; gs: number; n: number; e: number; step: string }
interface Sample { t: number; s: number; xt: number; gs: number; moving: boolean }

/** A transcript line: "  412.3 s  s= 1012 m  xt= +0.4 m  10.2 kt  | text". */
const line = (c: Said): string =>
  `${c.t.toFixed(1).padStart(7)} s  s=${Number.isFinite(c.s) ? c.s.toFixed(0).padStart(5) : '    -'} m  xt=${Number.isFinite(c.xt) ? (c.xt >= 0 ? '+' : '') + c.xt.toFixed(1) : '-'} m  ${c.gs.toFixed(1).padStart(4)} kt  N${c.n.toFixed(0)} E${c.e.toFixed(0)}  [${c.step}]  ${c.text}`;

describe('L02 taxi calls against position, student on the yellow line (item 8)', () => {
  it('flies from cold and dark to the hold on the centreline; every call at the right place, once', async () => {
    const said: Said[] = [];
    const seen = new Set<string>();
    const track: Sample[] = [];
    const panel: { s: number; m: TaxiGuideModel }[] = [];
    let route: TaxiRoute | null = null;
    let taxiDone = -1;
    const run = await flyLesson(lesson('L02'), {
      maxSimS: 1500,
      onFrame: (h, t) => {
        const f = h.runner.evalContext.frame;
        const st = h.physics.state;
        const step = h.runner.currentStep?.def.id ?? '';
        if (!(h.ui as { setTaxiGuide?: unknown }).setTaxiGuide) {
          (h.ui as unknown as { setTaxiGuide(m: TaxiGuideModel | null): void }).setTaxiGuide = (m) => {
            if (m) panel.push({ s: Number(h.runner.evalContext.frame['taxi.alongM']), m });
          };
        }
        route = h.runner.activeTaxiRoute ?? route;
        const s = Number(f['taxi.alongM']);
        const xt = Number(f['taxi.xtrackM']);
        const gs = st.groundSpeed / 0.514444;
        for (const c of h.speech.transcript) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          said.push({ t: c.atSim, text: c.text, s, xt, gs, n: st.position.x, e: st.position.y, step });
        }
        if (step === 'taxiA1' && f['taxi.active'] === true) track.push({ t, s, xt, gs, moving: gs > 5 });
        if (taxiDone < 0 && route && step !== 'taxiA1' && track.length > 0) taxiDone = t;
        // Stop once the run-up has begun at the hold.
        return taxiDone > 0 && t > taxiDone + 5;
      },
    });
    expect(run.crashes).toEqual([]);
    expect(route, 'a taxi route').not.toBeNull();
    const r = route as unknown as TaxiRoute;
    const taxiSaid = said.filter((c) => c.step === 'taxiA1');
    if (env.FS_TAXI_OUT) {
      const wps = r.waypoints.map((w) => `  ${w.action.padEnd(9)} ${w.name.padEnd(5)} at s=${w.sM.toFixed(0)} m (turn ${w.turnDeg} deg)`).join('\n');
      (await loadFs()).writeFileSync(env.FS_TAXI_OUT, `L02 taxi, headless (AutoStudent pure-pursuit driver), route ${r.lengthM.toFixed(0)} m:\n${wps}\n\n${said.map(line).join('\n')}\n`);
    }

    // 1. The track: on the line at taxi speed (away from the stand pull-out and the stop at the hold).
    const cruising = track.filter((x) => x.moving && x.s > 8 && x.s < r.lengthM - 10);
    expect(cruising.length).toBeGreaterThan(100);
    const maxXt = Math.max(...cruising.map((x) => Math.abs(x.xt)));
    expect(maxXt, 'max cross-track while taxiing, m').toBeLessThanOrEqual(2);
    const mean = cruising.reduce((a, x) => a + x.gs, 0) / cruising.length;
    expect(mean).toBeGreaterThanOrEqual(8);
    expect(mean).toBeLessThanOrEqual(12);
    expect(Math.max(...cruising.map((x) => x.gs))).toBeLessThanOrEqual(12.5);

    // 2. Every turn: one advance call and one "turn now" call, each in its window and naming the right way.
    const turns = r.waypoints.filter((w) => w.action === 'left' || w.action === 'right');
    expect(turns.map((w) => `${w.action} ${w.name}`)).toEqual(['right apron', 'left B1', 'right A', 'left A1']);
    turns.forEach((w, i) => {
      const name = spokenTaxiway(w.name);
      const wrong = w.action === 'left' ? 'right' : 'left';
      if (i === 0) {
        // 26 m from the stand: called before moving off.
        const c = taxiSaid.filter((x) => /out of the stand/.test(x.text));
        expect(c, 'stand call').toHaveLength(1);
        expect(c[0].text).toContain(`turn ${w.action}`);
        expect(c[0].s).toBeLessThan(3);
      } else {
        const adv = taxiSaid.filter((x) => x.text.includes(`${name} is the next `) || x.text.includes(`${name.charAt(0).toUpperCase()}${name.slice(1)} is the next `));
        expect(adv.map(line), `advance call for ${name}`).toHaveLength(1);
        expect(adv[0].text).toContain(`next ${w.action}`);
        const d = w.sM - adv[0].s;
        expect(d, `advance call for ${name}: ${line(adv[0])}`).toBeGreaterThanOrEqual(30);
        expect(d, `advance call for ${name}: ${line(adv[0])}`).toBeLessThanOrEqual(60);
      }
      const now = taxiSaid.filter((x) => (w.name === 'apron' ? /^Turn (left|right) now, onto the yellow line/ : new RegExp(`^Turn (left|right) now onto ${name}\\b`)).test(x.text));
      expect(now.map(line), `turn-now call for ${name}`).toHaveLength(1);
      expect(now[0].text).toMatch(new RegExp(`^Turn ${w.action} now`));
      const d = w.sM - now[0].s;
      expect(d, `turn-now call for ${name}: ${line(now[0])}`).toBeGreaterThanOrEqual(5);
      expect(d, `turn-now call for ${name}: ${line(now[0])}`).toBeLessThanOrEqual(20);
      // Never the wrong way for this taxiway.
      expect(taxiSaid.filter((x) => x.text.includes(`${wrong} onto ${name}`) || x.text.includes(`${name} is the next ${wrong}`)).map(line)).toEqual([]);
    });

    // 3. The hold: the call and HOLD SHORT on the panel before the hold line (4 m beyond the route's end).
    const holdLineS = r.lengthM + 4;
    const hold = taxiSaid.filter((x) => /^Holding point A1 ahead|holding point is just/i.test(x.text));
    expect(hold.map(line)).toHaveLength(1);
    expect(hold[0].s).toBeLessThan(holdLineS - 20);
    const hs = panel.find((p) => p.m.holdShort);
    expect(hs, 'HOLD SHORT shown').toBeDefined();
    expect(hs!.s).toBeLessThan(holdLineS - 20);
    // Stopped before the hold line.
    const last = track.at(-1)!;
    expect(last.s).toBeLessThan(holdLineS);
    // No call is made twice.
    const texts = taxiSaid.map((x) => x.text).filter((x) => /Turn|next|Holding point|out of the stand/.test(x));
    expect(new Set(texts).size).toBe(texts.length);
  }, 300_000);
});

/** The route point `s` along, pushed `off` m to the right of the line (left when negative), and the line's heading. */
function offsetAlong(r: TaxiRoute, s: number, off: number): { north: number; east: number; hdg: number } {
  const p = r.points;
  let k = p.findIndex((q) => q.sM >= s);
  if (k <= 0) k = 1;
  const a = p[k - 1], b = p[k];
  const t = Math.max(0, Math.min(1, (s - a.sM) / (b.sM - a.sM || 1)));
  const hdg = Math.atan2(b.east - a.east, b.north - a.north);
  // Right of the direction of travel: (north, east) normal = (-sin, cos) of the heading.
  return { north: a.north + (b.north - a.north) * t - Math.sin(hdg) * off, east: a.east + (b.east - a.east) * t + Math.cos(hdg) * off, hdg };
}

describe('taxi calls for a student 10-15 m off the line (item 8)', () => {
  // Along-route distance (not position boxes): the same calls at the same places whichever side of the line.
  for (const off of [-15, -12, -10, 0, 10, 12, 15]) {
    it(`${off >= 0 ? '+' : ''}${off} m: every turn called 30-60 m before and at it, once, the right way; the hold before the line`, () => {
      const route = buildTaxiRoute(PARKING.north, PARKING.east, 'A1')!;
      const tel = new Telemetry([createTaxiProvider()]);
      const guide = new TaxiGuide(route, true, false);
      const calls: { s: number; id: string; text: string }[] = [];
      const open = guide.opening();
      if (open) calls.push({ s: 0, id: open.id, text: open.cue.text as string });
      // 5 m/s (10 kt); each call keeps the instructor talking for 3 s (the next waits for a gap unless it is due).
      let talking = 0;
      const dt = 0.1;
      for (let s = 0; s <= route.lengthM; s += 5 * dt) {
        // The offset is eased in over the first 20 m (the aircraft starts on the stand's line).
        const p = offsetAlong(route, Math.min(s, route.lengthM - 0.01), off * Math.min(1, s / 20));
        const src = { state: { position: { x: p.north, y: p.east, z: 0 }, heading: p.hdg, onGround: true }, taxiRoute: route } as unknown as TelemetrySources;
        const f = tel.sample(src, dt);
        f.gsKt = 10;
        talking = Math.max(0, talking - dt);
        const c = guide.update(f, dt, talking === 0);
        if (c) {
          calls.push({ s, id: c.id, text: c.cue.text as string });
          talking = 3;
        }
      }
      const where = calls.map((c) => `${c.s.toFixed(0)} ${c.id}: ${c.text}`).join('\n');
      expect(guide.needsReroute, where).toBe(false);
      const turns = route.waypoints.filter((w) => w.action === 'left' || w.action === 'right');
      turns.forEach((w, i) => {
        const prep = calls.filter((c) => c.id === `prep:${i}`);
        const turn = calls.filter((c) => c.id === `turn:${i}`);
        if (i === 0) expect(calls.filter((c) => c.id === 'stand'), where).toHaveLength(1);
        else {
          expect(prep, `${where}\nprep:${i}`).toHaveLength(1);
          expect(w.sM - prep[0].s, `${where}\nprep:${i}`).toBeGreaterThanOrEqual(30);
          expect(w.sM - prep[0].s, `${where}\nprep:${i}`).toBeLessThanOrEqual(60);
          expect(prep[0].text).toContain(`next ${w.action}`);
        }
        expect(turn, `${where}\nturn:${i}`).toHaveLength(1);
        expect(w.sM - turn[0].s, `${where}\nturn:${i}`).toBeGreaterThanOrEqual(4);
        expect(w.sM - turn[0].s, `${where}\nturn:${i}`).toBeLessThanOrEqual(20);
        expect(turn[0].text).toMatch(new RegExp(`^Turn ${w.action} now`));
      });
      const hold = calls.filter((c) => c.id === 'hold:far');
      expect(hold, where).toHaveLength(1);
      expect(hold[0].s, where).toBeLessThan(route.lengthM + 4 - 20);
      expect(new Set(calls.map((c) => c.id)).size).toBe(calls.length);
    });
  }
});
