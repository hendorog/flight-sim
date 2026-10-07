// Panel controls and lamps: annunciator strip, switch row with the magneto key and dimmers, and the flap
// lever with its position indicator.

import { C172S_ANNUNCIATOR_LAMPS, C172S_PANEL } from '../../aircraft/c172s/panel';
import { clamp } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { GaugeDef, LampDef, PanelDef } from '../panelDef';
import { knob, screw } from './art';
import { context2d, LABEL_FONT, makeCanvas, rng, type Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';
import { PANEL_LAYOUT, type RockerKey } from '../layout';

export const PAINT_WHITE = '#ecebe4';

/** Placard lettering painted on the panel face. */
export function label(g: Ctx2D, text: string, x: number, y: number, size = 9, align: CanvasTextAlign = 'center'): void {
  g.font = `600 ${size}px ${LABEL_FONT}`;
  g.fillStyle = PAINT_WHITE;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

// ---------------------------------------------------------------------------------------------------
/** Annunciator strip: legends are dark behind smoked glass until lit. The lamps are the type's (the C172S's when none are given). */
export class AnnunciatorPanel implements PanelComponent {
  readonly id = 'annunciator';
  private readonly latch: Latch;
  private static readonly CELL_W = 86;
  private static readonly CELL_H = 26;
  private static readonly GAP = 5;

  constructor(
    readonly bounds: Rect,
    private readonly lamps: readonly LampDef[] = C172S_ANNUNCIATOR_LAMPS,
  ) {
    this.latch = new Latch(lamps.length);
  }

  sample(r: InstrumentReadings): boolean {
    this.lamps.forEach((l, i) => this.latch.set(i, l.lit(r) ? 1 : 0, 1));
    return this.latch.take();
  }

  private cellX(i: number): number {
    const A = AnnunciatorPanel;
    const total = this.lamps.length * A.CELL_W + (this.lamps.length - 1) * A.GAP;
    return this.bounds.x + (this.bounds.w - total) / 2 + i * (A.CELL_W + A.GAP);
  }

  drawStatic(g: Ctx2D): void {
    const b = this.bounds;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 2;
    g.fillStyle = '#141415';
    g.beginPath();
    g.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 6, 3);
    g.fill();
    g.restore();
  }

  paintLightMask(g: Ctx2D): void {
    const A = AnnunciatorPanel;
    const y = this.bounds.y + (this.bounds.h - A.CELL_H) / 2 - 1;
    // Lamps behind smoked glass: a lit lamp is bright in the image itself; unlit legends must stay dark.
    g.fillStyle = LIGHT_DIAL;
    this.lamps.forEach((_, i) => g.fillRect(this.cellX(i), y, A.CELL_W, A.CELL_H));
  }

  draw(g: Ctx2D): void {
    const A = AnnunciatorPanel;
    const y = this.bounds.y + (this.bounds.h - A.CELL_H) / 2 - 1;
    this.lamps.forEach((lamp, i) => {
      const x = this.cellX(i);
      const on = this.latch.get(i) === 1;
      g.fillStyle = '#060606';
      g.fillRect(x, y, A.CELL_W, A.CELL_H);
      g.save();
      g.font = `700 11px ${LABEL_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (on) {
        const haze = g.createRadialGradient(x + A.CELL_W / 2, y + A.CELL_H / 2, 2, x + A.CELL_W / 2, y + A.CELL_H / 2, A.CELL_W / 2);
        haze.addColorStop(0, lamp.color + '55');
        haze.addColorStop(1, lamp.color + '10');
        g.fillStyle = haze;
        g.fillRect(x, y, A.CELL_W, A.CELL_H);
        g.shadowColor = lamp.color;
        g.shadowBlur = 8;
        g.fillStyle = '#fff4dc';
        g.fillText(lamp.text, x + A.CELL_W / 2, y + A.CELL_H / 2 + 0.5);
        g.shadowBlur = 0;
        g.fillStyle = lamp.color;
        g.globalAlpha = 0.55;
        g.fillText(lamp.text, x + A.CELL_W / 2, y + A.CELL_H / 2 + 0.5);
      } else {
        g.fillStyle = 'rgba(120,112,100,0.28)';
        g.fillText(lamp.text, x + A.CELL_W / 2, y + A.CELL_H / 2 + 0.5);
      }
      g.restore();
      // Smoked glass reflection
      const glass = g.createLinearGradient(x, y, x, y + A.CELL_H);
      glass.addColorStop(0, 'rgba(255,255,255,0.10)');
      glass.addColorStop(0.4, 'rgba(255,255,255,0.02)');
      glass.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = glass;
      g.fillRect(x, y, A.CELL_W, A.CELL_H);
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 0.8;
      g.strokeRect(x + 0.5, y + 0.5, A.CELL_W - 1, A.CELL_H - 1);
    });
  }
}

// ---------------------------------------------------------------------------------------------------
/** The C172S row, and the place in it of a rocker named by its layout key (PANEL_LAYOUT lists them in the same order). */
const C172S_ROW = C172S_PANEL.switchRow;
const c172sRocker = (key: RockerKey): number => PANEL_LAYOUT.switchRow.rockers.findIndex((r) => r.key === key);

/**
 * The legend of each rocker of the C172S row: the switch's own label, or the row legend above it (the split
 * MASTER pair has no label of its own).
 */
export const ROCKER_LABELS = Object.fromEntries(
  PANEL_LAYOUT.switchRow.rockers.map((r, i) => {
    const d = C172S_ROW.switches[i];
    return [r.key, d.label || C172S_ROW.legends.find((l) => l.x === d.x && l.y === C172S_ROW.rockerTop - 12)!.text];
  }),
) as Record<RockerKey, string>;

const MAG_ANGLES = [-60, -30, 0, 30, 60]; // OFF, R, L, BOTH, START (degrees clockwise from 12)
const MAG_LABELS = ['OFF', 'R', 'L', 'BOTH', 'START'];

/**
 * The switch row of a panel definition: rocker switches with their legends, the magneto/start key where the
 * ignition is a key, and the panel/radio light dimmers. On the C172S: the key, the split MASTER (ALT | BAT,
 * red), fuel pump, lights, avionics master and pitot heat. Every control reflects ControlInputs.
 */
export class SwitchPanel implements PanelComponent {
  readonly id = 'switches';
  readonly bounds: Rect;
  /** One value per rocker, then the key position and the dimmer setting. */
  private readonly latch: Latch;

  constructor(
    private readonly row: PanelDef['switchRow'],
    private readonly ignition: PanelDef['ignition'],
  ) {
    this.bounds = row.bounds;
    this.latch = new Latch(row.switches.length + 2);
  }

  /**
   * Whether a rocker of the C172S row is ON, by its layout key: the `on` of that switch in the panel
   * definition. The row itself asks its own definition (sample); this is the old reading by key.
   */
  private isOn(k: RockerKey, c: ControlInputs): boolean {
    return C172S_ROW.switches[c172sRocker(k)].on(c);
  }

  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    const switches = this.row.switches;
    for (let i = 0; i < switches.length; i++) this.latch.set(i, switches[i].on(c) ? 1 : 0, 1);
    this.latch.set(switches.length, c.starter ? 4 : c.magnetos, 1);
    this.latch.set(switches.length + 1, c.lights.panel, 0.01);
    return this.latch.take();
  }

  drawStatic(g: Ctx2D): void {
    const { x, y } = this.bounds;
    const row = this.row;
    const top = row.rockerTop; // rocker top, local y
    g.save();
    g.translate(x, y);
    for (const d of row.switches) {
      // Recess
      g.fillStyle = '#0b0b0c';
      g.beginPath();
      g.roundRect(d.x - row.rockerW / 2 - 3, top - 3, row.rockerW + 6, row.rockerH + 6, 3);
      g.fill();
      if (d.label) label(g, d.label, d.x, top - 12, d.label.length > 6 ? 7.5 : 8.5);
    }
    // Bracket over each group of switches that are lettered one by one (the light switches); `legends` letters its tab.
    for (const group of new Set(row.switches.map((d) => d.group))) {
      const members = row.switches.filter((d) => d.group === group && d.label);
      if (group === undefined || members.length === 0) continue;
      const x0 = members[0].x - 14;
      const x1 = members[members.length - 1].x + 14;
      g.strokeStyle = PAINT_WHITE;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, top - 20);
      g.lineTo(x0, top - 24);
      g.lineTo(x1, top - 24);
      g.lineTo(x1, top - 20);
      g.stroke();
      g.fillStyle = '#3b3d40';
      g.fillRect((x0 + x1) / 2 - 26, top - 30, 52, 12);
    }
    for (const l of row.legends) label(g, l.text, l.x, l.y, l.size);
    if (this.ignition.kind === 'key') {
      // Magneto switch escutcheon
      const kx = this.ignition.at[0] - x;
      const ky = this.ignition.at[1] - y;
      const esc = g.createRadialGradient(kx - 6, ky - 8, 2, kx, ky, 26);
      esc.addColorStop(0, '#9a9ca0');
      esc.addColorStop(0.7, '#56585c');
      esc.addColorStop(1, '#2a2b2d');
      g.fillStyle = esc;
      g.beginPath();
      g.arc(kx, ky, 24, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#101011';
      g.beginPath();
      g.arc(kx, ky, 17, 0, Math.PI * 2);
      g.fill();
      MAG_LABELS.forEach((t, i) => {
        const a = (MAG_ANGLES[i] * Math.PI) / 180;
        label(g, t, kx + Math.sin(a) * (i === 4 ? 44 : 38), ky - Math.cos(a) * 36, 7.5);
      });
    }
    g.restore();
  }

  draw(g: Ctx2D): void {
    const { x, y } = this.bounds;
    const row = this.row;
    const n = row.switches.length;
    g.save();
    g.translate(x, y);
    row.switches.forEach((d, i) => rocker(g, d.x - row.rockerW / 2, row.rockerTop, row.rockerW, row.rockerH, this.latch.get(i) === 1, !!d.red));
    if (this.ignition.kind === 'key') {
      // Key
      const pos = this.latch.get(n);
      g.save();
      g.translate(this.ignition.at[0] - x, this.ignition.at[1] - y);
      g.rotate((MAG_ANGLES[pos] * Math.PI) / 180);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.roundRect(-7 + 2, -30 + 4, 14, 38, 5);
      g.fill();
      const key = g.createLinearGradient(-7, 0, 7, 0);
      key.addColorStop(0, '#6d6e70');
      key.addColorStop(0.35, '#d8d9da');
      key.addColorStop(1, '#6a6b6d');
      g.fillStyle = key;
      g.beginPath();
      g.roundRect(-7, -30, 14, 38, 5);
      g.fill();
      g.fillStyle = '#1a1a1b';
      g.beginPath();
      g.arc(0, -22, 2.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2c2c2e';
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    if (row.dimmers) {
      // Dimmers rotate with the panel-light setting.
      const dim = this.latch.get(n + 1);
      for (const dx of [row.dimmers.panel, row.dimmers.radio]) {
        g.save();
        g.translate(dx, row.dimmers.y);
        g.rotate((-135 + dim * 270) * (Math.PI / 180));
        knob(g, 0, 0, 11, PAINT_WHITE);
        g.restore();
      }
    }
    g.restore();
  }
}

/** Rocker switch in its recess; ON = top pressed in. */
export function rocker(g: Ctx2D, x: number, y: number, w: number, h: number, on: boolean, red: boolean): void {
  const base = red ? ['#c3261c', '#7c140e', '#e14a3c'] : ['#e9e8e2', '#9b9a94', '#ffffff'];
  const mid = y + h / 2;
  const top = g.createLinearGradient(0, y, 0, mid);
  const bot = g.createLinearGradient(0, mid, 0, y + h);
  // The pressed half faces slightly away from the light (darker); the raised half faces it.
  const pressed = on ? top : bot;
  const raised = on ? bot : top;
  pressed.addColorStop(0, base[1]);
  pressed.addColorStop(1, base[1]);
  raised.addColorStop(0, base[2]);
  raised.addColorStop(1, base[0]);
  g.fillStyle = top;
  g.fillRect(x, y, w, h / 2);
  g.fillStyle = bot;
  g.fillRect(x, mid, w, h / 2);
  // Pivot crease and the shadow of the raised half onto the pressed one.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x, on ? mid - 3 : mid, w, 3);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // Ribs on the raised half for grip.
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  const r0 = on ? mid + 5 : y + 5;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(x + 4, r0 + i * 4);
    g.lineTo(x + w - 4, r0 + i * 4);
    g.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------
const c172sFlapLever = (): Extract<GaugeDef, { kind: 'flapLever' }> => {
  for (const g of C172S_PANEL.gauges) if (g.kind === 'flapLever') return g;
  throw new Error('The C172S panel has no flap lever');
};
/** C172S: flap deflection at the bottom of the position scale, degrees, and the legends of the detents down the scale. */
export const FLAP_SCALE_DEG = c172sFlapLever().maxDeg;
export const FLAP_LEGENDS = c172sFlapLever().legends;

/**
 * Flap selector lever in its slotted guide, with the flap position pointer driven by the actual flaps: `maxDeg`
 * is the deflection at the bottom of the scale, `legends` letter the detents evenly down it.
 */
export class FlapIndicator implements PanelComponent {
  private readonly latch = new Latch(2);
  /** Slot position in local pixels; matches the 3D lever (0 deg at panel y 560, FULL at 760, x 1540). */
  static readonly SLOT_X = 100;
  static readonly SLOT_TOP = 80;
  static readonly SLOT_LEN = 200;

  /**
   * @param paintLever also paint the lever handle (for a flat 2D panel); the 3D cockpit has its own lever.
   */
  constructor(
    readonly id: string,
    readonly bounds: Rect,
    private readonly maxDeg: number,
    private readonly legends: readonly string[],
    private readonly paintLever = false,
  ) {}

  sample(r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.track(0, clamp(c.flaps, 0, 1), 0.004);
    this.latch.track(1, clamp(r.flapsDeg / this.maxDeg, 0, 1), 0.004);
    return this.latch.take();
  }

  drawStatic(g: Ctx2D): void {
    const { x, y } = this.bounds;
    const F = FlapIndicator;
    g.save();
    g.translate(x, y);
    const sx = F.SLOT_X;
    label(g, 'FLAPS', sx - 30, F.SLOT_TOP - 42, 11);
    this.legends.forEach((t, i) => {
      const yy = F.SLOT_TOP + (i / (this.legends.length - 1)) * F.SLOT_LEN;
      label(g, t, sx - 52, yy, 11, 'right');
      g.strokeStyle = PAINT_WHITE;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(sx - 48, yy);
      g.lineTo(sx - 34, yy);
      g.stroke();
    });
    // Slot (the 3D slot plate covers it in the cockpit)
    g.fillStyle = '#050505';
    g.beginPath();
    g.roundRect(sx - 5, F.SLOT_TOP - 14, 10, F.SLOT_LEN + 28, 5);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  }

  draw(g: Ctx2D): void {
    const { x, y } = this.bounds;
    const F = FlapIndicator;
    const sx = x + F.SLOT_X;
    // Position pointer on the scale (actual flap angle through the follow-up cable).
    const py = y + F.SLOT_TOP + this.latch.get(1) * F.SLOT_LEN;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.moveTo(sx - 20, py + 2);
    g.lineTo(sx - 32, py - 4);
    g.lineTo(sx - 32, py + 8);
    g.closePath();
    g.fill();
    g.fillStyle = '#f2f1ea';
    g.beginPath();
    g.moveTo(sx - 21, py);
    g.lineTo(sx - 33, py - 6);
    g.lineTo(sx - 33, py + 6);
    g.closePath();
    g.fill();
    if (!this.paintLever) return;
    // Lever handle: a white airfoil-shaped knob on a stem, at the selected position.
    const ly = y + F.SLOT_TOP + this.latch.get(0) * F.SLOT_LEN;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.roundRect(sx - 18 + 2, ly - 8 + 5, 44, 16, 7);
    g.fill();
    g.fillStyle = '#1c1c1d';
    g.fillRect(sx - 2.5, ly - 3, 5, 6);
    const grad = g.createLinearGradient(0, ly - 8, 0, ly + 8);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#e4e3dc');
    grad.addColorStop(1, '#9d9c95');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(sx - 16, ly);
    g.quadraticCurveTo(sx - 16, ly - 8, sx - 4, ly - 8);
    g.lineTo(sx + 26, ly - 3);
    g.lineTo(sx + 26, ly + 2);
    g.lineTo(sx - 4, ly + 8);
    g.quadraticCurveTo(sx - 16, ly + 8, sx - 16, ly);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 0.8;
    g.stroke();
  }
}

/** C172S: legend and sub-legend under the throttle and mixture bushings. */
const [C172S_THROTTLE, C172S_MIXTURE] = C172S_PANEL.background.bushings;
export const THROTTLE_LEGEND = [C172S_THROTTLE.text, C172S_THROTTLE.sub] as const;
export const MIXTURE_LEGEND = [C172S_MIXTURE.text, C172S_MIXTURE.sub] as const;

/** Bushings and legends of the push-pull engine controls (the knobs themselves are 3D parts of the cockpit model). */
export function paintEngineControls(g: Ctx2D, bushings: PanelDef['background']['bushings']): void {
  const rand = rng(77);
  for (const { at: [x, y], text, sub } of bushings) {
    const ring = g.createRadialGradient(x - 4, y - 5, 2, x, y, 17);
    ring.addColorStop(0, '#b9bbbe');
    ring.addColorStop(0.6, '#6c6e71');
    ring.addColorStop(1, '#2b2c2e');
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.arc(x + 1, y + 3, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ring;
    g.beginPath();
    g.arc(x, y, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#070707';
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
    label(g, text, x, y + 30, 9);
    label(g, sub, x, y + 42, 7);
    screw(g, x - 26, y, 3, rand);
  }
}

/** Plain avionics blanking plate. */
export function paintBlankPlate(g: Ctx2D, r: Rect): void {
  const rand = rng(91);
  const grad = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  grad.addColorStop(0, '#2c2d2f');
  grad.addColorStop(1, '#1f2021');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(r.x + 2, r.y + 1, r.w - 4, r.h - 4, 3);
  g.fill();
  screw(g, r.x + 9, r.y + r.h / 2, 3.2, rand);
  screw(g, r.x + r.w - 9, r.y + r.h / 2, 3.2, rand);
}

/** A block of small placard text (white on black label stock). */
export function paintPlacard(g: Ctx2D, x: number, y: number, lines: readonly string[], size = 7.5): void {
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.52 + 14;
  const h = lines.length * (size + 3) + 10;
  const c = makeCanvas(w, h);
  const p = context2d(c);
  p.fillStyle = '#0d0d0d';
  p.beginPath();
  p.roundRect(0, 0, w, h, 2);
  p.fill();
  p.font = `600 ${size}px ${LABEL_FONT}`;
  p.fillStyle = '#e2e0d6';
  p.textAlign = 'center';
  p.textBaseline = 'top';
  lines.forEach((l, i) => p.fillText(l, w / 2, 6 + i * (size + 3)));
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 2;
  g.shadowOffsetY = 1;
  g.drawImage(c, x - w / 2, y);
  g.restore();
}
