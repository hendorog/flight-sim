// Instrument hood and "close your eyes" (section 5.4): a DOM mask over everything above the glareshield
// line, projected from the panel's top edge each frame; the blackout is the same mask at full height.
// Without a projection (external view, panel not loaded) the hood covers the top 62 % of the screen.

import { PANEL_WIDTH } from '../../instruments/layout';
import { el } from '../dom';
import type { HoodMode, SchoolViewHost } from './models';

/**
 * Screen y (CSS px) of the glareshield, the panel's top edge, sampled at both ends in case the view is
 * rolled; null outside the cockpit view or without a projection.
 */
export function glareshieldY(view: SchoolViewHost | null): number | null {
  if (!view?.cockpit()) return null;
  const a = view.project(0, 0);
  const b = view.project(PANEL_WIDTH, 0);
  return a && b ? Math.max(a[1], b[1]) : null;
}

export class Hood {
  readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private mode: HoodMode = 'off';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'sc-hood hidden', parent);
    this.label = el('div', 'sc-hood-label', this.root);
  }

  set(mode: HoodMode): void {
    this.mode = mode;
    this.root.classList.toggle('hidden', mode === 'off');
    this.root.classList.toggle('blackout', mode === 'blackout');
    this.label.textContent = mode === 'blackout' ? 'Eyes closed' : 'Hood: instruments only';
    if (mode === 'blackout') this.root.style.height = '';
  }

  get current(): HoodMode {
    return this.mode;
  }

  update(view: SchoolViewHost | null): void {
    if (this.mode !== 'hood') return;
    const vh = window.innerHeight;
    const y = glareshieldY(view) ?? vh * 0.62;
    this.root.style.height = `${Math.round(Math.max(0, Math.min(vh, y + 4)))}px`;
  }
}
