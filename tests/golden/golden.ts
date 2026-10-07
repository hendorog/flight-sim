// Golden-master support: record named numbers during a scripted run and compare them with the values stored
// in tests/golden/data/<file>.json.
//
// The existing tests check the aircraft against handbook figures with 4-10 % bands; they cannot see a change
// in the fifth digit. These records pin the Cessna 172's numbers as they are, so a refactoring step can show
// that it left them alone.
//
//   compare     (default) every recorded value must match the stored one within a RELATIVE 1e-9 (absolute
//               1e-12 near zero). On a mismatch the message gives the worst relative difference and its key,
//               the largest absolute difference and its key, and the first key (in recording order, which is
//               time order) that is out: 1e-13 is a change in the order of some arithmetic, 1e-3 is a change in
//               the model. A value that is itself round-off residue (the sideslip of a parked aircraft, 1e-8)
//               can differ by tens of percent after a harmless reordering: its absolute difference shows that.
//   regenerate  FS_GOLDEN_UPDATE=1 npx vitest run tests/golden   writes the JSON instead of comparing.
//               Only deliberately, after a change that is MEANT to alter the numbers, and with the diff of
//               the JSON reviewed: a regenerated golden proves nothing about the change that prompted it.
//   repeat      FS_GOLDEN_TWICE=1 builds every record a second time in the same process and requires the two
//               to be bit-identical (finds module-level state that leaks from one run into the next).
//   exact       FS_GOLDEN_EXACT=1 npx vitest run tests/golden   every number must be IDENTICAL (===) to the
//               stored one: the mode a refactoring step is judged in (the tolerance above lets a one-ulp change
//               of a constant through in a component record while the whole-aircraft records fail). `===` and
//               not Object.is: a run-time -0 is stored as 0 in JSON and must still pass. Every record prints
//               one line, also when it passes (written to stdout directly, so no reporter hides it):
//                 [golden-exact] <file>/<section>: <n> of <total> values not identical[; worst <key>: ...]
//               where 'worst' is the key with the largest relative difference. Any n > 0 fails the record.
//               The exact mode is for the C172S records only: a record of a type accepted in Stage D (contract
//               4.5) is built with `{ exact: false }` and keeps the tolerance comparison in this mode too; it
//               prints `[golden] <file>/<section>: compared at the tolerance ...` instead.
//
// The rig functions the records are built with are frozen copies under tests/golden/rigs/ (not the helpers of
// the component test directories, which their owners may reshape), and no record iterates a live table of the
// application (parameter names, scenario ids): a name added to such a table must not add a key here.

import { expect } from 'vitest';
import type { Quat, Vec3 } from '../../src/core/math';
import type { AircraftState, ControlInputs } from '../../src/core/types';
import type { AeroOutput, GearOutput, PropulsionOutput } from '../../src/physics/interfaces';

export const RELATIVE_TOLERANCE = 1e-9;
export const ABSOLUTE_TOLERANCE = 1e-12;

/** node:fs, loaded at run time (the project builds without node's types). */
interface Fs {
  existsSync(path: URL): boolean;
  mkdirSync(path: URL, o: { recursive: boolean }): void;
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string): void;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; stdout?: { write(s: string): unknown } } }).process;
const env = proc?.env ?? {};
/**
 * Print a line whatever the reporter: vitest hides console.log of PASSING tests when it runs under a coding
 * agent (its 'minimal' reporter), and the exact-mode summary must be seen exactly then.
 */
function say(line: string): void {
  if (proc?.stdout) proc.stdout.write(`${line}\n`);
  else console.log(line);
}

const DATA_DIR = new URL('./data/', import.meta.url);
const UPDATE = env.FS_GOLDEN_UPDATE === '1';
const TWICE = env.FS_GOLDEN_TWICE === '1';
const EXACT = env.FS_GOLDEN_EXACT === '1';
if (UPDATE && EXACT) throw new Error('FS_GOLDEN_UPDATE=1 and FS_GOLDEN_EXACT=1 together: store or compare, not both');

/** Numbers are compared within the tolerance; booleans and strings (and non-finite numbers, stored as strings) exactly. */
export type GoldenValue = number | boolean | string;
export type GoldenSection = Record<string, GoldenValue>;

/** Collects the values of one record under 'group/field' keys, in the order they are put. */
export class Recorder {
  readonly values: GoldenSection = {};

