// The Career's radio identity hook (src/atc/RadioSystem.ts RadioDeps.identity, docs/career.md "Integration"): a
// scripted home circuit (calls picked from the Space menu at every leg, the tower's answers, the readbacks) gives a
// byte-identical transcript with no hook and with a hook that answers null, and it is the transcript pinned from the
// radio before the hook existed; with a hook that names the airframe, every call and answer uses the hook's
// registration and type and never the school's.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_AIRFIELD as H } from '../../src/world/airfields';
import { resetRadios } from '../../src/instruments/dynamics/radios';
import { circuitPath, placeOnLeg, stepTraffic } from '../../src/atc/circuit';
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

type Identity = { registration: string; icaoType: string; callsign: string | null } | null;

/**
 * Fly the home circuit (runway 07, left hand) from early upwind to a full stop: at every leg change the Space menu
 * opens and its first entry is picked; on the ground, slowed, the menu once more. `hook` absent: no identity dep at
 * all. Returns every caption heard and every menu entry offered, one per line.
 */
function transcript(hook?: { identity: () => Identity }): string {
  resetRadios();
  const lines: string[] = [];
  const speech = { enqueue: (u: { actor: string; caption: string }) => lines.push(`${u.actor}: ${u.caption}`), busy: () => false, idle: () => true, speaking: () => false, cancel() {} };
  const training = { speech, active: false, input: () => {}, radioIdentity: () => ({ authority: 'easa', registration: 'G-FSCK', icaoType: 'C172' }) };
  const path = circuitPath(H, 0);
  const s = placeOnLeg(path, 0, 0.1);
  const state = { position: { x: s.north, y: s.east }, onGround: false, groundSpeed: s.speed, track: s.heading, heading: s.heading, altitudeAGL: s.height, altitudeMSL: H.elevation + s.height };
  const ctx = { state, weather: { windDirectionDeg: 70, windSpeedKt: 6, qnhHpa: 1013, timeOfDay: 10, visibilityM: 20000 }, events: { on: () => () => {} }, paused: false };
  const deps = { training: training as never, readings: () => ({ avionicsPowered: true }) as never, layer: {} as never, traffic: () => [], comRadios: () => 2 as const, cdiSelect: () => false, ...(hook ?? {}) };
  const radio = new RadioSystem(deps);
  radio.init(ctx as never);
  const r = radio as unknown as { onKey: (e: unknown) => void; menu: { open: boolean; items: { label: string; detail: string }[] } };
  const key = (code: string) => r.onKey({ code, shiftKey: false, repeat: false, target: null, preventDefault() {}, stopImmediatePropagation() {} });
  const callOnce = (): void => {
    key('Space');
    if (!r.menu.open) return;
    for (const i of r.menu.items) lines.push(`menu: ${i.label} | ${i.detail}`);
    if (r.menu.items.length) key('Digit1');
    else key('Escape');
  };
  const sync = (): void => {
    Object.assign(state.position, { x: s.north, y: s.east });
    state.heading = state.track = s.heading;
    state.groundSpeed = s.speed;
    state.altitudeAGL = s.height;
    state.altitudeMSL = H.elevation + s.height;
    state.onGround = s.onGround;
  };
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
  // Down on final's runway: the roll-out, slowed, the tower's vacate, and the menu once more.
  Object.assign(state, { onGround: true, altitudeAGL: 0, altitudeMSL: H.elevation, groundSpeed: 15 });
  for (let k = 0; k < 40; k++) radio.update(0.1);
  callOnce();
  for (let k = 0; k < 40; k++) radio.update(0.1);
  return lines.join('\n');
}

