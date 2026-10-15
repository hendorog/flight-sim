// Handedness proofs of the real sky: an equirectangular map or a catalogue seen from inside the sphere is easily
// mirrored. Catalogue stars are placed exactly as the Points layer places them (world = equatorialToWorld * e) and
// projected into a camera at the airfield; the shipped Milky Way map is decoded and sampled through the shader's own
// lookup (see the block above its describe).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRPORT } from '../../src/core/world';
import { Celestial } from '../../src/render/sky/celestial';
import { EQ_TO_GAL, MILKY_WAY_GLSL, MILKY_WAY_MAP, milkyWayUv } from '../../src/render/sky/glsl/milkyWay';
import { decodeStarCatalog, equatorialVector, starIndexByHR } from '../../src/render/sky/starCatalog';
import { configureMilkyWayTexture } from '../../src/render/sky/StarField';

interface Fs {
  readFileSync(path: URL): Uint8Array;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const bytes = fs.readFileSync(new URL('../../public/sky/stars/bsc5.bin', import.meta.url));
const cat = decodeStarCatalog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const DEG = Math.PI / 180;

// 2016-12-29 23:30 (doy 364 of the leap year 2016): new Moon, Orion near the meridian. Same as the shots.
const celestial = new Celestial();
celestial.update(23.5, 364);

/** World direction (three.js: x east, y up, z = -north) of a catalogue star. */
function worldDir(hr: number): THREE.Vector3 {
  const i = starIndexByHR(cat, hr);
  expect(i, `HR ${hr}`).toBeGreaterThanOrEqual(0);
  const e = equatorialVector(cat.ra[i], cat.dec[i]) as number[];
  return new THREE.Vector3(e[0], e[1], e[2]).applyMatrix3(celestial.equatorialToWorld);
}

/** Direction of azimuth (from north through east) / altitude, deg. */
function azAlt(az: number, alt: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(az * DEG) * Math.cos(alt * DEG), Math.sin(alt * DEG), -Math.cos(az * DEG) * Math.cos(alt * DEG));
}

/** Gnomonic screen coordinates (x right, y up) of `d` in a level camera looking at az/alt. */
function camera(az: number, alt: number): (d: THREE.Vector3) => [number, number] {
  const f = azAlt(az, alt);
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f);
  return (d) => {
    const z = d.dot(f);
    expect(z, 'in front of the camera').toBeGreaterThan(0.2);
    return [d.dot(r) / z, d.dot(u) / z];
  };
}

describe('catalogue handedness at the airfield (46.5 N), 2016-12-29 23:30', () => {
  it('uses the airfield latitude', () => {
    expect(AIRPORT.latitudeDeg).toBeCloseTo(46.5, 6);
    // The celestial pole stands at the latitude's altitude, due north.
    const pole = new THREE.Vector3(0, 0, 1).applyMatrix3(celestial.equatorialToWorld);
    expect(Math.asin(pole.y) / DEG).toBeCloseTo(46.5, 6);
    expect(pole.x).toBeCloseTo(0, 6);
    expect(pole.z).toBeLessThan(0);
  });

  it('looking south (az 180, alt 35): Betelgeuse left of and above Rigel, Sirius lower left', () => {
    const view = camera(180, 35);
    const betelgeuse = view(worldDir(2061));
    const rigel = view(worldDir(1713));
    const sirius = view(worldDir(2491));
    expect(betelgeuse[0]).toBeLessThan(rigel[0]);
    expect(betelgeuse[1]).toBeGreaterThan(rigel[1]);
    expect(sirius[0]).toBeLessThan(rigel[0]);
    expect(sirius[1]).toBeLessThan(rigel[1]);
    // Belt (Alnitak, Alnilam, Mintaka) between the two.
    for (const hr of [1948, 1903, 1852]) {
      const b = view(worldDir(hr));
      expect(b[1]).toBeLessThan(betelgeuse[1]);
      expect(b[1]).toBeGreaterThan(rigel[1]);
    }
  });

  it('looking south, increasing right ascension is to the left (east)', () => {
    const view = camera(180, 35);
    // Two points on the celestial equator near the meridian, 1 h of RA apart.
    // The equator crosses the meridian due south at altitude 90 - latitude: its RA there is the sidereal time.
    const m = azAlt(180, 90 - AIRPORT.latitudeDeg).applyMatrix3(celestial.equatorialToWorld.clone().transpose());
    expect(m.z).toBeCloseTo(0, 6);
    const lst = Math.atan2(m.y, m.x);
    const at = (ra: number): [number, number] => {
      const e = equatorialVector(ra, 0) as number[];
      return view(new THREE.Vector3(e[0], e[1], e[2]).applyMatrix3(celestial.equatorialToWorld));
    };
    expect(at(lst + 0.25)[0]).toBeLessThan(at(lst)[0]);
    expect(at(lst)[0]).toBeLessThan(at(lst - 0.25)[0]);
  });

  it('looking NE (az 45, alt 32): the Plough pointers Merak -> Dubhe aim at Polaris, Alkaid farthest from Dubhe', () => {
    const view = camera(45, 32);
    const merak = view(worldDir(4295));
    const dubhe = view(worldDir(4301));
    const pole = view(azAlt(0, 46.5));
    const polaris = view(worldDir(424));
    const angle = (a: [number, number], b: [number, number]): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
    let miss = (angle(merak, dubhe) - angle(dubhe, pole)) / DEG;
    miss = ((miss + 540) % 360) - 180;
    expect(Math.abs(miss)).toBeLessThan(10);
    // Polaris is upper left of Dubhe in this view.
    expect(polaris[0]).toBeLessThan(dubhe[0]);
    expect(polaris[1]).toBeGreaterThan(dubhe[1]);
    const dubheW = worldDir(4301);
    const dipper = [4295, 4554, 4660, 4905, 5054, 5191].map((hr) => ({ hr, d: worldDir(hr).angleTo(dubheW) }));
    dipper.sort((a, b) => b.d - a.d);
    expect(dipper[0].hr).toBe(5191);
  });
});

