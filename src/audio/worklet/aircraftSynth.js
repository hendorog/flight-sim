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
//                a diesel's sharper pulse and combustion knock, a turbocharger's whine; or a gas turbine
//                (TurbineVoice): the gas generator's whine, burner and exhaust roar, light-off, starter-generator,
//                igniters and reduction gearbox (or a helicopter's main transmission), and no pulses at all
//   1 prop     - blade-passage harmonics (phase-locked to the crank on a direct-drive engine, on the
//                propeller's own shaft angle behind a reduction gear) plus broadband tip noise rising with
//                tip Mach, amplitude-modulated at blade passage; a turboprop's growl at the shaft rate and its
//                reverse growl; a helicopter's main rotor (as the propeller, with its high-speed impulsive crack),
//                its tail rotor (TailRotorVoice) and a pusher propeller on the rotor shaft (PusherVoice)
//   2 airframe - wind, sideslip whistle, flap flow noise, stall buffet, tyre rolling by surface, brake
//                squeal, tyre skid, touchdown chirps, crash, the flow over an extended landing gear and the
//                thump of its locks
//   3 cabin    - stall warning (a reed horn or an electric tone; a helicopter's low-rotor / ENGINE OUT horn),
//                flap motor, instrument gyros, avionics fan, landing-gear pump and gear warning (a beeping horn
//                or a repeating chime), stick shaker, overspeed clacker, caution / warning chimes; a twin
//                turboshaft's warning unit, the rotor's n-per-rev hum and the half-P hop (RotorcraftCabinVoice)
//
// The voices added with the turbine types read the parameters appended at the very end of the block
// (params.ts EXTRA_PARAMS) and draw from noise sources of their own; a profile without them builds none of them
// and smooths none of those parameters, so every other type plays sample for sample as before. The precipitation
// voice (airframe stem, every type) reads 'rain' and the hail voice 'hail' and 'hailSize': the appended parameters
// are smoothed from the first block in which 'rain' or 'hail' is non-zero, and each voice draws only from sources of
// its own, so without precipitation and hail every type plays sample for sample as before.
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

// Precipitation voice (AircraftSynth.rainSound). Unconfirmed: tuning values set by ear, not measured: impacts a
// second at full level, the centres of the tick, thud and hiss bands, Hz, and their gains.
const RAIN_IMPACTS_PER_S = 1500;
const RAIN_TICK_HZ = 2600;
const RAIN_THUD_HZ = 700;
const RAIN_HISS_HZ = 5200;
const RAIN_TICK_GAIN = 2.0;
const RAIN_THUD_GAIN = 1.0;
const RAIN_HISS_GAIN = 0.18;
// Hail voice (AircraftSynth.hailSound). Unconfirmed: tuning values set by ear, not measured: impacts a second at full
// level, the pitch of the body ring for a 5 mm and a 50 mm stone, Hz, the bright click's centre, Hz, and the gains.
const HAIL_IMPACTS_PER_S = 260;
const HAIL_BODY_SMALL_HZ = 2400;
const HAIL_BODY_LARGE_HZ = 520;
const HAIL_CLICK_HZ = 4200;
const HAIL_CLICK_GAIN = 3.2;
const HAIL_BODY_GAIN = 2.6;
const HAIL_RATTLE_GAIN = 0.5;
/** Decay of an impact's noise burst, s. */
const HAIL_BURST_S = 0.004;

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
 * One gas turbine (EngineSoundProfile.combustion 'turbine', described by its `turbine` member): no combustion
 * pulses at all. Its parameters are read differently from a piston engine's: `rpm` is the GAS-GENERATOR speed,
 * `firing` 1 while the burner is alight, `load` what it burns (0..~1.2), `starter` the starter-generator,
 * `propRpm` the propeller (for the gearbox).
 *   - the gas generator's whine: tones at fixed multiples of its shaft rate (the rotor, the compressor's blade
 *     passage), each with a breathy band of noise round it, growing with the 1.5th power of its speed: it rises from
 *     silence with the starter and winds down with the spool after shutdown (the speed comes from the model);
 *   - the burner and exhaust roar: noise bands that brighten and grow with load, wandering slowly; nothing while
 *     the burner is out (it fades in over about a second at light-off, out over a quarter second at shutdown);
 *   - a soft thud at light-off on a start;
 *   - the starter-generator's commutator whine while it motors the spool;
 *   - a faint reduction-gearbox mesh tone at the propeller's speed.
 * Same interface as EngineVoice (prepare / tune / sample / startAt / phase / spool / iTurbo), so the processor
 * treats both alike. `noise`: the source it draws from; `ix`: the indices of its parameters.
 */