  put(key: string, value: GoldenValue): void {
    if (key in this.values) throw new Error(`golden key recorded twice: ${key}`);
    // JSON has no NaN or Infinity: keep them as their names, so a value that turns non-finite still shows.
    this.values[key] = typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  }

  vec(key: string, v: Vec3): void {
    this.put(`${key}.x`, v.x);
    this.put(`${key}.y`, v.y);
    this.put(`${key}.z`, v.z);
  }

  quat(key: string, q: Quat): void {
    this.put(`${key}.w`, q.w);
    this.put(`${key}.x`, q.x);
    this.put(`${key}.y`, q.y);
    this.put(`${key}.z`, q.z);
  }

  /** Every element of a (typed) array, as key[0], key[1], ... */
  list(key: string, xs: ArrayLike<number>): void {
    for (let i = 0; i < xs.length; i++) this.put(`${key}[${i}]`, xs[i]);
  }

  /**
   * The complete AircraftState. Fields are listed one by one (not walked), so a field ADDED to the state by a
   * later change does not disturb the record, and one renamed or removed stops the type check.
   */
  state(key: string, s: AircraftState): void {
    const k = (name: string) => `${key}/${name}`;
    this.put(k('time'), s.time);
    this.vec(k('position'), s.position);
    this.vec(k('velocity'), s.velocity);
    this.quat(k('orientation'), s.orientation);
    this.vec(k('angularVelocity'), s.angularVelocity);
    this.put(k('roll'), s.roll);
    this.put(k('pitch'), s.pitch);
    this.put(k('heading'), s.heading);
    this.put(k('track'), s.track);
    this.put(k('altitudeMSL'), s.altitudeMSL);
    this.put(k('altitudeAGL'), s.altitudeAGL);
    this.put(k('verticalSpeed'), s.verticalSpeed);
    this.put(k('groundSpeed'), s.groundSpeed);
    this.put(k('tas'), s.tas);
    this.put(k('ias'), s.ias);
    this.put(k('mach'), s.mach);
    this.put(k('alpha'), s.alpha);
    this.put(k('beta'), s.beta);
    this.vec(k('airVelocityBody'), s.airVelocityBody);
    this.vec(k('specificForce'), s.specificForce);
    this.put(k('gLoad'), s.gLoad);
    this.put(k('slipBall'), s.slipBall);
    this.put(k('staticPressure'), s.staticPressure);
    this.put(k('oat'), s.oat);
    this.put(k('airDensity'), s.airDensity);
    this.put(k('onGround'), s.onGround);
    this.put(k('stallWarning'), s.stallWarning);
    this.put(k('stallFraction'), s.stallFraction);
    this.put(k('crashed'), s.crashed);
    this.put(k('crashReason'), s.crashReason);
    this.put(k('surfaces.elevator'), s.surfaces.elevator);
    this.put(k('surfaces.aileronLeft'), s.surfaces.aileronLeft);
    this.put(k('surfaces.aileronRight'), s.surfaces.aileronRight);
    this.put(k('surfaces.rudder'), s.surfaces.rudder);
    this.put(k('surfaces.flaps'), s.surfaces.flaps);
    this.put(k('surfaces.elevatorTrim'), s.surfaces.elevatorTrim);
    this.engine(k('engine'), s.engine);
    this.put(k('propeller.rpm'), s.propeller.rpm);
    this.put(k('propeller.thrust'), s.propeller.thrust);
    this.put(k('propeller.advanceRatio'), s.propeller.advanceRatio);
    this.put(k('propeller.rotation'), s.propeller.rotation);
    this.wheels(k('wheels'), s.wheels);
    this.put(k('fuel.left'), s.fuel.left);
    this.put(k('fuel.right'), s.fuel.right);
    this.put(k('fuel.capacityEach'), s.fuel.capacityEach);
    this.put(k('mass'), s.mass);
    this.electrical(k('electrical'), s.electrical);
  }

  engine(key: string, e: AircraftState['engine']): void {
    this.put(`${key}.running`, e.running);
    this.put(`${key}.rpm`, e.rpm);
    this.put(`${key}.manifoldPressure`, e.manifoldPressure);
    this.put(`${key}.power`, e.power);
    this.put(`${key}.torque`, e.torque);
    this.put(`${key}.fuelFlow`, e.fuelFlow);
    this.put(`${key}.egt`, e.egt);
    this.put(`${key}.cht`, e.cht);
    this.put(`${key}.oilTemp`, e.oilTemp);
    this.put(`${key}.oilPressure`, e.oilPressure);
    this.put(`${key}.fuelPressure`, e.fuelPressure);
  }

