// Every material of the aircraft, created once and shared. Paint is a clear-coated MeshPhysicalMaterial;
// all materials pick up reflections from scene.environment (owned by the sky module).

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { AirframeVisualDef } from './airframe/types';
import type { FuselageTextures } from './livery';
import { FIN_HEIGHT, makeFinPlanform, sectionPoint } from './liftingSurface';

const srgb = (c: readonly number[]): THREE.Color => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

/** Rivet rows and skin laps for wings and tail: u = metres of span (repeats every metre), v = contour. */
function surfaceDetailTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 2048;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // R = height (128 flush), G = roughness.
  g.fillStyle = 'rgb(128, 88, 0)';
  g.fillRect(0, 0, W, H);
  // Rib rivet rows every 1/3 m, pitch ~30 mm along the chord (v spans ~2 chords of ~1.5 m).
  const pitchV = (0.03 / 3.0) * H;
  for (const u of [0.02, 0.353, 0.687]) {
    const x = u * W;
    g.fillStyle = 'rgb(160, 96, 0)';
    for (let y = pitchV / 2; y < H; y += pitchV) {
      g.beginPath();
      g.ellipse(x, y, 2.4, 2.2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Spar rivet rows and skin laps at fixed chord fractions on both surfaces.
  for (const xc of [0.14, 0.27, 0.66]) {
    for (const v of [0.5 - 0.5 * xc, 0.5 + 0.5 * xc]) {
      const y = v * H;
      g.fillStyle = 'rgb(160, 96, 0)';
      for (let x = 6; x < W; x += 30) {
        g.beginPath();
        g.ellipse(x, y, 2.4, 2.2, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Skin lap joint just aft of the main spar (a slight step rather than a groove).
  for (const v of [0.5 + 0.5 * 0.3, 0.5 - 0.5 * 0.3]) {
    g.fillStyle = 'rgb(112, 110, 0)';
    g.fillRect(0, v * H - 1.2, W, 2.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/** Fin texture u covers fin height h from FIN_UV_H0 (below the base: the rudder's lower extension). */
export const FIN_UV_H0 = -0.35;
/** Of the Cessna 172S fin; another airframe's range is its own fin height + 0.45. */
export const FIN_UV_RANGE = FIN_HEIGHT + 0.45;

/**
 * Fin and rudder paint: the scheme's diagonal band with its accent line and a band-coloured fin cap, in side
 * projection (the Cessna 172S: navy, red).
 */
function finColourTexture(def: Pick<AirframeVisualDef, 'livery' | 'tail'>, finHeight: number, uvRange: number): THREE.DataTexture {
  const W = 512;
  const H = 1024;
  const data = new Uint8Array(W * H * 4);
  const p = { x: 0, y: 0, z: 0 };
  const finPlanform = makeFinPlanform(def.tail);
  const fin = def.livery.fin;
  const navy = def.livery.palette.band;
  const red = def.livery.palette.accent;
  const white = def.livery.palette.base;
  const aa = 0.004;
  const band = (d: number, half: number): number => {
    const t = Math.min(1, Math.max(0, (half + aa - Math.abs(d)) / (2 * aa)));
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const xc = Math.abs(v - 0.5) * 2;
    for (let i = 0; i < W; i++) {
      const h = FIN_UV_H0 + ((i + 0.5) / W) * uvRange;
      sectionPoint(finPlanform, h, xc, 0, p);
      // Bands rise toward the tail, continuing the fuselage stripe's sweep.
      const w = p.z - (fin.bandZ0 + (p.x - fin.bandX0) * fin.slope);
      let col: readonly number[] = white;
      const k1 = band(w, 0.085);
      const k2 = band(w + 0.085 + 0.03, 0.011);
      const k3 = h > finHeight - fin.cap ? 1 : 0;
      const mixc = (a: readonly number[], b: readonly number[], k: number): number[] => a.map((x, n) => x + (b[n] - x) * k);
      col = mixc(col, navy, Math.max(k1, k3));
      col = mixc(col, red, k2 * (1 - k3));
      const o = (j * W + i) * 4;
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Tyre tread: chevron blocks across the crown so wheel rotation is visible. */
function treadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = 'rgb(40,40,40)';
  // Three circumferential grooves on the crown (v ~ 0.35..0.65 of the profile) and sidewall ribs.
  for (const v of [0.4, 0.5, 0.6]) g.fillRect(0, v * 64 - 1.5, 1024, 3);
  for (let x = 0; x < 1024; x += 32) {
    g.fillRect(x, 0, 3, 14);
    g.fillRect(x + 16, 50, 3, 14);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Grime on the glazing, tiled at ~0.5 m: the optical depth of a thin, uneven dust film - soft smudges and
 * wipe marks plus a few faint dried water spots. Dust grains are far below a pixel at cockpit distances, so
 * the film is modelled as a smooth density, never as resolved specks. It scatters sunlight mainly forward
 * (see AircraftMaterials.setSun), so it shows as a glow when looking toward the sun and is all but invisible
 * with the sun behind you.
 */
function glassDirtTexture(): THREE.DataTexture {
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  let h = 0x2545f491;
  const rnd = (): number => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const v = new Float32Array(N * N);
  // Smudges: a few soft blobs (wiped streaks), wrapped so the tile repeats seamlessly.
  const blobs = Array.from({ length: 14 }, () => ({ x: rnd() * N, y: rnd() * N, r: 20 + rnd() * 60, a: 0.02 + rnd() * 0.05 }));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let s = 0.012;
      for (const b of blobs) {
        const dx = Math.min(Math.abs(x - b.x), N - Math.abs(x - b.x));
        const dy = Math.min(Math.abs(y - b.y), N - Math.abs(y - b.y));
        s += b.a * Math.exp(-(dx * dx + dy * dy) / (b.r * b.r));
      }
      v[y * N + x] = s;
    }
  const splat = (cx: number, cy: number, r: number, a: number, ring: boolean): void => {
    const R = Math.ceil(r + 1);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1.2) continue;
        // Water spots dry with a darker rim; dust is a soft dot.
        const k = ring ? Math.exp(-((d - 0.9) ** 2) / 0.02) * 0.7 + 0.3 * Math.max(0, 1 - d) : Math.max(0, 1 - d * d);
        const i = (((cy + dy) % N) + N) % N;
        const j = (((cx + dx) % N) + N) % N;
        v[i * N + j] += a * k;
      }
  };
  // Wipe marks: shallow arcs from a cleaning cloth, a little denser than the film around them.
  for (let n = 0; n < 5; n++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const r = 90 + rnd() * 120;
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < 90; k++) {
      const a = a0 + (k / 90) * 1.4;
      splat(Math.floor(cx + r * Math.cos(a)), Math.floor(cy + r * Math.sin(a)), 7, 0.004, false);
    }
  }
  for (let n = 0; n < 12; n++) splat(Math.floor(rnd() * N), Math.floor(rnd() * N), 4 + rnd() * 5, 0.012 + rnd() * 0.02, true);
  for (let i = 0; i < N * N; i++) {
    const c = Math.min(255, Math.round(v[i] * 255));
    data.set([c, c, c, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise on an n x n texel grid with `cells` lattice cells per side (smoothstep interpolation). */
function tileNoise(n: number, cells: number, seed: number): Float32Array {
  let h = seed >>> 0 || 1;
  const rnd = (): number => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * cells;
    const y0 = Math.floor(fy);
    let ty = fy - y0;
    ty = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % cells) * cells;
    const r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells;
      const x0 = Math.floor(fx);
      let tx = fx - x0;
      tx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cells;
      const c1 = (x0 + 1) % cells;
      const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
      const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
      out[y * n + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/**
 * Tiling surface detail for the cabin trim, one RGBA texel per sample: R = height (bump), G = roughness,
 * B = albedo factor (x 1/255 of 200, so 200 = unchanged). The cabin geometry carries texture coordinates in
 * metres (Cockpit: box-projected), so `tile` (m) sets the texture's repeat.
 */
function trimDetailTexture(kind: 'leather' | 'carpet' | 'plastic', tile: number): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const f = (cells: number, seed: number): Float32Array => tileNoise(N, cells, seed);
  if (kind === 'leather') {
    // Grain: ridged cells (creases between rounded pebbles) over soft wrinkles; the creases are a little
    // rougher and darker.
    const cellsA = f(64, 11);
    const cellsB = f(96, 12);
    const wrinkle = f(8, 13);
    const wrinkle2 = f(20, 14);
    for (let i = 0; i < N * N; i++) {
      const ridge = 1 - Math.abs(cellsA[i] - 0.5) * 2;
      const ridge2 = 1 - Math.abs(cellsB[i] - 0.5) * 2;
      const crease = Math.pow(Math.max(ridge, ridge2), 6);
      const hgt = 0.55 + 0.25 * (wrinkle[i] - 0.5) + 0.15 * (wrinkle2[i] - 0.5) - 0.25 * crease;
      data[i * 4] = Math.max(0, Math.min(255, hgt * 255));
      data[i * 4 + 1] = (0.58 + 0.18 * crease + 0.08 * (wrinkle2[i] - 0.5)) * 255;
      data[i * 4 + 2] = 200 * (1 - 0.1 * crease + 0.06 * (wrinkle[i] - 0.5));
      data[i * 4 + 3] = 255;
    }
  } else if (kind === 'carpet') {
    // Cut pile: tufts a few millimetres across, tips lighter than the shadowed gaps, with a soft mottling
    // where the pile lies in different directions.
    const tuft = f(96, 21);
    const tuft2 = f(128, 22);
    const mottle = f(6, 23);
    const mottle2 = f(14, 24);
    for (let i = 0; i < N * N; i++) {
      const t = 0.6 * tuft[i] + 0.4 * tuft2[i];
      const m = 0.6 * mottle[i] + 0.4 * mottle2[i];
      const v = 0.7 + 0.45 * (t - 0.5) + 0.3 * (m - 0.5);
      // Height and albedo together: the pile tips catch the light.
      const a = Math.max(0, Math.min(255, v * 200));
      data[i * 4] = a;
      data[i * 4 + 1] = a;
      data[i * 4 + 2] = a;
      data[i * 4 + 3] = 255;
    }
  } else {
    // Moulded plastic: a fine pebble grain (visible mostly as broken-up highlights).
    const g1 = f(48, 31);
    const g2 = f(96, 32);
    for (let i = 0; i < N * N; i++) {
      const ridge = 1 - Math.abs(g1[i] - 0.5) * 2;
      const hgt = 0.5 + 0.3 * (g2[i] - 0.5) - 0.3 * Math.pow(ridge, 4);
      data[i * 4] = Math.max(0, Math.min(255, hgt * 255));
      data[i * 4 + 1] = (0.85 + 0.15 * (g2[i] - 0.5)) * 255;
      data[i * 4 + 2] = 200;
      data[i * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export class AircraftMaterials {
  readonly fuselagePaint: THREE.MeshPhysicalMaterial;
  readonly wingPaint: THREE.MeshPhysicalMaterial;
  readonly finPaint: THREE.MeshPhysicalMaterial;
  readonly plainPaint: THREE.MeshPhysicalMaterial;
  readonly navyPaint: THREE.MeshPhysicalMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly lining: THREE.MeshStandardMaterial;
  readonly tyre: THREE.MeshStandardMaterial;
  readonly aluminium: THREE.MeshStandardMaterial;
  readonly chrome: THREE.MeshStandardMaterial;
  readonly darkMetal: THREE.MeshStandardMaterial;
  readonly black: THREE.MeshStandardMaterial;
  readonly propFront: THREE.MeshStandardMaterial;
  readonly propBack: THREE.MeshStandardMaterial;
  readonly exhaust: THREE.MeshStandardMaterial;
  // Cabin
  readonly panelPlastic: THREE.MeshStandardMaterial;
  readonly glareshield: THREE.MeshStandardMaterial;
  readonly seatFabric: THREE.MeshStandardMaterial;
  readonly carpet: THREE.MeshStandardMaterial;
  readonly trimPlastic: THREE.MeshStandardMaterial;
  readonly knobBlack: THREE.MeshStandardMaterial;
  readonly knobRed: THREE.MeshStandardMaterial;
  readonly knobWhite: THREE.MeshStandardMaterial;
  /** Materials only used inside the cabin (their meshes get the per-vertex cabin occlusion, cabinLight.ts). */
  readonly cabin: THREE.MeshStandardMaterial[];
  private readonly textures: THREE.Texture[] = [];

  /** @param def the airframe whose paint scheme and fin these are (default: the Cessna 172S) */
  constructor(fus: FuselageTextures, def: Pick<AirframeVisualDef, 'livery' | 'tail'> = C172S_VISUAL) {
    const finHeight = def.tail.v.base.z - def.tail.v.tip.z;
    const finUvRange = finHeight + 0.45;
    // Rivet rows and skin laps are a metal airframe's; composite wings and fins are smooth.
    const detail = def.livery.construction === 'composite' ? null : surfaceDetailTexture();
    const finColour = finColourTexture(def, finHeight, finUvRange);
    const tread = treadTexture();
    this.textures.push(fus.colour, fus.detail, fus.glass, fus.lining);
    if (detail) this.textures.push(detail);
    this.textures.push(finColour, tread);

    const paint = (name: string, p: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial => {
      const m = new THREE.MeshPhysicalMaterial({
        roughness: 1,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        bumpScale: 1.2,
        ...p,
      });
      m.name = name;
      return m;
    };
    const white = srgb(def.livery.palette.base);

    this.fuselagePaint = paint('fuselagePaint', {
      map: fus.colour,
      alphaTest: 0.5,
      bumpMap: fus.detail,
      roughnessMap: fus.detail,
      bumpScale: 1.6,
    });
    // The skin must shadow the cabin through its window openings only; its back faces also cast so a
    // low sun does not leak through the far side of the cabin.
    this.fuselagePaint.shadowSide = THREE.DoubleSide;

    this.wingPaint = paint('wingPaint', detail ? { color: white, bumpMap: detail, roughnessMap: detail, clearcoat: 0.8, clearcoatRoughness: 0.12 } : { color: white, roughness: 0.3 });
    this.finPaint = paint('finPaint', detail ? { map: finColour, bumpMap: detail, roughnessMap: detail } : { map: finColour, roughness: 0.3 });
    // The fin texture spans finUvRange metres of u; the detail texture repeats every metre.
    finColour.repeat.set(1 / finUvRange, 1);
    finColour.offset.set(-FIN_UV_H0 / finUvRange, 0);
    this.plainPaint = paint('plainPaint', { color: white, roughness: 0.3 });
    this.navyPaint = paint('navyPaint', { color: srgb(def.livery.palette.band), roughness: 0.3 });

    // Glazing: additive reflection over attenuated background (src + dst * (1 - a)) so the Fresnel
    // reflection keeps its full strength while the glass only dims what is behind it by `opacity`.
    // The glass UVs span the cabin (u ~3.1 m along, v ~3.6 m around): repeat the dirt every ~0.5 m.
    const dirt = glassDirtTexture();
    dirt.repeat.set(6, 7);
    this.textures.push(dirt);
    this.glass = new THREE.MeshPhysicalMaterial({
      name: 'glass',
      // Diffuse = dirt only (clean glass has none): the film's back-scatter albedo is tiny (~0.01); its
      // forward scatter toward the eye when looking at the sun is added in the shader below.
      color: new THREE.Color(0.25, 0.24, 0.22),
      map: dirt,
      roughness: 0.02,
      metalness: 0,
      ior: 1.5,
      specularIntensity: 1,
      transparent: true,
      opacity: 0.14,
      alphaMap: fus.glass,
      alphaTest: 0.03,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      envMapIntensity: 1.3,
    });
    // One pass for both faces: the glazing is a thin shell seen either from outside or from the cabin, never
    // through two of its own layers in a way that needs back-to-front ordering. Without this three.js
    // renders transparent DoubleSide materials as a BackSide then a FrontSide pass, flipping `side` and
    // re-keying the program twice every frame.
    this.glass.forceSinglePass = true;

    this.patchGlassScatter(this.glass);

    this.lining = new THREE.MeshStandardMaterial({
      name: 'lining',
      color: srgb([168, 168, 168]),
      roughness: 0.92,
      alphaMap: fus.lining,
      // Mouldings (window surrounds, the door outline and the headliner seams) baked into the R channel.
      bumpMap: fus.lining,
      bumpScale: 6,
      alphaTest: 0.5,
      // Smooth cut-out edges when the target is multisampled (plain alpha test otherwise).
      alphaToCoverage: true,
    });

    // In the mostly diffuse cabin light a bump alone hardly shows: the relief's grooves (seams, the door's
    // parting line) are also darkened by their cavity and its raised rims lightened a little. Height 0 is the
    // placeholder before the bake arrives: left unchanged.
    this.lining.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
	#ifdef USE_BUMPMAP
	{
		float lh = texture2D( bumpMap, vBumpMapUv ).x;
		if ( lh > 0.01 ) diffuseColor.rgb *= 0.55 + 0.45 * smoothstep( 0.2, 0.5, lh ) + 0.12 * smoothstep( 0.5, 0.85, lh );
	}
	#endif`,
      );
    };
    this.lining.customProgramCacheKey = () => 'liningCavity';

    tread.repeat.set(3, 1);
    this.tyre = new THREE.MeshStandardMaterial({ name: 'tyre', color: srgb([22, 22, 23]), roughness: 0.88, bumpMap: tread, bumpScale: 2.5 });
    this.aluminium = new THREE.MeshStandardMaterial({ name: 'aluminium', color: srgb([200, 203, 207]), metalness: 1, roughness: 0.32 });
    this.chrome = new THREE.MeshStandardMaterial({ name: 'chrome', color: srgb([235, 236, 238]), metalness: 1, roughness: 0.08 });
    this.darkMetal = new THREE.MeshStandardMaterial({ name: 'darkMetal', color: srgb([60, 62, 66]), metalness: 0.8, roughness: 0.45 });
    this.black = new THREE.MeshStandardMaterial({ name: 'black', color: srgb([10, 10, 11]), roughness: 0.7 });
    this.propFront = new THREE.MeshStandardMaterial({ name: 'propFront', vertexColors: true, metalness: 0.35, roughness: 0.4 });
    this.propBack = new THREE.MeshStandardMaterial({ name: 'propBack', vertexColors: true, roughness: 0.85 });
    this.exhaust = new THREE.MeshStandardMaterial({ name: 'exhaust', color: srgb([70, 58, 48]), metalness: 0.9, roughness: 0.6 });
    for (const m of [this.propFront, this.propBack]) {
      m.transparent = true;
      m.depthWrite = true;
    }

    // The cabin sees only part of the outside through its windows: cabinLight.ts computes a per-vertex
    // occlusion for everything inside that dims the indirect (environment) light, while direct sun through
    // the windows (shadowed by the skin) stays at full strength.
    const cabin = (name: string, c: readonly number[], roughness: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ name, color: srgb(c), roughness, ...extra });
    // Surface detail, in metres of the box-projected cabin texture coordinates (Cockpit.projectTrimUv).
    const leather = trimDetailTexture('leather', 0.09);
    const carpetTex = trimDetailTexture('carpet', 0.16);
    const plastic = trimDetailTexture('plastic', 0.05);
    this.textures.push(leather, carpetTex, plastic);
    this.panelPlastic = cabin('panelPlastic', [46, 47, 50], 0.75, { bumpMap: plastic, bumpScale: 0.6 });
    // Anti-glare covering: matte and with a low specular reflectance, so it neither reflects in the
    // windscreen nor shows the sky's colour at the grazing angles the pilot sees it at.
    this.glareshield = new THREE.MeshPhysicalMaterial({ name: 'glareshield', color: srgb([18, 18, 19]), roughness: 0.95, specularIntensity: 0.3 });
    // Leather seat facings: grain in the bump, creases a little rougher.
    this.seatFabric = cabin('seatFabric', [84, 80, 76], 1, { bumpMap: leather, bumpScale: 1.2, roughnessMap: leather });
    // Dark charcoal cut-pile carpet: the pile tips carry the albedo and height variation.
    this.carpet = cabin('carpet', [44, 44, 46], 1, { map: carpetTex, bumpMap: carpetTex, bumpScale: 1.5 });
    this.trimPlastic = cabin('trimPlastic', [168, 164, 156], 0.7, { bumpMap: plastic, bumpScale: 0.6, roughnessMap: plastic });
    this.knobBlack = cabin('knobBlack', [15, 15, 16], 0.4);
    this.knobRed = cabin('knobRed', [170, 20, 18], 0.4);
    this.knobWhite = cabin('knobWhite', [220, 220, 215], 0.45);
    this.cabin = [
      this.panelPlastic,
      this.glareshield,
      this.seatFabric,
      this.carpet,
      this.trimPlastic,
      this.knobBlack,
      this.knobRed,
      this.knobWhite,
      this.lining,
    ];
  }

  /** Sun for the glazing's dust forward scatter: unit direction toward the sun (world) and its colour x intensity. */
  readonly glassSun = { dir: { value: new THREE.Vector3(0, 1, 0) }, color: { value: new THREE.Color(0, 0, 0) } };

  /** Update the sun the glazing dust scatters (ctx.sky.sunDir / sunColor), once per frame. */
  setSun(dir: THREE.Vector3, color: THREE.Color): void {
    this.glassSun.dir.value.copy(dir);
    this.glassSun.color.value.copy(color);
  }

  /**
   * Dust film forward scatter: radiance E_sun * tau * p_HG(theta) / mu toward an eye looking through the
   * glass at angle theta from the sun, with tau the film's optical depth (the dirt map), a Henyey-Greenstein
   * phase function with g = 0.75 (dust, sizes ~ the wavelength) and mu the cosine of the view incidence
   * (longer path through the film at grazing angles). The film is 0.4 x the dirt map (tau ~ 0.005-0.03): looking straight at the sun a 2 % film gives about the
   * sky's radiance; 30 degrees away a tenth of that; with the sun behind, nothing.
   */
  private patchGlassScatter(m: THREE.MeshPhysicalMaterial): void {
    const sun = this.glassSun;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.glassSunDir = sun.dir;
      shader.uniforms.glassSunColor = sun.color;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 glassSunDir;\nuniform vec3 glassSunColor;')
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `
	{
		vec3 eyeRay = normalize( -vViewPosition );
		vec3 sunV = normalize( ( viewMatrix * vec4( glassSunDir, 0.0 ) ).xyz );
		float cosT = dot( eyeRay, sunV );
		const float g = 0.75;
		float phase = ( 1.0 - g * g ) / ( 4.0 * PI * pow( 1.0 + g * g - 2.0 * g * cosT, 1.5 ) );
		float mu = max( abs( dot( normal, eyeRay ) ), 0.2 );
		#ifdef USE_MAP
			float tau = 0.4 * texture2D( map, vMapUv ).r;
		#else
			float tau = 0.005;
		#endif
		outgoingLight += glassSunColor * tau * phase / mu;
	}
	#include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'glassScatter';
  }

  dispose(): void {
    for (const t of this.textures) t.dispose();
    for (const v of Object.values(this)) if (v instanceof THREE.Material) v.dispose();
  }
}
