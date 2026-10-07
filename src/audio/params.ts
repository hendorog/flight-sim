// Parameter block sent from the main thread to the synthesis worklet every frame.
// The worklet source is prefixed with this table (see synthSource.ts) so both sides share one definition.

export const SYNTH_PARAMS = [
  /** Crankshaft speed used for synthesis, rev/min (includes starter cranking speed). */
  'rpm',
  /** 1 while the engine is producing power (combustion), 0 otherwise. Smoothed in the worklet into start stumble / shutdown. */
  'firing',
  /** Engine load 0..~1.2 from manifold pressure and power: exhaust pulse strength and brightness. */
  'load',
  /** Throttle opening 0..1: intake roar. */
  'throttle',
  /** 1 while the starter motor is engaged. */
  'starter',
  /** 0..1 extra combustion irregularity (lean or over-rich mixture, one magneto). */
  'roughness',
  /** Propeller loading 0..~1.5 (thrust relative to cruise). */
  'propLoad',
  /** Helical blade tip Mach number. */
  'tipMach',
  /** Airframe wind noise level 0..~2 (IAS squared). */
  'windLevel',
  /** Wind noise band centre, Hz. */
  'windFreq',
  /** Sideslip whistle 0..1. */
  'slip',
  /** Flap-extension flow noise 0..1. */
  'flapNoise',
  /** Stall buffet 0..1. */
  'buffet',
  /** Stall warning horn 0..1 (pitch rises with it). */
  'horn',
  /** Flap motor running 0..1. */
  'flapMotor',
  /** Tyre rolling noise level 0..1. */
  'rolling',
  /** Ground speed while rolling, m/s (texture rate). */
  'rollSpeed',
  /** 0 paved, 1 grass/snow, 2 gravel/dirt/rock. */
  'surface',
  /** Brake squeal 0..1. */
  'brakeSqueal',
  /** Tyre skid 0..1. */
  'skid',
  /** Instrument gyro spin 0..1 (gyro whine). */
  'gyro',
  /** Avionics cooling fan 0..1. */
  'fan',
  /** Turbulence 0..1: gust modulation of the wind noise. */
  'turbulence',
  /** Landing-gear hydraulic pump running 0..1. */
  'gearPump',
  /** Gear warning sounding 0..1 (a beeping horn or a repeating chime, by the sound profile). */
  'gearHorn',
  /** Flow noise of the extended landing gear 0..~2.5 (extension x IAS squared). */
  'gearWind',
  /** Propeller shaft speed, rev/min: the blade passage of a geared engine. */
  'propRpm',
  /** Turbocharger speed 0..1 of its speed at full load. */
  'turbo',
] as const;

export type SynthParamName = (typeof SYNTH_PARAMS)[number];

/** name -> index into the Float32Array sent to the worklet (the shared parameters and those of engine 0). */
export const P = Object.fromEntries(SYNTH_PARAMS.map((n, i) => [n, i])) as Record<SynthParamName, number>;

/** The parameters every engine has. Engine 0's are the names above; each further engine has a block of them after the list. */
export const ENGINE_PARAMS = ['rpm', 'firing', 'load', 'throttle', 'starter', 'roughness', 'propLoad', 'tipMach', 'propRpm', 'turbo'] as const;
export type EngineParamName = (typeof ENGINE_PARAMS)[number];
/** Engines the parameter block has room for. */
export const MAX_ENGINES = 2;

/** Per engine: name -> index of its parameters. ENGINE_P[0].rpm === P.rpm. */
export const ENGINE_P: readonly Record<EngineParamName, number>[] = Array.from(
  { length: MAX_ENGINES },
  (_, e) => Object.fromEntries(ENGINE_PARAMS.map((n, k) => [n, e === 0 ? P[n] : SYNTH_PARAMS.length + (e - 1) * ENGINE_PARAMS.length + k])) as Record<EngineParamName, number>,
);
export const PARAM_COUNT = SYNTH_PARAMS.length + (MAX_ENGINES - 1) * ENGINE_PARAMS.length;

/** Worklet outputs (each mono). */
export const STEM = { engine: 0, prop: 1, airframe: 2, cabin: 3 } as const;
export const STEM_COUNT = 4;
