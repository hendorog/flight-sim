// Scale all the artwork together, keeping the recess, pointer, bezel knob and dirty rectangle aligned.
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { Ctx2D } from './canvas';
import type { PanelComponent, Rect } from './component';

export class ScaledGauge implements PanelComponent {
  readonly id: string;
  constructor(private readonly inner: PanelComponent, readonly bounds: Rect,
    private readonly x: number, private readonly y: number, private readonly scale: number) {
    this.id = inner.id;
  }
  sample(r: InstrumentReadings, c: ControlInputs, time: number): boolean { return this.inner.sample(r, c, time); }
  private paint(g: Ctx2D, draw: (g: Ctx2D) => void): void {
    g.save();
    g.translate(this.x, this.y);
    g.scale(this.scale, this.scale);
    g.translate(-this.x, -this.y);
    draw(g);
    g.restore();
  }
  draw(g: Ctx2D): void { this.paint(g, (ctx) => this.inner.draw(ctx)); }
  drawStatic(g: Ctx2D): void { this.paint(g, (ctx) => this.inner.drawStatic?.(ctx)); }
  paintLightMask(g: Ctx2D): void { this.paint(g, (ctx) => this.inner.paintLightMask?.(ctx)); }
}
