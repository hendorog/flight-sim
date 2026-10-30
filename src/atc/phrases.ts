// Radio phraseology (docs/atc.md): how numbers, callsigns, runways, winds and pressures are written in captions and
// spoken by the synthesiser, by the authority the lessons fly under (FAA or EASA). Pure: strings in, strings out.

export type Authority = 'faa' | 'easa';

/** A line as captioned and as spoken (digits and letters spelled out for the synthesiser). */
export interface Phrase {
  text: string;
  speak: string;
}

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const PHONETIC: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
  J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

/** Each digit and letter spelled: '2FS' -> 'two Foxtrot Sierra'. Other characters are dropped. */
export function spell(s: string): string {
  const out: string[] = [];
  for (const ch of s.toUpperCase()) {
    if (ch >= '0' && ch <= '9') out.push(DIGITS[+ch]);
    else if (PHONETIC[ch]) out.push(PHONETIC[ch]);
  }
  return out.join(' ');
}

/** The ATIS information letter's word ('Alpha'). */
export function letterWord(letter: string): string {
  return PHONETIC[letter.toUpperCase()] ?? letter;
}

export const both = (text: string, speak = text): Phrase => ({ text, speak });

/** Join phrases with ', ' (both forms). */
export function join(parts: readonly Phrase[], sep = ', '): Phrase {
  return { text: parts.map((p) => p.text).join(sep), speak: parts.map((p) => p.speak).join(sep) };
}

/** A runway designator: 'runway 07' / 'runway zero seven'. */
export function runway(id: string): Phrase {
  return { text: `runway ${id}`, speak: `runway ${spell(id)}` };
}

/** A frequency, MHz: '118.3' / 'one one eight decimal three' (FAA: 'point'). Trailing zeros are not spoken. */
export function frequency(mhz: number, a: Authority): Phrase {
  const s = mhz.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const [whole, frac] = s.split('.');
  const word = a === 'faa' ? 'point' : 'decimal';
  return { text: s, speak: frac ? `${spell(whole)} ${word} ${spell(frac)}` : spell(whole) };
}

/** An altitude, ft, to the nearest hundred: 'one thousand five hundred'. */
export function altitudeFt(ft: number): Phrase {
  const r = Math.max(0, Math.round(ft / 100) * 100);
  const th = Math.floor(r / 1000);
  const hu = (r % 1000) / 100;
  const words: string[] = [];
  if (th > 0) words.push(`${spell(String(th))} thousand`);
  if (hu > 0 || th === 0) words.push(`${DIGITS[hu]} hundred`);
  return { text: `${r.toLocaleString('en-US')} feet`, speak: `${words.join(' ')} feet` };
}

/** The pressure setting: EASA 'QNH 1015' (hPa), FAA 'altimeter 29.98' (inHg). */
export function pressure(qnhHpa: number, a: Authority): Phrase {
  if (a === 'faa') {
    const inHg = (qnhHpa / 33.8639).toFixed(2);
    return { text: `altimeter ${inHg}`, speak: `altimeter ${spell(inHg.replace('.', ''))}` };
  }
  const h = String(Math.round(qnhHpa)).padStart(4, '0');
  return { text: `QNH ${h}`, speak: `Q N H ${spell(h)}` };
}

/** "wind" as speech engines say the noun: some read the bare word as the verb (to wind up). */
const WIND = 'winnd';

/** The wind: 'wind 250 at 8' / 'wind two five zero degrees, eight knots'; calm under 3 kt. */
export function wind(fromDeg: number, kt: number, a: Authority): Phrase {
  const k = Math.round(kt);
  if (k < 3) return both('wind calm', `${WIND} calm`);
  const d = String((Math.round(fromDeg / 10) * 10 + 359) % 360 + 1).padStart(3, '0');
  return a === 'faa'
    ? { text: `wind ${d} at ${k}`, speak: `${WIND} ${spell(d)} at ${spell(String(k))}` }
    : { text: `wind ${d} degrees ${k} knots`, speak: `${WIND} ${spell(d)} degrees, ${spell(String(k))} knots` };
}

/** Compass words for a bearing (deg true) from a field: 'north-east'. */
export function compass(deg: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Whole nautical miles in words for distances ('five miles'). */
export function miles(nm: number): Phrase {
  const n = Math.max(1, Math.round(nm));
  return n === 1 ? both('1 mile', 'one mile') : both(`${n} miles`);
}

/** An aircraft on the radio: its full callsign, and the abbreviation used once the station has answered. */
export interface Callsign {
  full: Phrase;
  short: Phrase;
}

/** Manufacturer word an FAA callsign starts with, from the ICAO type designator. */
function maker(icaoType: string): string {
  const t = icaoType.toUpperCase();
  if (/^C\d/.test(t)) return t === 'C208' ? 'Caravan' : 'Cessna';
  if (t.startsWith('PA')) return 'Piper';
  if (t.startsWith('DA')) return 'Diamond';
  if (t.startsWith('PC')) return 'Pilatus';
  if (/^R\d/.test(t)) return 'Robinson';
  if (t === 'H269') return 'Schweizer';
  if (t === 'H500') return 'Helicopter';
  if (t === 'B105') return 'Helicopter';
  return 'November';
}

/**
 * A registration as a callsign. FAA: the maker and the registration without its N ('Cessna 172FS'), abbreviated to
 * the maker and the last three ('Cessna 2FS'). EASA: the registration spelled ('November 172FS'), abbreviated to its
 * first character and last two ('NFS'); a military serial is spoken as it stands.
 */
export function callsign(registration: string, icaoType: string, a: Authority): Callsign {
  const reg = registration.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(reg)) {
    const p = { text: registration, speak: `Army ${spell(reg.slice(-4))}` };
    return { full: p, short: p };
  }
  if (a === 'faa' && reg.startsWith('N')) {
    const m = maker(icaoType);
    const tail = reg.slice(1);
    const last3 = tail.slice(-3);
    return {
      full: { text: `${m} ${tail}`, speak: `${m} ${spell(tail)}` },
      short: { text: `${m} ${last3}`, speak: `${m} ${spell(last3)}` },
    };
  }
  const shortReg = reg[0] + reg.slice(-2);
  const written = registration.toUpperCase();
  return {
    full: { text: written, speak: spell(reg) },
    short: { text: `${reg[0]}-${reg.slice(-2)}`, speak: spell(shortReg) },
  };
}
