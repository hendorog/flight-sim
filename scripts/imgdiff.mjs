#!/usr/bin/env node
// Compare two PNG images pixel by pixel; the exit code says whether they differ.
//
//   node scripts/imgdiff.mjs <a.png> <b.png> [--max N] [--mask x,y,w,h]... [--tol T] [--out diff.png]
//                            [--strict] [--no-rules]
//
//   --max N         number of differing pixels still accepted (default 0)
//   --mask x,y,w,h  ignore this rectangle (pixels, origin top-left); may be given several times
//   --tol T         a pixel differs when any of R, G, B, A differs by more than T (0..255, default 0)
//   --out file      write a picture of the differences: differing pixels red on the dimmed first image,
//                   masked regions blue
//   --strict        ignore the `tol` and `max` lines of a rules file (its masks still apply)
//   --no-rules      ignore rules files altogether
//
// Exit code: 0 = at most N pixels differ; 1 = more than N differ, or the sizes are not the same;
// 2 = usage error or a file that cannot be read. Prints one line with the count, and when pixels differ their
// bounding box and the largest channel difference (what to look at, or to mask).
//
// Rules file. A reference image may have a file beside it named <image>.rules (for example
// work/baseline/panel.png.rules) that describes what in THAT picture is known not to repeat from one run of the
// same code to the next. It is applied whenever the image is one of the two compared, and it is printed, so
// every caller compares the same way without repeating the numbers:
//     # a comment: printed as a note when the comparison fails
//     mask 1200,856,400,44      a rectangle that is not compared (a wall-clock readout, a toast that fades)
//     tol 16                    noise floor: the tolerance used is at least this ...
//     max 200                   ... and at least this many differing pixels are accepted
// `tol` and `max` RAISE what the command line asks for (`--max 0` on a picture with `max 200` accepts 200, and
// says so); --strict compares with the command line's numbers alone.
//
// No dependencies: reads the PNGs Chrome writes (8 bits per channel, not interlaced; grey, RGB, palette, with
// or without alpha) with node's zlib.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

function usage(message) {
  if (message) console.error(`[imgdiff] ${message}`);
  console.error('usage: node scripts/imgdiff.mjs <a.png> <b.png> [--max N] [--mask x,y,w,h]... [--tol T] [--out diff.png] [--strict] [--no-rules]');
  process.exit(2);
}

const files = [];
const masks = [];
let max = 0;
let tol = 0;
let out = null;
let strict = false;
let useRules = true;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const value = () => {
    if (i + 1 >= argv.length) usage(`${a} needs a value`);
    return argv[++i];
  };
  if (a === '--max') max = Number(value());
  else if (a === '--tol') tol = Number(value());
  else if (a === '--out') out = value();
  else if (a === '--strict') strict = true;
  else if (a === '--no-rules') useRules = false;
  else if (a === '--mask') {
    const m = value().split(',').map(Number);
    if (m.length !== 4 || m.some((n) => !Number.isFinite(n))) usage('--mask takes x,y,w,h');
    masks.push(m);
  } else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else files.push(a);
}
if (files.length !== 2) usage();
if (!Number.isFinite(max) || max < 0 || !Number.isFinite(tol) || tol < 0) usage('--max and --tol take a number >= 0');