class TurbineVoice {
  constructor(profile, noise, ix = ENGINE_P[0]) {
    const t = profile.turbine;
    this.noise = noise;
    this.iRpm = ix.rpm;
    this.iFiring = ix.firing;
    this.iLoad = ix.load;
    this.iStarter = ix.starter;
    this.iPropRpm = ix.propRpm;
    this.iTurbo = ix.turbo;
    this.ngRpm = t.ngRpm;
    this.tones = t.tones;
    this.tonePh = new Float64Array(t.tones.length);
    this.toneF = t.tones.map(() => new SVF());
    this.roar = t.roar;
    this.roarF = t.roar.map(() => new SVF());
    this.starterPerRev = t.starter.perNgRev;
    this.starterLevel = t.starter.level;
    this.meshPerRev = t.gearMesh.perPropRev;
    this.meshLevel = t.gearMesh.level;
    // The output speed from which the gearbox mesh is at full strength, rev/s (a helicopter's transmission: low).
    this.meshFullRps = t.gearMeshFullRps ?? 30;
    this.lightOffLevel = t.lightOff;
    // The igniters on a start (engines 0 and 1, each keyed on its own parameter, 'ignitor' and 'ignitor2'; a source of
    // its own, so the shared sequences are untouched).
    const first = ix === ENGINE_P[0];
    const ign = first || ix === ENGINE_P[1] ? t.ignitor : undefined;
    this.iIgn = first ? P.ignitor : P.ignitor2;
    this.ignLevel = ign ? ign.level : 0;
    this.ignRate = ign ? ign.perSecond : 0;
    if (this.ignLevel > 0) {
      this.ignNoise = new Noise(first ? 0x1f123bb5 : 0x2b7e1516);
      this.ignF = new SVF();
      this.ignF.set(3400, 1.4);
      this.ignPh = 0;
      this.ignEnv = 0;
      this.ignDecay = expCoef(0.004);
    }
    this.level = profile.level;
    /** Not used by a turbine: the processor's interface (a direct-drive propeller's crank angle, a turbocharger). */
    this.phase = 0;
    this.spool = 0;
    this.fireEnv = 0;
    this.lit = false;
    this.wander = 0;
    this.wanderTarget = 0;
    this.wanderCount = 0;
    this.motorPh = 0;
    this.meshPh = 0;
    this.thudAge = 1;
    this.thudPh = 0;
    this.thudF = new SVF();
    this.thudF.set(110, 0.8);
    this.brushF = new SVF();
  }

  startAt(phase) {
    this.phase = phase;
  }

  /** A start with the engine already alight: no light-off, the burner at once. */
  prime(v) {
    this.lit = v[this.iFiring] > 0.5;
    this.fireEnv = this.lit ? 1 : 0;
  }

  prepare() {}

  /** Block-rate filter setup from the smoothed gas-generator shaft rate (rev/s) and load. */
  tune(rps0, load0) {
    for (let k = 0; k < this.tones.length; k++) this.toneF[k].set(Math.max(20, this.tones[k].order * rps0), 12);
    for (let k = 0; k < this.roar.length; k++) {
      const r = this.roar[k];
      this.roarF[k].set(r.hz + r.perLoad * Math.min(load0, 1.2), r.q);
    }
    this.brushF.set(Math.max(200, this.starterPerRev * rps0 * 1.5), 1.2);
  }

