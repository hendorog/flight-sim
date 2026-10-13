// Field Guide text for the Deep Time fauna (WP7). Pure data. Honest about the composite: the animals are drawn
// from the best-known Late Cretaceous forms of western North America and the poetic licence is flagged where used.
// Keyed by string so a species added by the art package degrades to a generic entry instead of breaking the build.

import { FAUNA_SPECIES_IDS } from './types';

export interface FieldGuideEntry {
  name: string;
  /** Size in one line, e.g. '12 m long, 4 t'. */
  size: string;
  /** Exactly three facts; the first is the vivid one the sighting toast uses. */
  facts: readonly [string, string, string];
}

export const FIELD_GUIDE_DATA: Readonly<Record<string, FieldGuideEntry>> = {
  edmontosaurus: {
    name: 'Edmontosaurus',
    size: '12 m long, about 4 tonnes',
    facts: [
      'Walks on four legs and bolts on two, so a herd can drop its head to graze and be sprinting a heartbeat later.',
      'A duck-billed hadrosaur with a battery of hundreds of tiny teeth, grinding ferns and conifer needles all day.',
      'Herds moved along the river plain; a big grazer is a moving buffet for tyrannosaurs, which is why they watch the sky.',
    ],
  },
  quetzalcoatlus: {
    name: 'Quetzalcoatlus',
    size: '11 m wingspan, about 200 kg',
    facts: [
      'A giraffe-tall pterosaur that thermals like a vulture, circling kilometres up on the same rising air you are hunting.',
      'Its spear-like beak is toothless; it likely stalked the ground and snapped up whatever fitted.',
      'Poetic licence: Quetzalcoatlus is from Texas at the very end of the Cretaceous; this world is a composite landscape.',
    ],
  },
  azhdarchidSmall: {
    name: 'Small azhdarchid',
    size: '5 m wingspan, about 25 kg',
    facts: [
      'Azhdarchids were terrestrial stalkers: long legs, long neck, picking prey from the ground like a stork.',
      'They fold their wings onto the knuckles and walk on all fours, then launch with a vault from the arms.',
      'The smaller kinds are known from fragments, so this one is a scaled-down stand-in for the whole family.',
    ],
  },
};

export function fieldGuideEntry(id: string): FieldGuideEntry {
  return (
    FIELD_GUIDE_DATA[id] ?? {
      name: id,
      size: 'size unknown',
      facts: ['A creature the guide has yet to describe.', 'More notes after another sighting.', 'Composite fauna, poetic licence applies.'],
    }
  );
}

/** The species the guide lists, in roster order. */
export const FIELD_GUIDE_SPECIES: readonly string[] = FAUNA_SPECIES_IDS;

/** Text of the first-sighting toast: name, size, one vivid fact. */
export function sightingToastText(id: string): string {
  const e = fieldGuideEntry(id);
  return `New in your Field Guide: ${e.name} (${e.size}). ${e.facts[0]}`;
}