// Rules files of the two images (see the header).
const notes = [];
const applied = [];
if (useRules) {
  for (const file of new Set(files)) {
    const path = `${file}.rules`;
    if (!existsSync(path)) continue;
    let nMasks = 0, floorTol = null, floorMax = null;
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (line === '') continue;
      if (line.startsWith('#')) {
        notes.push(line.replace(/^#\s?/, ''));
        continue;
      }
      const [word, rest = ''] = line.split(/\s+(.*)/);
      const numbers = rest.split(',').map((x) => Number(x.trim()));
      if (word === 'mask' && numbers.length === 4 && numbers.every(Number.isFinite)) {
        masks.push(numbers);
        nMasks++;
      } else if (word === 'tol' && numbers.length === 1 && numbers[0] >= 0) floorTol = numbers[0];
      else if (word === 'max' && numbers.length === 1 && numbers[0] >= 0) floorMax = numbers[0];
      else {
        console.error(`[imgdiff] ${path}: cannot read the line '${line}' (mask x,y,w,h | tol N | max N | # note)`);
        process.exit(2);
      }
    }
    const parts = [];
    if (nMasks) parts.push(`${nMasks} mask${nMasks > 1 ? 's' : ''}`);
    if (floorTol !== null) {
      if (strict) parts.push(`tolerance ${floorTol} ignored (--strict)`);
      else {
        parts.push(`tolerance at least ${floorTol}${tol < floorTol ? ` (the command asked for ${tol})` : ''}`);
        tol = Math.max(tol, floorTol);
      }
    }
    if (floorMax !== null) {
      if (strict) parts.push(`max ${floorMax} ignored (--strict)`);
      else {
        parts.push(`max at least ${floorMax}${max < floorMax ? ` (the command asked for ${max})` : ''}`);
        max = Math.max(max, floorMax);
      }
    }
    applied.push(`[imgdiff] rules of ${path}: ${parts.join(', ') || 'notes only'}`);
  }
}

/** Decode a PNG into { width, height, data: Uint8Array RGBA }. */
function readPng(path) {
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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function writePng(path, width, height, rgba) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

let a, b;
try {
  a = readPng(files[0]);
  b = readPng(files[1]);
} catch (e) {
  console.error(`[imgdiff] ${e.message}`);
  process.exit(2);
}
if (a.width !== b.width || a.height !== b.height) {
  console.log(`[imgdiff] DIFFERENT SIZES: ${files[0]} is ${a.width}x${a.height}, ${files[1]} is ${b.width}x${b.height}`);
  process.exit(1);
}

const { width, height } = a;
const masked = new Uint8Array(width * height);
for (const [mx, my, mw, mh] of masks) {
  for (let y = Math.max(0, Math.floor(my)); y < Math.min(height, Math.ceil(my + mh)); y++) {
    for (let x = Math.max(0, Math.floor(mx)); x < Math.min(width, Math.ceil(mx + mw)); x++) masked[y * width + x] = 1;
  }
}

let differing = 0, compared = 0, largest = 0;
let x0 = width, y0 = height, x1 = -1, y1 = -1;
const picture = out ? new Uint8Array(width * height * 4) : null;
for (let i = 0; i < width * height; i++) {
  const k = i * 4;
  let d = 0;
  if (!masked[i]) {
    compared++;
    d = Math.max(Math.abs(a.data[k] - b.data[k]), Math.abs(a.data[k + 1] - b.data[k + 1]), Math.abs(a.data[k + 2] - b.data[k + 2]), Math.abs(a.data[k + 3] - b.data[k + 3]));
    if (d > tol) {
      differing++;
      if (d > largest) largest = d;
      const x = i % width, y = (i - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (picture) {
    const grey = (a.data[k] + a.data[k + 1] + a.data[k + 2]) / 12;
    if (!masked[i] && d > tol) picture.set([255, 0, 0, 255], k);
    else if (masked[i]) picture.set([grey, grey, 96 + grey, 255], k);
    else picture.set([grey, grey, grey, 255], k);
  }
}
if (picture) writePng(out, width, height, picture);

const ok = differing <= max;
let line = `[imgdiff] ${ok ? 'OK' : 'DIFFERENT'}: ${differing} of ${compared} pixels differ (max ${max}${tol ? `, tolerance ${tol}` : ''}${masks.length ? `, ${masks.length} mask${masks.length > 1 ? 's' : ''}` : ''}) ${files[0]} ${files[1]}`;
if (differing > 0) line += `\n[imgdiff] differing pixels lie in x ${x0}..${x1}, y ${y0}..${y1} (--mask ${x0},${y0},${x1 - x0 + 1},${y1 - y0 + 1}); largest channel difference ${largest}`;
for (const a of applied) console.log(a);
console.log(line);
if (!ok) for (const n of notes) console.log(`[imgdiff] note: ${n}`);
process.exit(ok ? 0 : 1);
