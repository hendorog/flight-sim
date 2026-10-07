// AudioWorklet: procedural light-aircraft sound. Plain JavaScript, loaded as text (?raw) and started from a
// Blob URL. synthSource.ts prepends `const P = {...}; const PARAM_COUNT = n; const ENGINE_P = [...];
// const DEFAULT_PROFILE = {...};` (parameter indices shared with the main thread, see params.ts; the sound
// profile of the Cessna 172S, see profile.ts).
//
// The engine and propeller voices are built from a sound profile (AudioProfile), one pair per engine. Without
// a message the profile is DEFAULT_PROFILE, the Cessna 172S; `{ type: 'config', profile }` rebuilds them for
// another type (the processor is registered once per context, so a new type is a message).
//
// A profile with ONE engine is synthesised as the Cessna 172S always was: harmonic weights and loudness
// evaluated per sample, the blade passage of a direct-drive propeller locked to the crank angle, every noise
// drawn from the shared sources in a fixed order. A profile with TWO engines evaluates those weights once per
// render quantum and ramps to them (the cost of the second voice), and every voice after the first has noise
// sources of its own, so adding one cannot shift the sequence of anything else.
//
// Four mono outputs (stems), mixed and spatialised on the main thread:
//   0 engine   - exhaust pulses of a piston engine (C172S: a flat-four, even 180-degree firing, two per crank
//                revolution) with cycle-to-cycle variation, exhaust-system resonances, intake roar, valve-train
//                ticks, starter motor and compression chug, start stumble / shutdown misfires, idle lope;
//                a diesel's sharper pulse and combustion knock, a turbocharger's whine
//   1 prop     - blade-passage harmonics (phase-locked to the crank on a direct-drive engine, on the
//                propeller's own shaft angle behind a reduction gear) plus broadband tip noise rising with
//                tip Mach, amplitude-modulated at blade passage
//   2 airframe - wind, sideslip whistle, flap flow noise, stall buffet, tyre rolling by surface, brake
//                squeal, tyre skid, touchdown chirps, crash, the flow over an extended landing gear and the
//                thump of its locks
//   3 cabin    - stall warning (a reed horn or an electric tone), flap motor, instrument gyros, avionics
//                fan, landing-gear pump and gear warning (a beeping horn or a repeating chime)
//
// Every parameter is smoothed per sample (one-pole, ~30 ms) so frame-rate parameter updates never zipper,
// and every transient has an attack ramp so nothing clicks.

const SR = sampleRate;
const TAU = Math.PI * 2;

/** xorshift32 white noise in [-1, 1). */
class Noise {
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s >>> 0;
    return this.s / 2147483648 - 1;
  }
}

/** Pink-ish noise (Paul Kellet's economy filter), roughly unit RMS. */
class Pink {
  constructor(seed) {
    this.w = new Noise(seed);
    this.b0 = this.b1 = this.b2 = 0;
  }
  next() {
    const w = this.w.next();
    this.b0 = 0.99765 * this.b0 + w * 0.099046;
    this.b1 = 0.963 * this.b1 + w * 0.2965164;
    this.b2 = 0.57 * this.b2 + w * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.35;
  }
}

/**
 * Topology-preserving-transform state-variable filter (Simper / Zavalishin). Stable under fast
 * cutoff modulation, which is why it is used everywhere here instead of biquads. The band output has a
 * peak gain of Q (constant skirt), so narrow resonators ring louder; levels below are set with that in mind.
 */
class SVF {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.low = 0;
    this.band = 0;
    this.high = 0;
    this.set(1000, 0.707);
  }
  set(fc, q) {
    const g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  process(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = v0 - this.k * v1 - v2;
    return v1;
  }
}

const expCoef = (tau) => Math.exp(-1 / (tau * SR));
/** Standard normal-ish sample (sum of uniforms). */
const gauss = (n) => (n.next() + n.next() + n.next()) * 0.577;

/**
 * One piston engine, built from an EngineSoundProfile: exhaust pulses per cylinder with cycle-to-cycle
 * variation, the exhaust-system resonances, intake roar, valve-train ticks, starter motor and compression
 * chug, start stumble / shutdown misfires, idle lope. `noise` is the source it draws from, a fixed number of
 * times per sample and in a fixed order; `ix` the indices of its parameters (an entry of ENGINE_P);
 * `blockRate` selects the loudness evaluated once per render quantum (prepare) instead of per sample.
 */
