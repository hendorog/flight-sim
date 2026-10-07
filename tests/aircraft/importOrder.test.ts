// Import order of the aircraft definition files and of the components built from them.
//
// A definition file (src/aircraft/<id>/*.ts) and a component module may never import EACH OTHER: which of the
// two is evaluated first then depends on the module the program happened to enter through, and the one that
// comes second reads constants of a module whose body has not run. In the browser that is "Cannot access ...
// before initialization" from one entry and a working program from another. Under this test runner it does not
// even throw: the constant reads as `undefined`, and a definition is built with holes in it.
//
// So the test does not only load: every aircraft file and every component module is imported ALONE, as the
// first module of a fresh registry, and then all exported VALUES of the aircraft files and of the components
// bound to them must be what they are after any other entry. Then the two groups one after the other, in both
// orders.
//
// While a definition file still refers to a component's constants BY REFERENCE, that import carries the mark
// `// BYREF(<slot>)` with the slot that will move the numbers into the definition file and turn the import
// round. The second half reads the source text: an import of an aircraft leaf file that leaves src/aircraft
// either is marked or goes to a PURE module (one that reaches no aircraft file), and no mark is left of a slot
// that has finished.

import { describe, expect, it, vi } from 'vitest';

function fromSrc<T>(found: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(found).map(([path, v]) => [path.replace('../../src/', ''), v]));
}