  sample(v) {
    const nz = this.noise;
    const rps = Math.max(0, v[this.iRpm]) / 60;
    const ng = rps / (this.ngRpm / 60);
    const firing = v[this.iFiring];
    // Light-off: the flame spreads round the annular burner over about a second; flame-out or cut-off is quick.
    if (firing > 0.5 && !this.lit) {
      this.lit = true;
      // On a start (a slow spool), the soft thud of the first fuel lighting.
      if (ng < 0.4 && this.lightOffLevel > 0) this.thudAge = 0;
    } else if (firing < 0.5 && this.lit) {
      this.lit = false;
    }
    this.fireEnv += (firing - this.fireEnv) * (firing > this.fireEnv ? 1 / (0.8 * SR) : 1 / (0.25 * SR));

    let out = 0;
    // The gas generator's whine: pure tones with a little noise round them, sound pressure with the 1.5th power of the speed.
    const whine = ng * Math.sqrt(ng);
    if (whine > 1e-6) {
      for (let k = 0; k < this.tones.length; k++) {
        const tone = this.tones[k];
        let ph = this.tonePh[k] + (tone.order * rps) / SR;
        if (ph >= 1) ph -= Math.floor(ph);
        this.tonePh[k] = ph;
        const f = tone.order * rps;
        // Nothing above the band the context can carry (aliasing).
        if (f > SR * 0.45) continue;
        out += (Math.sin(TAU * ph) + this.toneF[k].process(nz.next()) * tone.band) * tone.gain * whine;
      }
    }

    // Burner and exhaust roar: band-limited noise, slowly wandering (the flame is never quite steady).
    if (this.fireEnv > 1e-4) {
      if (++this.wanderCount > SR / 4) {
        this.wanderCount = 0;
        this.wanderTarget = nz.next();
      }
      this.wander += (this.wanderTarget - this.wander) * (1 / (0.3 * SR));
      const load = Math.min(v[this.iLoad], 1.3);
      const roar = this.fireEnv * (0.25 + 0.75 * load) * (1 + 0.12 * this.wander);
      const w = nz.next();
      let r = 0;
      for (let k = 0; k < this.roarF.length; k++) r += this.roarF[k].process(w) * this.roar[k].gain;
      out += r * roar;
    }

    // Light-off thud: a low, soft push of gas through the stacks, 40 ms to build, a quarter second to die away.
    if (this.thudAge < 0.8) {
      const t = this.thudAge;
      this.thudAge += 1 / SR;
      this.thudPh = (this.thudPh + 42 / SR) % 1;
      const env = (1 - Math.exp(-t / 0.04)) * Math.exp(-t / 0.25);
      out += this.lightOffLevel * env * (this.thudF.process(nz.next()) * 1.2 + Math.sin(TAU * this.thudPh) * 0.5);
    }

    // Starter-generator: a commutator whine rising with the spool, brush noise, while it is engaged.
    const starter = v[this.iStarter];
    if (starter > 0.001) {
      this.motorPh += (Math.max(rps, 3) * this.starterPerRev) / SR;
      if (this.motorPh >= 1) this.motorPh -= Math.floor(this.motorPh);
      const ph = TAU * this.motorPh;
      const spin = 0.35 + 0.65 * Math.min(1, ng / 0.15);
      out += starter * this.starterLevel * spin * (Math.sin(ph) + 0.3 * Math.sin(2 * ph) + this.brushF.process(nz.next()) * 0.6);
    }

    // Reduction gearbox: the mesh of the second planetary stage, at the propeller's speed.
    const propRps = Math.max(0, v[this.iPropRpm]) / 60;
    if (this.meshLevel > 0 && propRps > 0.1) {
      this.meshPh += (this.meshPerRev * propRps) / SR;
      if (this.meshPh >= 1) this.meshPh -= Math.floor(this.meshPh);
      const turn = Math.min(1, propRps / this.meshFullRps);
      out += Math.sin(TAU * this.meshPh) * this.meshLevel * turn * turn;
    }

    // Igniters: the exciter discharges across the plugs a few times a second while the starter runs, a dry crack each.
    if (this.ignLevel > 0) {
      const ign = v[this.iIgn];
      if (ign > 0.01) {
        this.ignPh += this.ignRate / SR;
        if (this.ignPh >= 1) {
          this.ignPh -= 1;
          this.ignEnv = 1;
        }
      } else {
        this.ignPh = 0.95;
      }
      if (this.ignEnv > 1e-4) {
        this.ignEnv *= this.ignDecay;
        out += this.ignF.process(this.ignNoise.next() * this.ignEnv) * this.ignLevel * Math.min(1, ign * 1.5);
      }
    }
    return out * 0.6 * this.level;
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
    // Geared only: the shaft-rate roughness of a turboprop's unevenly loaded disc (PropSoundProfile.growl).
    this.growl = this.geared ? profile.growl ?? 0 : 0;
    // Geared, engine 0 only: the reverse growl (PropSoundProfile.reverse), from a noise source of its own.
    this.revGrowl = this.geared && ix === ENGINE_P[0] && profile.reverse ? profile.reverse.growl : 0;
    if (this.revGrowl > 0) {
      this.revPink = new Pink(90917);
      this.revLowF = new SVF();
      this.revMidF = new SVF();
    }
    // Geared, engine 0 only: a helicopter main rotor's high-speed impulsive noise (PropSoundProfile.impulsive). No
    // noise source: the crack is a deterministic pulse locked to the blade passage.
    const hsi = this.geared && ix === ENGINE_P[0] ? profile.impulsive : undefined;
    this.hsiOnset = hsi ? hsi.onsetMach : 0;
    this.hsiFull = hsi ? hsi.fullMach : 1;
    this.hsiLevel = hsi ? hsi.level : 0;
    this.hsiAmp = 0;
    this.hsiWidth = 0.1;
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

  /** Block-rate filter setup from the current smoothed tip Mach number (and, reversing, the smoothed parameters `v`). */
  tune(tip, v) {
    this.tipF.set(500 + 5200 * tip * tip, 0.8);
    if (this.hsiLevel > 0) {
      // The crack sets in at the onset Mach and grows steeply on the way to full (smoothstep, to the 1.5th power),
      // narrowing as it strengthens (the shock delocalising off the advancing tip): 9 % of the blade passage at onset,
      // 3 % at full.
      const x = Math.max(0, Math.min(1, (v[P.advTipMach] - this.hsiOnset) / (this.hsiFull - this.hsiOnset)));
      const s = x * x * (3 - 2 * x);
      this.hsiAmp = this.hsiLevel * s * Math.sqrt(s);
      this.hsiWidth = 0.09 - 0.06 * s;
    }
    if (this.revGrowl > 0) {
      const rev = Math.min(1.5, v[P.reverse]);
      this.revLowF.set(150 + 140 * rev, 0.9);
      this.revMidF.set(520 + 480 * rev, 1.3);
    }
  }

  /**
   * Reverse growl: the disc at a negative angle churns its own wake. A low roar and a harsher band above it,
   * beaten hard at the blade passage and at the shaft rate (each blade meets the disturbed flow at one place a
   * revolution), louder and brighter with the reverse thrust. `bp`: the blade-passage angle, rad.
   */
  reverseAt(v, bp) {
    const rev = v[P.reverse];
    const w = this.revPink.next();
    this.revLowF.process(w);
    this.revMidF.process(w);
    if (rev < 1e-4) return 0;
    const a = TAU * this.phase;
    const beat = (1 + 0.5 * Math.sin(bp + 0.3)) * (1 + 0.3 * Math.sin(a + 0.4) + 0.15 * Math.sin(2 * a + 1.9));
    const r = Math.min(rev, 1.5);
    // Rounded peaks (the roar is dense, not spiky): a soft limit on the noise bands before the beat.
    const roar = Math.tanh(1.6 * (this.revLowF.band * 0.9 + this.revMidF.band * 0.45 * Math.min(1, r))) / 1.6;
    return this.revGrowl * r * beat * roar;
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
      if (this.growl > 0) tone *= this.growlAt(load);
      const rv = this.revGrowl > 0 ? this.reverseAt(v, bp) : 0;
      if (this.hsiAmp > 1e-5) tone += this.impulseAt();
      return (tone + broad * 0.5 + rv) * 0.7 * this.level;
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
    if (this.growl > 0) tone *= this.growlAt(load);
    const rv = this.revGrowl > 0 ? this.reverseAt(v, bp) : 0;
    if (this.hsiAmp > 1e-5) return (tone * toneLevel + this.impulseAt() + broad * 0.5 + rv) * 0.7 * this.level;
    return (tone * toneLevel + broad * 0.5 + rv) * 0.7 * this.level;
  }

  /**
   * High-speed impulsive noise: once per blade passage (as the blade crosses the advancing side) a sharp negative
   * pressure pulse of width `hsiWidth` of the passage, then a positive recovery lobe half as deep over twice the width,
   * so the pulse has no mean. Geared only: `this.phase` is the shaft angle.
   */
  impulseAt() {
    const w = this.hsiWidth;
    const f = (this.blades * this.phase) % 1;
    if (f < w) {
      const s = Math.sin((Math.PI * f) / w);
      return -this.hsiAmp * s * s;
    }
    if (f < 3 * w) {
      const s = Math.sin((Math.PI * (f - w)) / (2 * w));
      return 0.5 * this.hsiAmp * s * s;
    }
    return 0;
  }

  /**
   * Growl: each blade passes through the disturbed inflow (cowl, intake, exhaust stacks) at the same place once a
   * revolution, so its loading, and the loudness of its passage, beats at the shaft rate and its second multiple.
   * The beat puts lines at every multiple of the shaft rate between those of the blade passage: the rough,
   * growling drone. Deeper with thrust. A factor on the tone, about 1.
   */
  growlAt(load) {
    const depth = this.growl * (0.35 + 0.65 * Math.min(1, load / 1.2));
    const a = TAU * this.phase;
    return 1 + depth * (0.6 * Math.sin(a + 0.4) + 0.35 * Math.sin(2 * a + 1.9));
  }
}

/**
 * A helicopter's tail rotor (AudioProfile.tailRotor), heard in the propeller stem beside the main rotor: blade
 * passage at `blades` x its shaft rate (an MD 500E: two blades at about 2930 rpm, 98 Hz), its harmonics rolling off
 * less steeply as it is loaded; broadband tip noise rising with the tip Mach number; and the slap: each blade's
 * passage turning impulsive (a short pressure crack per blade) as |thrust| grows past the hover value, the sound
 * of a hard pedal turn. Parameters `tailRpm`, `tailLoad`, `tailTipMach` (params.ts EXTRA_PARAMS); a noise source
 * of its own. The harmonic weights are set per render quantum from the smoothed parameters (tune).
 */
class TailRotorVoice {
  constructor(profile) {
    this.blades = profile.blades;
    this.slap = profile.slap;
    this.level = profile.level;
    this.pink = new Pink(31337);
    this.tipF = new SVF();
    this.phase = 0;
    this.w = new Float64Array(9);
    this.broad = 0;
    this.slapAmp = 0;
  }