class EngineVoice {
  constructor(profile, noise, ix = ENGINE_P[0], blockRate = false) {
    this.noise = noise;
    this.blockRate = blockRate;
    this.iRpm = ix.rpm;
    this.iFiring = ix.firing;
    this.iLoad = ix.load;
    this.iThrottle = ix.throttle;
    this.iStarter = ix.starter;
    this.iRoughness = ix.roughness;
    this.iTurbo = ix.turbo;
    this.cylinders = profile.cylinders;
    // Firing strokes per crank revolution (a four-stroke engine fires every cylinder once in two revolutions),
    // and the crank angle between two of them, revolutions.
    this.perRev = profile.cylinders / 2;
    this.spacing = 2 / profile.cylinders;
    // Small per-cylinder timing and strength differences (unequal exhaust runners, mixture distribution) give
    // the characteristic lumpy beat. C172S: firing order 1-3-2-4 at even 180-degree intervals.
    this.cylOffset = profile.firingOffsets;
    this.cylGain = profile.cylGains;
    // Compression ignition: the charge burns at once when it lights, so the pressure rises several times
    // faster than behind a spark's flame front. That is a shorter exhaust pulse and a hard broadband knock
    // per firing, strongest relative to the exhaust note at idle. Injection is metered per cycle and the idle
    // speed is governed, so combustion is regular: little cycle-to-cycle variation and no idle lope.
    const diesel = profile.combustion === 'diesel';
    /** Exhaust pulse length: its share of the firing interval and its floor, s. */
    this.pulseShare = diesel ? 0.22 : 0.35;
    this.pulseMin = diesel ? 0.0012 : 0.0018;
    /** Combustion noise burst per firing: strength at no load and its growth with load, decay (s), band (Hz). */
    this.burstBase = diesel ? 1.4 : 0.25;
    this.burstPerLoad = diesel ? 0.5 : 0.6;
    this.burstTau = diesel ? 0.0015 : 0.0025;
    this.burstTauPerLoad = diesel ? 0.001 : 0.002;
    this.burstHz = diesel ? 2400 : 1400;
    this.burstHzPerLoad = diesel ? 600 : 900;
    /** Cycle-to-cycle variation of the pulse strength: at speed, and the extra at idle. */
    this.ccvBase = diesel ? 0.03 : 0.06;
    this.ccvIdle = diesel ? 0.06 : 0.2;
    this.idleLopeRpm = diesel ? 0 : profile.idleLopeRpm;
    // Turbocharger: a whine at the rotor's speed, which follows the exhaust energy with the rotor's inertia.
    this.turboHz = profile.turbo ? profile.turbo.hzAtFullLoad : 0;
    this.turboLevel = profile.turbo ? profile.turbo.level : 0;
    this.spool = 0;
    this.turboPh = 0;
    this.exhaust = profile.exhaust;
    this.exGain = profile.exhaust.map((x) => x.gain);
    this.level = profile.level;

    this.phase = 0; // crank angle in revolutions, 0..2 (one four-stroke cycle)
    this.nextCyl = 0;
    this.fireEnv = 0;
    this.pulseAge = 1;
    this.pulseLen = 0.005;
    this.pulseAmp = 0;
    this.burstEnv = 0;
    this.tickEnv = 0;
    this.popEnv = 0;
    this.lope = 0;
    this.lopeTarget = 0;
    this.lopeCount = 0;
    this.burstDecay = 0.99;
    this.motorPh = 0;
    this.exRes = profile.exhaust.map(() => new SVF());
    this.burstF = new SVF();
    this.intakeF = new SVF();
    this.tickF = new SVF();
    this.grindF = new SVF();
    this.dcIn = 0;
    this.dcOut = 0;
    // Block-rate path: saturation drive and loudness, ramped across the render quantum.
    this.drive = 1;
    this.driveStep = 0;
    this.loud = 0.32;
    this.loudStep = 0;
  }

  /** Start at another crank angle (revolutions, 0..2): two engines are never in step. */
  startAt(phase) {
    this.phase = phase;
    this.nextCyl = Math.ceil(phase / this.spacing) % this.cylinders;
  }

  /** Block-rate path: the drive and loudness this render quantum of `n` samples ramps to (`v`: the parameters at its end). */
  prepare(v, n) {
    const load = v[this.iLoad];
    this.driveStep = (1 + 1.5 * load - this.drive) / n;
    this.loudStep = (0.32 + 0.68 * Math.pow(Math.min(1.2, load), 0.75) - this.loud) / n;
  }

  /** Block-rate filter setup from the current smoothed crank speed (rev/s) and load. */
  tune(rps0, load0) {
    // C172S: the tailpipe quarter-wave shifts a little with gas temperature / flow, the other two with load.
    for (let k = 0; k < this.exRes.length; k++) {
      const x = this.exhaust[k];
      this.exRes[k].set(x.hz + rps0 * x.perRps + load0 * x.perLoad, x.q);
    }
    this.burstF.set(this.burstHz + load0 * this.burstHzPerLoad, 1.2);
    this.intakeF.set(380 + rps0 * 6, 1.4);
    this.tickF.set(4200, 1.5);
    this.grindF.set(2300, 2.5);
  }

