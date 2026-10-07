// Base class for a round instrument: a cached dial face, dynamic parts drawn every change, and a cached
// front layer (fixed markers, bezel, glass).

import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import { makeBezel, makeFace } from './art';
import { context2d, makeCanvas, type Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';
import { BEZEL_MARGIN, roundGaugeRect } from '../panelParts';

export interface RoundGaugeOptions {
  /** Outer size of the bezel, px (the 3-1/8" instruments are 172 px, the 2-1/4" ones 120 px). */
  bezel: number;
  /** Radius of the glass aperture, px. */
  aperture: number;
  shape: 'square' | 'round';
  /** Number of latched display values. */
  values: number;
  seed: number;
}

/** Clear margin around the bezel for its drop shadow; part of the component's bounds. */
const MARGIN = BEZEL_MARGIN;

export abstract class RoundGauge implements PanelComponent {
  readonly bounds: Rect;
  /** Dial centre in panel pixels. */
  protected readonly cx: number;
  protected readonly cy: number;
  protected readonly r: number;
  protected readonly latch: Latch;
  private face: HTMLCanvasElement | null = null;
  private front: HTMLCanvasElement | null = null;

  constructor(
    readonly id: string,
    cx: number,
    cy: number,
    private readonly opts: RoundGaugeOptions,
  ) {
    this.bounds = roundGaugeRect(cx, cy, opts.bezel);
    const size = this.bounds.w;
    this.cx = this.bounds.x + size / 2;
    this.cy = this.bounds.y + size / 2;
    this.r = opts.aperture;
    this.latch = new Latch(opts.values);
  }

  abstract sample(r: InstrumentReadings, c: ControlInputs, time: number): boolean;

  /** Paint the static dial (ticks, arcs, numbers, legends), origin at the dial centre. */
  protected abstract paintFace(g: Ctx2D): void;
  /** Draw the moving parts in panel coordinates (centre at this.cx, this.cy). */
  protected abstract drawDynamic(g: Ctx2D): void;
  /** Fixed parts above the moving parts but under the glass, origin at the dial centre. */
  protected paintFixtures(_g: Ctx2D): void {}
  /** Parts mounted on the bezel (knobs), origin at the dial centre. */
  protected paintOverBezel(_g: Ctx2D): void {}

  /** The dial behind the glass is backlit (post lights in the real aircraft; here the whole aperture). */
  paintLightMask(g: Ctx2D): void {
    g.fillStyle = LIGHT_DIAL;
    g.beginPath();
    g.arc(this.cx, this.cy, this.r, 0, Math.PI * 2);
    g.fill();
  }

  draw(g: Ctx2D): void {
    if (!this.face || !this.front) this.build();
    const b = this.bounds;
    g.drawImage(this.face!, b.x, b.y);
    this.drawDynamic(g);
    g.drawImage(this.front!, b.x, b.y);
  }

  private build(): void {
    const size = this.bounds.w;
    const m = size / 2;
    this.face = makeFace(size, this.r, this.opts.seed);
    const fg = context2d(this.face);
    fg.setTransform(1, 0, 0, 1, m, m);
    this.paintFace(fg);
    this.front = makeCanvas(size, size);
    const g = context2d(this.front);
    g.translate(m, m);
    this.paintFixtures(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(makeBezel(this.opts.bezel, this.r, this.opts.seed + 1, this.opts.shape), MARGIN, MARGIN);
    g.translate(m, m);
    this.paintOverBezel(g);
  }
}