  /** Block-rate setup from the smoothed parameters `v`. */
  tune(v) {
    const tip = v[P.tailTipMach];
    const load = Math.min(2, v[P.tailLoad]);
    this.tipF.set(700 + 5600 * tip * tip, 0.8);
    // Loaded harder, the harmonics roll off less steeply (the blade's passage sharpens).
    const slope = 1.7 - 0.6 * Math.min(1, load / 1.5);
    const toneLevel = (0.12 + 0.3 * load) * Math.pow(tip / 0.7, 3);
    for (let k = 1; k <= 8; k++) this.w[k] = Math.pow(k, -slope) * toneLevel;
    this.broad = Math.pow(tip / 0.7, 5) * (0.35 + 0.3 * load);
    // The slap sets in above the hover loading and grows quickly with it.
    const over = Math.max(0, load - 0.8);
    this.slapAmp = this.slap * over * Math.sqrt(over) * Math.pow(tip / 0.7, 2);
  }

  sample(v) {
    const n = this.pink.next();
    const rpm = v[P.tailRpm];
    if (rpm < 1) return 0;
    this.phase += rpm / (60 * SR);
    if (this.phase >= 1) this.phase -= 1;
    const bp = TAU * this.blades * this.phase;
    let tone = 0;
    const x = bp + 0.4;
    const twoCos = 2 * Math.cos(x);
    let s0 = 0;
    let s1 = Math.sin(x);
    for (let k = 1; k <= 8; k++) {
      tone += s1 * this.w[k];
      const s2 = twoCos * s1 - s0;
      s0 = s1;
      s1 = s2;
    }
    const broad = this.tipF.process(n) * this.broad * (1 + 0.5 * Math.sin(bp));
    // Slap: an N-shaped pressure pulse over the first 12 % of every blade passage (zero mean, no DC).
    let slap = 0;
    if (this.slapAmp > 1e-5) {
      const f = (this.blades * this.phase) % 1;
      if (f < 0.12) slap = Math.sin((TAU * f) / 0.12) * this.slapAmp;
    }
    return (tone + broad * 0.5 + slap) * 0.7 * this.level;
  }
}

/**
 * A pusher propeller on the rotor shaft (AudioProfile.pusher; the AH-56A's three-blade Hamilton Standard, 3 x 1717 rpm =
 * 85.9 Hz), in the propeller stem beside the rotors: blade passage at `blades` x its shaft rate, the harmonics rolling
 * off less steeply with loading and blade angle; broadband tip noise rising steeply with the tip Mach number (0.81
 * static) and with the blade angle; and in reverse pitch a roar of the disc churning its own wake, beaten at the blade
 * passage and the shaft rate. Parameters `pusherRpm`, `pusherLoad`, `pusherTipMach`, `pusherPitch`, `pusherReverse`
 * (params.ts EXTRA_PARAMS); noise sources of its own. Weights per render quantum (tune).
 */
class PusherVoice {
  constructor(profile) {
    this.blades = profile.blades;
    this.level = profile.level ?? 1;
    this.growl = profile.growl ?? 0.6;
    this.pink = new Pink(52361);
    this.revPink = new Pink(60493);
    this.tipF = new SVF();
    this.revLowF = new SVF();
    this.revMidF = new SVF();
    this.phase = 0;
    this.w = new Float64Array(9);
    this.broad = 0;
    this.rev = 0;
  }

