// Briefing diagrams (section 5.3): small inline SVGs generated from Briefing.diagram. Each is drawn in a
// 400 x 170 box in the UI's colours; runway 07 always points right (east-north-east), north is up.

import type { Briefing } from '../../training/types';

type DiagramSpec = NonNullable<Briefing['diagram']>;

const ACC = '#52c3ff';
const DIM = '#9aa8b6';
const FG = '#eef3f8';
const WARN = '#ffb224';
const OK = '#5fe39a';

const text = (x: number, y: number, s: string, opts: { fill?: string; anchor?: 'start' | 'middle' | 'end'; size?: number; weight?: number } = {}): string =>
  `<text x="${x}" y="${y}" fill="${opts.fill ?? DIM}" font-size="${opts.size ?? 11}" font-weight="${opts.weight ?? 500}" text-anchor="${opts.anchor ?? 'middle'}" font-family="Inter, system-ui, sans-serif">${s}</text>`;

/** A small arrow head at (x, y) pointing along `deg` (0 = right, 90 = down). */
const arrow = (x: number, y: number, deg: number, fill = ACC): string =>
  `<path d="M0 0 L-8 -4.5 L-8 4.5 Z" fill="${fill}" transform="translate(${x} ${y}) rotate(${deg})"/>`;

/** Runway seen from above, left to right, with threshold bars and a dashed centreline. */
function runway(x0: number, x1: number, y: number, h = 12): string {
  const bars = (x: number, dir: 1 | -1): string =>
    [-3, -1, 1, 3].map((k) => `<rect x="${x + dir * 3 - (dir < 0 ? 6 : 0)}" y="${y + k * 1.4 - 0.6}" width="6" height="1.2" fill="${FG}" opacity=".8"/>`).join('');
  return `<rect x="${x0}" y="${y - h / 2}" width="${x1 - x0}" height="${h}" rx="1.5" fill="#39434f" stroke="#55606d"/>
    <line x1="${x0 + 14}" y1="${y}" x2="${x1 - 14}" y2="${y}" stroke="${FG}" stroke-width="1" stroke-dasharray="6 5" opacity=".7"/>
    ${bars(x0, 1)}${bars(x1, -1)}
    ${text(x0 + 10, y + h / 2 + 12, '07', { size: 9.5, anchor: 'start' })}${text(x1 - 10, y + h / 2 + 12, '25', { size: 9.5, anchor: 'end' })}`;
}

function circuit(): string {
  const p = `M280 128 L340 128 Q356 128 356 112 L356 52 Q356 36 340 36 L70 36 Q54 36 54 52 L54 112 Q54 128 70 128 L120 128`;
  return `${runway(120, 280, 128)}
    <path d="${p}" fill="none" stroke="${ACC}" stroke-width="2" stroke-linejoin="round"/>
    ${arrow(318, 128, 0)}${arrow(356, 80, -90)}${arrow(200, 36, 180)}${arrow(54, 84, 90)}${arrow(100, 128, 0)}
    ${text(318, 146, 'Upwind')}${text(372, 84, 'Crosswind', { anchor: 'start', size: 10 })}
    ${text(200, 26, 'Downwind · 1,000 ft above the field · 90 kt', { fill: FG })}
    ${text(205, 56, 'abeam the threshold: flap 10, power back', { size: 10 })}
    <circle cx="120" cy="36" r="3.5" fill="${WARN}"/>
    ${text(38, 84, 'Base', { anchor: 'end' })}${text(88, 146, 'Final')}
    ${text(200, 100, 'Left-hand circuit, runway 07', { size: 10.5, fill: FG })}`;
}

