// Native double-click timing, with both clicks checked against the canvas and live panel hit-testing.
// HTML targets never qualify, including children of menus, SVG icons, editable text and other canvases.
export const MOUSE_DRAG_SLOP = 6; // CSS pixels; shared with the camera so click jitter never turns the view.

export class MouseFlightGesture {
  private down: { x: number; y: number; valid: boolean } | null = null;
  private first = false;
  private pair = false;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly blocked: (x: number, y: number) => boolean,
    private readonly toggle: () => void,
  ) {}

  attach(): void {
    window.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointermove', this.onMove, { capture: true });
    window.addEventListener('click', this.onClick, { capture: true });
    window.addEventListener('dblclick', this.onDoubleClick, { capture: true });
    window.addEventListener('pointercancel', this.reset, { capture: true });
    window.addEventListener('blur', this.reset);
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onDown, { capture: true });
    window.removeEventListener('pointermove', this.onMove, { capture: true });
    window.removeEventListener('click', this.onClick, { capture: true });
    window.removeEventListener('dblclick', this.onDoubleClick, { capture: true });
    window.removeEventListener('pointercancel', this.reset, { capture: true });
    window.removeEventListener('blur', this.reset);
  }

  private allowed(e: MouseEvent): boolean {
    return e.target === this.canvas && e.button === 0 && !e.ctrlKey && !e.altKey && !e.metaKey &&
      !e.shiftKey && !document.pointerLockElement && !this.blocked(e.clientX, e.clientY);
  }

  private readonly reset = (): void => { this.down = null; this.first = this.pair = false; };
  private readonly onDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY, valid: e.pointerType !== 'touch' && this.allowed(e) };
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > MOUSE_DRAG_SLOP) this.down.valid = false;
  };
  private readonly onClick = (e: MouseEvent): void => {
    const valid = !!this.down?.valid && this.allowed(e) &&
      Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) <= MOUSE_DRAG_SLOP;
    this.pair = e.detail === 2 && this.first && valid;
    this.first = e.detail === 1 && valid;
    this.down = null;
  };
  private readonly onDoubleClick = (e: MouseEvent): void => {
    const valid = this.pair && this.allowed(e);
    this.reset();
    if (!valid) return;
    e.preventDefault();
    this.toggle();
  };
}