  /** Block-rate setup from the smoothed parameters `v`. */
  tune(v) {
    const tip = v[P.pusherTipMach];
    const load = Math.min(2, v[P.pusherLoad]);
    const pitch = Math.min(1.5, Math.max(0, v[P.pusherPitch]));
    this.tipF.set(600 + 5400 * tip * tip, 0.8);
    // Loading sharpens the blade's passage: the harmonics roll off less steeply. At these tip speeds (Mach 0.81
    // static) the thickness noise is strong without any thrust: a large share of the tone does not need loading.
    const slope = 1.8 - 0.7 * Math.min(1, load / 1.5);
    const toneLevel = (0.2 + 0.3 * load + 0.15 * pitch) * Math.pow(tip / 0.8, 3);
    for (let k = 1; k <= 8; k++) this.w[k] = Math.pow(k, -slope) * toneLevel;
    // A blade at a steep angle sheds more profile-drag and separated-flow noise.
    this.broad = Math.pow(tip / 0.8, 5) * (0.3 + 0.25 * load + 0.5 * pitch);
    this.rev = Math.min(1.5, v[P.pusherReverse]);
    this.revLowF.set(140 + 120 * this.rev, 0.9);
    this.revMidF.set(480 + 420 * this.rev, 1.3);
  }

  sample(v) {
    const n = this.pink.next();
    const r = this.revPink.next();
    this.revLowF.process(r);
    this.revMidF.process(r);
    const rpm = v[P.pusherRpm];
    if (rpm < 1) return 0;
    this.phase += rpm / (60 * SR);
    if (this.phase >= 1) this.phase -= 1;
    const bp = TAU * this.blades * this.phase;
    let tone = 0;
    const x = bp + 0.9;
    const twoCos = 2 * Math.cos(x);
    let s0 = 0;
    let s1 = Math.sin(x);
    for (let k = 1; k <= 8; k++) {
      tone += s1 * this.w[k];
      const s2 = twoCos * s1 - s0;
      s0 = s1;
      s1 = s2;
    }
    const broad = this.tipF.process(n) * this.broad * (1 + 0.45 * Math.sin(bp));
    let roar = 0;
    if (this.rev > 1e-4) {
      const a = TAU * this.phase;
      const beat = (1 + 0.5 * Math.sin(bp + 0.3)) * (1 + 0.3 * Math.sin(a + 0.4) + 0.15 * Math.sin(2 * a + 1.9));
      roar = this.growl * this.rev * beat * (Math.tanh(1.6 * (this.revLowF.band * 0.9 + this.revMidF.band * 0.45 * Math.min(1, this.rev))) / 1.6);
    }
    return (tone + broad * 0.5 + roar) * 0.7 * this.level;
  }
}

/**
 * The cabin sounds of the hingeless-rotor types (cabin stem), each built only when the profile declares it:
 *   - a twin warning unit (AudioProfile.rotorWarnings; the Bo 105's K-DW02/01): an intermittent tone while NR is low or
 *     the N1s split (on for half of every beat, 5 ms edges), a steady higher tone while NR is high;
 *   - the rotor's n-per-rev vibration hum (AudioProfile.vibration): a tone at `vibrationHz` with the buzz of the
 *     structure (its second and third multiples), so a small speaker that cannot play 33 Hz still carries it;
 *   - the half-P hop (AudioProfile.halfP): a low rumble thumping at `halfPHz`.
 * Noise from a source of its own.
 */
class RotorcraftCabinVoice {
  constructor(profile) {
    const w = profile.rotorWarnings;
    this.warnLevel = w ? w.level : 0;
    this.lowHz = w ? w.lowHz : 0;
    this.lowRate = w ? w.lowPerSecond : 1;
    this.highHz = w ? w.highHz : 0;
    this.lowPh = 0;
    this.lowBeat = 0;
    this.highPh = 0;
    this.vibLevel = profile.vibration ? profile.vibration.level : 0;
    this.vibPh = 0;
    const h = profile.halfP;
    this.halfLevel = h ? h.level : 0;
    this.halfPh = 0;
    this.rumblePh = 0;
    this.rumbleHz = h ? h.rumbleHz : 50;
    this.noise = new Noise(0x3243f6a8);
    this.rumbleF = new SVF();
    this.rumbleF.set(this.rumbleHz, 0.9);
  }

