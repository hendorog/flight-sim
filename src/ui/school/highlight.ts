// Instrument highlight (section 5.4): a pulsing ring over each named instrument in the cockpit view,
// positioned every frame by projecting its panel position (src/instruments/layout.ts) to the screen as the
// panel click hotspots do. Hidden in external views and when the panel cannot be projected.

import { PANEL_LAYOUT } from '../../instruments/layout';
import type { InstrumentId } from '../../training/types';
import { el } from '../dom';
import type { SchoolViewHost } from './models';

const L = PANEL_LAYOUT;
const BIG = L.apertures.sixPack * 1.1;
const SMALL = L.apertures.small * 1.15;

/** Panel-pixel centre and ring radius of each instrument a lesson can name. */
export const INSTRUMENT_SPOTS: Record<InstrumentId, { x: number; y: number; r: number }> = {
  asi: { x: L.sixPack.cols[0], y: L.sixPack.rows[0], r: BIG },
  ai: { x: L.sixPack.cols[1], y: L.sixPack.rows[0], r: BIG },
  alt: { x: L.sixPack.cols[2], y: L.sixPack.rows[0], r: BIG },
  tc: { x: L.sixPack.cols[0], y: L.sixPack.rows[1], r: BIG },
  // The slip ball sits in the lower part of the turn coordinator.
  ball: { x: L.sixPack.cols[0], y: L.sixPack.rows[1] + L.apertures.sixPack * 0.45, r: L.apertures.sixPack * 0.42 },
  dg: { x: L.sixPack.cols[1], y: L.sixPack.rows[1], r: BIG },
  vsi: { x: L.sixPack.cols[2], y: L.sixPack.rows[1], r: BIG },
  tach: { x: L.engineRow.tach, y: L.engineRow.y, r: BIG },
  fuel: { x: L.engineRow.fuel, y: L.engineRow.y, r: SMALL },
  oil: { x: L.engineRow.oil, y: L.engineRow.y, r: SMALL },
  flaps: { x: L.flaps.x + L.flaps.w / 2, y: L.flaps.y + L.flaps.h / 2, r: L.flaps.h / 2 },
};

export class InstrumentHighlight {
  readonly root: HTMLElement;
  private ids: readonly InstrumentId[] = [];
  private rings: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', '', parent);
  }

  set(ids: readonly InstrumentId[]): void {
    this.ids = [...ids];
    while (this.rings.length < this.ids.length) this.rings.push(el('div', 'sc-ring hidden', this.root));
    while (this.rings.length > this.ids.length) this.rings.pop()!.remove();
  }

  get active(): readonly InstrumentId[] {
    return this.ids;
  }

  /** Per frame: place the rings (hidden outside the cockpit view or without a projection). */
  update(view: SchoolViewHost | null): void {
    if (this.ids.length === 0) return;
    const on = !!view && view.cockpit();
    this.ids.forEach((id, i) => {
      const ring = this.rings[i];
      const s = INSTRUMENT_SPOTS[id];
      const c = on && s ? view!.project(s.x, s.y) : null;
      const edge = c ? view!.project(s.x + s.r, s.y) : null;
      if (!c || !edge) {
        ring.classList.add('hidden');
        return;
      }
      const r = Math.max(14, Math.hypot(edge[0] - c[0], edge[1] - c[1]));
      ring.classList.remove('hidden');
      ring.style.width = ring.style.height = `${(2 * r).toFixed(1)}px`;
      ring.style.transform = `translate(${(c[0] - r).toFixed(1)}px, ${(c[1] - r).toFixed(1)}px)`;
    });
  }
}
