// A canvas that accepts every drawing call and draws nothing, so panel components can be built and painted
// without a DOM. It keeps the lettering (fillText), the fill and the stroke colours it was given.

import { vi } from 'vitest';
import type { Ctx2D } from '../../src/instruments/render/canvas';

export interface StubCanvas {
  g: Ctx2D;
  texts: string[];
  fills: string[];
  strokes: string[];
}

/** Installs the stub as `document` (undo with vi.unstubAllGlobals()) and returns its drawing context and what it recorded. */
export function stubCanvas(): StubCanvas {
  const texts: string[] = [];
  const fills: string[] = [];
  const strokes: string[] = [];
  const pixels = new Uint8ClampedArray(0);
  const sink: unknown = new Proxy(function () {}, {
    get: (_t, key) => {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'data') return pixels;
      if (key === 'fillText') return (text: string) => void texts.push(text);
      return sink;
    },
    set: (_t, key, value) => {
      if (key === 'strokeStyle') strokes.push(String(value));
      if (key === 'fillStyle' && typeof value === 'string') fills.push(value);
      return true;
    },
    apply: () => sink,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
  return { g: sink as Ctx2D, texts, fills, strokes };
}