  sample(v) {
    let out = 0;
    if (this.warnLevel > 0) {
      // The intermittent tone: NR LOW or N1 SPLIT (one oscillator, one rate).
      const low = Math.max(v[P.nrLowTone], v[P.n1SplitTone]);
      if (low > 1e-3) {
        const t = this.lowBeat / this.lowRate;
        this.lowBeat += this.lowRate / SR;
        if (this.lowBeat >= 1) this.lowBeat -= 1;
        this.lowPh = (this.lowPh + this.lowHz / SR) % 1;
        const ph = TAU * this.lowPh;
        const on = Math.max(0, Math.min(1, Math.min(t, 0.5 / this.lowRate - t) / 0.005));
        out += low * on * (Math.sin(ph) + 0.3 * Math.sin(3 * ph) + 0.12 * Math.sin(5 * ph)) * this.warnLevel;
      } else {
        this.lowBeat = 0;
      }
      const high = v[P.nrHighTone];
      if (high > 1e-3) {
        this.highPh = (this.highPh + this.highHz / SR) % 1;
        const ph = TAU * this.highPh;
        out += high * (Math.sin(ph) + 0.2 * Math.sin(3 * ph)) * this.warnLevel * 0.8;
      }
    }
    const vib = this.vibLevel > 0 ? v[P.vibration] : 0;
    if (vib > 1e-4) {
      this.vibPh = (this.vibPh + v[P.vibrationHz] / SR) % 1;
      const ph = TAU * this.vibPh;
      out += vib * this.vibLevel * (Math.sin(ph) + 0.45 * Math.sin(2 * ph + 0.6) + 0.3 * Math.sin(3 * ph + 1.4));
    }
    const hop = this.halfLevel > 0 ? v[P.halfP] : 0;
    const w = this.noise.next();
    this.rumbleF.process(w);
    if (hop > 1e-4) {
      this.halfPh = (this.halfPh + v[P.halfPHz] / SR) % 1;
      this.rumblePh = (this.rumblePh + (0.85 * this.rumbleHz) / SR) % 1;
      // One thump a cycle: the envelope peaks sharply once a cycle and never quite empties.
      const c = 0.5 + 0.5 * Math.sin(TAU * this.halfPh);
      const env = 0.15 + 0.85 * c * c * c;
      const a = Math.min(hop, 2);
      out += this.halfLevel * a * env * (this.rumbleF.band * 1.2 + Math.sin(TAU * this.rumblePh) * 0.6);
    }
    return out;
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
    // Precipitation on the airframe, likewise: drawn from only while the 'rain' parameter is on. `rainHeard`: it has
    // been non-zero, so the appended parameters are smoothed (configure, onMessage).
    this.rainHeard = false;
    this.rainNoise = new Noise(0x3c6ef372);
    this.rainPink = new Pink(9091);
    this.rainTickF = new SVF();
    this.rainTickF.set(RAIN_TICK_HZ, 1.3);
    this.rainThudF = new SVF();
    this.rainThudF.set(RAIN_THUD_HZ, 0.9);
    this.rainHissF = new SVF();
    this.rainHissF.set(RAIN_HISS_HZ, 0.7);
    // Hail, likewise: drawn from only while the 'hail' parameter is on.
    this.hailNoise = new Noise(0x6a09e667);
    this.hailClickF = new SVF();
    this.hailClickF.set(HAIL_CLICK_HZ, 2.5);
    this.hailBodyF = new SVF();
    this.hailBodyF.set(HAIL_BODY_SMALL_HZ, 6);
    this.hailBodyHz = HAIL_BODY_SMALL_HZ;
    this.hailBurst = 0;
    this.hailHit = 0;
    this.hailBurstK = Math.exp(-1 / (HAIL_BURST_S * SR));

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
    // Warnings of the turbine types (warningSounds).
    this.shakerSpin = 0;
    this.shakerPh = 0;
    this.shakerKnock = 0;
    this.shakerMotorPh = 0;
    this.clackPh = 0.999;
    this.clackEnv = 0;
    this.cawsPh = 0;
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
      const noise = i === 0 ? this.noise : new Noise(0x7f4a7c15 + i);
      // A gas turbine (combustion 'turbine') has a voice of its own; every other engine is a piston engine.
      const engine = e.engine.combustion === 'turbine' && e.engine.turbine ? new TurbineVoice(e.engine, noise, ENGINE_P[i]) : new EngineVoice(e.engine, noise, ENGINE_P[i], blockRate);
      const prop = new PropVoice(e.prop, i === 0 ? this.pink : new Pink(4711 + i), ENGINE_P[i], e.engine.gearRatio, blockRate);
      if (i > 0) engine.startAt((0.618 * i) % 2);
      // A turbocharger already turning (a change of type in flight) is not spooled up from rest.
      engine.spool = this.value[engine.iTurbo];
      // A gas turbine already alight (a change of type in flight) has no light-off.
      if (engine.prime && this.primed) engine.prime(this.value);
      return { engine, prop };
    });
    // A helicopter's tail rotor, the stick shaker, the overspeed clacker and the caution/warning chimes: voices of
    // their own, each with its own noise source, built only for a profile that has them.
    this.tail = profile.tailRotor ? new TailRotorVoice(profile.tailRotor) : null;
    // The hingeless-rotor types: a pusher on the rotor shaft (propeller stem) and the cabin's warning unit, vibration hum
    // and half-P rumble.
    this.pusher = profile.pusher ? new PusherVoice(profile.pusher) : null;
    this.rcCabin = profile.rotorWarnings || profile.vibration || profile.halfP ? new RotorcraftCabinVoice(profile) : null;
    this.shakerHz = profile.stickShaker ? profile.stickShaker.hz : 0;
    this.shakerLevel = profile.stickShaker ? profile.stickShaker.level : 0;
    this.clackRate = profile.overspeedWarning ? profile.overspeedWarning.perSecond : 0;
    this.clackLevel = profile.overspeedWarning ? profile.overspeedWarning.level : 0;
    this.cawsHz = profile.caws ? profile.caws.hz : 0;
    this.cawsLevel = profile.caws ? profile.caws.level : 0;
    this.hasWarnings = this.shakerLevel > 0 || this.clackLevel > 0 || this.cawsLevel > 0;
    if (this.hasWarnings && !this.warnNoise) {
      this.warnNoise = new Noise(0x2c1b3c6d);
      this.shakerF = new SVF();
      this.shakerF.set(1300, 2.2);
      this.shakerLowF = new SVF();
      this.shakerLowF.set(180, 1.2);
      this.clackF = new SVF();
      this.clackF.set(2300, 7);
      this.clackF2 = new SVF();
      this.clackF2.set(3900, 9);
    }
    this.chimes = [];
    // Parameters smoothed per sample: up to the last one this profile reads (see params.ts for their order).
    this.hasGear = !!profile.gear;
    this.paramsUsed = P.turbulence + 1;
    if (this.hasGear) this.paramsUsed = P.gearWind + 1;
    if (engines.some((e) => e.engine.gearRatio !== 1 || e.engine.turbo)) this.paramsUsed = P.turbo + 1;
    if (engines.length > 1) this.paramsUsed = ENGINE_P[engines.length - 1].turbo + 1;
    // The appended parameters (params.ts EXTRA_PARAMS) sit at the end of the block: read only by a profile that uses one.
    const extras = this.tail || this.pusher || this.rcCabin || this.hasWarnings ||
      engines.some((e) => e.prop.reverse || e.prop.impulsive || (e.engine.turbine && e.engine.turbine.ignitor));
    if (extras || this.rainHeard) this.paramsUsed = PARAM_COUNT;
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
      // The first precipitation: smooth the appended parameters from now on (its own included).
      if (!this.rainHeard && (this.target[P.rain] > 0 || this.target[P.hail] > 0)) {
        this.rainHeard = true;
        this.paramsUsed = PARAM_COUNT;
      }
      if (!this.primed) {
        this.value.set(this.target);
        this.primed = true;
        // A start with the engines running: their turbochargers are at speed.
        for (const voice of this.voices) {
          voice.engine.spool = this.value[voice.engine.iTurbo];
          // A start with a gas turbine alight: its burner at once, no light-off.
          if (voice.engine.prime) voice.engine.prime(this.value);
        }
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
    } else if (d.type === 'caws') {
      // The caution and warning system: a warning is three strikes of the chime, a caution one.
      if (this.cawsLevel > 0 && this.chimes.length < 6) {
        const strikes = d.level === 'warning' ? 3 : 1;
        for (let k = 0; k < strikes; k++) this.chimes.push({ age: -0.24 * k, amp: d.level === 'warning' ? 1 : 0.8 });
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
      prop.tune(val[prop.iTipMach], val);
      if (this.blockRate) {
        eng.prepare(ahead, n);
        prop.prepare(ahead, n);
      }
    }
    const tail = this.tail;
    if (tail) tail.tune(val);
    const pusher = this.pusher;
    if (pusher) pusher.tune(val);
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
        let p = prop.sample(val, eng.phase);
        if (tail) p += tail.sample(val);
        if (pusher) p += pusher.sample(val);
        outP[i] = p;
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
        if (tail) p += tail.sample(val);
        if (pusher) p += pusher.sample(val);
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

    const rain = v[P.rain];
    if (rain > 1e-4) out += this.rainSound(rain);
    const hail = v[P.hail];
    if (hail > 1e-4) out += this.hailSound(hail, v[P.hailSize]);

    return out;
  }

