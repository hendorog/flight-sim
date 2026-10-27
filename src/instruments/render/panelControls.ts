// Small console controls with the same bindings as their click hotspots.
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { GaugeDef } from '../panelDef';
import { centredText, knob } from './art';
import type { Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';
import { drawSegments } from './sevenSegment';

/** An optional digital CAT indicator. Reads the same simulated probe as the analog CAT gauge. */
export class DigitalTemperature implements PanelComponent {
  readonly id: string;
  readonly bounds: Rect;
  private readonly latch = new Latch(2);
  constructor(private readonly def: Extract<GaugeDef, { kind: 'digitalTemperature' }>) { this.id = def.id; this.bounds = def.bounds; }
  sample(r: InstrumentReadings): boolean {
    this.latch.set(0, this.def.read(r), 1); this.latch.set(1, r.busPowered ? 1 : 0, 1);
    return this.latch.take();
  }
  draw(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = '#151819'; g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 5); g.fill();
    centredText(g, this.def.label, b.x + b.w / 2, b.y + 10, 8);
    drawSegments(g, this.latch.get(1) ? `${Math.round(this.latch.get(0))}°C` : '', b.x + b.w - 12, b.y + 24,
      { height: 22, on: '#ed7544', off: '#271710' });
  }
  paintLightMask(g: Ctx2D): void {
    const b = this.bounds; g.fillStyle = '#fff'; g.fillRect(b.x + 8, b.y + 21, b.w - 16, b.h - 25);
  }
}

type Control = Extract<GaugeDef, { kind: 'pullKnob' | 'pushButton' | 'positionSwitch' }>;
export class ConsoleControl implements PanelComponent {
  readonly id: string;
  readonly bounds: Rect;
  private readonly latch = new Latch(2);
  constructor(private readonly def: Control) { this.id = def.id; this.bounds = def.bounds; }
  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.set(0, Number(this.def.read(c)), 0.01);
    this.latch.set(1, 'guard' in this.def && this.def.guard?.closed(c) ? 1 : 0, 1);
    return this.latch.take();
  }
  draw(g: Ctx2D): void {
    const b = this.bounds, d = this.def;
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    centredText(g, d.label, x, b.y + b.h - 8, 9);
    const pulled = this.latch.get(0);
    if (d.kind === 'positionSwitch') {
      const sy = b.y + 35, travel = b.h - 66;
      g.fillStyle = '#111'; g.fillRect(x - 4, sy, 8, travel);
      d.positions.forEach((text, i) => centredText(g, text, x + 25, sy + i * travel / (d.positions.length - 1), 6));
      const ly = sy + pulled * travel / (d.positions.length - 1);
      g.strokeStyle = '#aaa'; g.lineWidth = 6; g.beginPath(); g.moveTo(x, y); g.lineTo(x, ly); g.stroke();
      knob(g, x, ly, 9, '#d9d7c5');
      if (d.guard) {
        const closed = this.latch.get(1) === 1;
        g.strokeStyle = '#d64031'; g.lineWidth = 5;
        g.strokeRect(x - 16, closed ? sy - 7 : b.y + 2, 32, closed ? travel + 15 : 15);
        centredText(g, closed ? 'LIFT GUARD' : 'GUARD OPEN', x, b.y + 12, 7, '#ffb29c');
      }
      return;
    }
    knob(g, x, y, d.kind === 'pullKnob' ? 16 + 3 * pulled : 11, d.kind === 'pullKnob' ? d.color : '#deded5');
    if (d.kind === 'pullKnob') {
      g.fillStyle = d.color; g.beginPath(); g.arc(x, y, 12 + 2 * pulled, 0, Math.PI * 2); g.fill();
      centredText(g, pulled > 0.95 ? 'PULL' : 'PUSH', x, y, 6, '#fff');
      if (d.guard) {
        const closed = this.latch.get(1) === 1;
        g.strokeStyle = '#e5ba48'; g.lineWidth = 4;
        g.beginPath(); g.roundRect(x - 24, closed ? y - 24 : b.y + 2, 48, closed ? 48 : 10, 4); g.stroke();
        centredText(g, 'GUARD', x, b.y + 9, 7, '#e5ba48');
      }
    } else if (pulled) { centredText(g, 'TEST', x, y, 5, '#222'); }
  }
}

/** How long the knob shows pulled out after a stroke, s (out and back in). */
const PRIMER_STROKE_SHOW = 0.6;

/**
 * A hand primer's knob (PanelDef.primer) over its bushing: turned with its slot across when LOCKED, along when
 * unlocked; drawn pulled out (larger, nearer) for a moment after each stroke (ControlInputs.primerStrokes).
 */
export class PrimerKnob implements PanelComponent {
  readonly id = 'primer';
  private readonly latch = new Latch(2);
  private strokes = NaN;
  private strokeAt = -Infinity;
  constructor(readonly bounds: Rect) {}
  sample(_r: InstrumentReadings, c: ControlInputs, time: number): boolean {
    const strokes = c.primerStrokes ?? 0;
    if (strokes > this.strokes) this.strokeAt = time;
    this.strokes = strokes;
    // Out and back in: a triangle over the stroke's time.
    const t = (time - this.strokeAt) / PRIMER_STROKE_SHOW;
    this.latch.set(0, t >= 0 && t < 1 ? 1 - Math.abs(2 * t - 1) : 0, 0.1);
    this.latch.set(1, (c.primerLocked ?? true) ? 1 : 0, 1);
    return this.latch.take();
  }
  draw(g: Ctx2D): void {
    const b = this.bounds;
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    const r = 10 + 5 * this.latch.get(0);
    knob(g, x, y, r);
    // The slot across the face: horizontal locked, vertical unlocked.
    const locked = this.latch.get(1) === 1;
    g.strokeStyle = locked ? '#c9c9c4' : '#f0b44a';
    g.lineWidth = 2.5;
    g.beginPath();
    if (locked) { g.moveTo(x - r * 0.7, y); g.lineTo(x + r * 0.7, y); } else { g.moveTo(x, y - r * 0.7); g.lineTo(x, y + r * 0.7); }
    g.stroke();
  }
}

/** A running-time hourmeter, separate from the rpm-weighted tachometer counter. */
export class Hourmeter implements PanelComponent {
  private readonly latch = new Latch(1);
  constructor(readonly id: string, readonly bounds: Rect) {}
  sample(r: InstrumentReadings): boolean { this.latch.set(0, r.engineHours, 0.1); return this.latch.take(); }
  draw(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = '#111'; g.fillRect(b.x, b.y, b.w, b.h);
    centredText(g, 'HOURS', b.x + b.w / 2, b.y + 10, 8);
    centredText(g, this.latch.get(0).toFixed(1).padStart(6, '0'), b.x + b.w / 2, b.y + 29, 16, '#d7ddc5');
  }
  paintLightMask(g: Ctx2D): void { g.fillStyle = LIGHT_DIAL; g.fillRect(this.bounds.x, this.bounds.y, this.bounds.w, this.bounds.h); }
}