  electrical(key: string, e: AircraftState['electrical']): void {
    this.put(`${key}.busVoltage`, e.busVoltage);
    this.put(`${key}.batteryCharge`, e.batteryCharge);
    this.put(`${key}.alternatorAmps`, e.alternatorAmps);
    this.put(`${key}.batteryAmps`, e.batteryAmps);
  }

  wheels(key: string, wheels: AircraftState['wheels']): void {
    for (const w of wheels) {
      const k = `${key}.${w.name}`;
      this.put(`${k}.compression`, w.compression);
      this.put(`${k}.onGround`, w.onGround);
      this.put(`${k}.load`, w.load);
      this.put(`${k}.spinRate`, w.spinRate);
      this.put(`${k}.rotation`, w.rotation);
      this.put(`${k}.steerAngle`, w.steerAngle);
      this.put(`${k}.skid`, w.skid);
    }
  }

  /** The pilot's controls the flight model reads (the instrument knobs are left out). */
  controls(key: string, c: ControlInputs): void {
    const k = (name: string) => `${key}/${name}`;
    this.put(k('elevator'), c.elevator);
    this.put(k('aileron'), c.aileron);
    this.put(k('rudder'), c.rudder);
    this.put(k('throttle'), c.throttle);
    this.put(k('mixture'), c.mixture);
    this.put(k('flaps'), c.flaps);
    this.put(k('elevatorTrim'), c.elevatorTrim);
    this.put(k('brakeLeft'), c.brakeLeft);
    this.put(k('brakeRight'), c.brakeRight);
    this.put(k('parkingBrake'), c.parkingBrake);
    this.put(k('magnetos'), c.magnetos);
    this.put(k('starter'), c.starter);
    this.put(k('fuelPump'), c.fuelPump);
    this.put(k('fuelSelector'), c.fuelSelector);
    this.put(k('masterBattery'), c.masterBattery);
    this.put(k('alternator'), c.alternator);
  }

  aero(key: string, o: AeroOutput): void {
    this.vec(`${key}/force`, o.force);
    this.vec(`${key}/moment`, o.moment);
    this.put(`${key}/alpha`, o.alpha);
    this.put(`${key}/beta`, o.beta);
    this.put(`${key}/stallFraction`, o.stallFraction);
    this.put(`${key}/stallWarning`, o.stallWarning);
    this.put(`${key}/lift`, o.lift);
    this.put(`${key}/drag`, o.drag);
  }

  propulsion(key: string, o: PropulsionOutput): void {
    this.vec(`${key}/force`, o.force);
    this.vec(`${key}/moment`, o.moment);
    this.engine(`${key}/engine`, o.engine);
    this.put(`${key}/propeller.rpm`, o.propeller.rpm);
    this.put(`${key}/propeller.thrust`, o.propeller.thrust);
    this.put(`${key}/propeller.advanceRatio`, o.propeller.advanceRatio);
    this.put(`${key}/propeller.rotation`, o.propeller.rotation);
    this.vec(`${key}/slipstream.origin`, o.slipstream.origin);
    this.put(`${key}/slipstream.radius`, o.slipstream.radius);
    this.put(`${key}/slipstream.inducedVelocity`, o.slipstream.inducedVelocity);
    this.put(`${key}/slipstream.swirlRate`, o.slipstream.swirlRate);
    this.vec(`${key}/angularMomentum`, o.angularMomentum);
    this.put(`${key}/fuelUsed.left`, o.fuelUsed.left);
    this.put(`${key}/fuelUsed.right`, o.fuelUsed.right);
    this.electrical(`${key}/electrical`, o.electrical);
  }

  gear(key: string, o: GearOutput): void {
    this.vec(`${key}/force`, o.force);
    this.vec(`${key}/moment`, o.moment);
    this.wheels(`${key}/wheels`, o.wheels);
    this.put(`${key}/onGround`, o.onGround);
    this.put(`${key}/crash`, o.crash);
  }
}

