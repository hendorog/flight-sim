// Fauna rosters per era (Deep Time). Owned by the fauna behaviour package (WP5 fills the Cretaceous roster);
// WP0 created it with the present roster ('none') and the Cretaceous one aliased to it, so no fauna system is
// built anywhere until WP5 lands.
//
// Consumers pick ROSTERS[era().fauna]. Pure data.

import type { RosterId } from '../era/types';
import type { FaunaRoster } from './types';

const NONE: FaunaRoster = Object.freeze({ id: 'none', entries: Object.freeze([]) });

export const ROSTERS: Readonly<Record<RosterId, FaunaRoster>> = Object.freeze({
  none: NONE,
  // STUB (WP0): no animals until WP5 (Edmontosaurus herds, Quetzalcoatlus and the small azhdarchid).
  cretaceous: NONE,
});
