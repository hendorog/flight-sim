// The AH-56A Cheyenne's sound (src/aircraft/ah56/audio.ts): the T64's whine on Ng, the four-blade rotor through the
// propeller voice with its high-speed impulsive crack, the tail rotor, the NEW pusher channel (blade passage, loudness
// with |thrust| and blade angle, the reverse roar), the 8P hum, the half-P thump, the gear motor and the tail-wheel lock,
// and the FLAWS voice warnings; and the mapping from the rotorcraft state (pusher, events.halfPHop) to the parameters.
//
// IMPORT RULE (plan revision 2, section 7.7): the profile reads every checked number from the definition, which is the
// S0 stub today (the MD 500E rotor with four blades at 492 rpm, its tail rotor and 250-C20B). So the tests assert the
// RELATIONSHIPS with the definition, and pin the AH-56A's own frequencies (16.4 Hz rotor, 82.5 Hz tail rotor, 85.9 Hz
// pusher, 32.8 Hz 8P, 2.05 Hz half-P) on a profile built by ah56Audio() from a test-local LANDED definition (AG's rotor,
// AC's pusher, the wheels) made of the published facts: the profile AG and AC will get without an AU edit.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AH56_AUDIO, AH56_TARGET_HZ, ah56Audio } from '../../src/aircraft/ah56/audio';
import * as D from '../../src/aircraft/ah56/dimensions';
import { AH56_AMCS_NR_FRACTION, AH56_ENGINE_RATIO, AH56_MASS_LB, AH56_NR_100, AH56_NR_PCT, AH56_PROP_BETA_DEG, AH56_PROP_RATIO, AH56_TAIL_RATIO } from '../../src/aircraft/ah56/facts';
import { AH56_POWERPLANT } from '../../src/aircraft/ah56/powerplant';
import { AH56_ROTORCRAFT as stub } from '../../src/aircraft/ah56/rotorcraft';
import { MD500_AUDIO } from '../../src/aircraft/md500/audio';
import { AudioSystem, TAIL_WHEEL_LOCK_THUMP } from '../../src/audio/AudioSystem';
import { advancingTipMach, fillSynthParams, makeParamBlock, pusherSound, SPEED_OF_SOUND, type SoundContext } from '../../src/audio/mapping';
import { P, STEM } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { tailHoverThrustN } from '../../src/audio/rotorcraftProfile';
import { activeMessages, browserSpeaker, ROTOR_RPM_DISARM_PCT, speechSeconds, VoiceWarner, type Speaker } from '../../src/audio/voiceWarnings';
import { createEventBus, type SimContext } from '../../src/core/context';
import { DEG, G0, KT, LB } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type AircraftState } from '../../src/core/types';
import { emptyRotorcraftState, type RotorcraftDefinition, type RotorcraftState } from '../../src/physics/rotorcraft/definition';
import type { PusherDef } from '../../src/physics/rotorcraft/pusher';
import { biquad, dbfs, exteriorMix, interiorMix } from './mixModel';
import { envelope, peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

/** AG's rotor and wheels and AC's pusher as the published facts give them (test-local; the real ones arrive with AG/AC). */
const LANDED: RotorcraftDefinition = {
  ...stub,
  main: { ...stub.main, blades: D.MAIN_ROTOR_BLADES, radius: D.MAIN_ROTOR_RADIUS, hub: D.MAIN_HUB },
  tail: { ...stub.tail, blades: D.TAIL_ROTOR_BLADES, radius: D.TAIL_ROTOR_RADIUS, hub: D.TAIL_HUB },
  nominalRpm: AH56_NR_100, referenceRpm: AH56_NR_100,
  engineRatio: AH56_ENGINE_RATIO, tailRatio: AH56_TAIL_RATIO,
  landingGear: 'wheels',
  pusher: { propeller: { blades: D.PUSHER_BLADES, diameter: D.PUSHER_RADIUS * 2 }, ratio: AH56_PROP_RATIO } as unknown as PusherDef,
};
const LANDED_AUDIO = ah56Audio(LANDED, AH56_POWERPLANT);

const ENGINE = AH56_AUDIO.engines[0].engine;
const NG_RPM = ENGINE.turbine!.ngRpm;
const ng = (fraction: number): number => fraction * NG_RPM;
const TAIL_RPM = AH56_NR_100 * AH56_TAIL_RATIO;
const PROP_RPM = AH56_NR_100 * AH56_PROP_RATIO;
const tail = (load: number): Record<string, number> => ({ tailRpm: TAIL_RPM, tailLoad: load, tailTipMach: 0.58 });
const pusher = (load: number, pitch: number, reverse = 0): Record<string, number> =>
  ({ pusherRpm: PROP_RPM, pusherLoad: load, pusherTipMach: 0.81, pusherPitch: pitch, pusherReverse: reverse });
/** Hover at 18,300 lb: Ng 90 %, Nr 246 (ICS 100 %), tip Mach 0.59, the pusher at its hover detent (no thrust). */
const HOVER = { rpm: ng(0.9), firing: 1, load: 0.7, propRpm: AH56_NR_100, tipMach: 0.59, propLoad: 1, ...tail(1), ...pusher(0.05, 0) };
/** Cruise at 190 KTAS (97.7 m/s): the wing carrying part of the weight, the pusher driving, the advancing tip at Mach 0.88. */
const CRUISE = { ...HOVER, rpm: ng(0.97), load: 0.95, tipMach: 0.66, propLoad: 0.6, advTipMach: 0.878, ...tail(0.3),
  ...pusher(1, 0.75), pusherTipMach: 0.86, windLevel: 2.5, windFreq: 250 + 97.7 * 9, turbulence: 0.1, vibration: 1, vibrationHz: AH56_TARGET_HZ.vibration8P };
const band = (x: Float32Array, lo: number, hi: number): Float32Array => biquad(biquad(x, { type: 'highpass', frequency: lo, Q: 0 }), { type: 'lowpass', frequency: hi, Q: 0 });
const stems = (params: Record<string, number>, seconds = 3, profile: AudioProfile = LANDED_AUDIO): Float32Array[] =>
  new SynthHost(profile).set(params).render(seconds).map((x) => x.subarray(SR));
const db = (a: number, b: number): number => 20 * Math.log10(a / b);

describe('AH56_AUDIO: the import rule', () => {
  it('reads every checked number from the definition and the powerplant (the S0 stub today)', () => {
    expect(AH56_AUDIO.engines).toHaveLength(1);
    expect(ENGINE.combustion).toBe('turbine');
    expect(ENGINE.ratedPowerW).toBe(AH56_POWERPLANT.engines[0].engine.ratedPower);
    expect(ENGINE.gearRatio).toBe(stub.engineRatio);
    const rotor = AH56_AUDIO.engines[0].prop;
    expect(rotor.blades).toBe(stub.main.blades);
    expect(rotor.blades).toBe(4);
    expect(rotor.diameterM).toBe(stub.main.radius * 2);
    const tr = AH56_AUDIO.tailRotor!;
    expect([tr.blades, tr.diameterM, tr.ratio]).toEqual([stub.tail.blades, stub.tail.radius * 2, stub.tailRatio]);
    expect(tr.hoverThrustN).toBe(tailHoverThrustN(stub, AH56_MASS_LB.test * LB * G0));
    expect(AH56_AUDIO.busPoweredV).toBe(AH56_POWERPLANT.electrical.busDeadVolts);
    // Skids today: no gear voice (consistency: a rotorcraft's gear voice exists exactly with wheels).
    expect(stub.landingGear).not.toBe('wheels');
    expect(AH56_AUDIO.gear).toBeNull();
    // The pusher channel is present while def.pusher is absent: the published propeller (3 blades, 10 ft, 1717 / 246).
    expect(stub.pusher).toBeUndefined();
    expect(AH56_AUDIO.pusher).toMatchObject({ blades: 3, ratio: AH56_PROP_RATIO });
    expect(AH56_AUDIO.pusher!.diameterM).toBeCloseTo(3.048, 6);
    // The FLAWS ROTOR RPM and the hum count the rotor's percent from the definition's 100 %.
    expect(AH56_AUDIO.vibration!.rpm100).toBe(stub.referenceRpm);
    const rpmMessage = AH56_AUDIO.voiceWarnings!.messages.find((m) => m.when.kind === 'rotorRpm')!;
    expect(rpmMessage.when).toEqual({ kind: 'rotorRpm', low: AH56_NR_PCT.powerOn[0], high: AH56_NR_PCT.powerOn[1], rpm100: stub.referenceRpm });
  });

  it('follows AG and AC without an edit: the landed definition gives the AH-56A\'s rotor, tail rotor, pusher and gear', () => {
    const p = LANDED_AUDIO;
    expect(p.engines[0].prop.blades).toBe(4);
    expect(p.engines[0].prop.diameterM).toBeCloseTo(15.616, 3);
    expect(p.engines[0].engine.gearRatio).toBeCloseTo(55.28, 2);
    expect([p.tailRotor!.blades, p.tailRotor!.ratio]).toEqual([4, AH56_TAIL_RATIO]);
    expect(p.tailRotor!.diameterM).toBeCloseTo(3.048, 6);
    // Consistency (tests/aircraft/consistency.ts): audio.pusher equals def.pusher once it exists.
    expect([p.pusher!.blades, p.pusher!.diameterM, p.pusher!.ratio]).toEqual([LANDED.pusher!.propeller.blades, LANDED.pusher!.propeller.diameter, LANDED.pusher!.ratio]);
    // A pusher definition that differed from the facts would be followed, not the facts.
    const other = ah56Audio({ ...LANDED, pusher: { ...LANDED.pusher!, ratio: 7 } }, AH56_POWERPLANT);
    expect(other.pusher!.ratio).toBe(7);
    expect(p.gear).toEqual({ pump: true, warningHorn: false, pumpHz: 240 });
    expect(p.vibration!.rpm100).toBe(AH56_NR_100);
  });

  it('the AH-56A\'s frequencies at 100 % (research-ah56 section 15): 16.4 / 82.5 / 85.9 / 32.8 / 2.05 Hz, AMCS 16.0', () => {
    expect(AH56_TARGET_HZ.rotor).toBeCloseTo(16.4, 1);
    expect(AH56_TARGET_HZ.rotor * AH56_AMCS_NR_FRACTION).toBeCloseTo(16.0, 1);
    expect(AH56_TARGET_HZ.tailRotor).toBeCloseTo(82.5, 1);
    expect(AH56_TARGET_HZ.pusher).toBeCloseTo(85.85, 1);
    // The pusher beats against the tail rotor at about 3 Hz.
    expect(AH56_TARGET_HZ.pusher - AH56_TARGET_HZ.tailRotor).toBeCloseTo(3.35, 1);
    expect(AH56_TARGET_HZ.vibration8P).toBeCloseTo(32.8, 1);
    expect(AH56_TARGET_HZ.halfP).toBeCloseTo(2.05, 2);
    // The pusher's static tip Mach 0.81 (899 ft/s) and the rotor's advancing tip Mach 0.885 at 194 KTAS.
    expect((Math.PI * D.PUSHER_RADIUS * 2 * PROP_RPM) / 60 / SPEED_OF_SOUND).toBeCloseTo(0.81, 2);
    expect(advancingTipMach(AH56_NR_100, 194 * KT, SPEED_OF_SOUND, D.MAIN_ROTOR_RADIUS * 2)).toBeCloseTo(0.885, 2);
  });

  it('is plain data (structuredClone and JSON)', () => {
    for (const p of [AH56_AUDIO, LANDED_AUDIO]) {
      expect(structuredClone(p)).toEqual(p);
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    }
  });
});

describe('AH-56A voices (the landed profile)', () => {
  it('the T64 whines on Ng: its compressor tone at 13 x the shaft rate (3.9 kHz at 100 %, ESTIMATE speed)', () => {
    for (const fraction of [0.65, 0.9]) {
      const x = stems({ rpm: ng(fraction), firing: 1, load: 0.6 })[STEM.engine];
      const f = (13 * ng(fraction)) / 60;
      expect(toneMagnitude(x, f), `${fraction}`).toBeGreaterThan(20 * toneMagnitude(x, 1.03 * f));
    }
  }, 60_000);

  it('the rotor beats at 16.4 Hz, the tail rotor at 82.5 Hz and the pusher at 85.9 Hz, beating against each other at about 3.4 Hz', () => {
    const prop = stems(HOVER, 5)[STEM.prop];
    expect(toneMagnitude(prop, AH56_TARGET_HZ.rotor)).toBeGreaterThan(10 * toneMagnitude(prop, 20));
    expect(toneMagnitude(prop, AH56_TARGET_HZ.tailRotor)).toBeGreaterThan(5 * toneMagnitude(prop, 78));
    expect(toneMagnitude(prop, AH56_TARGET_HZ.pusher)).toBeGreaterThan(5 * toneMagnitude(prop, 91));
    // The two tones' sum swells and fades at their difference: the 70-100 Hz band's loudness beats at 3.35 Hz.
    const env = envelope(band(prop, 70, 100), 0.01);
    const beat = AH56_TARGET_HZ.pusher - AH56_TARGET_HZ.tailRotor;
    expect(toneMagnitude(env, beat, 100)).toBeGreaterThan(4 * toneMagnitude(env, 5.5, 100));
  }, 60_000);

  it('the pusher grows louder with |thrust| and with blade angle, and is silent when it does not turn', () => {
    const level = (load: number, pitch: number): number => dbfs(rms(stems({ ...pusher(load, pitch) })[STEM.prop]));
    expect(level(1, 0.3) - level(0.05, 0)).toBeGreaterThan(4);
    expect(level(1, 0.9) - level(1, 0.3)).toBeGreaterThan(1);
    expect(peak(stems({ ...pusher(1, 0.5), pusherRpm: 0 })[STEM.prop])).toBe(0);
  }, 60_000);

  it('roars in reverse pitch: a low, rough band well above the blade passage', () => {
    const roar = (rev: number): number => rms(band(stems({ ...pusher(0.8, 0, rev) })[STEM.prop], 150, 1200));
    expect(db(roar(1.2), roar(0))).toBeGreaterThan(6);
  }, 60_000);

  it('a profile without a pusher plays nothing on its parameters (the MD 500E)', () => {
    expect(peak(stems(pusher(1, 1, 1), 2, MD500_AUDIO)[STEM.prop])).toBe(0);
  }, 30_000);

  it('the rotor cracks as the advancing tip nears Mach 0.9 (high-speed impulsive noise), and not below its onset', () => {
    const rotorOnly = { propRpm: AH56_NR_100, tipMach: 0.66, propLoad: 0.6 };
    const hf = (adv: number): number => rms(band(stems({ ...rotorOnly, advTipMach: adv })[STEM.prop], 150, 2000));
    const none = hf(0);
    expect(hf(0.8) / none).toBeCloseTo(1, 3);
    // 194 KTAS (advancing tip 0.885): the crack lifts the rotor's 150-2000 Hz band by 5 dB or more; at 0.92 by 9 dB.
    expect(db(hf(0.885), none)).toBeGreaterThan(5);
    expect(db(hf(0.92), none)).toBeGreaterThan(9);
    // The crack is once per blade passage: its band's loudness beats at 16.4 Hz.
    const env = envelope(band(stems({ ...rotorOnly, advTipMach: 0.9 }, 4)[STEM.prop], 150, 2000), 0.005);
    expect(toneMagnitude(env, AH56_TARGET_HZ.rotor, 200)).toBeGreaterThan(5 * toneMagnitude(env, 23, 200));
  }, 60_000);

  it('the 8P hum at 32.8 Hz in the cockpit (cabin stem), with its buzz at 65.6 Hz', () => {
    const x = stems({ vibration: 1, vibrationHz: AH56_TARGET_HZ.vibration8P })[STEM.cabin];
    expect(toneMagnitude(x, 32.8)).toBeGreaterThan(20 * toneMagnitude(x, 40));
    expect(toneMagnitude(x, 65.6)).toBeGreaterThan(10 * toneMagnitude(x, 75));
    expect(peak(stems({ vibration: 0, vibrationHz: 32.8 })[STEM.cabin])).toBe(0);
  }, 60_000);

  it('the half-P hop: a low rumble thumping at 2.05 Hz, stronger with the amplitude', () => {
    const run = (amp: number): Float32Array => stems({ halfP: amp, halfPHz: AH56_TARGET_HZ.halfP }, 6)[STEM.cabin];
    const x = run(1);
    const env = envelope(band(x, 20, 120), 0.02);
    expect(toneMagnitude(env, 2.05, 50)).toBeGreaterThan(5 * toneMagnitude(env, 3.3, 50));
    expect(db(rms(run(1.5)), rms(run(0.5)))).toBeGreaterThan(6);
    expect(peak(run(0))).toBe(0);
  }, 60_000);

  it('the gear motor runs while a leg is in transit (wheels only), and the lock thumps', () => {
    const motor = stems({ gearPump: 1 })[STEM.cabin];
    expect(toneMagnitude(motor, 240)).toBeGreaterThan(10 * toneMagnitude(motor, 270));
    // On skids (the stub) there is no gear voice: the same parameter is silent.
    expect(peak(stems({ gearPump: 1 }, 2, AH56_AUDIO)[STEM.cabin])).toBe(0);
    const host = new SynthHost(LANDED_AUDIO).set({});
    host.message({ type: 'thump', amp: TAIL_WHEEL_LOCK_THUMP });
    expect(peak(host.render(0.5)[STEM.airframe])).toBeGreaterThan(0.01);
  }, 60_000);
});

describe('AH-56A mix', () => {
  it('hover, a hard pedal turn and a 190 KTAS cruise: in the cockpit window of the C172S (-17 .. -9 dBFS), nothing clips', () => {
    for (const [name, params] of [['hover', HOVER], ['pedal', { ...HOVER, ...tail(2) }], ['cruise', CRUISE]] as const) {
      const all = new SynthHost(LANDED_AUDIO).set(params).render(4);
      const inside = interiorMix(all, LANDED_AUDIO);
      const level = dbfs(rms(inside, SR));
      expect(level, name).toBeGreaterThan(-17);
      expect(level, name).toBeLessThan(-9);
      expect(dbfs(peak(inside.subarray(SR))), name).toBeLessThan(-2);
      expect(dbfs(peak(exteriorMix(all, 15, LANDED_AUDIO).subarray(SR))), name).toBeLessThan(-1);
    }
  }, 90_000);

  it('the reverse roar on the landing roll stays inside the window too', () => {
    const roll = { ...HOVER, propLoad: 0.3, ...pusher(0.8, 0, 1.2), rolling: 0.5, rollSpeed: 15 };
    const inside = interiorMix(new SynthHost(LANDED_AUDIO).set(roll).render(4), LANDED_AUDIO);
    expect(dbfs(rms(inside, SR))).toBeLessThan(-9);
    expect(dbfs(peak(inside.subarray(SR)))).toBeLessThan(-2);
  }, 60_000);
});

describe('AH-56A mapping', () => {
  const sound = (): SoundContext => ({ surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 0 });
  /** An AH-56A at 246 rpm with its pusher state (AC) and the half-P state (AH). */
  const flying = (edit: (r: RotorcraftState, s: AircraftState) => void = () => undefined): AircraftState => {
    const s = makeMockState();
    s.electrical.busVoltage = 28;
    s.tas = 0;
    s.ias = 0;
    const r = emptyRotorcraftState();
    Object.assign(r, { rotorRpm: AH56_NR_100, thrust: 81_000, tailThrust: -LANDED_AUDIO.tailRotor!.hoverThrustN });
    r.pusher = { lever: 0.2, beta: AH56_PROP_BETA_DEG.hoverDetent * DEG, betaCommand: AH56_PROP_BETA_DEG.hoverDetent * DEG, deltaBeta: false, rpm: 0, thrust: 0, torque: 0 };
    r.events = { halfPHop: { active: false, amplitude: 0, phase: 0, stirs: 0, strike: false } };
    s.rotorcraft = r;
    Object.assign(s.propeller, { rpm: AH56_NR_100, thrust: 81_000 });
    edit(r, s);
    return s;
  };
  const fill = (s: AircraftState, profile: AudioProfile = LANDED_AUDIO): Float32Array => {
    const c = defaultControls();
    c.masterBattery = true;
    return fillSynthParams(s, c, sound(), makeParamBlock(), profile);
  };

  it('the pusher turns at ratio x Nr whatever its state reports; loading, tip Mach, blade angle; silent without its state', () => {
    const out = fill(flying());
    expect(out[P.pusherRpm]).toBe(Math.fround(AH56_NR_100 * AH56_PROP_RATIO));
    expect(out[P.pusherRpm]).toBeCloseTo(1717, 0);
    expect(out[P.pusherLoad]).toBe(0);
    expect(out[P.pusherTipMach]).toBeCloseTo(0.81, 2);
    expect(out[P.pusherPitch]).toBe(0);
    expect(out[P.pusherReverse]).toBe(0);
    // Forward: 15 kN at +30 deg in a 190 KTAS cruise.
    const fwd = pusherSound(flying((r, s) => { r.pusher!.beta = 30 * DEG; r.pusher!.thrust = 15_000; s.tas = 97.7; }), SPEED_OF_SOUND, LANDED_AUDIO);
    expect(fwd.load).toBeCloseTo(1, 6);
    expect(fwd.pitch).toBeCloseTo((30 + 2.2) / (40.8 + 2.2), 6);
    expect(fwd.tipMach).toBeCloseTo(0.855, 2);
    expect(fwd.reverse).toBe(0);
    // Full reverse on the landing roll: -17.2 deg, 6 kN backwards.
    const rev = pusherSound(flying((r) => { r.pusher!.beta = AH56_PROP_BETA_DEG.min * DEG; r.pusher!.thrust = -6000; }), SPEED_OF_SOUND, LANDED_AUDIO);
    expect(rev.reverse).toBeCloseTo(1 * (0.2 + 6000 / 15_000), 6);
    expect(rev.pitch).toBe(0);
    // No pusher state (the stub today, and every type before): silent.
    expect(fill(flying((r) => delete r.pusher))[P.pusherRpm]).toBe(0);
    expect(fill(flying(), MD500_AUDIO)[P.pusherRpm]).toBe(0);
  });

  it('the advancing-tip Mach number for the rotor\'s crack: (Omega R + V) / a', () => {
    const out = fill(flying((_r, s) => { s.tas = 194 * KT; }));
    expect(out[P.advTipMach]).toBeCloseTo(0.885, 2);
    expect(fill(flying((_r, s) => { s.tas = 194 * KT; }), MD500_AUDIO)[P.advTipMach]).toBe(0);
  });

  it('the 8P hum: 32.8 Hz at 246 rpm, growing with airspeed and rotor speed', () => {
    const at = (kias: number, rpm = AH56_NR_100): number[] => {
      const o = fill(flying((r, s) => { s.ias = kias * KT; r.rotorRpm = rpm; }));
      return [o[P.vibration], o[P.vibrationHz]];
    };
    expect(at(0)[1]).toBeCloseTo(32.8, 1);
    expect(at(0)[0]).toBeCloseTo(0.35, 6);
    expect(at(90)[0]).toBeCloseTo(0.35 + 0.65 * 0.25, 6);
    expect(at(200)[0]).toBeCloseTo(1, 6);
    expect(at(200, 0.5 * AH56_NR_100)[0]).toBeCloseTo(0.25, 6);
    expect(at(200, 0)[0]).toBe(0);
  });

  it('the half-P thump from events.halfPHop.amplitude, at 0.5 x the rotor rate (2.05 Hz at 246 rpm)', () => {
    expect(fill(flying())[P.halfP]).toBe(0);
    const out = fill(flying((r) => Object.assign(r.events!.halfPHop!, { active: true, amplitude: 1.2 })));
    expect(out[P.halfP]).toBeCloseTo(1.2, 6);
    expect(out[P.halfPHz]).toBeCloseTo(2.05, 2);
    expect(fill(flying((r) => Object.assign(r.events!.halfPHop!, { amplitude: 9 })))[P.halfP]).toBe(2);
  });
});

describe('FLAWS voice warnings', () => {
  const VOICE = LANDED_AUDIO.voiceWarnings!;
  const at = (pct: number, volts = 28): AircraftState => {
    const s = makeMockState();
    s.electrical.busVoltage = volts;
    const r = emptyRotorcraftState();
    r.rotorRpm = (pct / 100) * AH56_NR_100;
    s.rotorcraft = r;
    return s;
  };
  class Recorder implements Speaker {
    readonly spoken: { text: string; volume: number }[] = [];
    cancels = 0;
    speak(text: string, volume: number): void {
      this.spoken.push({ text, volume });
    }
    cancel(): void {
      this.cancels++;
    }
  }

  it('words (ESTIMATE): engine fire, rotor rpm, master caution, in that priority', () => {
    expect(VOICE.messages.map((m) => m.text)).toEqual(['Engine fire', 'Rotor RPM', 'Master caution']);
    expect(VOICE.repeatSeconds).toBe(3);
  });

  it('ROTOR RPM: armed once the rotor has reached 95 %, then outside 95-105 %, on the bus; disarmed below 50 %', () => {
    const armed = [false, false, false];
    const active = (pct: number, volts = 28): boolean => activeMessages(at(pct, volts), volts > 18, VOICE, armed, false)[1];
    // A start: the rotor coming up through 30-90 % is not a warning.
    expect([30, 60, 90].map((p) => active(p))).toEqual([false, false, false]);
    expect(active(100)).toBe(false);
    expect(active(93)).toBe(true);
    expect(active(106)).toBe(true);
    expect(active(93, 10)).toBe(false);
    // A shutdown: below 50 % it disarms and stays quiet on the way down.
    expect(active(ROTOR_RPM_DISARM_PCT - 1)).toBe(false);
    expect(active(70)).toBe(false);
    // ENGINE FIRE never (no state reports a fire).
    expect(activeMessages(at(100), true, VOICE, armed, true)).toEqual([false, false, true]);
  });

  it('speaks at once, repeats every 3 s while the condition holds, one message at a time, the higher priority first', () => {
    const rec = new Recorder();
    const w = new VoiceWarner(VOICE, rec);
    const run = (pct: number, seconds: number): void => {
      for (let t = 0; t < seconds - 1e-9; t += 0.1) w.update(at(pct), true, 0.1, 0.8);
    };
    run(100, 1);
    expect(rec.spoken).toEqual([]);
    run(92, 0.15);
    expect(rec.spoken).toEqual([{ text: 'Rotor RPM', volume: 0.8 * 0.9 }]);
    run(92, 6.9);
    expect(rec.spoken.map((s) => s.text)).toEqual(['Rotor RPM', 'Rotor RPM', 'Rotor RPM']);
    // A caution while the rotor warning holds: said after the rotor warning's words, before its next repeat.
    w.noteCaution();
    run(92, speechSeconds('Rotor RPM') + 0.2);
    expect(rec.spoken.at(-1)!.text).toBe('Master caution');
    // Back in the band: silent.
    const n = rec.spoken.length;
    run(100, 10);
    expect(rec.spoken).toHaveLength(n);
    // Muted (volume 0): the warner keeps time but says nothing.
    run(92, 5);
    const m = rec.spoken.length;
    run(100, 1);
    for (let t = 0; t < 5; t += 0.1) w.update(at(92), true, 0.1, 0);
    expect(rec.spoken).toHaveLength(m);
    w.silence();
    expect(rec.cancels).toBe(1);
  });

  it('the browser speaker: an utterance at the volume given; cancel() only while its own words are pending', () => {
    const spoken: { text: string; volume: number; rate: number; pitch: number; onend: (() => void) | null }[] = [];
    let cancels = 0;
    class Utterance {
      volume = 1; rate = 1; pitch = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    const speaker = browserSpeaker({ speechSynthesis: { speak: (u) => void spoken.push(u as never), cancel: () => void cancels++ }, SpeechSynthesisUtterance: Utterance as never })!;
    speaker.cancel();
    expect(cancels).toBe(0);
    speaker.speak('Rotor RPM', 0.5);
    expect(spoken[0]).toMatchObject({ text: 'Rotor RPM', volume: 0.5 });
    speaker.cancel();
    expect(cancels).toBe(1);
    speaker.speak('Master caution', 0.5);
    spoken[1].onend!();
    speaker.cancel();
    expect(cancels).toBe(1);
    // Node has no speech synthesis: no speaker.
    expect(browserSpeaker({})).toBeNull();
  });
});

describe('AudioSystem with the AH-56A', () => {
  let posted: unknown[] = [];
  function standIn() {
    return class {
      readonly port = { postMessage: (m: unknown) => void posted.push(m) };
      constructor() {
        const param = { value: 0, setTargetAtTime: () => undefined, setValueAtTime: () => undefined, cancelScheduledValues: () => undefined, linearRampToValueAtTime: () => undefined };
        for (const name of ['gain', 'frequency', 'delayTime', 'pan']) Object.assign(this, { [name]: { ...param } });
      }
      connect(node: unknown): unknown {
        return node;
      }
      disconnect(): void {}
    };
  }
  class FakeContext {
    currentTime = 0;
    state = 'running';
    sampleRate = 48000;
    destination = new (standIn())();
    audioWorklet = { addModule: async () => undefined };
    addEventListener(): void {}
    resume = async () => undefined;
    suspend = async () => undefined;
    close = async () => undefined;
  }
  beforeEach(() => {
    posted = [];
    vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal('AudioContext', FakeContext);
    for (const n of ['AudioWorkletNode', 'GainNode', 'BiquadFilterNode', 'DelayNode', 'StereoPannerNode', 'DynamicsCompressorNode']) vi.stubGlobal(n, standIn());
  });
  afterEach(() => vi.unstubAllGlobals());

  async function started(speaker: Speaker): Promise<{ audio: AudioSystem; ctx: SimContext }> {
    const state = makeMockState();
    state.electrical.busVoltage = 28;
    const r = emptyRotorcraftState();
    r.rotorRpm = LANDED.referenceRpm;
    state.rotorcraft = r;
    const ctx = {
      paused: false,
      events: createEventBus(),
      state,
      controls: defaultControls(),
      env: { surface: () => 'runway', atmosphere: () => ({ speedOfSound: 340 }) },
      weather: defaultWeather(),
      camera: new THREE.PerspectiveCamera(),
      cameraMode: 'cockpit',
    } as unknown as SimContext;
    const audio = new AudioSystem({ profile: LANDED_AUDIO, speaker });
    audio.init(ctx);
    await audio.start();
    return { audio, ctx };
  }

  it('speaks ROTOR RPM from the frame loop and MASTER CAUTION on a caution chime; silent when paused', async () => {
    const spoken: string[] = [];
    let cancels = 0;
    const { audio, ctx } = await started({ speak: (t) => void spoken.push(t), cancel: () => void cancels++ });
    audio.update(0.1, ctx);
    expect(spoken).toEqual([]);
    ctx.state.rotorcraft!.rotorRpm = 0.9 * LANDED.referenceRpm;
    audio.update(0.1, ctx);
    expect(spoken).toEqual(['Rotor RPM']);
    ctx.state.rotorcraft!.rotorRpm = LANDED.referenceRpm;
    audio.caws('caution');
    for (let i = 0; i < 20; i++) audio.update(0.1, ctx);
    expect(spoken).toEqual(['Rotor RPM', 'Master caution']);
    ctx.events.emit('paused', { paused: true });
    expect(cancels).toBe(1);
    audio.dispose();
  });

  it('the tail-wheel lock clunks when it changes (not at the first frame)', async () => {
    const { audio, ctx } = await started({ speak: () => undefined, cancel: () => undefined });
    ctx.controls.tailWheelLock = true;
    audio.update(0.1, ctx);
    const thumps = (): unknown[] => posted.filter((m) => (m as { type?: string }).type === 'thump');
    expect(thumps()).toEqual([]);
    ctx.controls.tailWheelLock = false;
    audio.update(0.1, ctx);
    expect(thumps()).toEqual([{ type: 'thump', amp: TAIL_WHEEL_LOCK_THUMP }]);
    audio.update(0.1, ctx);
    expect(thumps()).toHaveLength(1);
    audio.dispose();
  });
});
