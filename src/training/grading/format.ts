// Wording of measured values in criterion details and the debrief ("Within ±150 ft for 91 %; worst 210 ft
// low at 3:12"). Units and the high/low words come from the signal id, so lesson data never repeats them.

import type { SignalId, Tol } from '../types';

export interface UnitInfo {
  unit: string;          // 'ft', 'kt', '°', '' (dimensionless)
  hi: string; lo: string;  // words for a positive / negative deviation
  dp: number;            // decimals shown
}

const U = (unit: string, hi: string, lo: string, dp = 0): UnitInfo => ({ unit, hi, lo, dp });

const UNITS: Record<string, UnitInfo> = {
  asiKt: U('kt', 'fast', 'slow'), kias: U('kt', 'fast', 'slow'), tasKt: U('kt', 'fast', 'slow'), gsKt: U('kt', 'fast', 'slow'),
  headwindKt: U('kt', 'high', 'low'), crosswindKt: U('kt', 'high', 'low'),
  altFt: U('ft', 'high', 'low'), altMslFt: U('ft', 'high', 'low'), aglFt: U('ft', 'high', 'low'), hafFt: U('ft', 'high', 'low'),
  gpDevFt: U('ft', 'high', 'low'), distAimFt: U('ft', 'long', 'short'), 'step.altChangeFt': U('ft', 'high', 'low'),
  vsiFpm: U('fpm', 'high', 'low'), vsFpm: U('fpm', 'high', 'low'),
  hdgDeg: U('°', 'right', 'left'), hdgTrueDeg: U('°', 'right', 'left'), trackDeg: U('°', 'right', 'left'), dgErrDeg: U('°', 'right', 'left'),
  aiBankDeg: U('°', 'right', 'left'), bankDeg: U('°', 'right', 'left'), driftDeg: U('°', 'right', 'left'),
  aiPitchDeg: U('°', 'high', 'low'), pitchDeg: U('°', 'high', 'low'), aoaDeg: U('°', 'high', 'low'),
  'step.turnDeg': U('°', 'over', 'short'), 'step.maxBankAbsDeg': U('°', 'high', 'low'),
  rpm: U('rpm', 'high', 'low'), rwyAcrossM: U('m', 'right', 'left', 1), rwyAlongM: U('m', 'long', 'short'),
  ball: U('', 'right', 'left', 2), turnRate: U('', 'fast', 'slow', 2), gLoad: U('g', 'high', 'low', 1),
  'nav.xtkNm': U('NM', 'right', 'left', 1), 'nav.distNm': U('NM', 'long', 'short', 1), 'nav.etaErrMin': U('min', 'late', 'early', 1),
  downwindOffsetNm: U('NM', 'wide', 'close', 2), untrimmedS: U('s', 'long', 'short'),
};

/** Unit and wording for a signal; unknown signals get a neutral entry. */
export function unitOf(sig: SignalId | undefined): UnitInfo {
  if (sig && UNITS[sig]) return UNITS[sig];
  if (sig) {
    if (/Kt$/.test(sig)) return U('kt', 'high', 'low');
    if (/Ft$/.test(sig)) return U('ft', 'high', 'low');
    if (/Fpm$/.test(sig)) return U('fpm', 'high', 'low');
    if (/Deg$/.test(sig)) return U('°', 'high', 'low');
    if (/Nm$/.test(sig)) return U('NM', 'high', 'low', 1);
    if (/M$/.test(sig)) return U('m', 'high', 'low', 1);
  }
  return U('', 'high', 'low', 1);
}

/** A number with thousands separators and `dp` decimals: 3500 -> '3,500'. */
export function num(x: number, dp = 0): string {
  return x.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** 'ft' -> ' ft', '°' -> '°' (no space), '' -> ''. */
export function withUnit(x: number, u: UnitInfo): string {
  if (!u.unit) return num(x, u.dp);
  return u.unit === '°' ? `${num(x, u.dp)}°` : `${num(x, u.dp)} ${u.unit}`;
}

/** Tolerance text: ±150 ft, −5/+15 kt, 0/+400 ft. */
export function tolText(t: Tol, u: UnitInfo): string {
  const body = t.minus === t.plus ? `±${num(t.plus, u.dp)}` : `${t.minus === 0 ? '0' : `−${num(t.minus, u.dp)}`}/+${num(t.plus, u.dp)}`;
  return u.unit === '°' ? `${body}°` : u.unit ? `${body} ${u.unit}` : body;
}

/** A signed deviation in words: '210 ft low', '4 kt fast', 'on target'. */
export function devText(dev: number, u: UnitInfo): string {
  const mag = Math.abs(dev);
  if (Number(num(mag, u.dp).replace(/,/g, '')) === 0) return 'on target';
  return `${withUnit(mag, u)} ${dev > 0 ? u.hi : u.lo}`;
}

/** Run time as m:ss ('3:12'); hours as h:mm:ss. */
export function clock(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Percentage of a fraction, no decimals: 0.912 -> '91 %'. */
export const pct = (f: number): string => `${Math.round(f * 100)} %`;