/** The scripted circuit's transcript from the radio before the identity hook existed (5a4bb20), pinned. */
const BEFORE_THE_HOOK = `menu: Final 07, full stop | Fable Regional Tower, G-FSCK, final runway 07, full stop
menu: Final 07, touch and go | Fable Regional Tower, G-FSCK, final runway 07, touch and go
menu: Left downwind 07, full stop | Fable Regional Tower, G-FSCK, left hand downwind runway 07, full stop
menu: Left downwind 07, touch and go | Fable Regional Tower, G-FSCK, left hand downwind runway 07, touch and go
menu: Left base 07 | Fable Regional Tower, G-FSCK, left hand base runway 07
menu: Crosswind 07 | Fable Regional Tower, G-FSCK, left hand crosswind runway 07
menu: Going around | Fable Regional Tower, G-FSCK, going around
menu: Radio check | Fable Regional Tower, G-FSCK, radio check on 118.3
student: Fable Regional Tower, G-FSCK, final runway 07, full stop
tower: G-CK, runway 07, cleared to land, wind 070 degrees 6 knots
tower: G-CK, read back
menu: Read back | Runway 07, cleared to land, G-CK
menu: Say again | Fable Regional Tower, G-CK, say again
menu: Upwind 07 | Fable Regional Tower, G-CK, upwind runway 07
menu: Left downwind 07, full stop | Fable Regional Tower, G-CK, left hand downwind runway 07, full stop
menu: Left downwind 07, touch and go | Fable Regional Tower, G-CK, left hand downwind runway 07, touch and go
menu: Left base 07 | Fable Regional Tower, G-CK, left hand base runway 07
menu: Final 07, full stop | Fable Regional Tower, G-CK, final runway 07, full stop
menu: Final 07, touch and go | Fable Regional Tower, G-CK, final runway 07, touch and go
menu: Going around | Fable Regional Tower, G-CK, going around
student: Runway 07, cleared to land, G-CK
menu: Crosswind 07 | Fable Regional Tower, G-CK, left hand crosswind runway 07
menu: Left downwind 07, full stop | Fable Regional Tower, G-CK, left hand downwind runway 07, full stop
menu: Left downwind 07, touch and go | Fable Regional Tower, G-CK, left hand downwind runway 07, touch and go
menu: Left base 07 | Fable Regional Tower, G-CK, left hand base runway 07
menu: Final 07, full stop | Fable Regional Tower, G-CK, final runway 07, full stop
menu: Final 07, touch and go | Fable Regional Tower, G-CK, final runway 07, touch and go
menu: Going around | Fable Regional Tower, G-CK, going around
menu: Radio check | Fable Regional Tower, G-CK, radio check on 118.3
student: Fable Regional Tower, G-CK, left hand crosswind runway 07
tower: G-CK, number one, report final
menu: Left downwind 07, full stop | Fable Regional Tower, G-CK, left hand downwind runway 07, full stop
menu: Left downwind 07, touch and go | Fable Regional Tower, G-CK, left hand downwind runway 07, touch and go
menu: Left base 07 | Fable Regional Tower, G-CK, left hand base runway 07
menu: Final 07, full stop | Fable Regional Tower, G-CK, final runway 07, full stop
menu: Final 07, touch and go | Fable Regional Tower, G-CK, final runway 07, touch and go
menu: Crosswind 07 | Fable Regional Tower, G-CK, left hand crosswind runway 07
menu: Going around | Fable Regional Tower, G-CK, going around
menu: Radio check | Fable Regional Tower, G-CK, radio check on 118.3
student: Fable Regional Tower, G-CK, left hand downwind runway 07, full stop
tower: G-CK, number one, report final
menu: Say again | Fable Regional Tower, G-CK, say again
menu: Left base 07 | Fable Regional Tower, G-CK, left hand base runway 07
menu: Left downwind 07, full stop | Fable Regional Tower, G-CK, left hand downwind runway 07, full stop
menu: Left downwind 07, touch and go | Fable Regional Tower, G-CK, left hand downwind runway 07, touch and go
menu: Final 07, full stop | Fable Regional Tower, G-CK, final runway 07, full stop
menu: Final 07, touch and go | Fable Regional Tower, G-CK, final runway 07, touch and go
menu: Crosswind 07 | Fable Regional Tower, G-CK, left hand crosswind runway 07
menu: Going around | Fable Regional Tower, G-CK, going around
menu: Radio check | Fable Regional Tower, G-CK, radio check on 118.3
student: Fable Regional Tower, G-CK, say again
tower: G-CK, number one, report final
menu: Radio check | Fable Regional Tower, G-CK, radio check on 118.3
student: Fable Regional Tower, G-CK, radio check on 118.3
tower: G-CK, Fable Regional Tower, readability five
tower: G-CK, vacate left at A2, when vacated contact Ground 121.9
menu: Read back | Vacate left at A2, Ground 121.9, G-CK
menu: Say again | Fable Regional Tower, G-CK, say again
menu: Radio check | Fable Regional Tower, G-CK, radio check on 118.3
student: Vacate left at A2, Ground 121.9, G-CK`;

describe('the radio identity hook', () => {
  beforeEach(() => resetRadios());

  it('changes nothing when absent or when it answers null', () => {
    const none = transcript();
    expect(none.split('\n').length).toBeGreaterThan(8);
    expect(none).toContain('G-CK');
    expect(transcript({ identity: () => null })).toBe(none);
    expect(none).toBe(BEFORE_THE_HOOK);
  });

  it("puts the hook's registration and type in every call and answer", () => {
    // No company callsign (its phrasing is a later stage's, tests/atc/careerHooks.test.ts): the registration speaks.
    const career = transcript({ identity: () => ({ registration: 'G-GKQQ', icaoType: 'C152', callsign: null }) });
    const school = transcript();
    expect(career).not.toContain('G-CK');
    expect(career).not.toContain('G-FSCK');
    expect(career).toContain('G-QQ');
    // The same exchange otherwise: the school's abbreviation swapped for the airframe's gives the same lines.
    expect(career.replace(/G-QQ/g, 'G-CK').replace(/G-GKQQ/g, 'G-FSCK').replace(/C152/g, 'C172')).toBe(school);
  });
});