  sample(v) {
    const nz = this.noise;
    const starter = v[this.iStarter];
    // Combustion envelope: rises over ~0.6 s on start (misfires while it is partial), falls fast on shutdown.
    const firing = v[this.iFiring];
    this.fireEnv += (firing - this.fireEnv) * (firing > this.fireEnv ? 1 / (0.6 * SR) : 1 / (0.12 * SR));

    let rpm = v[this.iRpm];
    // Idle lope: slow random speed wander at low rpm (uneven idle combustion).
    if (++this.lopeCount > SR / 3) {
      this.lopeCount = 0;
      this.lopeTarget = nz.next();
    }
    this.lope += (this.lopeTarget - this.lope) * (1 / (0.25 * SR));
    const lopeDepth = 0.035 * Math.max(0, Math.min(1, (this.idleLopeRpm - rpm) / 500)) * this.fireEnv;
    // Cranking: the starter slows on each compression stroke (C172S: two per revolution).
    const crank = starter * (1 - this.fireEnv);
    const chug = 1 + 0.35 * crank * Math.sin(TAU * this.perRev * this.phase);
    rpm *= (1 + lopeDepth * this.lope) * chug;

    const rps = rpm / 60;
    const prevPhase = this.phase;
    this.phase += rps / SR;
    if (this.phase >= 2) this.phase -= 2;

    // Firing events at even intervals (C172S: 0, 0.5, 1.0, 1.5 revolutions) plus per-cylinder offsets.
    const ev = this.nextCyl * this.spacing + this.cylOffset[this.nextCyl];
    const crossed = prevPhase <= this.phase ? prevPhase < ev && this.phase >= ev : prevPhase < ev || this.phase >= ev;
    if (crossed && rps > 0.5) this.fire(this.nextCyl, v, rps);

    let out = 0;
    // Exhaust blowdown pulse (raised cosine) and the exhaust-system ringing it excites.
    let pulse = 0;
    if (this.pulseAge < this.pulseLen) {
      const s = Math.sin((Math.PI * this.pulseAge) / this.pulseLen);
      pulse = this.pulseAmp * s * s;
      this.pulseAge += 1 / SR;
    }
    let ex = pulse * 0.9;
    for (let k = 0; k < this.exRes.length; k++) ex += this.exRes[k].process(pulse) * this.exGain[k];
    // Combustion roar: short noise burst per firing, brighter with load.
    this.burstEnv *= this.burstDecay;
    const burst = this.burstF.process(nz.next() * this.burstEnv);
    // Afterfire pop on misfire during start or shutdown.
    this.popEnv *= 0.9985;
    const pop = this.popEnv * (nz.next() * 0.6 + (this.popEnv > 0.5 ? 0.4 : 0));
    ex += burst * 0.9;
    // High-amplitude exhaust pulses steepen (nonlinear propagation): soft saturation brightens full power.
    // Exhaust sound power grows with the mass flow (manifold pressure x rpm): a C172 idles ~15 dB quieter
    // than it runs at full power, more than the pulse shape alone gives.
    let drive;
    let loudness;
    if (this.blockRate) {
      drive = this.drive += this.driveStep;
      loudness = this.loud += this.loudStep;
    } else {
      drive = 1 + 1.5 * v[this.iLoad];
      loudness = 0.32 + 0.68 * Math.pow(Math.min(1.2, v[this.iLoad]), 0.75);
    }
    ex = Math.tanh(ex * drive) / drive;
    out += ex * loudness + pop;

    // Intake roar: band-limited noise pulsing with the intake strokes, grows with throttle opening.
    const intakeMod = 0.55 + 0.45 * Math.cos(TAU * this.perRev * this.phase + 1.3);
    out += this.intakeF.process(nz.next()) * v[this.iThrottle] * Math.min(1, rps / 40) * intakeMod * 0.35 * loudness;

    // Valve train: a tick per valve event, plus first-order (once per rev) mechanical rumble.
    this.tickEnv *= 0.992;
    this.tickF.process(nz.next() * this.tickEnv);
    out += this.tickF.band * 0.05 * Math.min(1, rps / 20);
    out += Math.sin(TAU * this.phase) * 0.02 * Math.min(1, rps / 10);

    // Starter motor: commutator whine (~24 bars at ~13x crank speed) and pinion grind.
    if (starter > 0.001) {
      this.motorPh += (Math.max(rps, 2) * 13 * 24) / SR;
      if (this.motorPh > 1) this.motorPh -= 1;
      const whine = Math.sin(TAU * this.motorPh) + 0.35 * Math.sin(TAU * 2 * this.motorPh);
      const grind = this.grindF.process(nz.next());
      out += starter * (whine * 0.08 + grind * 0.16) * (2 - chug);
    }

    // Turbocharger whine: the rotor takes about half a second to follow the exhaust energy; the tone is at
    // the rotor's speed and grows with the square of it.
    if (this.turboLevel > 0) {
      this.spool += (v[this.iTurbo] - this.spool) * (1 / (0.5 * SR));
      this.turboPh += (this.turboHz * this.spool) / SR;
      if (this.turboPh > 1) this.turboPh -= 1;
      const ph = TAU * this.turboPh;
      out += (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * this.turboLevel * this.spool * this.spool;
    }

    // DC blocker (the pulses are unipolar).
    const y = out - this.dcIn + 0.995 * this.dcOut;
    this.dcIn = out;
    this.dcOut = y;
    return y * 0.6 * this.level;
  }

  fire(cyl, v, rps) {
    const nz = this.noise;
    this.nextCyl = (cyl + 1) % this.cylinders;
    this.tickEnv = 1;
    const env = this.fireEnv;
    // Misfire probability: incomplete combustion while the envelope is partial (start/stop), plus roughness.
    const pFire = Math.pow(env, 0.6) * (1 - 0.35 * v[this.iRoughness]);
    const fired = nz.next() * 0.5 + 0.5 < pFire;
    // Cycle-to-cycle combustion variation is large at idle and small at cruise.
    const ccv = this.ccvBase + this.ccvIdle * Math.max(0, Math.min(1, (1300 - rps * 60) / 700)) + 0.15 * v[this.iRoughness];
    const load = v[this.iLoad];
    const interval = 1 / (this.perRev * rps);
    this.pulseLen = Math.min(0.012, Math.max(this.pulseMin, interval * this.pulseShare));
    this.pulseAge = 0;
    if (fired) {
      this.pulseAmp = (0.35 + 0.75 * load) * this.cylGain[cyl] * Math.max(0.2, 1 + ccv * gauss(nz));
      this.burstEnv = this.burstBase + this.burstPerLoad * load;
      this.burstDecay = expCoef(this.burstTau + this.burstTauPerLoad * load);
    } else {
      // Unfired: only the compression/pumping pulse of the air charge.
      this.pulseAmp = 0.1 * this.cylGain[cyl];
      this.burstEnv = 0.02;
      if (env > 0.05 && env < 0.97 && nz.next() > 0.7) this.popEnv = 0.6 + 0.4 * (nz.next() * 0.5 + 0.5);
    }
  }
}

/**
 * One propeller, built from a PropSoundProfile: blade-passage harmonics plus broadband tip noise rising with
 * tip Mach, amplitude-modulated at blade passage. On a direct-drive engine (`gearRatio` 1) the blade passage
 * is phase-locked to the crank of its engine; behind a reduction gear the propeller has its own shaft angle,
 * advanced by the propeller speed. `pink` is the noise source it draws from; `ix` the indices of its
 * parameters (an entry of ENGINE_P); `blockRate` selects the harmonic weights evaluated once per render
 * quantum (prepare) instead of per sample.
 */
class PropVoice {
  constructor(profile, pink, ix = ENGINE_P[0], gearRatio = 1, blockRate = false) {
    this.pink = pink;
    this.blockRate = blockRate;
    this.iTipMach = ix.tipMach;
    this.iPropLoad = ix.propLoad;
    this.iPropRpm = ix.propRpm;
    this.blades = profile.blades;
    this.level = profile.level;
    this.geared = gearRatio !== 1;
    this.phase = 0; // geared: propeller shaft angle in revolutions, 0..1
    this.tipF = new SVF();
    // Block-rate path: the eight harmonic amplitudes and the broadband level, ramped across the render quantum.
    this.w = new Float64Array(9);
    this.wStep = new Float64Array(9);
    this.broad = 0;
    this.broadStep = 0;
  }

