// Procedural textures for the airport, generated once on the CPU at start-up (about 0.45 s in total).
//
// Pavement textures use a packed RGBA8 layout read by the pavement shader:
//   R = albedo (linear), G = roughness, B/A = surface normal x/y (0.5 + 0.5 * n), z reconstructed.
// Building textures are ordinary three.js maps (normal maps are tangent space, OpenGL convention).
// All textures tile seamlessly, are mipmapped and use the renderer's maximum anisotropy.

import * as THREE from 'three';
import { periodicFbm, periodicNoise, rng } from './noise';

function finish(tex: THREE.DataTexture, anisotropy: number, srgb = false): THREE.DataTexture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const to8 = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));

/** Pack albedo / roughness / height fields into the pavement RGBA layout. `texel` is the texel size in metres. */
function packSurface(n: number, albedo: Float32Array, rough: Float32Array, height: Float32Array, texel: number): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n, yp = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const xm = (x - 1 + n) % n, xp = (x + 1) % n;
      const dx = (height[y * n + xp] - height[y * n + xm]) / (2 * texel);
      const dy = (height[yp + x] - height[ym + x]) / (2 * texel);
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      out[i * 4] = to8(albedo[i]);
      out[i * 4 + 1] = to8(rough[i]);
      out[i * 4 + 2] = to8(0.5 - 0.5 * dx * inv);
      out[i * 4 + 3] = to8(0.5 - 0.5 * dy * inv);
    }
  }
  return out;
}

/**
 * Stamp elliptical stones (aggregate) into height/albedo/roughness fields, wrapping at the edges.
 * Sizes in texels.
 */
function stampAggregate(
  n: number,
  fields: { albedo: Float32Array; rough: Float32Array; height: Float32Array },
  count: number,
  rMin: number,
  rMax: number,
  albedoRange: [number, number],
  heightScale: number,
  seed: number,
): void {
  const r = rng(seed);
  for (let k = 0; k < count; k++) {
    const cx = r() * n, cy = r() * n;
    // log-uniform sizes: many small chips, few large ones
    const rad = rMin * Math.pow(rMax / rMin, r() * r());
    const ecc = 0.6 + 0.4 * r();
    const ang = r() * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const alb = albedoRange[0] + (albedoRange[1] - albedoRange[0]) * r() * (0.6 + 0.4 * r());
    const amp = heightScale * rad * (0.5 + 0.5 * r());
    const rough = 0.55 + 0.3 * r();
    const ext = Math.ceil(rad) + 1;
    for (let oy = -ext; oy <= ext; oy++) {
      for (let ox = -ext; ox <= ext; ox++) {
        const px = Math.floor(cx) + ox, py = Math.floor(cy) + oy;
        const lx = (px + 0.5 - cx) * ca + (py + 0.5 - cy) * sa;
        const ly = (-(px + 0.5 - cx) * sa + (py + 0.5 - cy) * ca) / ecc;
        const d2 = (lx * lx + ly * ly) / (rad * rad);
        if (d2 >= 1) continue;
        const i = (((py % n) + n) % n) * n + (((px % n) + n) % n);
        const h = amp * Math.sqrt(1 - d2);
        if (h > fields.height[i]) {
          fields.height[i] = h;
          // slightly darker rims: bitumen film clinging to the stone edge
          fields.albedo[i] = alb * (0.75 + 0.25 * Math.sqrt(1 - d2));
          fields.rough[i] = rough;
        }
      }
    }
  }
}

/**
 * Aged asphalt concrete: dark bitumen matrix with exposed grey aggregate, mean albedo ~0.11 (weathered asphalt is
 * 0.08-0.15). 1024^2 over `tileMetres`.
 */
export function makeAsphaltTexture(anisotropy: number, tileMetres = 4, n = 1024): THREE.DataTexture {
  const albedo = new Float32Array(n * n);
  const rough = new Float32Array(n * n);
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const s = x / n, t = y / n;
      const fine = periodicFbm(s, t, 128, 3, 7);
      albedo[i] = 0.065 + 0.045 * fine;
      rough[i] = 0.9 + 0.08 * fine;
      height[i] = 0.0006 * periodicNoise(s * 256, t * 256, 256, 11);
    }
  }
  const texel = tileMetres / n;
  const fields = { albedo, rough, height };
  // 3/8" (9.5 mm) nominal aggregate: chips 3..14 mm, ~55% exposed at the surface after years of wear.
  stampAggregate(n, fields, Math.round(0.55 * n * n / 2.5), 0.0015 / texel, 0.007 / texel, [0.12, 0.32], 0.35 * texel, 21);
  // Air voids / ravelled pits: small dark dips.
  const r = rng(33);
  for (let k = 0; k < n * n / 900; k++) {
    const cx = Math.floor(r() * n), cy = Math.floor(r() * n);
    const rad = 1 + Math.floor(r() * 2);
    for (let oy = -rad; oy <= rad; oy++) {
      for (let ox = -rad; ox <= rad; ox++) {
        if (ox * ox + oy * oy > rad * rad) continue;
        const i = ((cy + oy + n) % n) * n + ((cx + ox + n) % n);
        albedo[i] = 0.03;
        height[i] = -0.0015;
        rough[i] = 1;
      }
    }
  }
  return finish(new THREE.DataTexture(packSurface(n, albedo, rough, height, texel), n, n), anisotropy);
}

