// A minimal stand-in for the page, so the UI's DOM classes (Hud, ControlsWidget, HintsCard) can be built and
// updated in node: elements with children, class lists, inline style, text and attributes; canvases whose
// drawing context accepts every call and draws nothing; a window that takes listeners.

import { vi } from 'vitest';

export class FakeElement {
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  readonly style: Record<string, string> & { setProperty(k: string, v: string): void } = Object.assign(Object.create(null), {
    setProperty(this: Record<string, string>, k: string, v: string) {
      this[k] = v;
    },
  });
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  private ownText = '';
  className = '';
  innerHTML = '';
  width = 0;
  height = 0;

  constructor(readonly tagName: string) {}

  get classList() {
    const names = (): string[] => this.className.split(/\s+/).filter((c) => c.length > 0);
    const set = (list: string[]): void => void (this.className = list.join(' '));
    return {
      contains: (c: string) => names().includes(c),
      add: (...cs: string[]) => set([...new Set([...names(), ...cs])]),
      remove: (...cs: string[]) => set(names().filter((n) => !cs.includes(n))),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !names().includes(c);
        set(on ? [...new Set([...names(), c])] : names().filter((n) => n !== c));
        return on;
      },
    };
  }

  /** Own text plus that of every descendant, in order (as the DOM's textContent). */
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join('');
  }

  set textContent(t: string) {
    this.children.length = 0;
    this.ownText = t;
  }

  get lastElementChild(): FakeElement | null {
    return this.children[this.children.length - 1] ?? null;
  }

  appendChild(c: FakeElement): FakeElement {
    c.remove();
    c.parentElement = this;
    this.children.push(c);
    return c;
  }

  prepend(c: FakeElement): void {
    c.remove();
    c.parentElement = this;
    this.children.unshift(c);
  }

  insertBefore(c: FakeElement, ref: FakeElement | null): FakeElement {
    c.remove();
    c.parentElement = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }

  replaceChildren(...cs: FakeElement[]): void {
    for (const c of [...this.children]) c.remove();
    for (const c of cs) this.appendChild(c);
  }

  remove(): void {
    const p = this.parentElement;
    if (!p) return;
    p.children.splice(p.children.indexOf(this), 1);
    this.parentElement = null;
  }

  setAttribute(k: string, v: string): void {
    this.attributes.set(k, v);
  }

  /** Any selector finds a detached stand-in (the HUD's wind arrow is an SVG group inside innerHTML). */
  querySelector(): FakeElement {
    return new FakeElement('g');
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  focus(): void {}
  blur(): void {}

  getContext(): unknown {
    return SINK;
  }

  /** Every descendant (depth first) whose class list has `cls`. */
  findAll(cls: string): FakeElement[] {
    const out: FakeElement[] = [];
    for (const c of this.children) {
      if (c.classList.contains(cls)) out.push(c);
      out.push(...c.findAll(cls));
    }
    return out;
  }

  /** The direct children's text, one entry per child. */
  get childTexts(): string[] {
    return this.children.map((c) => c.textContent);
  }
}

const SINK: unknown = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : SINK),
  set: () => true,
  apply: () => SINK,
});

/** Installs `document` and `window` (undo with vi.unstubAllGlobals()). */
export function installFakeDom(): void {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    head: new FakeElement('head'),
    getElementById: () => null,
    activeElement: null,
  });
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
  });
}