/** Every module under src/ by its path from there ('aircraft/c172s/sim.ts'): a function that imports it now. */
const LOADERS = fromSrc(import.meta.glob('../../src/**/*.ts'));
/** The source text of the same modules. */
const SOURCES = fromSrc(import.meta.glob<string>('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }));

/** The slots that invert by-reference imports, and those of them whose refactor pass has been accepted. */
const INVERTING_SLOTS = ['B2', 'B5a', 'B5b', 'B6', 'C1a', 'C2', 'C3'];
const FINISHED_SLOTS: readonly string[] = ['B2', 'B5a', 'B5b', 'B6', 'C1a', 'C2', 'C3'];

/**
 * Modules the program, the tests and the tools enter through. The modules the definition files refer to are
 * added from the source text below, so this list is only what no definition file names.
 */
const ENTRY_MODULES = [
  'physics/index.ts',
  'physics/aero/index.ts',
  'physics/gear/index.ts',
  'physics/propulsion/index.ts',
  'physics/c172FlightModel.ts',
  'core/mockState.ts',
  'sim/SimPhysics.ts',
  'sim/Simulator.ts',
  'sim/params.ts',
  'sim/scenarios.ts',
  'sim/starts.ts',
  'sim/autoflight.ts',
  'instruments/index.ts',
  'input/index.ts',
  'audio/index.ts',
  'ui/index.ts',
  'render/aircraft/AircraftVisual.ts',
  'training/index.ts',
  'training/TrainingSystem.ts',
  'training/aircraft/registry.ts',
];

/**
 * A browser-side module may come to need the page at import time; it can then not be loaded here, which is no
 * fault of the order. Not accepted from an aircraft file.
 */
const NEEDS_BROWSER = /^ReferenceError: (document|window|self|location|navigator|localStorage|requestAnimationFrame|Worker|OffscreenCanvas|Audio\w*|HTML\w*) is not defined/;

interface ValueImport {
  /** The imported module by its path from src/, or null for a package, a `?raw` text or a file that is not TypeScript. */
  target: string | null;
  specifier: string;
  /** The slot of the `// BYREF(<slot>)` mark on the statement's last line, or null. */
  mark: string | null;
}

function resolve(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.') || specifier.includes('?')) return null;
  const parts = file.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  const path = parts.join('/');
  return [path, `${path}.ts`, `${path}/index.ts`].find((candidate) => candidate.endsWith('.ts') && candidate in SOURCES) ?? null;
}

/** True for `import type ...`, `export type ...` and a list whose every name is `type X`: nothing is loaded. */
function typeOnly(clause: string): boolean {
  const text = clause.trim();
  if (/^type\b\s*[\w{*]/.test(text)) return true;
  const list = /^\{([\s\S]*)\}$/.exec(text);
  if (!list) return false;
  const names = list[1].split(',').map((name) => name.trim()).filter((name) => name !== '');
  return names.length > 0 && names.every((name) => name.startsWith('type '));
}

/** The static imports and re-exports of a module that load another module (dynamic import() is not one). */
function valueImports(file: string, source: string): ValueImport[] {
  // Without the comments (a remark inside an import list), except the marks.
  const code = source.replace(/\/\/(?! BYREF\()[^\n]*/g, '').replace(/\/\*[^\n]*?\*\//g, '');
  const found: ValueImport[] = [];
  const add = (specifier: string, tail: string) =>
    found.push({ target: resolve(file, specifier), specifier, mark: /\/\/ BYREF\(([\w-]+)\)/.exec(tail)?.[1] ?? null });
  // Between the keyword and `from` only what an import clause is made of, so that no other statement is taken for one.
  for (const m of code.matchAll(/^(?:import|export)\b([\w\s,{}*$]*?)\bfrom\s*'([^']+)';?([^\n]*)/gm)) {
    if (!typeOnly(m[1])) add(m[2], m[3]);
  }
  for (const m of code.matchAll(/^import\s*'([^']+)';?([^\n]*)/gm)) add(m[1], m[2]);
  return found;
}

const IMPORTS = new Map(Object.entries(SOURCES).map(([file, source]) => [file, valueImports(file, source)]));

/**
 * Every module that loading `file` loads, itself included. `marked: false` leaves the BYREF imports out: what
 * the file will load once they have been turned round.
 */
function closure(file: string, marked = true, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const i of IMPORTS.get(file) ?? []) if (i.target && (marked || i.mark === null)) closure(i.target, marked, seen);
  return seen;
}

const isAircraft = (file: string) => file.startsWith('aircraft/');
/** A file of one type's directory, other than the two that assemble the rest. */
const isLeaf = (file: string) => /^aircraft\/[^/]+\/[^/]+\.ts$/.test(file) && !/\/(index|presentation)\.ts$/.test(file);

const AIRCRAFT_FILES = Object.keys(SOURCES).filter(isAircraft).sort();
const LEAF_FILES = AIRCRAFT_FILES.filter(isLeaf);

/** A module of the program proper: not an aircraft file, not a page script (those run their page when imported). */
const isComponent = (file: string) => !isAircraft(file) && !file.startsWith('dev/') && file !== 'main.ts';

/**
 * The components BOUND to the aircraft files: what an aircraft file imports, the target of every BYREF import,
 * and every module that imports an aircraft file. Their exported values are compared, like the aircraft files'.
 */
const BOUND_MODULES = [
  ...new Set([
    ...AIRCRAFT_FILES.flatMap((file) => IMPORTS.get(file)!.map((i) => i.target)),
    ...[...IMPORTS.values()].flatMap((imports) => imports.filter((i) => i.mark !== null).map((i) => i.target)),
    ...[...IMPORTS].filter(([, imports]) => imports.some((i) => i.target !== null && isAircraft(i.target))).map(([file]) => file),
  ]),
].filter((file): file is string => file !== null && isComponent(file)).sort();

const COMPONENT_MODULES = [...new Set([...ENTRY_MODULES, ...BOUND_MODULES])];

async function load(file: string): Promise<{ exports: Record<string, unknown> | null; error: string | null }> {
  try {
    return { exports: (await LOADERS[file]()) as Record<string, unknown>, error: null };
  } catch (e) {
    return { exports: null, error: String(e) };
  }
}

/**
 * One line per exported value, down to the numbers: 'C172S_MASS.loadings.typical.payload = 200'. Plain objects
 * and arrays are followed; a function and an instance of a class are only named (two evaluations make two of
 * them, and nothing here needs to tell them apart).
 */
function describeExports(exports: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const seen = new Set<object>();
  const walk = (value: unknown, path: string, depth: number): void => {
    if (typeof value === 'function') return void lines.push(`${path} = function`);
    if (typeof value === 'string') return void lines.push(`${path} = ${JSON.stringify(value)}`);
    if (value === null || typeof value !== 'object') return void lines.push(`${path} = ${String(value)}`);
    if (ArrayBuffer.isView(value)) {
      const numbers = value as unknown as ArrayLike<number>;
      return void lines.push(`${path} = ${value.constructor.name}(${numbers.length}) ${Array.prototype.slice.call(numbers, 0, 8).join(' ')}`);
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return void lines.push(`${path} = <${value.constructor?.name ?? 'object'}>`);
    if (seen.has(value)) return void lines.push(`${path} = <above>`);
    if (depth >= 16) return void lines.push(`${path} = <deeper>`);
    seen.add(value);
    const keys = Object.keys(value);
    if (keys.length === 0) lines.push(`${path} = ${Array.isArray(value) ? '[]' : '{}'}`);
    for (const key of keys) walk((value as Record<string, unknown>)[key], Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, depth + 1);
  };
  for (const name of Object.keys(exports).sort()) walk(exports[name], name, 0);
  return lines;
}

interface Evaluation {
  /** A module that did not load: 'file: error'. */
  errors: string[];
  /** The exported values of every watched module that loaded. */
  values: Map<string, string[]>;
}

/** A fresh registry; the modules of `first` in that order; then every watched module, whatever is left of them. */
async function evaluate(first: readonly string[], watched: readonly string[]): Promise<Evaluation> {
  vi.resetModules();
  const errors: string[] = [];
  const values = new Map<string, string[]>();
  for (const file of first) {
    const { error } = await load(file);
    if (error !== null) errors.push(`${file}: ${error}`);
  }
  for (const file of watched) {
    const { exports, error } = await load(file);
    if (exports !== null) values.set(file, describeExports(exports));
    else if (!first.includes(file)) errors.push(`${file}: ${error}`);
  }
  return { errors, values };
}

/** Where `got` departs from `reference`: the first line of each module that is not the same. */
function departures(got: Evaluation, reference: Evaluation): string[] {
  const found = [...got.errors];
  for (const [file, want] of reference.values) {
    const lines = got.values.get(file);
    if (!lines) continue;
    const at = want.findIndex((line, i) => line !== lines[i]);
    if (at >= 0) found.push(`${file}: ${lines[at] ?? '(no more values)'}; otherwise ${want[at]}`);
    else if (lines.length > want.length) found.push(`${file}: ${lines[want.length]}; otherwise no more values`);
  }
  return found;
}

interface Baseline {
  /** The component modules that load here (see NEEDS_BROWSER), and the failures of the others. */
  loadable: string[];
  broken: string[];
  /** The aircraft files and the bound components that load. */
  watched: string[];
  /** Their values when they are loaded in that order and nothing before them. */
  reference: Evaluation;
}

let baselineOnce: Promise<Baseline> | null = null;
function baseline(): Promise<Baseline> {
  return (baselineOnce ??= (async () => {
    const loadable: string[] = [];
    const broken: string[] = [];
    for (const file of COMPONENT_MODULES) {
      vi.resetModules();
      const { error } = await load(file);
      if (error === null) loadable.push(file);
      else if (!NEEDS_BROWSER.test(error)) broken.push(`${file}: ${error}`);
    }
    const watched = [...AIRCRAFT_FILES, ...BOUND_MODULES.filter((file) => loadable.includes(file))];
    return { loadable, broken, watched, reference: await evaluate([], watched) };
  })());
}

/** Every module of `entries` as the only module loaded before the watched ones. */
async function enterThrough(entries: readonly string[]): Promise<string[]> {
  const { watched, reference } = await baseline();
  const found: string[] = [];
  for (const entry of entries) {
    for (const departure of departures(await evaluate([entry], watched), reference)) found.push(`entering through ${entry}: ${departure}`);
  }
  // The first few say it; a ring shows up from many entries.
  return found.slice(0, 12);
}

// The tests that evaluate take their own time limit: together they evaluate the module graph about a hundred
// times, which is seconds alone and several times that while the whole suite keeps every core busy.
describe('load order', () => {
  it('finds the files it is about', () => {
    for (const file of ['aircraft/registry.ts', 'aircraft/c172s/index.ts', 'aircraft/c172s/presentation.ts', 'aircraft/c172s/sim.ts']) {
      expect(AIRCRAFT_FILES, file).toContain(file);
    }
    for (const file of ENTRY_MODULES) expect(Object.keys(LOADERS), file).toContain(file);
    expect(LEAF_FILES.length).toBeGreaterThanOrEqual(12);
    // The application shell is bound to the default aircraft.
    expect(BOUND_MODULES).toContain('sim/Simulator.ts');
  });

  it('a fresh registry evaluates the modules again, to the same values', async () => {
    const { watched, reference, broken } = await baseline();
    expect(broken).toEqual([]);
    expect(reference.errors).toEqual([]);
    for (const file of AIRCRAFT_FILES.filter((f) => f !== 'aircraft/types.ts')) expect(reference.values.get(file)?.length, file).toBeGreaterThan(0);
    const geometry = (await LOADERS['aircraft/c172s/geometry.ts']()) as { C172S_GEOMETRY: object };
    const again = await evaluate([], watched);
    expect(((await LOADERS['aircraft/c172s/geometry.ts']()) as typeof geometry).C172S_GEOMETRY).not.toBe(geometry.C172S_GEOMETRY);
    expect(departures(again, reference)).toEqual([]);
    // The values are followed down to the numbers.
    expect(reference.values.get('aircraft/c172s/geometry.ts')).toContain('C172S_GEOMETRY.propellers[0].blades = 2');
    expect(reference.values.get('aircraft/c172s/index.ts')).toContain('C172S_DEFINITION.aero = function');
  }, 60_000);

  it('every aircraft file may be the first module loaded', async () => {
    expect(await enterThrough(AIRCRAFT_FILES)).toEqual([]);
  }, 60_000);

  it('every component module may be the first module loaded', async () => {
    const { loadable, broken } = await baseline();
    expect(broken).toEqual([]);
    // The flight model side has no excuse: it runs without a page.
    for (const file of ENTRY_MODULES.filter((entry) => /^(physics|core|sim\/(?!Simulator))/.test(entry))) expect(loadable, file).toContain(file);
    expect(await enterThrough(loadable)).toEqual([]);
  }, 60_000);

  it('the aircraft files first and then the components, and the other way round', async () => {
    const { loadable, watched, reference } = await baseline();
    expect(departures(await evaluate([...AIRCRAFT_FILES, ...loadable], watched), reference)).toEqual([]);
    expect(departures(await evaluate([...loadable, ...AIRCRAFT_FILES], watched), reference)).toEqual([]);
    expect(departures(await evaluate([...loadable].reverse(), [...watched].reverse()), reference)).toEqual([]);
  }, 60_000);
});

describe('by-reference imports', () => {
  it('the reader of import statements knows the forms the sources use', () => {
    const sample = [
      "import type { A } from './autopilot';",
      "import { type B, type C } from './airData';",
      "import { D, type E } from './massModel'; // BYREF(C1a)",
      'import {',
      "  F, // the tab's travel; nose down",
      '  G,',
      "} from './controlSystem'; // BYREF(C1a)",
      "import * as THREE from 'three';",
      "import text from './worklet/aircraftSynth.js?raw';",
      "import './trim';",
      "export { H } from './atmosphere';",
      "export type { I } from './interfaces';",
      "export type * from './environment';",
      "export * from './rigidBody';",
      'export const J = 1;',
      'export interface K {',
      "  /** Taken from './nowhere'. */",
      '  k: number;',
      '}',
      "export function l(): string { return `taken from './nowhere'`; }",
      "const lazy = () => import('./c172FlightModel');",
    ].join('\n');
    expect(valueImports('physics/sample.ts', sample)).toEqual([
      { target: 'physics/massModel.ts', specifier: './massModel', mark: 'C1a' },
      { target: 'physics/controlSystem.ts', specifier: './controlSystem', mark: 'C1a' },
      { target: null, specifier: 'three', mark: null },
      { target: null, specifier: './worklet/aircraftSynth.js?raw', mark: null },
      { target: 'physics/atmosphere.ts', specifier: './atmosphere', mark: null },
      { target: 'physics/rigidBody.ts', specifier: './rigidBody', mark: null },
      { target: 'physics/trim.ts', specifier: './trim', mark: null },
    ]);
    expect(resolve('aircraft/c172s/index.ts', '../../physics/aero')).toBe('physics/aero/index.ts');
    expect(resolve('aircraft/registry.ts', './c172s/index')).toBe('aircraft/c172s/index.ts');
  });

  it('an aircraft leaf file reaches outside src/aircraft only for pure modules, or marks the import BYREF', () => {
    const unmarked: string[] = [];
    for (const file of LEAF_FILES) {
      for (const i of IMPORTS.get(file)!) {
        if (i.target === null || isAircraft(i.target) || i.mark !== null) continue;
        // aircraft/types.ts is types only: nothing of it is there to be loaded.
        const reached = [...closure(i.target)].filter((f) => isAircraft(f) && f !== 'aircraft/types.ts');
        if (reached.length > 0) unmarked.push(`${file} imports '${i.specifier}', which loads ${reached[0]}`);
      }
    }
    expect(unmarked).toEqual([]);
  });

  it('an airframe visual is loadable in the livery worker: project modules only, no three.js, no flight model', () => {
    for (const file of AIRCRAFT_FILES.filter((f) => f.endsWith('/visual.ts'))) {
      const loaded = [...closure(file)];
      expect(loaded.flatMap((f) => IMPORTS.get(f)!).filter((i) => i.target === null).map((i) => i.specifier), file).toEqual([]);
      expect(loaded.filter((f) => /^aircraft\/([^/]+\/index|registry|placeholder)\.ts$/.test(f)), file).toEqual([]);
    }
    // The loader the worker imports has no static import at all; its six targets are dynamic.
    expect(IMPORTS.get('aircraft/visualLoader.ts')).toEqual([]);
  });

  it('the definition tier does not load the presentation tier', () => {
    for (const file of AIRCRAFT_FILES.filter((f) => f.endsWith('/index.ts')).concat('aircraft/registry.ts', 'aircraft/placeholder.ts')) {
      expect([...closure(file)].filter((f) => /^aircraft\/[^/]+\/(presentation|visual|panel|ui|audio|training)\.ts$/.test(f)), file).toEqual([]);
      // The by-reference imports still reach into the component directories; what stays when they are gone does not.
      expect([...closure(file, false)].filter((f) => /^(render|instruments|ui|audio|training)\//.test(f)), file).toEqual([]);
    }
  });

  it('every mark names the slot that will turn the import round, and no finished slot has one left', () => {
    const marks: { file: string; slot: string }[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const m of source.matchAll(/\bBYREF\(([^)]*)\)/g)) marks.push({ file, slot: m[1] });
    }
    for (const { file, slot } of marks) expect(INVERTING_SLOTS, `${file}: BYREF(${slot})`).toContain(slot);
    expect(marks.filter((m) => FINISHED_SLOTS.includes(m.slot))).toEqual([]);
    for (const slot of FINISHED_SLOTS) expect(INVERTING_SLOTS).toContain(slot);
    // A mark that is not on an import statement would be missed by the rules above.
    const onImports = [...IMPORTS.values()].flat().filter((i) => i.mark !== null).length;
    expect(marks.length).toBe(onImports);
  });
});