  /**
   * Precipitation on the skin and the windscreen, level `r` 0..1 (mapping.ts precipNoise): drop impacts as a random
   * stream of single-sample impulses (RAIN_IMPACTS_PER_S x r a second, each of random strength) rung through a
   * bright band (the tick on the skin and the glass) and a low one (the thud), and, as the impacts merge in heavy
   * rain, a hiss growing with r squared. Draws only from its own sources.
   */
  rainSound(r) {
    const nz = this.rainNoise;
    const hit = nz.next() * 0.5 + 0.5 < (RAIN_IMPACTS_PER_S * r) / SR ? 0.4 + 0.6 * (nz.next() * 0.5 + 0.5) : 0;
    const tick = this.rainTickF.process(hit);
    this.rainThudF.process(hit);
    const hiss = this.rainHissF.process(this.rainPink.next());
    return r * (tick * RAIN_TICK_GAIN + this.rainThudF.band * RAIN_THUD_GAIN) + r * r * hiss * RAIN_HISS_GAIN;
  }

  /**
   * Hail on the skin and the windscreen, level `h` 0..1 (mapping.ts hailNoise), largest stone `sizeMm`: impacts as a
   * random stream (HAIL_IMPACTS_PER_S x h a second), each a short noise burst of random strength rung through a bright
   * click band and a resonant body band whose pitch falls from HAIL_BODY_SMALL_HZ to HAIL_BODY_LARGE_HZ as the stones
   * grow (larger stones thud on the skin), and a rattle of the bursts themselves. Draws only from its own source.
   */
  hailSound(h, sizeMm) {
    const nz = this.hailNoise;
    const big = Math.min(1, Math.max(0, (sizeMm - 5) / 45));
    const hz = HAIL_BODY_SMALL_HZ + (HAIL_BODY_LARGE_HZ - HAIL_BODY_SMALL_HZ) * big;
    if (Math.abs(hz - this.hailBodyHz) > 5) {
      this.hailBodyHz = hz;
      this.hailBodyF.set(hz, 6);
    }
    if (nz.next() * 0.5 + 0.5 < (HAIL_IMPACTS_PER_S * h) / SR) {
      // The stones vary in size: most impacts are of the smaller ones.
      const u = nz.next() * 0.5 + 0.5;
      this.hailHit = (0.3 + 0.7 * u * u) * (0.6 + 0.4 * big);
      this.hailBurst = 1;
    }
    this.hailBurst *= this.hailBurstK;
    const e = this.hailBurst * this.hailHit * nz.next();
    const click = this.hailClickF.process(e);
    this.hailBodyF.process(e);
    return h * (click * HAIL_CLICK_GAIN + this.hailBodyF.band * HAIL_BODY_GAIN * (0.6 + 0.8 * big) + e * HAIL_RATTLE_GAIN);
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
    if (this.hasWarnings) out += this.warningSounds(v);
    if (this.rcCabin) out += this.rcCabin.sample(v);

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

  /**
   * The warnings of a turbine type, in the cabin: the stick shaker (an eccentric weight on a motor rattling the
   * control column: a low thump at its rate, the clatter of the column in its guides, the motor's whine), the
   * overspeed clacker (a hammer striking a small bell plate, several strokes a second), the caution and warning
   * chimes (struck by 'caws' messages). The shaker and the clacker key on their parameters; all three draw from
   * one noise source of their own.
   */
  warningSounds(v) {
    const nz = this.warnNoise;
    let out = 0;
    // Stick shaker: spins up in about 0.1 s, down in 0.2 s.
    const sh = this.shakerLevel > 0 ? v[P.shaker] : 0;
    this.shakerSpin += (sh - this.shakerSpin) * (1 / ((sh > this.shakerSpin ? 0.1 : 0.12) * SR));
    if (this.shakerSpin > 1e-3) {
      const spin = this.shakerSpin;
      const prev = this.shakerPh;
      this.shakerPh = (prev + (this.shakerHz * spin) / SR) % 1;
      // A knock of the column against its stops every half turn of the weight.
      if ((this.shakerPh % 0.5) < (prev % 0.5)) this.shakerKnock = 0.6 + 0.4 * Math.abs(nz.next());
      this.shakerKnock *= 0.9975;
      const knock = this.shakerF.process(nz.next() * this.shakerKnock);
      const thump = this.shakerLowF.process(Math.sin(TAU * this.shakerPh) + nz.next() * 0.3);
      this.shakerMotorPh = (this.shakerMotorPh + (this.shakerHz * 14 * spin) / SR) % 1;
      const whine = Math.sin(TAU * this.shakerMotorPh) * 0.08;
      out += this.shakerLevel * spin * (knock * 0.9 + thump * 0.6 + whine);
    }
    // Overspeed clacker: strokes at its rate while it sounds; the bell plate rings for a few tens of milliseconds.
    const ck = this.clackLevel > 0 ? v[P.overspeed] : 0;
    if (ck > 0.01) {
      const prev = this.clackPh;
      this.clackPh = (prev + this.clackRate / SR) % 1;
      if (this.clackPh < prev) this.clackEnv = 1;
    } else {
      this.clackPh = 0.999;
    }
    if (this.clackEnv > 1e-4) {
      this.clackEnv *= 0.9988;
      const strike = nz.next() * this.clackEnv * this.clackEnv;
      // The plate's ring, hard-limited as a small speaker driven flat out does: a dense clack, not a spike.
      const ring = this.clackF.process(strike) * 0.5 + this.clackF2.process(strike) * 0.3;
      out += this.clackLevel * Math.min(1, ck * 1.5) * Math.tanh(3 * ring) * 0.35;
    }
    // Caution / warning chimes: one resonator (so repeated strikes add, never cancel) with two overtones, struck
    // with a 5 ms attack, ringing out over about half a second.
    if (this.chimes.length > 0) {
      let env = 0;
      for (let c = this.chimes.length - 1; c >= 0; c--) {
        const ch = this.chimes[c];
        const t = ch.age;
        ch.age += 1 / SR;
        if (t < 0) continue;
        env += ch.amp * (1 - Math.exp(-t / 0.005)) * Math.exp(-t / 0.35);
        if (t > 3) this.chimes.splice(c, 1);
      }
      this.cawsPh = (this.cawsPh + this.cawsHz / SR) % 1;
      const ph = TAU * this.cawsPh;
      out += this.cawsLevel * env * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph)) * 0.25;
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
