// Mouse operation of the instrument panel in the cockpit view: knobs (altimeter setting, heading bug,
// DG align, OBS, dimmers), the switch row, the magneto key or the ignition switches, and where the panel has
// them the gear selector, the flap switch and guarded knobs.
//
// The 3D panel face is the mesh named 'instrumentPanel' (render/aircraft/cockpit.ts, a PlaneGeometry
// carrying the panel texture), so a raycast gives uv, and panel pixel = (u * width, (1 - v) * height) of the
// panel definition. What is clickable there, and what operating it does, are the hotspots built from that
// definition (instruments/hotspots.ts). Left click / hold operates; the wheel turns a knob under the pointer
// (and is then kept from the camera zoom). Nothing here takes keyboard focus. Momentary controls (a starter,
// DG align, a guarded knob) are held through the input module, because InputSystem rewrites them every frame
// from what it holds: through the `hold` function the owner passes in (InputSystem.hold, which can address one
// engine), else by a synthetic press of the action's key (which follows the keyboard's engine selection).

import * as THREE from 'three';
import { C172S_PANEL } from '../aircraft/c172s/panel';
import type { SimContext } from '../core/context';
import { keysForAction, type InputAction } from '../input/bindings';
import { buildHotspots, hotspotAt, type PanelHotspot } from '../instruments';
import type { PanelDef } from '../instruments/panelDef';
import { el, setText } from './dom';

const REPEAT_DELAY_MS = 380;
const REPEAT_MS = 70;