function turn(bankDeg: number): string {
  const b = Math.max(5, Math.min(70, bankDeg));
  return `<line x1="20" y1="120" x2="380" y2="120" stroke="${DIM}" stroke-width="1" stroke-dasharray="4 4"/>
    ${text(28, 114, 'horizon', { anchor: 'start', size: 9.5 })}
    <g transform="translate(200 104) rotate(${-b})">
      <line x1="-110" y1="0" x2="110" y2="0" stroke="${FG}" stroke-width="5" stroke-linecap="round"/>
      <circle r="13" fill="#2a3440" stroke="${FG}" stroke-width="2.5"/>
      <line x1="0" y1="-13" x2="0" y2="-30" stroke="${FG}" stroke-width="3" stroke-linecap="round"/>
      <line x1="0" y1="0" x2="0" y2="-74" stroke="${ACC}" stroke-width="1.5" stroke-dasharray="3 3"/>
      ${arrow(0, -78, -90)}
    </g>
    <path d="M200 30 A74 74 0 0 0 ${200 - 74 * Math.sin((b * Math.PI) / 180)} ${104 - 74 * Math.cos((b * Math.PI) / 180)}" fill="none" stroke="${WARN}" stroke-width="1.5"/>
    ${text(188, 24, `${Math.round(b)}° bank`, { fill: WARN, weight: 650, anchor: 'end' })}
    ${text(260, 30, 'lift tilts: more back pressure', { anchor: 'start', size: 10 })}
    ${text(200, 160, 'Lookout · roll to the bank · hold the attitude · roll out early', { fill: FG, size: 10.5 })}`;
}

function climb(): string {
  return `<line x1="20" y1="140" x2="380" y2="140" stroke="${DIM}" stroke-width="1"/>
    <path d="M30 140 L90 140 Q110 140 128 128 L262 46 Q280 34 302 34 L380 34" fill="none" stroke="${ACC}" stroke-width="2.5"/>
    <line x1="30" y1="34" x2="380" y2="34" stroke="${OK}" stroke-width="1" stroke-dasharray="5 4"/>
    ${text(384, 30, 'target', { anchor: 'end', size: 9.5, fill: OK })}
    <circle cx="262" cy="46" r="4" fill="${WARN}"/>
    ${text(272, 64, 'start levelling early:', { anchor: 'start', size: 10, fill: WARN })}
    ${text(272, 76, '10 % of the climb rate', { anchor: 'start', size: 10, fill: WARN })}
    ${text(206, 122, 'full power · Vy · trim', { anchor: 'start', fill: FG })}
    ${text(60, 132, 'APT', { size: 10.5, weight: 700, fill: FG })}
    ${text(330, 52, 'APT', { size: 10.5, weight: 700, fill: FG })}
    ${text(200, 162, 'Attitude, then power, then trim: entering the climb and levelling off', { size: 10.5 })}`;
}

function glide(): string {
  return `<line x1="20" y1="146" x2="380" y2="146" stroke="${DIM}" stroke-width="1"/>
    <path d="M30 30 L70 30 Q84 30 96 36 L372 140" fill="none" stroke="${ACC}" stroke-width="2.5"/>
    <path d="M96 36 L372 104" fill="none" stroke="${OK}" stroke-width="1.5" stroke-dasharray="5 4"/>
    ${text(300, 94, '500 fpm at 90 kt, reduced power', { anchor: 'end', size: 10, fill: OK })}
    ${text(250, 126, 'glide: throttle closed, attitude for best glide', { anchor: 'end', size: 10.5, fill: FG })}
    ${text(30, 22, 'Lookout below and ahead first', { anchor: 'start', size: 10 })}
    ${text(200, 164, 'Lower the nose to hold the speed; level off with attitude, power, trim', { size: 10.5 })}`;
}

