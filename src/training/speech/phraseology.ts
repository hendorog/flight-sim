// Phraseology rendering (section 3.7.3): one template, two outputs: the caption ("Climb to 3,500 ft at 74 kt")
// and the spoken aviation form ("climb to three thousand five hundred feet at seventy-four knots").
//
// Template syntax: `{name}` or `{name:format}`.
// - `name` is looked up through RenderContext (a variable, a signal, `vspeed.Vy`, `setting.cruiseRpm`,
//   `tol.altitude`). A capitalised name that is not found is looked up in lower case and its value
//   capitalised, so preset rungs can write "{Side} rudder" at the start of a sentence.
// - `format` is one of FORMATS below. `{x:dev:alt}` renders x as a signed altitude deviation; a variable
//   literally named `dev` with format `alt` (`{dev:alt}`, as the coach presets write it) means the same.
// - Without a format, numbers render as plain integers and strings verbatim.
// - Unknown names render as '?' in captions and are skipped in speech (with the surrounding spacing tidied).
//
// Speech also rewrites the literal text around the templates, so line authors can write captions naturally:
// "500 fpm" -> "five hundred feet per minute", "Vy" -> "V Y", "°" -> " degrees". The captions are untouched.

/** Looks up a template name: a variable, a signal, `vspeed.Vy`, `setting.cruiseRpm`, `tol.altitude`. */
export interface RenderContext {
  lookup(name: string): number | string | undefined;
}

export interface Rendered { caption: string; speak: string }

/** The template formats (section 2.6), plus `rwy` and `freq` from section 3.7.3. */
export const FORMATS = ['alt', 'hdg', 'kt', 'fpm', 'deg', 'rpm', 'dev:alt', 'side', 'dir', 'nm', 'min', 'qnh', 'rwy', 'freq'] as const;
export type Format = (typeof FORMATS)[number];

const TEMPLATE = /\{([A-Za-z_][\w.]*(?:\/[\w.]+)?)(?::([a-z:]+))?\}/g;

/**
 * Render `{name:format}` templates. `speakTemplate` (InlineCue.speak) replaces the template for speech when
 * given. Unknown names render as '?' in captions and are skipped in speech.
 */
export function render(template: string, ctx: RenderContext, speakTemplate?: string): Rendered {
  const caption = collapse(template.replace(TEMPLATE, (_m, name: string, fmt?: string) => formatValue(name, fmt, ctx, 'caption') ?? '?'));
  const speakSrc = speakTemplate ?? template;
  // Templates are expanded to their spoken form first; the literal-text rewrite then runs on the whole line
  // (it only touches digits-with-units and abbreviations, which the spoken expansions never contain).
  const MARK = '\u0000';
  const spokenParts: string[] = [];
  const withMarks = speakSrc.replace(TEMPLATE, (_m, name: string, fmt?: string) => {
    spokenParts.push(formatValue(name, fmt, ctx, 'speak') ?? '');
    return `${MARK}${spokenParts.length - 1}${MARK}`;
  });
  const literal = speakLiteral(withMarks);
  const speak = tidy(literal.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_m, i: string) => spokenParts[Number(i)]));
  return { caption, speak };
}

