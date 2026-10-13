// Deep Time, increment 2 (WP0a contract, FROZEN names; WP6 owns the contents): the era's understorey.
//
// PART 1, the far speckle (ships): UNDERSTOREY_SPECKLE_GLSL, spliced into the terrain material's splat
// (terrainMaterial.ts fragmentSplat) right after the ground layers (grass / meadow, mud, ash and sand) and before
// the edge shade, rock and snow, outside the present day only and unless ?eraoff=speckle. It may darken / tint
// acc.albedo (and acc.rough / acc.slope) with cycad rosettes and fern clumps. In scope there: tP, tXZ, tN, tUp, tH,
// tDist, tBio (vBiome), vRiver (signed distance from the river centreline, half-width), landW (the meadow weight,
// after the Flats mud: tMudL under STRIP_MUD),
// grassW, tMarshW (MARSH_CHANNEL), sandW, forestW, the noise samples nA..nD / sB..sD, runwayLocal(tXZ) (the Flats
// strip), hash2f, and ERA_TERRAIN_UNIFORMS_GLSL's uniforms. UNDERSTOREY_HEAD_GLSL goes in the fragment head (after
// the volcano helpers) for its functions. Both empty: nothing is emitted (the stub).
//
// PART 2, the near layer (stretch): createUnderstorey returns an EraLayer (world/terrain/eraLayers.ts) - one
// instanced draw of cycads / tree ferns near the camera - or null. TerrainSystem builds it (through createEraLayers)
// only when era().flora !== 'present'; it is not built when ?eraoff=understorey.
//
// THE SPECKLE (WP6)
//   What it is: from 300-1500 ft the Cretaceous ground cover read as a lawn (a smooth olive sward). Real fern
//   prairie is lumpy: dark cycad rosettes and fern clumps a few metres across, each with its own shaded side and
//   shadow. The speckle paints them into the terrain's albedo and normal, one plant at most per SPECKLE.cellM
//   square cell (a jittered site; the plant and its shadow stay inside their cell, so a pixel looks at ONE cell:
//   one hash, no neighbour loop - well under the 0.1 ms budget).
//   Where: on the meadow (the fern prairie, the marsh) and, thinner, on the Flats' mud; denser within ~50 m of the
//   river and along forest margins; none on the strip (the runway rectangle plus SPECKLE.stripPad*) and none on
//   slopes over 20 deg (exactly 0 from cos 20 deg down), none above the tree line, none on the river banks.
//   Range: it fades in from 150 m (closer, a painted plant would read as a decal) and out by 1500 m. A plant also
//   fades out once it is about a pixel across (the pixel footprint from fwidth of its normalised distance, so the
//   oblique forward view fades before the door window's steeper one) instead of crawling.
//   Tone: MOSTLY MEAN-PRESERVING. The ground between the plants is lifted to give back SPECKLE.preserve of the
//   plants' expected darkening (they are dark), so the speckle adds texture rather than a darker ring around the
//   camera, and the fades in and out at 150 / 1500 m leave no visible edge; the remainder lets the dense brakes
//   (the river, the forest margins) read a little darker. The palette (WP7) keeps the ground's tone.
//   CPU mirror: speckleDensity / speckleCell / speckleGround / speckleDistanceFade evaluate exactly what the GLSL
//   does (the GLSL's constants are interpolated from SPECKLE below, so the two cannot drift), for the tests.

import { AIRPORT } from '../../../core/world';
import type { EraLayer, EraLayerContext } from '../eraLayers';

