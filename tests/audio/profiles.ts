// Sound profiles for the audio tests: the Cessna 172S profile with some of its numbers changed.

import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import type { AudioProfile } from '../../src/audio/profile';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

/** A copy of the Cessna 172S profile after `edit` has changed it. */
export function variant(edit: (p: Mutable<AudioProfile>) => void = () => undefined): AudioProfile {
  const p = structuredClone(C172S_AUDIO) as Mutable<AudioProfile>;
  edit(p);
  return p;
}