/** Relative difference of two numbers as the comparison measures it (0 inside the absolute tolerance). */
function relativeDifference(a: number, b: number): number {
  const d = Math.abs(a - b);
  if (d <= ABSOLUTE_TOLERANCE) return 0;
  return d / Math.max(Math.abs(a), Math.abs(b));
}

/** Differences between a record and its stored golden, one line each; empty when they agree. */
export function compareSections(actual: GoldenSection, stored: GoldenSection): string[] {
  const problems: string[] = [];
  let worst = 0, worstKey = '';
  let worstAbs = 0, worstAbsKey = '';
  let first = '';
  let out = 0, compared = 0;
  for (const key of Object.keys(actual)) {
    if (!(key in stored)) {
      problems.push(`recorded but not in the golden: ${key}`);
      continue;
    }
    const a = actual[key], b = stored[key];
    if (typeof a === 'number' && typeof b === 'number') {
      compared++;
      const rel = relativeDifference(a, b);
      if (rel > worst) {
        worst = rel;
        worstKey = key;
      }
      if (Math.abs(a - b) > worstAbs) {
        worstAbs = Math.abs(a - b);
        worstAbsKey = key;
      }
      if (rel > RELATIVE_TOLERANCE) {
        out++;
        first ||= `${key}: ${a} (golden ${b}, relative difference ${rel.toExponential(2)})`;
      }
    } else if (a !== b) {
      problems.push(`${key}: ${JSON.stringify(a)} (golden ${JSON.stringify(b)})`);
    }
  }
  for (const key of Object.keys(stored)) if (!(key in actual)) problems.push(`in the golden but not recorded: ${key}`);
  if (out > 0) {
    problems.unshift(
      `${out} of ${compared} numbers differ by more than ${RELATIVE_TOLERANCE} relative`,
      `worst relative difference ${worst.toExponential(2)} at ${worstKey}: ${actual[worstKey]} (golden ${stored[worstKey]})`,
      `largest absolute difference ${worstAbs.toExponential(2)} at ${worstAbsKey}: ${actual[worstAbsKey]} (golden ${stored[worstAbsKey]})`,
      `first out of tolerance: ${first}`,
    );
  }
  return problems;
}

/** Result of the exact comparison of a record with its stored golden. */
export interface ExactComparison {
  /** Keys in the record or in the golden. */
  total: number;
  /** Keys whose values are not identical (numbers by ===, so -0 equals 0), or that only one side has. */
  differing: number;
  /** The key with the largest relative difference (or, when no pair of numbers differs, the first differing key); '' when none. */
  worstKey: string;
  /** |a - b| / max(|a|, |b|) at the worst key (0 when it is not a pair of numbers). */
  worstRelative: number;
  /** |a - b| at the worst key. */
  worstAbsolute: number;
  /** One line per differing key, in recording order. */
  problems: string[];
}

/** Exact comparison (FS_GOLDEN_EXACT=1): every value identical, no tolerance. */
export function compareExact(actual: GoldenSection, stored: GoldenSection): ExactComparison {
  const x: ExactComparison = { total: 0, differing: 0, worstKey: '', worstRelative: 0, worstAbsolute: 0, problems: [] };
  let firstOther = '';
  for (const key of Object.keys(actual)) {
    x.total++;
    if (!(key in stored)) {
      x.differing++;
      firstOther ||= key;
      x.problems.push(`recorded but not in the golden: ${key}`);
      continue;
    }
    const a = actual[key], b = stored[key];
    // `===`: numbers identical except that -0 equals 0 (JSON stores -0 as 0); NaN and the infinities were
    // recorded as their names (Recorder.put), so they compare as strings.
    if (a === b) continue;
    x.differing++;
    if (typeof a === 'number' && typeof b === 'number') {
      const abs = Math.abs(a - b);
      const rel = abs / Math.max(Math.abs(a), Math.abs(b));
      if (rel > x.worstRelative) {
        x.worstRelative = rel;
        x.worstAbsolute = abs;
        x.worstKey = key;
      }
      x.problems.push(`${key}: ${a} (golden ${b}, relative ${rel.toExponential(2)}, absolute ${abs.toExponential(2)})`);
    } else {
      firstOther ||= key;
      x.problems.push(`${key}: ${JSON.stringify(a)} (golden ${JSON.stringify(b)})`);
    }
  }
  for (const key of Object.keys(stored)) {
    if (key in actual) continue;
    x.total++;
    x.differing++;
    firstOther ||= key;
    x.problems.push(`in the golden but not recorded: ${key}`);
  }
  if (x.worstKey === '') x.worstKey = firstOther;
  return x;
}