/** The speckle's tuning. Every number here is written into the GLSL. */
export const SPECKLE = Object.freeze({
  /** Cell size, m: at most one plant per cell. */
  cellM: 8,
  /** Plant radius range, m. */
  rMinM: 1.5,
  rMaxM: 3.0,
  /** The shadow's largest offset from its plant, m (low sun); the plant + shadow stay inside the cell. */
  shadowMaxM: 0.9,
  /** Shadow length per metre of plant radius at a 45 deg sun (scaled by 1 / tan(elevation), capped above). */
  shadowPerR: 0.35,
  /** Ground brightness in the shadow. */
  shadowK: 0.55,
  /** The plant's dome tilt (acc.slope units: tNormalW adds 0.35 x slope), at its rim. */
  dome: 0.7,
  /** Probability that a cell at density 1 holds a plant. */
  pMax: 0.9,
  /** Density terms: the prairie's base (x the patch noise), the marsh's extra, the river's and the margins'. */
  base: 0.45,
  marsh: 0.12,
  river: 0.55,
  margin: 0.45,
  /** The river boost: full within riverFullM of the bank (|signed distance| - half-width), 0 beyond riverReachM. */
  riverFullM: 12,
  riverReachM: 50,
  /** The forest-margin band in the land cover's forest value (biome forest; the stand's edge is ~0.42). */
  marginIn0: 0.03,
  marginIn1: 0.15,
  marginOut0: 0.35,
  marginOut1: 0.6,
  /** Slope: none at or beyond 20 deg (up = cos 20), full from 16 deg. */
  slopeZeroUp: Math.cos((20 * Math.PI) / 180),
  slopeFullUp: Math.cos((16 * Math.PI) / 180),
  /** The strip: none within the runway rectangle grown by these pads (m), then a soft edge. */
  stripPadAlongM: 120,
  stripPadAcrossM: 45,
  stripSoftM: 40,
  /** The Flats' mud carries this share of the meadow's plants. */
  mudShare: 0.45,
  /** Distance fade, m: in over [fadeIn0, fadeIn1], out over [fadeOut0, fadeOut1]. */
  fadeIn0: 150,
  fadeIn1: 250,
  fadeOut0: 1100,
  fadeOut1: 1500,
  /** Pixel-footprint fade, in plant radii per pixel: full below vis0, gone beyond vis1. */
  vis0: 1.3,
  vis1: 2.6,
  /** Share of the plants' mean darkening the lift between them gives back (1: exactly mean-preserving). */
  preserve: 0.75,
  /** Mean area of a plant's outline relative to its disc (the cycad's star, the fern's lobes). */
  shapeArea: 0.8,
  /** Hash salts (cell -> roll / radius, site, kind / orientation). */
  saltA: [7151, -3301] as const,
  saltB: [-911, 5281] as const,
  saltC: [2, 9973] as const,
});

const RW_HALF_LEN = AIRPORT.runway.length / 2;
const RW_HALF_WID = AIRPORT.runway.width / 2;

