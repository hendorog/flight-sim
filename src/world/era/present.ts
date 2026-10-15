// The present day: every value is what the world was before eras existed (offsets 0, every flag on, no
// volcano, today's airport, grass on the airfield flat, the Flight School, no weather preset). Code paths taken
// when isPresent() must not read anything from here that would change them; see types.ts.

import type { EraParams } from './types';

export const PRESENT: EraParams = Object.freeze({
  id: 'present',
  label: 'Present day',
  epoch: '',
  blurb: 'Today’s valley: the airfield, the town, farmland and forest under the Alps.',
  terrain: Object.freeze({ treeLineOffset: 0, snowLineOffset: 0, farmland: true, town: true, marsh: false, volcano: null }),
  palette: 'present',
  flora: 'present',
  fauna: 'none',
  world: Object.freeze({ airport: 'modern', flatSurface: 'grass', school: true, towerCamera: true }),
  weather: Object.freeze({}),
} as const satisfies EraParams);
