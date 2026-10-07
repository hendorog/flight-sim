import { describe, expect, it } from 'vitest';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { KEY_BINDINGS } from '../../src/input/bindings';
import {
  achievedRateLabel,
  SIM_RATES,
  mixtureLabel,
  parkingBrakeStepText,
  STARTUP_BRAKE_STEP,
  STARTUP_STEPS,
  splitKeyAlternatives,
  splitKeyCombo,
  starterAdvice,
  switchChanges,
  switchSnapshot,
  trimLabel,
} from '../../src/ui/cues';
import { parkingBrakeCue } from '../../src/ui/status';

describe('Controls tab key caps', () => {
  it('keeps "Num +" as one key and splits modifiers', () => {
    expect(splitKeyCombo('Num +')).toEqual(['Num +']);
    expect(splitKeyCombo('Num -')).toEqual(['Num -']);
    expect(splitKeyCombo('Shift+B')).toEqual(['Shift', 'B']);
    expect(splitKeyCombo('Shift+Num +')).toEqual(['Shift', 'Num +']);
    expect(splitKeyAlternatives('= / Num +')).toEqual(['=', 'Num +']);
  });

  it('renders no empty key cap for any real binding', () => {
    for (const b of KEY_BINDINGS) {
      for (const alt of splitKeyAlternatives(b.keys)) {
        const caps = splitKeyCombo(alt);
        expect(caps.length, b.keys).toBeGreaterThan(0);
        for (const k of caps) expect(k.trim(), b.keys).not.toBe('');
      }
    }
    const zoom = KEY_BINDINGS.find((b) => b.action === 'Zoom in')!;
    expect(splitKeyAlternatives(zoom.keys).flatMap(splitKeyCombo)).toContain('Num +');
  });
});

describe('lever and switch cues', () => {
  it('names the mixture positions', () => {
    expect(mixtureLabel(0)).toBe('Mixture IDLE CUT-OFF');
    expect(mixtureLabel(1)).toBe('Mixture FULL RICH');
    expect(mixtureLabel(0.45)).toBe('Mixture 45%');
  });

  it('reads the trim numerically', () => {
    expect(trimLabel(0)).toBe('0%');
    expect(trimLabel(0.12)).toBe('12% UP');
    expect(trimLabel(-0.3)).toBe('30% DN');
  });

  it('announces each switch change once, merging the master halves', () => {
    const a = defaultControls();
    a.masterBattery = a.alternator = false;
    const b = structuredClone(a);
    b.masterBattery = b.alternator = true;
    b.avionics = !a.avionics;
    b.magnetos = 0;
    b.lights.landing = true;
    const msgs = switchChanges(switchSnapshot(a), switchSnapshot(b));
    expect(msgs).toContain('Master switch ON');
    expect(msgs).toContain(`Avionics ${b.avionics ? 'ON' : 'OFF'}`);
    expect(msgs).toContain('Magnetos OFF');
    expect(msgs).toContain('Landing light ON');
    expect(msgs).toHaveLength(4);
    expect(switchChanges(switchSnapshot(b), switchSnapshot(b))).toEqual([]);
  });

  it('explains why the starter cannot start the engine', () => {
    const c = defaultControls();
    c.masterBattery = false;
    c.mixture = 0;
    expect(starterAdvice(c)).toMatch(/master/i);
    c.masterBattery = true;
    expect(starterAdvice(c)).toMatch(/IDLE CUT-OFF/);
    c.mixture = 0.085; // three taps of Shift+M
    expect(starterAdvice(c)).toMatch(/too lean/);
    c.mixture = 1;
    expect(starterAdvice(c)).toBeNull();
    c.fuelSelector = 'off';
    expect(starterAdvice(c)).toMatch(/fuel selector/i);
  });

  it('turns the parking-brake cue red when the throttle is opened against it', () => {
    const c = defaultControls();
    const s = makeMockState({ heightAGL: 0 });
    s.engine.running = true;
    expect(parkingBrakeCue(c, s)).toBeNull();
    c.parkingBrake = true;
    expect(parkingBrakeCue(c, s)?.level).toBe('warn');
    c.throttle = 1;
    const cue = parkingBrakeCue(c, s)!;
    expect(cue.level).toBe('alert');
    expect(cue.text).toMatch(/Shift\+B/);
  });
});

describe('engine start procedure', () => {
  // The apron scenario loads with the parking brake set: a step that toggles it would release it.
  it('never tells the pilot to toggle the parking brake that the apron already has set', () => {
    const [what, how] = STARTUP_STEPS[STARTUP_BRAKE_STEP];
    expect(what).toBe('Parking brake');
    expect(how).toMatch(/^check SET/);
    expect(how).not.toMatch(/^set \(Shift\+B\)/);
    // Only the last step releases it, and it says "release", not a bare key.
    const releases = STARTUP_STEPS.filter(([, h]) => /release/i.test(h));
    expect(releases.length).toBe(1);
    expect(STARTUP_STEPS.indexOf(releases[0])).toBe(STARTUP_STEPS.length - 1);
    expect(releases[0][1]).toMatch(/release the parking brake \(Shift\+B\) when ready to taxi/);
  });

  it('the live brake step says leave it when set and names the key when not', () => {
    expect(parkingBrakeStepText(true)).toMatch(/SET/);
    expect(parkingBrakeStepText(true)).not.toMatch(/Shift\+B/);
    expect(parkingBrakeStepText(false)).toMatch(/press Shift\+B to set/);
  });
});

describe('simulation rate', () => {
  it('offers up to 16x, as the README advertises', () => {
    expect(SIM_RATES).toContain(8);
    expect(Math.max(...SIM_RATES)).toBe(16);
  });

  it('shows the achieved rate only when it falls short', () => {
    expect(achievedRateLabel(16, 16, false)).toBe('');
    expect(achievedRateLabel(16, 15.6, false)).toBe('');
    expect(achievedRateLabel(16, 11.4, false)).toBe('Achieving about 11× (limited by the CPU)');
    expect(achievedRateLabel(8, 5.26, false)).toBe('Achieving about 5.3× (limited by the CPU)');
    expect(achievedRateLabel(8, 2, true)).toBe('');
    expect(achievedRateLabel(1, 0.5, false)).toBe('');
    expect(achievedRateLabel(4, undefined, false)).toBe('');
  });
});