/** Broom-finished Portland cement concrete (apron). Grooves run along texture x. */
export function makeConcreteTexture(anisotropy: number, tileMetres = 4, n = 1024): THREE.DataTexture {
  const albedo = new Float32Array(n * n);
  const rough = new Float32Array(n * n);
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const s = x / n, t = y / n;
      const blotch = periodicFbm(s, t, 8, 4, 3);
      const fine = periodicFbm(s, t, 256, 2, 5);
      // Broom finish: fine grooves, stretched noise with 1/128 of the variation along the groove.
      const broom = periodicNoise(s * 8, t * 700, 700, 13) * 0.6 + periodicNoise(s * 16, t * 1400, 1400, 17) * 0.4;
      albedo[i] = 0.34 + 0.07 * (blotch - 0.5) + 0.06 * (fine - 0.5) - 0.03 * broom;
      rough[i] = 0.82 + 0.1 * fine;
      height[i] = 0.0005 * broom + 0.0002 * fine;
    }
  }
  const texel = tileMetres / n;
  // Exposed fine aggregate (sand and small gravel) where the cement paste has worn.
  stampAggregate(n, { albedo, rough, height }, Math.round(0.25 * n * n / 3), 0.0012 / texel, 0.005 / texel, [0.18, 0.6], 0.1 * texel, 41);
  const r = rng(43);
  for (let k = 0; k < n * n / 400; k++) {
    const i = Math.floor(r() * n) * n + Math.floor(r() * n);
    albedo[i] *= 0.45;
    height[i] = -0.0008;
  }
  return finish(new THREE.DataTexture(packSurface(n, albedo, rough, height, texel), n, n), anisotropy);
}

/**
 * Crack-sealant map for asphalt: R = 1 on the bands of tar sealant laid over thermal and fatigue cracks.
 * Texture x runs along the runway. 2048^2 texels over `tileMetres` (3 cm texels at 64 m).
 */
export function makeCrackTexture(anisotropy: number, tileMetres = 64, n = 2048): THREE.DataTexture {
  const data = new Uint8Array(n * n);
  const r = rng(77);
  const texel = tileMetres / n;
  const plot = (x: number, y: number, rad: number): void => {
    const e = Math.ceil(rad);
    for (let oy = -e; oy <= e; oy++) {
      for (let ox = -e; ox <= e; ox++) {
        const d = Math.hypot(ox + (x % 1) - 0.5, oy + (y % 1) - 0.5);
        if (d > rad + 0.5) continue;
        const v = Math.min(1, rad + 0.5 - d);
        const i = ((Math.floor(y) + oy + n) % n) * n + ((Math.floor(x) + ox + n) % n);
        data[i] = Math.max(data[i], Math.round(v * 255));
      }
    }
  };
  const walk = (x: number, y: number, dir: number, length: number, wander: number, rad: number, branch: number): void => {
    const step = 0.8;
    for (let s = 0; s < length / step; s++) {
      dir += (r() - 0.5) * wander;
      x += Math.cos(dir) * step;
      y += Math.sin(dir) * step;
      plot(x, y, rad);
      if (branch > 0 && r() < 0.004) walk(x, y, dir + (r() < 0.5 ? 1 : -1) * (0.6 + r()), length * 0.3, wander, rad * 0.8, branch - 1);
    }
  };
  // Transverse thermal cracks run across the pavement (texture y); the runway is 30 m wide, so they span most of it.
  for (let k = 0; k < 18; k++) walk(r() * n, r() * n, Math.PI / 2 + (r() - 0.5) * 0.3, (6 + r() * 22) / texel, 0.12, 0.9 + r() * 0.8, 2);
  // Longitudinal cracks along paving-lane joints and wheel paths.
  for (let k = 0; k < 8; k++) walk(r() * n, r() * n, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.1, (8 + r() * 25) / texel, 0.06, 0.8 + r() * 0.6, 1);
  // Short meandering fatigue cracks.
  for (let k = 0; k < 40; k++) walk(r() * n, r() * n, r() * Math.PI * 2, (0.8 + r() * 4) / texel, 0.5, 0.6 + r() * 0.5, 1);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.unpackAlignment = 1;
  return finish(tex, anisotropy);
}

/** Four independent channels of tileable fBm at different scales, for breaking up repetition in shaders. */
export function makeNoiseTexture(anisotropy: number, n = 256): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = x / n, t = y / n, i = (y * n + x) * 4;
      data[i] = to8(periodicFbm(s, t, 4, 5, 101));
      data[i + 1] = to8(periodicFbm(s, t, 8, 5, 202));
      data[i + 2] = to8(periodicFbm(s, t, 16, 4, 303));
      data[i + 3] = to8(periodicFbm(s, t, 32, 3, 404));
    }
  }
  return finish(new THREE.DataTexture(data, n, n), anisotropy);
}

