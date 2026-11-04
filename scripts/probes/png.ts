// A minimal RGB PNG encoder for the probes (node only).
const node = (await import(/* @vite-ignore */ 'node:zlib' as string)) as { deflateSync(b: Uint8Array): Uint8Array };

function crc(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

/** Encode w x h RGB bytes as a PNG file. */
export function png(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (t: string, d: Uint8Array): Uint8Array => {
    const o = new Uint8Array(12 + d.length);
    const dv = new DataView(o.buffer);
    dv.setUint32(0, d.length);
    for (let i = 0; i < 4; i++) o[4 + i] = t.charCodeAt(i);
    o.set(d, 8);
    dv.setUint32(8 + d.length, crc(o.subarray(4, 8 + d.length)));
    return o;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', node.deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