  /** Block-rate path: the harmonic amplitudes and broadband level this render quantum of `n` samples ramps to (`v`: the parameters at its end). */
  prepare(v, n) {
    const tip = v[this.iTipMach];
    const load = v[this.iPropLoad];
    const m = Math.max(0, Math.min(1, (tip - 0.45) / 0.4));
    const slope = 1.9 - 0.9 * m;
    const toneLevel = (0.08 + 0.3 * load) * Math.pow(tip / 0.8, 3);
    for (let k = 1; k <= 8; k++) this.wStep[k] = (Math.pow(k, -slope) * toneLevel - this.w[k]) / n;
    this.broadStep = (Math.pow(tip / 0.8, 5) * (0.5 + 0.35 * load) - this.broad) / n;
  }

  /** Block-rate filter setup from the current smoothed tip Mach number. */
  tune(tip) {
    this.tipF.set(500 + 5200 * tip * tip, 0.8);
  }

  /** `crankPhase`: the crank angle of its engine, revolutions. */
  sample(v, crankPhase) {
    const tip = v[this.iTipMach];
    if (tip < 0.02) return 0;
    const load = v[this.iPropLoad];
    let bp;
    if (this.geared) {
      // Blade passage on the propeller's own shaft: the crank turns `gearRatio` times per propeller revolution.
      this.phase += v[this.iPropRpm] / (60 * SR);
      if (this.phase >= 1) this.phase -= 1;
      bp = TAU * this.blades * this.phase;
    } else {
      // Blade passage: every blade once per revolution of the crank (direct drive), phase-locked to the crank angle.
      bp = TAU * this.blades * crankPhase;
    }
    if (this.blockRate) {
      // The same eight harmonics sin(k (bp + 0.7)), by the recurrence s[k+1] = 2 cos(x) s[k] - s[k-1].
      const x = bp + 0.7;
      const twoCos = 2 * Math.cos(x);
      const w = this.w;
      const ws = this.wStep;
      let s0 = 0;
      let s1 = Math.sin(x);
      let tone = 0;
      for (let k = 1; k <= 8; k++) {
        tone += s1 * (w[k] += ws[k]);
        const s2 = twoCos * s1 - s0;
        s0 = s1;
        s1 = s2;
      }
      const broad = this.tipF.process(this.pink.next()) * (this.broad += this.broadStep) * (1 + 0.45 * Math.sin(bp));
      return (tone + broad * 0.5) * 0.7 * this.level;
    }
    // Harmonic roll-off flattens as tip Mach rises (thickness noise sharpens toward a sawtooth).
    const m = Math.max(0, Math.min(1, (tip - 0.45) / 0.4));
    const slope = 1.9 - 0.9 * m;
    let tone = 0;
    for (let k = 1; k <= 8; k++) tone += Math.sin(k * bp + k * 0.7) * Math.pow(k, -slope);
    const tipLevel = Math.pow(tip / 0.8, 3);
    const toneLevel = (0.08 + 0.3 * load) * tipLevel;
    // Broadband tip / trailing-edge noise, strongly Mach dependent, modulated at blade passage.
    const broad = this.tipF.process(this.pink.next()) * Math.pow(tip / 0.8, 5) * (0.5 + 0.35 * load) * (1 + 0.45 * Math.sin(bp));
    return (tone * toneLevel + broad * 0.5) * 0.7 * this.level;
  }
}

class AircraftSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.target = new Float32Array(PARAM_COUNT);
    this.value = new Float32Array(PARAM_COUNT);
    /** Block-rate path: the smoothed parameters as they will be at the end of the render quantum. */
    this.ahead = new Float32Array(PARAM_COUNT);
    this.primed = false;
    this.smooth = expCoef(0.03);
    this.port.onmessage = (e) => this.onMessage(e.data);