export class CockpitClicks {
  /** Set false to disable panel clicking (e.g. while a modal is open). */
  enabled = true;
  private ctx: SimContext | null = null;
  private dom: HTMLElement | null = null;
  private mesh: THREE.Mesh | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];
  private readonly tip: HTMLDivElement;
  private hover: PanelHotspot | null = null;
  private held: { spot: PanelHotspot; dir: 1 | -1; next: number; repeats: number } | null = null;
  /** The momentary action a spring-loaded knob step or a push hotspot is holding down, or null. */
  private holding: { action: InputAction; engine?: number } | null = null;
  private lastPointer = { x: 0, y: 0, valid: false };
  private corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null = null;
  private cornersOf: THREE.BufferGeometry | null = null;
  private readonly size: PanelDef['size'];
  private readonly spots: readonly PanelHotspot[];

  /**
   * @param def the panel on the 3D face; default: the C172S's.
   * @param holdAction InputSystem.hold of the input module: holds a momentary action, for one engine when
   *   `engine` is given. Absent: a synthetic press of the action's key.
   */
  constructor(
    parent: HTMLElement,
    def: PanelDef = C172S_PANEL,
    private readonly holdAction?: (action: InputAction, down: boolean, engine?: number) => void,
  ) {
    this.tip = el('div', 'paneltip hidden', parent);
    this.size = def.size;
    this.spots = buildHotspots(def);
  }

  attach(ctx: SimContext): void {
    this.ctx = ctx;
    this.dom = ctx.renderer.domElement;
    this.dom.addEventListener('pointermove', this.onMove);
    this.dom.addEventListener('pointerdown', this.onDown);
    this.dom.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('blur', this.onUp);
    // Capture phase on window so a wheel over a knob never reaches the camera's zoom handler.
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
  }

  dispose(): void {
    const d = this.dom;
    d?.removeEventListener('pointermove', this.onMove);
    d?.removeEventListener('pointerdown', this.onDown);
    d?.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('blur', this.onUp);
    window.removeEventListener('wheel', this.onWheel, { capture: true });
    this.release();
    this.tip.remove();
  }

  /** A panel control is under the pointer (its tooltip shows its state). */
  get hovering(): boolean {
    return this.hover !== null;
  }

  /** Per frame: key repeat while a knob is held, the tooltip value, and the cursor. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const active = this.enabled && ctx.cameraMode === 'cockpit';
    if (!active) {
      this.release();
      this.setHover(null);
      return;
    }
    const h = this.held;
    if (h && h.spot.kind === 'knob' && !h.spot.noRepeat) {
      const now = performance.now();
      if (now >= h.next) {
        h.repeats++;
        // Spin faster the longer the knob is held.
        h.spot.turn?.(h.dir, ctx.controls, h.repeats > 20 ? 5 : 1);
        h.next = now + REPEAT_MS;
      }
    }
    if (this.hover) {
      const v = this.hover.value(ctx.controls);
      setText(this.tip, v ? `${this.hover.name}: ${v}` : this.hover.name);
    }
  }

  // --------------------------------------------------------------------------------------------------

  private panelMesh(): THREE.Mesh | null {
    if (this.mesh?.parent) return this.mesh;
    let found: THREE.Mesh | null = null;
    this.ctx?.scene.traverse((o) => {
      if (!found && o.name === 'instrumentPanel' && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    this.mesh = found;
    return found;
  }

  /** Hotspot under a client position, or null. */
  private pick(clientX: number, clientY: number): PanelHotspot | null {
    const ctx = this.ctx;
    const dom = this.dom;
    if (!ctx || !dom || !this.enabled || ctx.cameraMode !== 'cockpit') return null;
    const mesh = this.panelMesh();
    if (!mesh || !mesh.visible) return null;
    const r = dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, ctx.camera);
    this.hits.length = 0;
    mesh.raycast(this.ray, this.hits);
    const uv = this.hits[0]?.uv;
    if (!uv) return null;
    return hotspotAt(uv.x * this.size.w, (1 - uv.y) * this.size.h, this.spots);
  }

  /**
   * World position of a panel pixel. The panel geometry may be transformed in its local frame, so the
   * mapping is taken from the mesh's own corner vertices (uv (0,0), (1,0), (0,1)).
   */
  panelPointToWorld(px: number, py: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const mesh = this.panelMesh();
    if (!mesh) return null;
    const geo = mesh.geometry;
    if (this.cornersOf !== geo) {
      const pos = geo.getAttribute('position');
      const uv = geo.getAttribute('uv');
      if (!pos || !uv) return null;
      const find = (u: number, v: number): THREE.Vector3 | null => {
        for (let i = 0; i < uv.count; i++)
          if (Math.abs(uv.getX(i) - u) < 1e-4 && Math.abs(uv.getY(i) - v) < 1e-4) return new THREE.Vector3().fromBufferAttribute(pos, i);
        return null;
      };
      const c00 = find(0, 0);
      const c10 = find(1, 0);
      const c01 = find(0, 1);
      if (!c00 || !c10 || !c01) return null;
      this.corners = [c00, c10.sub(c00), c01.sub(c00)];
      this.cornersOf = geo;
    }
    const [o, du, dv] = this.corners!;
    const u = px / this.size.w;
    const v = 1 - py / this.size.h;
    out.copy(o).addScaledVector(du, u).addScaledVector(dv, v);
    return mesh.localToWorld(out);
  }

  /** Client (CSS pixel) position of a panel pixel in the current view, or null. */
  panelPointToClient(px: number, py: number): [number, number] | null {
    const p = this.panelPointToWorld(px, py);
    if (!p || !this.ctx || !this.dom) return null;
    p.project(this.ctx.camera);
    const r = this.dom.getBoundingClientRect();
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
  }

  /** Which half of a knob the pointer is on: right = clockwise. */
  private side(spot: PanelHotspot, clientX: number): 1 | -1 {
    const c = this.panelPointToClient(spot.x, spot.y);
    return !c || clientX >= c[0] ? 1 : -1;
  }

  /** Which half of a lever's slot the pointer is on: lower = +1. */
  private below(spot: PanelHotspot, clientY: number): 1 | -1 {
    const c = this.panelPointToClient(spot.x, spot.y);
    return !c || clientY >= c[1] ? 1 : -1;
  }

  private setHover(spot: PanelHotspot | null): void {
    if (spot === this.hover) return;
    this.hover = spot;
    this.tip.classList.toggle('hidden', !spot);
    if (this.dom) this.dom.style.cursor = spot ? (spot.kind === 'knob' ? 'ew-resize' : spot.kind === 'select' ? 'ns-resize' : 'pointer') : '';
  }

  private placeTip(x: number, y: number): void {
    this.tip.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 18)}px)`;
  }

  private readonly onMove = (e: PointerEvent): void => {
    this.lastPointer = { x: e.clientX, y: e.clientY, valid: true };
    if (e.buttons & ~1) {
      // Right/middle drag is the camera's (mouse look); hide the tip meanwhile.
      this.setHover(null);
      return;
    }
    const spot = this.held?.spot ?? this.pick(e.clientX, e.clientY);
    this.setHover(spot);
    if (spot) this.placeTip(e.clientX, e.clientY);
  };

  private readonly onLeave = (): void => {
    this.lastPointer.valid = false;
    if (!this.held) this.setHover(null);
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const spot = this.pick(e.clientX, e.clientY);
    if (!spot) return;
    const c = this.ctx!.controls;
    e.preventDefault();
    e.stopPropagation();
    if (spot.kind === 'toggle') {
      spot.toggle?.(c);
      return;
    }
    if (spot.kind === 'select') {
      spot.step?.(this.below(spot, e.clientY), c);
      return;
    }
    if (spot.kind === 'push') {
      spot.press?.(true, c);
      if (spot.hold) this.hold(spot.hold.action, true, spot.hold.engine);
      this.held = { spot, dir: 1, next: Infinity, repeats: 0 };
      return;
    }
    const dir = this.side(spot, e.clientX);
    if (spot.springHold && dir === 1 && spot.springHold.when(c)) {
      // Spring-loaded last step (the key's START): held until the button is released.
      this.hold(spot.springHold.action, true);
      this.held = { spot, dir, next: Infinity, repeats: 0 };
      return;
    }
    spot.turn?.(dir, c, 1);
    this.held = { spot, dir, next: performance.now() + REPEAT_DELAY_MS, repeats: 0 };
  };

  private readonly onUp = (): void => {
    this.release();
  };

  private release(): void {
    const h = this.held;
    if (!h) return;
    this.held = null;
    if (h.spot.kind === 'push' && this.ctx) h.spot.press?.(false, this.ctx.controls);
    if (this.holding) this.hold(this.holding.action, false, this.holding.engine);
  }

  /** Hold or release a momentary action through the input module (one at a time: there is one mouse button). */
  private hold(action: InputAction, down: boolean, engine?: number): void {
    if (down === (this.holding !== null)) return;
    this.holding = down ? { action, engine } : null;
    if (this.holdAction) {
      this.holdAction(action, down, engine);
      return;
    }
    // No hold function (UISystemOptions.hold absent): the key of the action; its engine is then the keyboard's.
    const key = keysForAction(action)[0];
    if (!key) return;
    const letter = key.code.startsWith('Key') ? key.code.slice(3).toLowerCase() : '';
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: key.code, key: letter, shiftKey: key.shift, bubbles: true }));
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) return;
    const target = e.target;
    if (target !== this.dom) return;
    const spot = this.pick(e.clientX, e.clientY);
    if (!spot || spot.kind !== 'knob') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const dir: 1 | -1 = e.deltaY < 0 ? 1 : -1;
    // The wheel never engages a spring-loaded step (the starter).
    spot.turn?.(dir, this.ctx!.controls, Math.abs(e.deltaY) > 150 ? 5 : 1);
    this.setHover(spot);
    this.placeTip(e.clientX, e.clientY);
  };
}
