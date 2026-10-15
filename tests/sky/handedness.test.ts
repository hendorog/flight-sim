// Handedness proofs of the real sky: an equirectangular map or a catalogue seen from inside the sphere is easily
// mirrored. Catalogue stars are placed exactly as the Points layer places them (world = equatorialToWorld * e) and
// projected into a camera at the airfield; the Milky Way map's lookup (milkyWayUv, the TS mirror of the shader) is
// checked against where the map itself is brightest.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRPORT } from '../../src/core/world';
import { Celestial } from '../../src/render/sky/celestial';
import { EQ_TO_GAL, MILKY_WAY_GLSL, MILKY_WAY_MAP, milkyWayUv } from '../../src/render/sky/glsl/milkyWay';
import { decodeStarCatalog, equatorialVector, starIndexByHR } from '../../src/render/sky/starCatalog';

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

describe('Milky Way map handedness', () => {
  /** J2000 unit vector of the direction whose map lookup is (u, v): the inverse of milkyWayUv. */
  const fromUv = (u: number, v: number): THREE.Vector3 => {
    const ra = 2 * Math.PI * (0.5 - u);
    const dec = Math.PI * (v - 0.5);
    return new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
  };
  const sgrA = { ra: 266.417 * DEG, dec: -29.008 * DEG };
  const sgrDir = new THREE.Vector3(...(equatorialVector(sgrA.ra, sgrA.dec) as [number, number, number]));
  // The map's own brightest region (2 deg smoothing), as the build script found it in image rows/columns. flipY:
  // texture v = 1 - row from the top.
  const peak = { u: MILKY_WAY_MAP.peakColumn, v: 1 - MILKY_WAY_MAP.peakRowFromTop };

  it('maps Sgr A* next to the map’s bright bulge', () => {
    const [u, v] = milkyWayUv(sgrA.ra, sgrA.dec);
    expect(fromUv(u, v).angleTo(sgrDir)).toBeLessThan(1e-6);
    // The 2 deg-smoothed peak is the Large Sagittarius Star Cloud, ~4.8 deg from Sgr A* (whose own light is behind
    // the Great Rift's dust), so 6 deg rather than 3: the mirrored or flipped lookups below miss by far more.
    expect(fromUv(peak.u, peak.v).angleTo(sgrDir) / DEG).toBeLessThan(6);
    // A mirrored map (RA increasing to the right) would put the core near RA 90 deg, a flipped one at Dec +29.
    expect(fromUv(1 - peak.u, peak.v).angleTo(sgrDir) / DEG).toBeGreaterThan(90);
    expect(fromUv(peak.u, 1 - peak.v).angleTo(sgrDir) / DEG).toBeGreaterThan(40);
  });

  it('the galactic plane of EQ_TO_GAL runs along the map’s band', () => {
    const ngp = new THREE.Vector3(...EQ_TO_GAL[2]);
    const band = fromUv(0.5 - MILKY_WAY_MAP.bandPoleRaDeg / 360, 0.5 + MILKY_WAY_MAP.bandPoleDecDeg / 180);
    expect(band.angleTo(ngp) / DEG).toBeLessThan(3);
    expect(MILKY_WAY_MAP.bandContrast).toBeGreaterThan(5);
    // The galactic centre direction is EQ_TO_GAL's first row.
    expect(new THREE.Vector3(...EQ_TO_GAL[0]).angleTo(sgrDir) / DEG).toBeLessThan(0.1);
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
