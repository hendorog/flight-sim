// A round gauge whose needles read a CabinDisplay (cabin altitude and differential pressure as a display function of
// pressure altitude, dynamics/cabinDisplay.ts). It wraps the gauge component the panel definition builds, steps the
// display from the panel's own clock before the wrapped gauge samples, and passes everything else through.

import type { ControlInputs } from '../../core/types';
import type { CabinDisplay } from '../dynamics/cabinDisplay';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { Ctx2D } from './canvas';
import type { PanelComponent, Rect } from './component';

export class CabinGauge implements PanelComponent {
  readonly id: string;
  readonly bounds: Rect;
  private last = NaN;

  constructor(
    private readonly inner: PanelComponent,
    private readonly cabin: CabinDisplay,
  ) {
    this.id = inner.id;
    this.bounds = inner.bounds;
  }

  get paintRects(): readonly Rect[] | undefined { return this.inner.paintRects; }

  sample(r: InstrumentReadings, c: ControlInputs, time: number): boolean {
    const dt = Number.isNaN(this.last) ? Infinity : time - this.last;
    this.last = time;
    this.cabin.step(dt, r.pressureAltitudeFt);
    return this.inner.sample(r, c, time);
  }

  draw(g: Ctx2D): void { this.inner.draw(g); }
  drawStatic(g: Ctx2D): void { this.inner.drawStatic?.(g); }
  paintLightMask(g: Ctx2D): void { this.inner.paintLightMask?.(g); }
}
