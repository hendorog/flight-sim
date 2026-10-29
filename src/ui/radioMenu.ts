// The push-to-talk menu (docs/atc.md): Space opens it over the flight view with the calls that fit the moment,
// numbered; a number key or a click transmits one. Built by RadioSystem, mounted on the UI's school layer.

import { el } from './dom';

export interface RadioMenuItem {
  label: string;
  /** The transmission as captioned, shown under the label. */
  detail: string;
}

export class RadioMenu {
  readonly root: HTMLDivElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private key = '';

  constructor(parent: HTMLElement, private readonly onPick: (i: number) => void) {
    this.root = el('div', 'radio-menu hidden', parent);
    this.head = el('div', 'radio-menu-head', this.root);
    this.list = el('div', 'radio-menu-list', this.root);
    this.note = el('div', 'radio-menu-note', this.root);
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show (or refresh) the menu; the DOM is rebuilt only when the items change. */
  show(title: string, items: readonly RadioMenuItem[], note: string): void {
    this.root.classList.remove('hidden');
    this.head.textContent = title;
    this.note.textContent = note;
    const key = items.map((i) => i.label + i.detail).join('|');
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren();
    items.forEach((item, i) => {
      const b = el('button', 'radio-call', this.list);
      el('kbd', '', b, String(i + 1));
      const t = el('span', '', b);
      el('b', '', t, item.label);
      el('small', '', t, item.detail);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onPick(i);
      });
    });
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}

export const RADIO_MENU_CSS = `
#fsui .radio-menu { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); width: min(520px, calc(100vw - 32px));
  padding: 10px 12px 10px; border-radius: 12px; background: rgba(10,14,20,.84); backdrop-filter: blur(10px);
  border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.35); pointer-events: auto; }
#fsui .radio-menu-head { font-size: 10px; letter-spacing: .14em; color: #ffc34d; font-weight: 700; margin-bottom: 6px; text-transform: uppercase; }
#fsui .radio-menu-list { display: flex; flex-direction: column; gap: 4px; }
#fsui .radio-call { display: flex; align-items: flex-start; gap: 10px; text-align: left; padding: 6px 8px; border-radius: 8px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); color: var(--fg); cursor: pointer; }
#fsui .radio-call:hover { background: rgba(82,195,255,.14); border-color: rgba(82,195,255,.4); }
#fsui .radio-call kbd { flex: none; min-width: 18px; text-align: center; font: 700 12px/18px ui-monospace, Menlo, Consolas, monospace;
  border-radius: 4px; background: rgba(255,255,255,.12); }
#fsui .radio-call b { display: block; font-size: 13px; }
#fsui .radio-call small { display: block; font-size: 11.5px; color: var(--fg-dim); }
#fsui .radio-menu-note { margin-top: 6px; font-size: 11px; color: var(--fg-dim); }
`;