// ----------------------------------------------------------------------------------------------- CPU mirror

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** GLSL smoothstep (e0 < e1). */
const ss = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** What the density reads at a point (the GLSL's per-pixel values). */
export interface SpeckleInputs {
  /** Distance from the river bank, m: |signed distance from the centreline| - half-width; large when no river. */
  riverEdge: number;
  /** Land-cover forest value (biome forest; the shader's tBio.x). */
  forest: number;
  /** Vertical component of the surface normal. */
  up: number;
  /** Runway coordinates, m (core/world.ts runwayCoords): along the centreline, across it. */
  along: number;
  across: number;
  /** Marsh weight (the shader's tMarshW), 0 when none. */
  marsh?: number;
  /** River bank / bed weight (the shader's tRiverBank), 0 when none. */
  bank?: number;
  /** Above the tree line (the shader's alpine), 0 on the valley floor. */
  alpine?: number;
  /** The patch noises (the shader's nC.a and nD.b, 0..1; 0.5 = their mean). */
  patchA?: number;
  patchB?: number;
}

/** The speckle density (0..1) at a point: the CPU twin of the GLSL usDensity. */
export function speckleDensity(i: SpeckleInputs): number {
  const S = SPECKLE;
  const patch = Math.min(Math.max(0.7 - 1.4 * ((i.patchA ?? 0.5) - 0.5) + 1.6 * ((i.patchB ?? 0.5) - 0.5), 0.1), 1.4);
  const near = 1 - ss(S.riverFullM, S.riverReachM, i.riverEdge);
  const margin = ss(S.marginIn0, S.marginIn1, i.forest) * (1 - ss(S.marginOut0, S.marginOut1, i.forest));
  let d = (S.base + S.marsh * (i.marsh ?? 0)) * patch + S.river * near + S.margin * margin;
  d = clamp01(d);
  // Slope: exactly 0 at and beyond 20 deg.
  d *= ss(S.slopeZeroUp, S.slopeFullUp, i.up);
  // The strip: exactly 0 inside the padded runway rectangle.
  const qx = Math.max(Math.abs(i.along) - (RW_HALF_LEN + S.stripPadAlongM), 0);
  const qy = Math.max(Math.abs(i.across) - (RW_HALF_WID + S.stripPadAcrossM), 0);
  d *= ss(0, S.stripSoftM, Math.hypot(qx, qy));
  d *= (1 - (i.bank ?? 0)) * (1 - (i.alpine ?? 0));
  return d;
}

/** The ground weight the speckle lands on: the meadow's, plus a share of the Flats' mud. */
export function speckleGround(land: number, mud = 0): number {
  return clamp01(land + SPECKLE.mudShare * mud);
}

/** The distance fade (0..1). */
export function speckleDistanceFade(dist: number): number {
  const S = SPECKLE;
  return ss(S.fadeIn0, S.fadeIn1, dist) * (1 - ss(S.fadeOut0, S.fadeOut1, dist));
}

/** One cell's plant (whether it is there depends on the density: present when roll < density x pMax). */
export interface SpeckleCell {
  ix: number;
  iz: number;
  /** Uniform 0..1 roll against density x pMax. */
  roll: number;
  /** Radius, m. */
  r: number;
  /** Centre (three.js x = east, z = -north), m. */
  cx: number;
  cz: number;
  /** 0 cycad rosette, 1 fern clump. */
  kind: number;
  /** Rotation of its outline, turns (0..1). */
  turn: number;
  /** 1: a clump of two crowns (a large one and a smaller one beside it), 0: one crown. */
  twin: number;
  /** Tone variation 0..1. */
  tone: number;
}

/** 32-bit lowbias hash, identical to the GLSL hash2u (terrain/glsl.ts) and noise.ts hash2i. */
function hash2u(x: number, y: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

const U16 = 1 / 65536;

/** The plant of the cell containing three.js (x, z) = (east, -north): the CPU twin of the GLSL cell lookup. */
export function speckleCell(x: number, z: number, out: SpeckleCell = { ix: 0, iz: 0, roll: 0, r: 0, cx: 0, cz: 0, kind: 0, turn: 0, twin: 0, tone: 0 }): SpeckleCell {
  const S = SPECKLE;
  const ix = Math.floor(x / S.cellM);
  const iz = Math.floor(z / S.cellM);
  const a = hash2u(ix + S.saltA[0], iz + S.saltA[1]);
  const b = hash2u(ix + S.saltB[0], iz + S.saltB[1]);
  const c = hash2u(ix + S.saltC[0], iz + S.saltC[1]);
  out.ix = ix;
  out.iz = iz;
  out.roll = (a & 0xffff) * U16;
  out.r = S.rMinM + (S.rMaxM - S.rMinM) * (a >>> 16) * U16;
  const m = out.r + S.shadowMaxM;
  out.cx = ix * S.cellM + m + (b & 0xffff) * U16 * (S.cellM - 2 * m);
  out.cz = iz * S.cellM + m + (b >>> 16) * U16 * (S.cellM - 2 * m);
  out.kind = c & 1;
  out.turn = ((c >>> 1) & 0x7fff) / 32768;
  out.twin = (c >>> 16) & 1;
  out.tone = (c >>> 17) / 32768;
  return out;
}

/** Expected plant cover (area fraction) of a cell at density 1: pMax x the mean outline area / the cell. */
export const SPECKLE_MEAN_COVER =
  (SPECKLE.pMax * SPECKLE.shapeArea * Math.PI * (SPECKLE.rMinM * SPECKLE.rMinM + SPECKLE.rMinM * SPECKLE.rMaxM + SPECKLE.rMaxM * SPECKLE.rMaxM)) /
  3 /
  (SPECKLE.cellM * SPECKLE.cellM);

// ----------------------------------------------------------------------------------------------- GLSL

/** A GLSL float literal. */
const f = (n: number): string => {
  const s = Number.isInteger(n) ? n.toFixed(1) : String(+n.toFixed(7));
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const int = (n: number): string => String(Math.trunc(n));

const S = SPECKLE;

export const UNDERSTOREY_HEAD_GLSL = /* glsl */ `// Understorey speckle (vegetation/understorey.ts; WP6): the density of cycad rosettes and fern clumps.
float usDensity(float riverEdge, float forest, float up, vec2 rw, float marsh, float bank, float alpine, float pa, float pb) {
  float pch = clamp(0.7 - 1.4 * (pa - 0.5) + 1.6 * (pb - 0.5), 0.1, 1.4);
  float near = 1.0 - smoothstep(${f(S.riverFullM)}, ${f(S.riverReachM)}, riverEdge);
  float margin = smoothstep(${f(S.marginIn0)}, ${f(S.marginIn1)}, forest) * (1.0 - smoothstep(${f(S.marginOut0)}, ${f(S.marginOut1)}, forest));
  float d = clamp((${f(S.base)} + ${f(S.marsh)} * marsh) * pch + ${f(S.river)} * near + ${f(S.margin)} * margin, 0.0, 1.0);
  d *= smoothstep(${f(S.slopeZeroUp)}, ${f(S.slopeFullUp)}, up);
  vec2 q = max(abs(rw) - vec2(${f(RW_HALF_LEN + S.stripPadAlongM)}, ${f(RW_HALF_WID + S.stripPadAcrossM)}), 0.0);
  d *= smoothstep(0.0, ${f(S.stripSoftM)}, length(q));
  return d * (1.0 - bank) * (1.0 - alpine);
}
vec2 usCmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
// Coverage of a clump at v (from its site; radius r, outline factor k, fw the pixel footprint in radii): one crown,
// or (twin) a crown of 0.75 r and a second of 0.5 r beside it along dir - both inside r, so inside the cell.
float usClump(vec2 v, float r, vec2 dir, float twin, float k, float fw) {
  float r1 = r * (1.0 - 0.25 * twin);
  float a = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, length(v + dir * (0.25 * r * twin)) / (r1 * k));
  if (twin > 0.5) a = max(a, 1.0 - smoothstep(1.0 - 2.0 * fw, 1.0 + 2.0 * fw, length(v - dir * (0.5 * r)) / (0.5 * r)));
  return a;
}
`;

export const UNDERSTOREY_SPECKLE_GLSL = /* glsl */ `// Understorey speckle (WP6): dark cycad rosettes and fern clumps, at most one per ${f(S.cellM)} m cell, each with a
// dome-shaded crown and a short shadow; mean-preserving (the ground between is lifted to keep its tone).
{
  vec2 usCell = floor(tXZ * ${f(1 / S.cellM)});
  ivec2 usK = ivec2(usCell);
  uint usA = hash2u(usK.x + ${int(S.saltA[0])}, usK.y + ${int(S.saltA[1])});
  uint usB = hash2u(usK.x + ${int(S.saltB[0])}, usK.y + ${int(S.saltB[1])});
  uint usC = hash2u(usK.x + ${int(S.saltC[0])}, usK.y + ${int(S.saltC[1])});
  float usRoll = float(usA & 0xffffu) * ${f(U16)};
  float usR = ${f(S.rMinM)} + ${f(S.rMaxM - S.rMinM)} * float(usA >> 16u) * ${f(U16)};
  float usMg = usR + ${f(S.shadowMaxM)};
  vec2 usCtr = usCell * ${f(S.cellM)} + usMg + vec2(float(usB & 0xffffu), float(usB >> 16u)) * ${f(U16)} * (${f(S.cellM)} - 2.0 * usMg);
  vec2 usV = tXZ - usCtr;
  float usD = length(usV) / usR;
  // Pixel footprint in plant radii (taken in uniform control flow).
  float usFw = max(length(vec2(dFdx(usD), dFdy(usD))), 1e-4);
  float usFade = smoothstep(${f(S.fadeIn0)}, ${f(S.fadeIn1)}, tDist) * (1.0 - smoothstep(${f(S.fadeOut0)}, ${f(S.fadeOut1)}, tDist)) * (1.0 - smoothstep(${f(S.vis0)}, ${f(S.vis1)}, usFw));
  float usG = landW;
#if STRIP_MUD
  usG += ${f(S.mudShare)} * tMudL;
#endif
  usG = clamp(usG, 0.0, 1.0);
  if (usFade * usG > 0.001) {
    float usBank = 0.0;
    float usEdge = 1e4;
    if (vRiver.y > 1.0) { usEdge = abs(vRiver.x) - vRiver.y; usBank = tRiverBank; }
    float usDen = usDensity(usEdge, tBio.x, tUp, runwayLocal(tXZ), tMarshW, usBank, alpine, nC.a, nD.b);
    if (usDen > 0.0) {
      float usStr = usFade * usG;
      // The outline: a cycad's star of 8 fronds or a fern clump's lobes, rotated per plant; it relaxes to a disc
      // once the frond scale is under a pixel.
      float usTurn = float((usC >> 1u) & 0x7fffu) * ${f(1 / 32768)} * 6.2831853;
      vec2 usU = usCmul(usV / max(length(usV), 1e-4), vec2(cos(usTurn), -sin(usTurn)));
      vec2 usU2 = usCmul(usU, usU);
      vec2 usU4 = usCmul(usU2, usU2);
      float usAmp = 1.0 - smoothstep(0.08, 0.25, usFw);
      float usTone = float(usC >> 17u) * ${f(1 / 32768)};
      float usTwin = float((usC >> 16u) & 1u);
      vec2 usDir = vec2(cos(usTurn), sin(usTurn));
      bool usCycad = (usC & 1u) == 0u;
      float usShape = usCycad ? mix(1.0, mix(0.5, 1.0, 0.5 + 0.5 * usCmul(usU4, usU4).x), usAmp)
                              : mix(1.0, 0.86 + 0.09 * usCmul(usU2, usU).x + 0.06 * usCmul(usU4, usU).y, usAmp);
      float usPresent = usRoll < usDen * ${f(S.pMax)} ? 1.0 : 0.0;
      float usCov = usClump(usV, usR, usDir, usTwin, usShape, usFw) * usPresent;
      // Shadow: the same disc, offset down-sun (longer for a low sun, inside the cell).
      float usSunUp = smoothstep(0.0, 0.06, tSunW.y);
      float usSh = 0.0;
      if (tSunW.y > 0.0) {
        vec2 usSun = normalize(tSunW.xz + 1e-5);
        float usLen = min(${f(S.shadowPerR)} * usR * length(tSunW.xz) / max(tSunW.y, 0.02), ${f(S.shadowMaxM)});
        usSh = usClump(usV + usSun * usLen, usR * 0.92, usDir, usTwin, 1.0, usFw) * usPresent * usSunUp;
      }
      // Plant colour: cycads near-black glossy green, ferns a little lighter and yellower.
      vec3 usCol = usCycad ? vec3(0.010, 0.030, 0.004) : vec3(0.022, 0.044, 0.005);
      usCol *= 0.8 + 0.4 * usTone;
      // Fronds: lighter along each frond, darker between (while they resolve), and a lighter crown top.
      float usFr = usCycad ? usCmul(usU4, usU4).x : usCmul(usU4, usU).x;
      usCol *= 1.0 + usAmp * (0.3 * usFr + 0.35 * (1.0 - smoothstep(0.0, 0.6, usD)));
      // Mean preservation: the expected plant and shadow cover at this density, and the lift between them.
      float usMc = usDen * ${f(SPECKLE_MEAN_COVER)};
      float usMs = usMc * 0.4 * usSunUp;
      vec3 usLum = vec3(0.2126, 0.7152, 0.0722);
      float usKp = dot(usCol, usLum) / max(dot(acc.albedo, usLum), 1e-4);
      float usLift = 1.0 + ${f(S.preserve)} * (clamp((1.0 - usMc * usKp) / max(1.0 - usMc - usMs + usMs * ${f(S.shadowK)}, 0.2), 1.0, 1.6) - 1.0);
      vec3 usGround = acc.albedo * mix(1.0, usLift, usStr) * (1.0 - ${f(1 - S.shadowK)} * usSh * (1.0 - usCov) * usStr);
      acc.albedo = mix(usGround, usCol, usCov * usStr);
      // The crown as a low dome (its sunlit and shaded sides), replacing the ground's detail relief.
      acc.slope = mix(acc.slope, usV / usR * ${f(S.dome)}, usCov * usStr);
      // Matte foliage, deeper in the crown's rim (the shade under the fronds).
      acc.rough = mix(acc.rough, 0.95, usCov * usStr);
      acc.cavity *= mix(1.0, mix(0.85, 0.55, clamp(usD, 0.0, 1.0)), usCov * usStr);
    }
  }
}
`;

/** The near understorey layer (stub: none). */
export function createUnderstorey(_ctx: EraLayerContext): EraLayer | null {
  return null;
}
