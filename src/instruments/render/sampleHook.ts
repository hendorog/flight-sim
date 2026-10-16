// A gauge component with a hook run before each sample: the panel definition's `onSample` steps a display model (the cabin
// altitude display) from the readings and the panel's clock, then the wrapped gauge samples and draws as it always does.

import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { Ctx2D } from './canvas';
import type { PanelComponent, Rect } from './component';

export class SampleHook implements PanelComponent {
  readonly id: string;
  readonly bounds: Rect;

  constructor(
    private readonly inner: PanelComponent,
    private readonly hook: (r: InstrumentReadings, time: number) => void,
  ) {
    this.id = inner.id;
    this.bounds = inner.bounds;
  }

  get paintRects(): readonly Rect[] | undefined { return this.inner.paintRects; }

  sample(r: InstrumentReadings, c: ControlInputs, time: number): boolean {
    this.hook(r, time);
    return this.inner.sample(r, c, time);
  }

  draw(g: Ctx2D): void { this.inner.draw(g); }
  drawStatic(g: Ctx2D): void { this.inner.drawStatic?.(g); }
  paintLightMask(g: Ctx2D): void { this.inner.paintLightMask?.(g); }
}
