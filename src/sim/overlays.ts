// Full-screen messages owned by the application shell: boot failure and WebGL context loss. Plain DOM with
// inline styles so they work even if the UI module failed to load.

function panel(title: string, body: string, detail?: string): HTMLDivElement {
  const root = document.createElement('div');
  root.setAttribute('role', 'alert');
  root.style.cssText =
    'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(8,12,20,0.94);color:#e8edf3;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px';
  const card = document.createElement('div');
  card.style.cssText = 'max-width:760px;width:100%;background:#141c28;border:1px solid #2c3a4f;border-radius:10px;padding:24px 28px;box-shadow:0 10px 40px #0008';
  const h = document.createElement('h1');
  h.textContent = title;
  h.style.cssText = 'margin:0 0 8px;font-size:20px;font-weight:600;color:#ffb4a8';
  const p = document.createElement('p');
  p.textContent = body;
  p.style.margin = '0 0 16px';
  card.append(h, p);
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail;
    pre.style.cssText = 'margin:0 0 16px;max-height:40vh;overflow:auto;background:#0b1119;border-radius:6px;padding:12px;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;color:#b9c6d6';
    card.append(pre);
  }
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = 'font:inherit;padding:8px 18px;border-radius:6px;border:0;background:#3d7bd9;color:#fff;cursor:pointer';
  btn.onclick = () => location.reload();
  card.append(btn);
  root.append(card);
  return root;
}

/** Show why the simulator could not start. */
export function showBootError(err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const webgl = /webgl|context/i.test(e.message);
  const hint = webgl
    ? 'The simulator needs WebGL 2 with float render targets. Check that hardware acceleration is enabled in the browser.'
    : 'Something went wrong while loading the simulator.';
  document.body.append(panel('The simulator could not start', hint, `${e.name}: ${e.message}\n\n${e.stack ?? ''}`));
}

/** Show the context-lost message; returns a function that removes it. */
export function showContextLost(): () => void {
  const el = panel(
    'Graphics context lost',
    'The browser reset the GPU context (a driver reset or too little video memory). The flight is paused; the page reloads by itself when the GPU is back, or reload now.',
  );
  document.body.append(el);
  return () => el.remove();
}

export interface Curtain {
  /** Change the message. */
  setText(text: string): void;
  /** Fade out and remove. */
  close(): void;
  /** Resolves once the curtain is fully opaque (so work done after it is hidden). */
  readonly shown: Promise<void>;
}

/**
 * A full-screen fade used to hide work that stalls rendering (scenario reset, graphics settings): fades to
 * near-black in `fadeMs`, shows a short message, fades out again on close().
 */
export function showCurtain(text: string, fadeMs = 180): Curtain {
  const root = document.createElement('div');
  root.setAttribute('role', 'status');
  root.style.cssText =
    // It takes the pointer while up, so nothing underneath (the menu) can be clicked behind it.
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:progress;' +
    `background:#05080d;opacity:0;transition:opacity ${fadeMs}ms ease;` +
    'color:#c9d4e2;font:500 15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:0.02em';
  const label = document.createElement('div');
  label.textContent = text;
  root.append(label);
  document.body.append(root);
  // Force a style flush so the transition runs from 0.
  void root.offsetWidth;
  root.style.opacity = '1';
  // Opaque after the transition and one more painted frame.
  const shown = new Promise<void>((resolve) =>
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), fadeMs),
  );
  let closed = false;
  return {
    shown,
    setText(t: string) {
      label.textContent = t;
    },
    close() {
      if (closed) return;
      closed = true;
      root.style.opacity = '0';
      root.style.pointerEvents = 'none';
      setTimeout(() => root.remove(), fadeMs + 50);
    },
  };
}
