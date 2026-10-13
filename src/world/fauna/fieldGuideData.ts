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
  tyrannosaurus: {
    name: 'Tyrannosaurus rex',
    size: '12 m long, about 8 tonnes',
    facts: [
      'The biggest land predator of its world: a bite strong enough to crush bone, and eyes set forward to judge the distance to its prey.',
      'It lived at the very end of the Cretaceous, about 68-66 million years ago, from Montana to Saskatchewan, beside the Edmontosaurus it hunted.',
      'Healed Tyrannosaurus bite marks on Edmontosaurus tails show it attacked live prey; the charge and the roar here are a dramatisation.',
    ],
  },
  triceratops: {
    name: 'Triceratops',
    size: '8-9 m long, 6-12 tonnes',
    facts: [
      'Three horns and a solid bony frill, turned toward trouble: it stands its ground where the duckbills run.',
      'A Hell Creek neighbour of Tyrannosaurus and Edmontosaurus, about 68-66 million years ago; one of the commonest big animals of its plain.',
      'Whether it lived in herds is unknown (most finds are single animals); the group here is poetic licence.',
    ],
  },
  alamosaurus: {
    name: 'Alamosaurus',
    size: 'about 26 m long, 30-40 tonnes',
    facts: [
      'The last of the giant long-necked sauropods in North America, tall enough to browse the tops of the trees.',
      'Its bones come from southern Laramidia (New Mexico, Texas, Utah), 69-66 million years ago, far south of the T. rex and Triceratops country it shares here: a composite.',
      'Known from partial skeletons, so its true length is an estimate; some vertebrae hint that it grew larger still.',
    ],
  },
  pteranodon: {
    name: 'Pteranodon',
    size: '6-7 m wingspan, about 25-50 kg',
    facts: [
      'A toothless, long-crested pterosaur that soared like an albatross, its swept-back crest a signpost in the sky.',
      'It lived about 86-84 million years ago, some twenty million years before the other animals here.',
      'A seabird of the Western Interior Seaway that fished far from land; poetic licence brings it inland to circle with the azhdarchids.',
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