    this.noise = new Noise(0x9e3779b9);
    this.pink = new Pink(12345);
    this.pink2 = new Pink(777);
    // The landing-gear sounds draw from sources of their own: the sequences above are those of an aircraft without them.
    this.gearNoise = new Noise(0x51ed270b);
    this.gearPink = new Pink(4242);

    // Engine and propeller voices, and what else the profile sets.
    this.configure(DEFAULT_PROFILE);

    // Airframe
    this.windF = new SVF();
    this.windLowF = new SVF();
    this.slipF = new SVF();
    this.flapF = new SVF();
    this.buffetF = new SVF();
    this.buffetF2 = new SVF();
    this.gust = 0;
    this.gustTarget = 0;
    this.gustCount = 0;
    this.rollF = new SVF();
    this.hissF = new SVF();
    this.thumpEnv = 0;
    this.thumpTarget = 0;
    this.thumpPhase = 0;
    this.gravelEnv = 0;
    this.gravelF = new SVF();
    this.squealPhase = 0;
    this.squealPhase2 = 0;
    this.vibPhase = 0;
    this.skidF = new SVF();
    this.chirps = [];
    this.crash = null;
    this.gearF = new SVF();
    this.thumps = [];

    // Cabin
    this.hornPhase = 0;
    this.hornEnv = 0;
    this.hornF = new SVF();
    this.motorPhase = 0;
    this.motorSpin = 0;
    this.motorF = new SVF();
    this.gyroPhase1 = 0;
    this.gyroPhase2 = 0;
    this.fanF = new SVF();
    this.fanPhase = 0;
    this.pumpPhase = 0;
    this.pumpSpin = 0;
    this.pumpF = new SVF();
    this.gearHornPhase = 0;
    this.gearHornBeat = 0;
  }

  /**
   * Build the voices of an aircraft type from its AudioProfile. The first engine and its propeller draw from
   * the shared noise sources, in the order they always have; every further pair has sources of its own.
   */
  configure(profile) {
    const engines = profile.engines.slice(0, ENGINE_P.length);
    // Two engines: weights per render quantum (see the head of the file).
    const blockRate = engines.length > 1;
    this.blockRate = blockRate;
    this.voices = engines.map((e, i) => {
      const engine = new EngineVoice(e.engine, i === 0 ? this.noise : new Noise(0x7f4a7c15 + i), ENGINE_P[i], blockRate);
      const prop = new PropVoice(e.prop, i === 0 ? this.pink : new Pink(4711 + i), ENGINE_P[i], e.engine.gearRatio, blockRate);
      if (i > 0) engine.startAt((0.618 * i) % 2);
      // A turbocharger already turning (a change of type in flight) is not spooled up from rest.
      engine.spool = this.value[engine.iTurbo];
      return { engine, prop };
    });
    // Parameters smoothed per sample: up to the last one this profile reads (see params.ts for their order).
    this.hasGear = !!profile.gear;
    this.paramsUsed = P.turbulence + 1;
    if (this.hasGear) this.paramsUsed = P.gearWind + 1;
    if (engines.some((e) => e.engine.gearRatio !== 1 || e.engine.turbo)) this.paramsUsed = P.turbo + 1;
    if (engines.length > 1) this.paramsUsed = ENGINE_P[engines.length - 1].turbo + 1;
    // Stall warning: pitch at the threshold and its rise to full strength, Hz. An electric warner is a steady
    // tone at the first.
    this.hornBase = profile.stallWarner.baseHz;
    this.hornSweep = profile.stallWarner.sweepHz;
    this.hornElectric = profile.stallWarner.kind === 'electric';
    // Retractable landing gear: the warning (a beeping horn or a repeating chime) and the pitch of the hydraulic pump.
    const gear = profile.gear ?? {};
    this.gearChime = gear.warningKind === 'chime';
    this.gearHornHz = gear.warningHz ?? (this.gearChime ? 880 : 480);
    this.gearHornRate = (gear.warningPerMinute ?? (this.gearChime ? 60 : 90)) / 60;
    this.pumpHz = gear.pumpHz ?? 310;
  }

  onMessage(d) {
    if (d instanceof Float32Array) {
      this.target.set(d.subarray(0, PARAM_COUNT));
      if (!this.primed) {
        this.value.set(this.target);
        this.primed = true;
        // A start with the engines running: their turbochargers are at speed.
        for (const voice of this.voices) voice.engine.spool = this.value[voice.engine.iTurbo];
      }
    } else if (d.type === 'config') {
      this.configure(d.profile);
    } else if (d.type === 'chirp') {
      if (this.chirps.length < 6) {
        const f = new SVF();
        this.chirps.push({ age: 0, amp: d.amp, f });
      }
    } else if (d.type === 'thump') {
      if (this.hasGear && this.thumps.length < 6) {
        const f = new SVF();
        f.set(320, 2);
        this.thumps.push({ age: 0, amp: d.amp, f });
      }
    } else if (d.type === 'crash') {
      const boom = new SVF();
      boom.set(90, 0.8);
      const crunch = new SVF();
      crunch.set(650, 0.9);
      this.crash = { age: 0, amp: d.amp ?? 1, boom, crunch, res: [new SVF(), new SVF()], hitEnv: [0, 0] };
    }
  }

  process(_inputs, outputs) {
    const outE = outputs[0][0];
    const outP = outputs[1][0];
    const outA = outputs[2][0];
    const outC = outputs[3][0];
    const n = outE.length;
    const tgt = this.target;
    const val = this.value;
    const a = this.smooth;

    const voices = this.voices;
    const count = this.paramsUsed;

    // Block-rate path: where the smoothing below takes every parameter by the end of this render quantum
    // (messages arrive between quanta), so the weights can ramp to their values there.
    const ahead = this.ahead;
    if (this.blockRate) {
      const decay = Math.pow(a, n);
      for (let k = 0; k < count; k++) ahead[k] = tgt[k] + (val[k] - tgt[k]) * decay;
    }

    // Block-rate filter setup from the current smoothed parameters.
    for (let k = 0; k < voices.length; k++) {
      const eng = voices[k].engine;
      const prop = voices[k].prop;
      eng.tune(val[eng.iRpm] / 60, val[eng.iLoad]);
      prop.tune(val[prop.iTipMach]);
      if (this.blockRate) {
        eng.prepare(ahead, n);
        prop.prepare(ahead, n);
      }
    }
    const wf = val[P.windFreq];
    this.windF.set(wf, 0.55);
    this.windLowF.set(110, 0.7);
    this.slipF.set(wf * 2.6, 6);
    this.flapF.set(230, 1.1);
    this.buffetF.set(22, 0.9);
    this.buffetF2.set(65, 1.5);
    const surf = Math.round(val[P.surface]);
    this.rollF.set(surf === 0 ? 170 : 85, 0.8);
    this.hissF.set(surf === 0 ? 2600 : 1800, 0.9);
    this.gravelF.set(3200, 1.6);
    this.skidF.set(1500, 7);
    const hornF = this.hornBase + this.hornSweep * val[P.horn];
    this.hornF.set(hornF, 4);
    this.motorF.set(1800, 3);
    this.fanF.set(1400, 0.6);
    this.pumpF.set(1250, 2.5);
    // Vortex shedding of the gear legs: Strouhal number 0.2 on a leg about 0.07 m across, f = 0.2 V / d. The
    // wind band is 250 + 9 V Hz (mapping.ts windNoise), which gives the airspeed back.
    this.gearF.set(Math.max(30, (0.2 / 0.07) * ((wf - 250) / 9)), 1.4);

    if (voices.length === 1) {
      const eng = voices[0].engine;
      const prop = voices[0].prop;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < count; k++) val[k] = tgt[k] + (val[k] - tgt[k]) * a;
        outE[i] = eng.sample(val);
        outP[i] = prop.sample(val, eng.phase);
        outA[i] = this.airframe(val, surf);
        outC[i] = this.cabin(val);
      }
    } else {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < count; k++) val[k] = tgt[k] + (val[k] - tgt[k]) * a;
        let e = 0;
        let p = 0;
        for (let k = 0; k < voices.length; k++) {
          const eng = voices[k].engine;
          e += eng.sample(val);
          p += voices[k].prop.sample(val, eng.phase);
        }
        outE[i] = e;
        outP[i] = p;
        outA[i] = this.airframe(val, surf);
        outC[i] = this.cabin(val);
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ airframe

  airframe(v, surf) {
    const nz = this.noise;
    let out = 0;
    const wl = v[P.windLevel];
    if (wl > 1e-4) {
      // Gusts: slowly wandering amplitude modulation, deeper with turbulence.
      if (++this.gustCount > SR / 5) {
        this.gustCount = 0;
        this.gustTarget = nz.next();
      }
      this.gust += (this.gustTarget - this.gust) * (1 / (0.3 * SR));
      const g = 1 + this.gust * (0.1 + 0.35 * v[P.turbulence]);
      const p = this.pink2.next();
      const main = this.windF.process(p);
      this.windLowF.process(p);
      const slip = this.slipF.process(nz.next()) * v[P.slip];
      const flap = this.flapF.process(p) * v[P.flapNoise];
      out += wl * g * (main * 0.5 + this.windLowF.low * 0.5 + slip * 0.25 + flap * 0.8);
    }

    // Extended landing gear: low rumble of the flow shed by the legs and wheels.
    const gw = this.hasGear ? v[P.gearWind] : 0;
    if (gw > 1e-4) {
      this.gearF.process(this.gearPink.next());
      out += gw * (this.gearF.band * 0.8 + this.gearF.low * 0.12);
    }

    const buffet = v[P.buffet];
    if (buffet > 1e-4) {
      const w = nz.next();
      this.buffetF.process(w);
      this.buffetF2.process(w);
      out += buffet * (this.buffetF.low * 3.5 + this.buffetF2.band * 1.2);
    }

    const roll = v[P.rolling];
    if (roll > 1e-4) {
      const w = nz.next();
      const speed = v[P.rollSpeed];
      this.rollF.process(w);
      this.hissF.process(w);
      if (surf === 0) {
        out += roll * (this.rollF.band * 0.5 + this.hissF.band * 0.12);
      } else {
        // Unpaved: louder, lower rumble with random bumps; gravel adds stone crackle.
        out += roll * (this.rollF.low * 1.3 + this.hissF.band * 0.1);
        // Bumps re-energise a continuously running 48 Hz thump oscillator (no phase reset, so no click).
        if (nz.next() * 0.5 + 0.5 < (speed * 0.6) / SR) this.thumpTarget = 0.4 + 0.6 * (nz.next() * 0.5 + 0.5);
        this.thumpTarget *= 0.9992;
        this.thumpEnv += (this.thumpTarget - this.thumpEnv) * 0.01;
        this.thumpPhase = (this.thumpPhase + 48 / SR) % 1;
        out += roll * this.thumpEnv * Math.sin(TAU * this.thumpPhase) * 0.5;
        if (surf === 2) {
          if (nz.next() * 0.5 + 0.5 < (speed * 25) / SR) this.gravelEnv = 1;
          this.gravelEnv *= 0.97;
          out += roll * this.gravelF.process(nz.next() * this.gravelEnv) * 0.6;
        }
      }
    }

    const sq = v[P.brakeSqueal];
    if (sq > 1e-4) {
      this.vibPhase += 6.5 / SR;
      const vib = 1 + 0.012 * Math.sin(TAU * this.vibPhase);
      this.squealPhase = (this.squealPhase + (2900 * vib) / SR) % 1;
      this.squealPhase2 = (this.squealPhase2 + (5740 * vib) / SR) % 1;
      out += sq * (Math.sin(TAU * this.squealPhase) * 0.05 + Math.sin(TAU * this.squealPhase2) * 0.015);
    }

    const skid = v[P.skid];
    if (skid > 1e-4) out += skid * this.skidF.process(nz.next()) * 0.2;

    // Touchdown chirps: tyre spin-up scrub, a falling band of noise, plus the gear thump.
    for (let c = this.chirps.length - 1; c >= 0; c--) {
      const ch = this.chirps[c];
      const t = ch.age;
      ch.f.set(500 + 1300 * Math.exp(-t / 0.1), 5);
      const env = (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.08);
      out += 0.6 * ch.amp * (ch.f.process(nz.next()) * env * 1.4 + Math.sin(TAU * 55 * t) * Math.exp(-t / 0.06) * (1 - Math.exp(-t / 0.003)) * 0.5);
      ch.age += 1 / SR;
      if (ch.age > 0.6) this.chirps.splice(c, 1);
    }

    // Landing-gear locks: the thump of a leg reaching its stop (the gear thump of the chirp) and a short clunk.
    for (let c = this.thumps.length - 1; c >= 0; c--) {
      const th = this.thumps[c];
      const t = th.age;
      const attack = 1 - Math.exp(-t / 0.003);
      out += 0.9 * th.amp * attack * (Math.sin(TAU * 55 * t) * Math.exp(-t / 0.06) * 0.5 + th.f.process(this.gearNoise.next()) * Math.exp(-t / 0.015) * 0.9);
      th.age += 1 / SR;
      if (th.age > 0.6) this.thumps.splice(c, 1);
    }

    if (this.crash) out += this.crashSound(this.crash);

    return out;
  }

  crashSound(c) {
    const nz = this.noise;
    const t = c.age;
    c.age += 1 / SR;
    if (t > 4) {
      this.crash = null;
      return 0;
    }
    const attack = 1 - Math.exp(-t / 0.003);
    const w = nz.next();
    c.boom.process(w);
    c.crunch.process(w);
    let out = c.boom.low * 4 * Math.exp(-t / 1.1) + c.crunch.band * 1.5 * Math.exp(-t / 0.45) * (0.6 + 0.4 * Math.abs(nz.next()));
    // Metal: randomly re-struck resonances, rarer as the wreck settles.
    for (let r = 0; r < 2; r++) {
      if (nz.next() * 0.5 + 0.5 < (30 * Math.exp(-t / 0.8)) / SR) {
        c.res[r].set(300 + 2200 * (nz.next() * 0.5 + 0.5), 25);
        c.hitEnv[r] = 1;
      }
      c.hitEnv[r] *= 0.9995;
      out += c.res[r].process(nz.next() * c.hitEnv[r]) * 1.2;
    }
    return out * attack * c.amp * 0.35;
  }

  // ------------------------------------------------------------------ cabin

  cabin(v) {
    let out = 0;
    // Stall warning: a pneumatic reed, so pitch and loudness rise with the suction driving it. An electric
    // warner is a horn on a switch: one steady pitch, no breath.
    const h = v[P.horn];
    if (h > 1e-4) {
      if (this.hornElectric) {
        this.hornPhase = (this.hornPhase + this.hornBase / SR) % 1;
        const ph = TAU * this.hornPhase;
        out += h * (Math.sin(ph) + 0.33 * Math.sin(3 * ph) + 0.2 * Math.sin(5 * ph)) * 0.17;
      } else {
        this.hornPhase = (this.hornPhase + (this.hornBase + this.hornSweep * h) / SR) % 1;
        const ph = TAU * this.hornPhase;
        const reed = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.28 * Math.sin(3 * ph) + 0.15 * Math.sin(4 * ph);
        const breath = this.hornF.process(this.noise.next());
        out += h * (reed * 0.17 + breath * 0.09);
      }
    }

    // Flap motor: whine that spins up/down with the motor, and gearbox noise.
    const fm = v[P.flapMotor];
    this.motorSpin += (fm - this.motorSpin) * (1 / (0.08 * SR));
    if (this.motorSpin > 1e-3) {
      this.motorPhase = (this.motorPhase + (420 * this.motorSpin) / SR) % 1;
      const ph = TAU * this.motorPhase;
      const whine = Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph);
      out += this.motorSpin * (whine * 0.045 + this.motorF.process(this.noise.next()) * 0.075);
    }

    if (this.hasGear) out += this.gearSounds(v);

    // Vacuum and electric gyros: faint high whine with their spin.
    const gy = v[P.gyro];
    if (gy > 1e-3) {
      this.gyroPhase1 = (this.gyroPhase1 + (400 * gy) / SR) % 1;
      this.gyroPhase2 = (this.gyroPhase2 + (262 * gy) / SR) % 1;
      out += gy * gy * 0.006 * (Math.sin(TAU * this.gyroPhase1) + 0.5 * Math.sin(TAU * 2 * this.gyroPhase1) + 0.7 * Math.sin(TAU * this.gyroPhase2));
    }

    // Avionics fan: soft broadband air with a faint blade tone.
    const fan = v[P.fan];
    if (fan > 1e-3) {
      this.fanPhase = (this.fanPhase + 172 / SR) % 1;
      out += fan * (this.fanF.process(this.pink.next()) * 0.025 + Math.sin(TAU * this.fanPhase) * 0.003);
    }
    return out;
  }

  /** Cabin sounds of a retractable landing gear: the hydraulic pump and the gear warning. */
  gearSounds(v) {
    let out = 0;
    // Landing-gear hydraulic pump: an electric motor like the flap motor's, lower and rougher under load.
    const gp = v[P.gearPump];
    this.pumpSpin += (gp - this.pumpSpin) * (1 / (0.12 * SR));
    if (this.pumpSpin > 1e-3) {
      this.pumpPhase = (this.pumpPhase + (this.pumpHz * this.pumpSpin) / SR) % 1;
      const ph = TAU * this.pumpPhase;
      const whine = Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph);
      out += this.pumpSpin * (whine * 0.05 + this.pumpF.process(this.gearNoise.next()) * 0.06);
    }

    // Gear warning: intermittent, so it cannot be taken for the stall warning. A horn beeps (on for half of
    // every beat, 5 ms edges); a chime is struck once per beat and rings out.
    const gh = v[P.gearHorn];
    if (gh > 1e-4) {
      const t = this.gearHornBeat / this.gearHornRate; // time into this beat, s
      this.gearHornBeat += this.gearHornRate / SR;
      if (this.gearHornBeat >= 1) this.gearHornBeat -= 1;
      this.gearHornPhase = (this.gearHornPhase + this.gearHornHz / SR) % 1;
      const ph = TAU * this.gearHornPhase;
      if (this.gearChime) {
        const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.22);
        out += gh * env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * 0.3;
      } else {
        const on = Math.max(0, Math.min(1, Math.min(t, 0.5 / this.gearHornRate - t) / 0.005));
        out += gh * on * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.33 * Math.sin(3 * ph) + 0.25 * Math.sin(4 * ph)) * 0.2;
      }
    } else {
      this.gearHornBeat = 0;
    }
    return out;
  }
}

registerProcessor('aircraft-synth', AircraftSynth);