function stall(): string {
  // Lift coefficient against angle of attack: linear rise, peak at the critical angle, then the break.
  const pts: string[] = [];
  for (let a = 0; a <= 24; a += 0.5) {
    const cl = a <= 16 ? a / 16 - Math.max(0, a - 12) ** 2 / 160 : 0.9 - (a - 16) * 0.05;
    pts.push(`${40 + a * 13},${140 - cl * 100}`);
  }
  return `<line x1="40" y1="140" x2="372" y2="140" stroke="${DIM}"/><line x1="40" y1="140" x2="40" y2="20" stroke="${DIM}"/>
    ${text(372, 156, 'angle of attack', { anchor: 'end', size: 10 })}${text(46, 22, 'lift', { anchor: 'start', size: 10 })}
    <rect x="${40 + 16 * 13}" y="20" width="${24 * 13 - 16 * 13}" height="120" fill="rgba(255,77,61,.12)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${ACC}" stroke-width="2.5"/>
    <line x1="${40 + 13.5 * 13}" y1="20" x2="${40 + 13.5 * 13}" y2="140" stroke="${WARN}" stroke-dasharray="4 4"/>
    ${text(40 + 13.5 * 13 - 4, 34, 'warning', { anchor: 'end', size: 10, fill: WARN })}
    ${text(40 + 20 * 13, 34, 'stalled', { size: 10, fill: '#ff6b5b' })}
    ${text(40 + 16 * 13, 156, 'critical angle', { size: 10 })}
    ${text(150, 60, 'Recover: nose down to unstall,', { anchor: 'start', size: 10.5, fill: FG })}
    ${text(150, 74, 'full power, wings level, climb', { anchor: 'start', size: 10.5, fill: FG })}`;
}

function landingZone(): string {
  const aim = 108;
  return `${runway(40, 380, 96, 30)}
    <rect x="${aim}" y="81" width="64" height="30" fill="rgba(95,227,154,.22)" stroke="${OK}" stroke-dasharray="4 3"/>
    <rect x="${aim - 3}" y="84" width="6" height="8" fill="${FG}"/><rect x="${aim - 3}" y="100" width="6" height="8" fill="${FG}"/>
    ${text(aim, 70, 'aim point', { fill: FG })}${text(aim + 32, 130, 'touchdown zone', { fill: OK })}
    <path d="M10 40 L${aim} 96" stroke="${ACC}" stroke-width="2" stroke-dasharray="6 4"/>
    ${text(14, 34, '3° approach', { anchor: 'start', size: 10, fill: ACC })}
    ${text(250, 152, 'Flare over the aim point, hold it off, mains first on the centreline', { size: 10.5 })}`;
}

function pfl(): string {
  return `${runway(150, 290, 120)}
    <path d="M330 20 Q380 30 372 70 Q362 110 300 98 L120 98 Q70 98 70 120 Q70 140 110 140 L150 124" fill="none" stroke="${ACC}" stroke-width="2" stroke-dasharray="7 5"/>
    <circle cx="330" cy="20" r="5" fill="${WARN}"/><circle cx="300" cy="98" r="5" fill="${WARN}"/>
    ${text(322, 16, 'high key 2,000 ft', { anchor: 'end', size: 10.5, fill: WARN })}
    ${text(300, 88, 'low key 1,000 ft', { anchor: 'end', size: 10.5, fill: WARN })}
    ${arrow(372, 70, 100)}${arrow(150, 124, -20)}
    ${text(40, 30, 'Best glide · touch drills · field in sight', { anchor: 'start', size: 10.5, fill: FG })}
    ${text(220, 162, 'Aim a third of the way in; go around at 200 ft', { size: 10.5 })}`;
}

/** The SVG markup of a briefing diagram (400 x 170 viewBox). */
export function diagramSvg(d: DiagramSpec): string {
  let inner: string;
  switch (d.kind) {
    case 'circuit': inner = circuit(); break;
    case 'turn': inner = turn(d.bankDeg ?? 30); break;
    case 'climb': inner = climb(); break;
    case 'glide': inner = glide(); break;
    case 'stall': inner = stall(); break;
    case 'landingZone': inner = landingZone(); break;
    case 'pfl': inner = pfl(); break;
  }
  return `<svg viewBox="0 0 400 170" role="img" aria-label="${d.kind} diagram">${inner}</svg>`;
}