/** The one line an exact-mode record prints (work/baseline/golden-exact.txt holds them for the untouched tree). */
export function exactSummary(name: string, x: ExactComparison, actual: GoldenSection, stored: GoldenSection): string {
  let line = `[golden-exact] ${name}: ${x.differing} of ${x.total} values not identical`;
  if (x.differing > 0) {
    const a = actual[x.worstKey], b = stored[x.worstKey];
    line += `; worst ${x.worstKey}: ${JSON.stringify(a)} (golden ${JSON.stringify(b)})`;
    if (typeof a === 'number' && typeof b === 'number') line += `, relative ${x.worstRelative.toExponential(2)}, absolute ${x.worstAbsolute.toExponential(2)}`;
  }
  return line;
}

type GoldenFile = Record<string, GoldenSection>;
const files = new Map<string, GoldenFile>();

function load(file: string): GoldenFile {
  let data = files.get(file);
  if (!data) {
    const path = new URL(`${file}.json`, DATA_DIR);
    data = fs.existsSync(path) ? (JSON.parse(fs.readFileSync(path, 'utf8')) as GoldenFile) : {};
    files.set(file, data);
  }
  return data;
}

export interface GoldenOptions {
  /**
   * false: the record is compared at the tolerance even under FS_GOLDEN_EXACT=1 (the goldens of the types
   * accepted in Stage D, contract 4.0 and 4.5). Default true: every C172S record.
   */
  exact?: boolean;
}

/** How a record is compared: exactly when the run asks for it (FS_GOLDEN_EXACT=1) and the record allows it. */
export function comparisonMode(exactRun: boolean, options: GoldenOptions = {}): 'exact' | 'tolerance' {
  return exactRun && options.exact !== false ? 'exact' : 'tolerance';
}

/**
 * Build one record with `build` and compare it with section `section` of tests/golden/data/<file>.json (or
 * store it there, see the header). Returns the number of values in the record.
 */
export function golden(file: string, section: string, build: (r: Recorder) => void, options: GoldenOptions = {}): number {
  const rec = new Recorder();
  build(rec);
  const actual = rec.values;
  const count = Object.keys(actual).length;
  if (count === 0) throw new Error(`golden ${file}/${section}: nothing recorded`);

  if (TWICE) {
    const again = new Recorder();
    build(again);
    const differing = Object.keys(actual).filter((k) => !Object.is(actual[k], again.values[k]));
    expect(differing, `${file}/${section}: a second run in the same process is not bit-identical`).toEqual([]);
  }

  const data = load(file);
  if (UPDATE) {
    data[section] = actual;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(new URL(`${file}.json`, DATA_DIR), `${JSON.stringify(data, null, 1)}\n`);
    say(`[golden] ${file}/${section}: stored ${count} values`);
    return count;
  }
  const stored = data[section];
  if (!stored) throw new Error(`golden ${file}/${section}: no stored values (generate them with FS_GOLDEN_UPDATE=1)`);
  const mode = comparisonMode(EXACT, options);
  if (mode === 'exact') {
    const x = compareExact(actual, stored);
    say(exactSummary(`${file}/${section}`, x, actual, stored));
    if (x.differing > 0) {
      const shown = x.problems.slice(0, 12);
      if (x.problems.length > shown.length) shown.push(`... and ${x.problems.length - shown.length} more`);
      expect.fail(`golden ${file}/${section} is not identical (FS_GOLDEN_EXACT=1): ${x.differing} of ${x.total} values, worst ${x.worstKey}\n  ${shown.join('\n  ')}`);
    }
    return count;
  }
  const problems = compareSections(actual, stored);
  if (EXACT) say(`[golden] ${file}/${section}: compared at the tolerance ${RELATIVE_TOLERANCE} (exact mode is for the C172S records), ${problems.length === 0 ? 'within' : 'NOT within'}`);
  if (problems.length > 0) {
    const shown = problems.slice(0, 12);
    if (problems.length > shown.length) shown.push(`... and ${problems.length - shown.length} more`);
    expect.fail(`golden ${file}/${section} differs:\n  ${shown.join('\n  ')}`);
  }
  return count;
}
