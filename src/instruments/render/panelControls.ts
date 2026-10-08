// Small console controls with the same bindings as their click hotspots.
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { GaugeDef } from '../panelDef';
import { centredText, knob } from './art';
import type { Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';

type Control = Extract<GaugeDef, { kind: 'pullKnob' | 'pushButton' }>;
export class ConsoleControl implements PanelComponent {
  readonly id: string;
  readonly bounds: Rect;
  private readonly latch = new Latch(2);
  constructor(private readonly def: Control) { this.id = def.id; this.bounds = def.bounds; }
  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.set(0, Number(this.def.read(c)), 0.01);
    this.latch.set(1, this.def.kind === 'pullKnob' && this.def.guard?.closed(c) ? 1 : 0, 1);
    return this.latch.take();
  }
  draw(g: Ctx2D): void {
    const b = this.bounds, d = this.def;
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    centredText(g, d.label, x, b.y + b.h - 8, 9);
    const pulled = this.latch.get(0);
    knob(g, x, y, d.kind === 'pullKnob' ? 16 + 3 * pulled : 11, d.kind === 'pullKnob' ? d.color : '#deded5');
    if (d.kind === 'pullKnob') {
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
