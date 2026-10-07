// The keyboard pilot's targets of a type: the optional export `KEYBOARD_PILOT_TARGETS` (a Partial<PilotTargets>) of
// tests/conformance/targets/<id>.ts. The keyboardCircuit block flies with it, and so does scripts/fly-keyboard.mjs,
// which imports this module INTO THE PAGE: browser-safe, no test runner. No export = the C172S's pilotTargets.

import type { PilotTargets } from '../input/keyboardPilot';

/** The targets modules, loaded only when asked for. */
const MODULES = import.meta.glob<Partial<PilotTargets> | undefined>('./targets/*.ts', { import: 'KEYBOARD_PILOT_TARGETS' });

/** The pilot's targets of type `id`, or undefined (no targets file, or no export in it). */
export async function keyboardPilotTargets(id: string): Promise<Partial<PilotTargets> | undefined> {
  const load = MODULES[`./targets/${id}.ts`];
  return load ? await load() : undefined;
}
