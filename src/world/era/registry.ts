// Every era by id. Pure (workers, node tests).

import { CRETACEOUS } from './cretaceous';
import { PRESENT } from './present';
import { ERA_IDS, type EraId, type EraParams } from './types';

export const ERAS: Readonly<Record<EraId, EraParams>> = Object.freeze({ present: PRESENT, cretaceous: CRETACEOUS });

export function isEraId(v: unknown): v is EraId {
  return typeof v === 'string' && (ERA_IDS as readonly string[]).includes(v);
}

/** The era with this id; anything unknown (null, a typo, a future id) is the present day. */
export function eraById(id: unknown): EraParams {
  return isEraId(id) ? ERAS[id] : PRESENT;
}
