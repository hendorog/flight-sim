// Registrations of the Career's airframes (docs/career.md "Data model"): one per fleet aircraft, a pure function
// of its uid and the registration authority of the school's settings (EASA by default), so the hub, the logbook
// and the radio show the same marks after every reload without storing a second copy's rules.
//
// EASA-style marks are 'G-' and four letters (the UK register's form), FAA-style 'N', three digits (the first not
// 0) and two letters. Fleet uids are 'a1', 'a2', ...: their number is spread over the whole mark space by a
// bijective affine permutation (n x a + b mod the space size, a coprime with it), so no two airframes of one
// career share a mark and neighbouring uids do not get neighbouring marks. Any other uid is hashed (FNV-1a) into
// the same space. All marks are fictitious game data.

import type { AuthorityId } from '../training/types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** EASA: four letters, 26^4 marks. */
const EASA_SPACE = 26 ** 4;
/** FAA: 100-999 then two letters, 900 x 26^2 marks. */
const FAA_SPACE = 900 * 26 * 26;
/** The permutation's multiplier (a prime coprime with both spaces) and offset. */
const MULT = 7919;
const OFFSET = 104_729;

/** FNV-1a 32-bit of a string. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Index of a uid in a mark space of `size`: the affine permutation of its number, or a hash for other uids. */
function indexOf(uid: string, size: number): number {
  const m = /^a(\d{1,9})$/.exec(uid);
  if (m) return (((Number(m[1]) % size) * MULT + OFFSET) % size + size) % size;
  return fnv1a(uid) % size;
}

/** `n` written in `count` letters A-Z (most significant first). */
function letters(n: number, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    out = LETTERS[n % 26] + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/**
 * The registration of the fleet aircraft `uid` under `authority`: 'easa' -> /^G-[A-Z]{4}$/, 'faa' ->
 * /^N[1-9][0-9]{2}[A-Z]{2}$/. Deterministic; distinct for distinct numbered uids ('a1' ... 'a456976').
 */
export function registrationFor(uid: string, authority: AuthorityId): string {
  if (authority === 'faa') {
    const i = indexOf(uid, FAA_SPACE);
    return `N${100 + Math.floor(i / 676)}${letters(i % 676, 2)}`;
  }
  return `G-${letters(indexOf(uid, EASA_SPACE), 4)}`;
}
