// Lockheed AH-56A Cheyenne: the typed patch the stage owners write and the merge the assembly uses. FROZEN at the
// scaffold (integrator-owned). Plan revision 2, section 2.3.
//
// `Partial<RotorcraftDefinition>` is shallow, so it could not hold a partial `main` or a partial turboshaft governor;
// AH56Patch can. mergeDefinition() deep-merges exactly main, systems, systems.turboshaft and systems.turboshaft.governor
// (so AC's governor.propAnticipation cannot clobber AG's systems); every other key is replaced, later patches last.
// Plain data in, plain data out (codemap rule 4: the visual deep-equals it and is structured-cloned).
import type { RotorDefinition, RotorcraftDefinition, TurboshaftControlDef } from '../../physics/rotorcraft/definition';

export type AH56Patch = Omit<Partial<RotorcraftDefinition>, 'main' | 'systems'> & {
  main?: Partial<RotorDefinition>;
  systems?: Omit<Partial<RotorcraftDefinition['systems']>, 'turboshaft'> & {
    turboshaft?: Omit<Partial<TurboshaftControlDef>, 'governor'> & { governor?: Partial<TurboshaftControlDef['governor']> };
  };
};

export function mergeDefinition(base: RotorcraftDefinition, ...patches: readonly AH56Patch[]): RotorcraftDefinition {
  let out: RotorcraftDefinition = base;
  for (const p of patches) {
    const { main, systems, ...rest } = p;
    let mergedSystems = out.systems;
    if (systems) {
      const { turboshaft: ts, ...otherSystems } = systems;
      const baseTs = out.systems.turboshaft;
      const mergedTs = ts ? { ...baseTs, ...ts, governor: { ...baseTs?.governor, ...ts.governor } } as TurboshaftControlDef : baseTs;
      mergedSystems = { ...out.systems, ...otherSystems, ...(mergedTs ? { turboshaft: mergedTs } : {}) } as RotorcraftDefinition['systems'];
    }
    out = { ...out, ...rest, main: main ? { ...out.main, ...main } : out.main, systems: mergedSystems } as RotorcraftDefinition;
  }
  return out;
}