// ---------------------------------------------------------------------------------------------------------------
// Building textures (UVs are in metres; set repeat to 1 / tile size)

export interface BuildingTextures {
  /** Ribbed steel cladding (R-panel) normal map, CLADDING_TILE wide, ribs along texture v. */
  corrugated: THREE.DataTexture;
  /** Grime / rain-streak albedo multiplier (sRGB-neutral greyscale around 1), 4 m tile. */
  grime: THREE.DataTexture;
  /** Roughness variation to pair with grime (G channel), 4 m tile. */
  grimeRough: THREE.DataTexture;
  /** Fine normal noise for render / concrete walls, 2 m tile. */
  stucco: THREE.DataTexture;
}

function normalFromHeight(n: number, height: Float32Array, texel: number, strength: number): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const dx = (height[y * n + ((x + 1) % n)] - height[y * n + ((x - 1 + n) % n)]) / (2 * texel) * strength;
      const dy = (height[((y + 1) % n) * n + x] - height[((y - 1 + n) % n) * n + x]) / (2 * texel) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      out[i * 4] = to8(0.5 - 0.5 * dx * inv);
      out[i * 4 + 1] = to8(0.5 - 0.5 * dy * inv);
      out[i * 4 + 2] = to8(0.5 + 0.5 * inv);
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

/** Width of one ribbed cladding sheet (36 in coverage, three major ribs at 12 in centres), m. */
export const CLADDING_TILE = 0.9144;

/**
 * Height (m) of an R-panel / PBR steel cladding profile at position x (m) across the sheet: a trapezoidal major
 * rib (32 mm high, 95 mm at the base, 25 mm crown) every 12 in, two 3 mm stiffening ribs in each flat pan,
 * and a slight step at the sheet side lap.
 */
export function claddingProfile(x: number): number {
  const pitch = CLADDING_TILE / 3;
  const p = ((x % pitch) + pitch) % pitch;
  const d = Math.abs(p - pitch / 2); // distance from the rib centre
  const rib = 0.032 * Math.min(1, Math.max(0, (0.0475 - d) / (0.0475 - 0.0125)));
  const stiff = 0.003 * (Math.exp(-(((d - 0.095) / 0.008) ** 2)) + Math.exp(-(((d - 0.125) / 0.008) ** 2)));
  const sx = ((x % CLADDING_TILE) + CLADDING_TILE) % CLADDING_TILE;
  const lap = sx < 0.02 ? 0.0015 : 0;
  return rib + stiff + lap;
}

export function makeBuildingTextures(anisotropy: number): BuildingTextures {
  // Ribbed cladding sheet (normal map), with faint dents and oil-canning in the flat pans.
  const nc = 512;
  const hc = new Float32Array(nc * nc);
  for (let y = 0; y < nc; y++) {
    for (let x = 0; x < nc; x++) {
      const s = x / nc, t = y / nc;
      hc[y * nc + x] = claddingProfile(s * CLADDING_TILE) + 0.0012 * periodicFbm(s, t, 3, 3, 9);
    }
  }
  const corrugated = finish(new THREE.DataTexture(normalFromHeight(nc, hc, CLADDING_TILE / nc, 1), nc, nc), anisotropy);

  // Grime: vertical rain streaks (stretched noise) + blotches.
  const ng = 512;
  const grimeData = new Uint8Array(ng * ng * 4);
  const roughData = new Uint8Array(ng * ng * 4);
  for (let y = 0; y < ng; y++) {
    for (let x = 0; x < ng; x++) {
      const s = x / ng, t = y / ng, i = (y * ng + x) * 4;
      const streak = periodicNoise(s * 96, t * 3, 96, 51) * 0.6 + periodicNoise(s * 192, t * 6, 192, 52) * 0.4;
      const blotch = periodicFbm(s, t, 6, 4, 53);
      const g = 0.8 + 0.2 * blotch - 0.16 * Math.max(0, streak - 0.45);
      grimeData[i] = grimeData[i + 1] = grimeData[i + 2] = to8(g);
      grimeData[i + 3] = 255;
      roughData[i + 1] = to8(0.8 + 0.2 * blotch - 0.1 * streak);
      roughData[i + 3] = 255;
    }
  }
  const grime = finish(new THREE.DataTexture(grimeData, ng, ng), anisotropy);
  const grimeRough = finish(new THREE.DataTexture(roughData, ng, ng), anisotropy);

  // Stucco / render: fine isotropic bumps.
  const ns = 256;
  const hs = new Float32Array(ns * ns);
  for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) hs[y * ns + x] = 0.0012 * periodicFbm(x / ns, y / ns, 32, 3, 61);
  const stucco = finish(new THREE.DataTexture(normalFromHeight(ns, hs, 2 / ns, 1), ns, ns), anisotropy);

  return { corrugated, grime, grimeRough, stucco };
}