function collapse(s: string): string {
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Speech only: close the gaps a skipped template leaves ("Rate , we want" -> "Rate, we want"). */
function tidy(s: string): string {
  return collapse(s).replace(/ +([,.;:!?])/g, '$1').replace(/^[ ,;:]+/, '');
}

type Mode = 'caption' | 'speak';

function lookupName(name: string, ctx: RenderContext): number | string | undefined {
  const v = ctx.lookup(name);
  if (v !== undefined) return v;
  const first = name.charAt(0);
  if (first !== first.toLowerCase()) {
    const lower = ctx.lookup(first.toLowerCase() + name.slice(1));
    if (typeof lower === 'string') return capitalise(lower);
    return lower;
  }
  return undefined;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatValue(name: string, fmt: string | undefined, ctx: RenderContext, mode: Mode): string | undefined {
  const raw = lookupName(name, ctx);
  if (raw === undefined || (typeof raw === 'number' && !Number.isFinite(raw))) return undefined;
  const format = name === 'dev' && fmt === 'alt' ? 'dev:alt' : fmt;
  if (typeof raw === 'string') {
    // Strings pass through (a coach preset's 'left' or 'high'); a speech line reads a string that is a number
    // in the requested format, e.g. a capture stored as text.
    const n = Number(raw);
    if (format && raw.trim() !== '' && Number.isFinite(n) && format !== 'side' && format !== 'dir') return formatNumber(n, format, mode);
    return raw;
  }
  if (!format) return mode === 'caption' ? String(Math.round(raw)) : numberWords(Math.round(raw));
  return formatNumber(raw, format, mode);
}

function formatNumber(v: number, format: string, mode: Mode): string | undefined {
  const cap = mode === 'caption';
  switch (format) {
    case 'alt': {
      const ft = roundAlt(v);
      return cap ? `${group(ft)} ft` : `${numberWords(ft)} ${plural(ft, 'foot', 'feet')}`;
    }
    case 'dev:alt': {
      const ft = Math.abs(roundAlt(v));
      const dir = v >= 0 ? 'high' : 'low';
      return cap ? `${group(ft)} ft ${dir}` : `${numberWords(ft, true)} ${plural(ft, 'foot', 'feet')} ${dir}`;
    }
    case 'hdg': {
      const h = headingDigits(v);
      return cap ? h : digitWords(h);
    }
    case 'kt': {
      const k = Math.round(v);
      return cap ? `${k} kt` : `${numberWords(k)} ${plural(k, 'knot', 'knots')}`;
    }
    case 'fpm': {
      const f = Math.round(v / 10) * 10;
      return cap ? `${group(f)} fpm` : `${numberWords(f)} ${plural(f, 'foot', 'feet')} per minute`;
    }
    case 'deg': {
      const d = Math.round(v);
      return cap ? `${d}°` : `${numberWords(d)} ${plural(d, 'degree', 'degrees')}`;
    }
    case 'rpm': {
      const r = Math.round(v / 10) * 10;
      return cap ? `${group(r)} rpm` : `${numberWords(r)} R P M`;
    }
    case 'side':
      return v >= 0 ? 'right' : 'left';
    case 'dir':
      return v >= 0 ? 'high' : 'low';
    case 'nm': {
      const n = Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v);
      return cap ? `${n} NM` : `${decimalWords(n)} ${n === 1 ? 'mile' : 'miles'}`;
    }
    case 'min': {
      const m = Math.round(v);
      return cap ? `${m} min` : `${numberWords(m)} ${plural(m, 'minute', 'minutes')}`;
    }
    case 'qnh': {
      const q = String(Math.round(v));
      return cap ? q : digitWords(q);
    }
    case 'rwy': {
      const r = String(((Math.round(v) % 36) + 36) % 36 || 36).padStart(2, '0');
      return cap ? r : digitWords(r);
    }
    case 'freq': {
      const s = v.toFixed(3).replace(/0{1,2}$/, '');
      return cap ? s : s.split('.').map(digitWords).join(' decimal ');
    }
    default:
      return undefined;
  }
}

/** Altitudes read to 10 ft (an altimeter needle is not read closer), small heights to the foot. */
function roundAlt(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v / 10) * 10 : Math.round(v);
}

/** 0..359.5 -> '001'..'360' (north is 360 in aviation, never 000). */
function headingDigits(v: number): string {
  const h = ((Math.round(v) % 360) + 360) % 360 || 360;
  return String(h).padStart(3, '0');
}

function plural(n: number, one: string, many: string): string {
  return Math.abs(n) === 1 ? one : many;
}

