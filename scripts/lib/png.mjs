// Minimal PNG reader for the measuring scripts (the decoder of scripts/imgdiff.mjs, as a module): 8-bit,
// non-interlaced grey / RGB / palette / alpha PNGs as Chrome writes them. Returns { width, height, data: RGBA }.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPng(path) {
  const buf = readFileSync(path);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 8 || signature.some((b, i) => buf[i] !== b)) throw new Error(`${path}: not a PNG file`);
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  let palette = null, transparency = null;
  const idat = [];
  for (let at = 8; at + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colour = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!width || !height || channels === undefined) throw new Error(`${path}: unsupported PNG (colour type ${colour})`);
  if (depth !== 8 || interlace !== 0) throw new Error(`${path}: unsupported PNG (bit depth ${depth}, interlace ${interlace}); only 8-bit non-interlaced`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error(`${path}: truncated image data`);
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? px[dst + x - channels] : 0;
      const up = y > 0 ? px[dst + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? px[dst + x - stride - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`${path}: bad filter type ${filter}`);
      px[dst + x] = (raw[src + x] + predicted) & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (colour === 6) [r, g, b, a] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]];
    else if (colour === 2) [r, g, b] = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
    else if (colour === 0) r = g = b = px[i];
    else if (colour === 4) {
      r = g = b = px[i * 2];
      a = px[i * 2 + 1];
    } else {
      const k = px[i];
      if (!palette || k * 3 + 2 >= palette.length) throw new Error(`${path}: palette index out of range`);
      [r, g, b] = [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]];
      if (transparency && k < transparency.length) a = transparency[k];
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