// The Milky Way map, proved on the shipped file through the shader's own lookup: the shipped webp is decoded
// (ImageMagick; node has no webp decoder), sRGB-decoded to linear light as the GPU does (SRGBColorSpace), and
// addressed exactly as the GPU addresses it: the GLSL milkyWayUv() body (evaluated from MILKY_WAY_GLSL itself) gives
// (u, v); the loader's own texture configuration (configureMilkyWayTexture) gives flipY, hence the image row.
// Directions come from equatorialVector, the catalogue's frame, so "the bulge sits on the catalogue's Sagittarius
// stars" is checked in one frame from end to end. A mirrored or flipped file, a flipY change or a changed GLSL
// lookup each moves the bulge tens of degrees (the controls below show by how much).

interface ChildProcess {
  execFileSync(cmd: string, args: string[], opts: { maxBuffer: number; stdio?: unknown }): Uint8Array;
}
const cp = (await import(/* @vite-ignore */ 'node:child_process' as string)) as ChildProcess;
const MAP_URL = new URL('../../public/sky/stars/milkyway_4k.webp', import.meta.url);

/** The shipped map as linear-light luminance (map units: decoded value * lRef), top row first, or null without magick. */
function decodeShippedMap(): { lum: Float32Array; w: number; h: number } | null {
  const { width: w, height: h } = MILKY_WAY_MAP;
  let rgb: Uint8Array;
  try {
    rgb = cp.execFileSync('magick', [MAP_URL.pathname, '-depth', '8', 'rgb:-'], { maxBuffer: w * h * 3 + 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  expect(rgb.length, 'decoded size matches MILKY_WAY_MAP').toBe(w * h * 3);
  const lin = new Float32Array(256);
  for (let k = 0; k < 256; k++) lin[k] = new THREE.Color().setRGB(k / 255, 0, 0, THREE.SRGBColorSpace).r;
  const lum = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    lum[p] = (0.2126 * lin[rgb[3 * p]] + 0.7152 * lin[rgb[3 * p + 1]] + 0.0722 * lin[rgb[3 * p + 2]]) * MILKY_WAY_MAP.lRef;
  }
  return { lum, w, h };
}
const shipped = decodeShippedMap();
if (!shipped) console.warn('handedness.test: ImageMagick (magick) not found; the shipped Milky Way map proof is SKIPPED.');

type Vec = { x: number; y: number; z: number };
/** The shader's milkyWayUv(), evaluated from the GLSL source (a single return expression, valid JS with these shims). */
const glslUv = ((): ((e: Vec) => [number, number]) => {
  const m = /vec2 milkyWayUv\(vec3 e\)\s*\{([^}]*)\}/.exec(MILKY_WAY_GLSL);
  expect(m, 'milkyWayUv in MILKY_WAY_GLSL').not.toBeNull();
  const body = m![1].trim();
  expect(body.startsWith('return ')).toBe(true);
  const fn = new Function('vec2', 'fract', 'atan', 'asin', 'clamp', 'e', body) as (...a: unknown[]) => [number, number];
  const vec2 = (a: number, b: number): [number, number] => [a, b];
  const fract = (x: number): number => x - Math.floor(x);
  const atan = (y: number, x: number): number => Math.atan2(y, x);
  const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
  return (e) => fn(vec2, fract, atan, Math.asin, clamp, e);
})();

/** Image row from the top of texture coordinate v, from the loader's own texture configuration. */
const rowFromTop = ((): ((v: number) => number) => {
  const tex = new THREE.Texture();
  configureMilkyWayTexture(tex);
  return tex.flipY ? (v) => 1 - v : (v) => v;
})();

type Lookup = (e: Vec) => number;
/** Map luminance in a direction, sampled as the GPU does (nearest texel; u wraps, v clamps); `mod` injects controls. */
function lookup(map: { lum: Float32Array; w: number; h: number }, mod: (uv: [number, number]) => [number, number] = (uv) => uv): Lookup {
  return (e) => {
    const [u, v] = mod(glslUv(e));
    const col = ((Math.floor(u * map.w) % map.w) + map.w) % map.w;
    const row = Math.min(map.h - 1, Math.max(0, Math.floor(rowFromTop(v) * map.h)));
    return map.lum[row * map.w + col];
  };
}

/** Even sphere sampling (Fibonacci), J2000 unit vectors in the catalogue's frame. */
const N_DIRS = 120000;
const dirs = new Float64Array(N_DIRS * 3);
for (let k = 0; k < N_DIRS; k++) {
  const z = 1 - (2 * k + 1) / N_DIRS;
  const ra = k * Math.PI * (3 - Math.sqrt(5));
  equatorialVector(ra, Math.asin(z), dirs as unknown as number[], 3 * k);
}
const dirAt = (k: number): Vec => ({ x: dirs[3 * k], y: dirs[3 * k + 1], z: dirs[3 * k + 2] });

/** Brightest direction of the map smoothed with a 2 deg (sigma) Gaussian, and its smoothed value (map units). */
function smoothedPeak(look: Lookup): { dir: THREE.Vector3; value: number } {
  const raw = new Float64Array(N_DIRS);
  for (let k = 0; k < N_DIRS; k++) raw[k] = look(dirAt(k));
  const order = Array.from({ length: N_DIRS }, (_, k) => k).sort((a, b) => raw[b] - raw[a]);
  const sigma = 2 * DEG;
  const cosCut = Math.cos(3 * sigma);
  let best = { k: -1, value: -1 };
  for (const c of order.slice(0, 300)) {
    let sw = 0;
    let s = 0;
    for (let k = 0; k < N_DIRS; k++) {
      const cosA = dirs[3 * c] * dirs[3 * k] + dirs[3 * c + 1] * dirs[3 * k + 1] + dirs[3 * c + 2] * dirs[3 * k + 2];
      if (cosA < cosCut) continue;
      const a = Math.acos(Math.min(1, cosA));
      const w = Math.exp((-0.5 * a * a) / (sigma * sigma));
      sw += w;
      s += w * raw[k];
    }
    if (s / sw > best.value) best = { k: c, value: s / sw };
  }
  const d = dirAt(best.k);
  return { dir: new THREE.Vector3(d.x, d.y, d.z), value: best.value };
}

/** Mean luminance at |b| < 3 deg over mean at |b| > 30 deg (b from EQ_TO_GAL), equal-area samples. */
function bandContrast(look: Lookup): number {
  let inBand = 0;
  let nIn = 0;
  let off = 0;
  let nOff = 0;
  for (let k = 0; k < N_DIRS; k++) {
    const d = dirAt(k);
    const sinB = EQ_TO_GAL[2][0] * d.x + EQ_TO_GAL[2][1] * d.y + EQ_TO_GAL[2][2] * d.z;
    const b = Math.abs(Math.asin(sinB)) / DEG;
    if (b < 3) {
      inBand += look(d);
      nIn++;
    } else if (b > 30) {
      off += look(d);
      nOff++;
    }
  }
  return inBand / nIn / (off / nOff);
}

const starVec = (hr: number): THREE.Vector3 => {
  const i = starIndexByHR(cat, hr);
  expect(i, `HR ${hr}`).toBeGreaterThanOrEqual(0);
  return new THREE.Vector3(...(equatorialVector(cat.ra[i], cat.dec[i]) as [number, number, number]));
};
const sgrA = new THREE.Vector3(...(equatorialVector(266.417 * DEG, -29.008 * DEG) as [number, number, number]));

describe('Milky Way map handedness (the shipped file, through the shader lookup)', () => {
  it('the loader samples the map as the proof assumes: flipY, sRGB, RA wraps, Dec clamps', () => {
    const tex = new THREE.Texture();
    tex.flipY = false;
    configureMilkyWayTexture(tex);
    expect(tex.flipY).toBe(true);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it('the GLSL lookup agrees with the TS mirror (milkyWayUv) all over the sphere', () => {
    for (let k = 0; k < N_DIRS; k += 97) {
      const d = dirAt(k);
      const [u, v] = glslUv(d);
      const [tu, tv] = milkyWayUv(Math.atan2(d.y, d.x), Math.asin(d.z));
      const du = Math.abs(u - tu);
      expect(Math.min(du, 1 - du)).toBeLessThan(1e-6);
      expect(v).toBeCloseTo(tv, 6);
    }
    // RA increases to the left (u decreasing), Dec up (v increasing).
    const a = glslUv({ x: 1, y: 0, z: 0 });
    const b = glslUv({ x: Math.cos(0.1), y: Math.sin(0.1), z: 0 });
    expect(b[0]).toBeLessThan(a[0]);
    expect(glslUv({ x: 0.8, y: 0, z: 0.6 })[1]).toBeGreaterThan(0.5);
  });

  it.skipIf(!shipped)('the bulge sits on the catalogue’s Sagittarius stars; mirrored or flipped lookups miss it', () => {
    const map = shipped!;
    const peak = smoothedPeak(lookup(map));
    // The 2 deg-smoothed peak is the Large Sagittarius Star Cloud, ~4.8 deg from Sgr A* (whose own light is behind
    // the Great Rift's dust), just north of the Teapot's spout (Alnasl, gamma2 Sgr, HR 6746).
    expect(peak.dir.angleTo(sgrA) / DEG).toBeLessThan(6);
    expect(peak.dir.angleTo(starVec(6746)) / DEG).toBeLessThan(8);
    // Closer to the Teapot (Alnasl, Kaus Media/Australis/Borealis, Nunki, Ascella) than to any other bright star's
    // constellation: the Teapot's centroid within 15 deg.
    const teapot = [6746, 6859, 6879, 6913, 7121, 7194].reduce((s, hr) => s.add(starVec(hr)), new THREE.Vector3()).normalize();
    expect(peak.dir.angleTo(teapot) / DEG).toBeLessThan(15);
    // The recorded constants describe this file (q75 lossy and a different sampler: 10 %).
    expect(peak.value / MILKY_WAY_MAP.peak2deg).toBeGreaterThan(0.9);
    expect(peak.value / MILKY_WAY_MAP.peak2deg).toBeLessThan(1.1);
    // Controls: the same statistic through a mirrored (RA increasing to the right) or a flipped (flipY wrong) lookup.
    const mirrored = smoothedPeak(lookup(map, ([u, v]) => [1 - u, v]));
    const flipped = smoothedPeak(lookup(map, ([u, v]) => [u, 1 - v]));
    expect(mirrored.dir.angleTo(sgrA) / DEG).toBeGreaterThan(90);
    expect(flipped.dir.angleTo(sgrA) / DEG).toBeGreaterThan(40);
  });

  it.skipIf(!shipped)('the band runs along EQ_TO_GAL’s galactic plane; a mirrored lookup loses it', () => {
    const map = shipped!;
    const c = bandContrast(lookup(map));
    expect(c).toBeGreaterThan(5);
    expect(c / MILKY_WAY_MAP.bandContrast).toBeGreaterThan(0.8);
    expect(c / MILKY_WAY_MAP.bandContrast).toBeLessThan(1.25);
    // The mirrored band crosses the true plane twice (~3.7), a third of the real contrast.
    expect(bandContrast(lookup(map, ([u, v]) => [1 - u, v]))).toBeLessThan(c / 2);
    // Deneb sits in the Cygnus band (~3x the sky's mean on the shipped map), Regulus well off it.
    const look = lookup(map);
    const at = (hr: number): number => {
      const s = starVec(hr);
      return look({ x: s.x, y: s.y, z: s.z });
    };
    expect(at(7924) / MILKY_WAY_MAP.mean).toBeGreaterThan(2);
    expect(at(3982) / MILKY_WAY_MAP.mean).toBeLessThan(1);
  });

  it('the galactic centre direction is EQ_TO_GAL’s first row', () => {
    expect(new THREE.Vector3(...EQ_TO_GAL[0]).angleTo(sgrA) / DEG).toBeLessThan(0.1);
  });

  it('the shader holds the same rotation as the TS matrix (column by column)', () => {
    const cols = [0, 1, 2].map((c) => [0, 1, 2].map((r) => EQ_TO_GAL[r][c]));
    const glsl = MILKY_WAY_GLSL.replace(/\s+/g, ' ');
    const m = /mat3\(([^)]*)\)/.exec(glsl);
    expect(m).not.toBeNull();
    const nums = m![1].split(',').map(Number);
    expect(nums).toHaveLength(9);
    cols.flat().forEach((v, i) => expect(nums[i]).toBeCloseTo(v, 9));
  });
});