function group(n: number): string {
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
}

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Digit by digit with ICAO "niner": '070' -> 'zero seven zero', '1013' -> 'one zero one three'. */
export function digitWords(s: string): string {
  return [...s].filter((c) => c >= '0' && c <= '9').map((c) => DIGIT[Number(c)]).join(' ');
}

/** Below 1000, British style: 450 -> 'four hundred and fifty'. */
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) {
    const words = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : '');
    parts.push(h ? `and ${words}` : words);
  }
  return parts.join(' ');
}

/**
 * Integer to British English words: 2450 -> 'two thousand four hundred and fifty', 1050 -> 'one thousand and
 * fifty', 74 -> 'seventy-four'. `casual` reads a leading "one hundred" as "a hundred" (deviations: "a hundred
 * and sixty feet high").
 */
export function numberWords(n: number, casual = false): string {
  n = Math.round(n);
  if (n === 0) return 'zero';
  if (n < 0) return `minus ${numberWords(-n, casual)}`;
  const scales: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  const parts: string[] = [];
  let rest = n;
  for (const [size, word] of scales) {
    if (rest >= size) {
      parts.push(`${numberWords(Math.floor(rest / size))} ${word}`);
      rest %= size;
    }
  }
  if (rest) parts.push(parts.length && rest < 100 ? `and ${under1000(rest)}` : under1000(rest));
  const s = parts.join(' ');
  return casual && n >= 100 && n < 200 ? s.replace(/^one hundred/, 'a hundred') : s;
}

/** 4.5 -> 'four point five'; integers as numberWords. */
export function decimalWords(n: number): string {
  if (Number.isInteger(n)) return numberWords(n);
  const [i, f] = String(Math.abs(n)).split('.');
  return `${n < 0 ? 'minus ' : ''}${numberWords(Number(i))} point ${[...f].map((c) => ONES[Number(c)]).join(' ')}`;
}

// ---- Literal text: what a caption abbreviates, speech spells out ------------------------------------------

const VSPEEDS: Record<string, string> = {
  Vx: 'V X', Vy: 'V Y', Vr: 'V R', Va: 'V A', Vs: 'V S', Vso: 'V S O', Vs0: 'V S zero', Vs1: 'V S one',
  Vfe: 'V F E', Vno: 'V N O', Vne: 'V N E', Vref: 'V ref', Vapp: 'V app', Vglide: 'V glide', Vcc: 'V C C',
  Vcruise: 'V cruise', Vdescent: 'V descent', Vlof: 'V L O F',
};

/** Numbers with units in literal text ("500 fpm", "3,500 ft", "30°", "10 %") and V-speed names. */
function speakLiteral(s: string): string {
  const num = (t: string): number => Number(t.replace(/,/g, ''));
  return s
    .replace(/(-?\d[\d,]*(?:\.\d+)?)\s?(ft|fpm|kt|kts|rpm|RPM|NM|nm|°|%)(?![A-Za-z])/g, (_m, n: string, unit: string) => {
      const v = num(n);
      const words = Number.isInteger(v) ? numberWords(v) : decimalWords(v);
      switch (unit) {
        case 'ft': return `${words} ${plural(v, 'foot', 'feet')}`;
        case 'fpm': return `${words} ${plural(v, 'foot', 'feet')} per minute`;
        case 'kt': case 'kts': return `${words} ${plural(v, 'knot', 'knots')}`;
        case 'rpm': case 'RPM': return `${words} R P M`;
        case 'NM': case 'nm': return `${words} ${v === 1 ? 'mile' : 'miles'}`;
        case '°': return `${words} ${plural(v, 'degree', 'degrees')}`;
        default: return `${words} percent`;
      }
    })
    .replace(/\b(V[a-z]{1,7}[01]?)\b/g, (m: string) => VSPEEDS[m] ?? m)
    .replace(/\bAGL\b/g, 'A G L')
    .replace(/\bQNH\b/g, 'Q N H');
}
