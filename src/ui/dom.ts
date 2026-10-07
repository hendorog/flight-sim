// Tiny DOM helpers for the UI module.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Sets textContent only when it changed (avoids layout work every frame). */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

/**
 * A crisp 2D canvas of the given CSS size, scaled for the device pixel ratio. The backing store is re-derived on
 * window 'resize' (the simulator dispatches one whenever devicePixelRatio changes); callers draw in CSS pixels
 * every frame, so the resize (which clears the canvas) needs no redraw of its own.
 */
export function hiDpiCanvas(parent: HTMLElement, w: number, h: number, className?: string): CanvasRenderingContext2D {
  const c = el('canvas', className, parent);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext('2d')!;
  let applied = 0;
  const fit = (): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (dpr === applied) return;
    applied = dpr;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  window.addEventListener('resize', fit);
  return g;
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "HH:MM" from hours. */
export function formatHours(h: number): string {
  const m = Math.round(h * 60) % (24 * 60);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
