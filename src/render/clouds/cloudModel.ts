// The cloud field itself: where clouds are and how dense, shared by the view ray-march and the ground
// shadow pass so shadows always match the visible clouds. Follows the Nubis layout (Schneider 2015/2017):
//   weather map (2D coverage + type) -> height profile -> Perlin-Worley shape -> Worley detail erosion.
//
// Heights use a curved-earth approximation: a point at horizontal distance r from the camera sits
// r^2 / 2R lower relative to the local tangent plane, so the layer bends away and meets the horizon
// instead of ending in a flat edge (the world itself is flat; only the clouds are bent).
//
// Cloud type: WeatherSettings.cloudType (core/weatherFields cloudTypeOf, CLOUD_TYPE_PROFILES) selects the low
// layer's character. 'auto' (the default) keeps the cover-driven mapping (cumulus cells closing into a
// stratocumulus deck as the cover rises); the other types force the deck shape and scale the extinction, the
// shape-noise frequency and the tower extension (uCloudType, uLayer, uExtinction, uTopFrac), plus the
// render-only shape terms of CLOUD_TYPE_SHAPE (uCloudShape). With 'auto' every uniform holds the value it had
// before the types existed, and each GLSL term the types add reduces to the original expression.
//
// Mid-level sheet (WeatherSettings.midCover / midType / midAltM, core/weatherFields midLayerOf): uMid and
// uMidOffset for the single-intersection altostratus / altocumulus sheet of the view march (marchShader.ts).
//
// Convective activity (physics/weather/stormField.ts convectiveState, 0 for the default weather): the layer's tower
// extension and type bias move from the cloud type's values toward those of 'towering' as the activity rises
// (layerTowerExt, layerTypeBias), so convective conditions draw a deeper layer of more towering cells.
//
// Storm cells (render/weather/stormSelection.ts, the frame's selection at the camera, as the storm effect draws
// them): the lateral coverage around each cell is multiplied by 1 - sum(core_i x smoothstep(CLEAR_OUTER x R_i,
// CLEAR_INNER x R_i, r_i)), clamped at 0, R the drawn core radius and core the cell's core share (uStormClear,
// uStormClearCount). The view march and the shadow map read the same uniforms. With no cell the count is 0 and the
// term is skipped.

import * as THREE from 'three';
import { KT } from '../../core/math';
import type { SimContext } from '../../core/context';
import type { CloudType, MidCloudType, WeatherSettings } from '../../core/types';
import { CLOUD_TYPE_PROFILES, cloudTypeOf, midLayerOf, type MidLayer } from '../../core/weatherFields';
import { MAX_STORMS, stormCentreAt, type NorthEast } from '../../core/weatherFields';
import { StormField, stormShare } from '../../physics/weather/stormField';
import { cameraStormsAt, drawnCoreRadiusM } from '../weather/stormSelection';
import { COVERAGE_GLSL, coverageParams, evolveWeights } from './coverage';
import { WEATHER_SIZE, type CloudNoiseTextures } from './noiseTextures';

/** Horizontal period of the weather map, m. The shape and detail periods divide it so wind offsets wrap cleanly. */
const WEATHER_PERIOD = 60_000;
const SHAPE_PERIOD = 1_500;
const DETAIL_PERIOD = 480;
const CIRRUS_PERIOD = 30_000;
/** Tile period of the cirrus fibre texture, m (its second field is sampled at a third of it); divides CIRRUS_PERIOD. */
const CIRRUS_FIBRE_PERIOD = 10_000;
/** Upper-level (~8-10 km) wind relative to the surface wind. */
const CIRRUS_WIND_FACTOR = 2.5;
const EARTH_RADIUS = 6_371_000;
/** Wind at cloud level relative to the surface wind: 1/7 power law from 10 m to ~1.5 km AGL gives ~2x; use 1.8. */
export const CLOUD_WIND_FACTOR = 1.8;
/**
 * Where the weather map starts relative to the world, m (three.js x, z). The cloud field has clusters and
 * clearings several km across; this phase puts the home airfield under a representative part of it, where
 * the sky overhead and within 4 km shows the requested cover (measured for 20-50 % cover: overhead
 * 0.22 / 0.36 / 0.50), rather than under a cluster (the unshifted map gave 60-85 % overhead at 20-50 %).
 */
const WEATHER_PHASE: readonly [number, number] = [30_461, 22_196];
/** Period over which the two coverage fields cross-fade, s. Clouds grow and decay on a ~10-20 minute scale. */
const EVOLVE_PERIOD = 1_800;
/**
 * Extinction coefficient at density 1, 1/m. Fair-weather cumulus has liquid water content ~0.3-0.5 g/m^3 and
 * ~10 um droplets, i.e. extinction ~0.05-0.1 /m (visibility ~40-80 m inside the cloud).
 */
const EXTINCTION = 0.1;
/**
 * The march layer extends above the weather's nominal cloud top by this factor of the layer depth: the
 * towers of cumulus congestus rise out of the general level of the tops (cloudTopM is where most tops sit).
 */
export const TOWER_EXTENSION = 1.6;

/** Render-only shape terms of one cloud type (uCloudShape), on top of the CLOUD_TYPE_PROFILES uniforms. */
export interface CloudTypeShape {
  /** Multiplier on the deck's top height (the stratocumulus top, 30-55 % of the nominal depth). */
  readonly deckTopScale: number;
  /** 0..1: ragged deck base (deeper base undulation, the base fraying of cumulus kept under a deck). */
  readonly baseRagged: number;
  /** Multiplier on the detail erosion depth. */
  readonly erosionScale: number;
  /** Added to the weather map's type field before the deck term (> 0: more cells take the tower shape). */
  readonly typeBias: number;
}

/**
 * Per-type shape terms. Unconfirmed: tuning values chosen on dev/clouds.html (ctype=), not measured. 'auto'
 * is neutral (each term leaves the GLSL expression it enters unchanged). Stratus and nimbostratus decks fill
 * most of the layer depth (deckTopScale), stratus with little erosion (a smooth, featureless sheet),
 * nimbostratus with a ragged base; towering cumulus puts more of the cells into the congestus shape.
 */
export const CLOUD_TYPE_SHAPE: Readonly<Record<CloudType, CloudTypeShape>> = Object.freeze({
  auto: { deckTopScale: 1, baseRagged: 0, erosionScale: 1, typeBias: 0 },
  stratus: { deckTopScale: 1.7, baseRagged: 0, erosionScale: 0.35, typeBias: 0 },
  stratocumulus: { deckTopScale: 1, baseRagged: 0, erosionScale: 1, typeBias: 0 },
  cumulus: { deckTopScale: 1, baseRagged: 0, erosionScale: 1, typeBias: 0 },
  towering: { deckTopScale: 1, baseRagged: 0, erosionScale: 1, typeBias: 0.6 },
  nimbostratus: { deckTopScale: 1.7, baseRagged: 1, erosionScale: 0.8, typeBias: 0 },
});

/**
 * Optical depth of the mid-level sheet at full cover inside its patches. Unconfirmed tuning values: an
 * altostratus through which the sun shows as through ground glass, a thinner layer of altocumulus elements.
 * For altocumulus the value is the patch mean that the sky model and the shadow map use (midSheetTau); the view
 * march puts up to 6 times the mean in the element centres (marchShader.ts), so the visible elements are
 * thicker than the sheet that dims the ground and the low layer.
 */
export const MID_TAU_MAX: Readonly<Record<MidCloudType, number>> = Object.freeze({ altostratus: 6, altocumulus: 2 });
/** Optical depth of the sheet inside its patches at a vanishing cover. Unconfirmed tuning value. */
const MID_TAU_MIN = 0.5;

/**
 * Mean optical depth of the mid-level sheet inside its patches: mix(MID_TAU_MIN, MID_TAU_MAX, cover), the
 * value the view march uses (marchShader.ts) and the sky model takes (render/sky/cloudSky.ts midTau).
 */
export function midSheetTau(cover: number, type: MidCloudType): number {
  return MID_TAU_MIN + (MID_TAU_MAX[type] - MID_TAU_MIN) * cover;
}
/**
 * Wind at the mid-level sheet relative to the surface wind. Unconfirmed: between the cloud-level factor
 * (CLOUD_WIND_FACTOR) and the cirrus factor (CIRRUS_WIND_FACTOR).
 */
export const MID_WIND_FACTOR = 2.2;

/**
 * Cumulus clearing around a storm cell: full between the centre and CLEAR_INNER core radii, none from CLEAR_OUTER
 * (the air subsiding around a cumulonimbus suppresses the cumulus near it). Unconfirmed: look values.
 */
export const CLEAR_INNER = 1.5;
export const CLEAR_OUTER = 3;

/** The convective activity of a weather for the drawn layer (one cached evaluation for every caller). */
const _activity = new StormField();
export function layerActivity(w: WeatherSettings): number {
  return _activity.convective(w).activity;
}

/** Tower extension of the drawn layer: the type's towerExt toward the 'towering' value with the activity. */
export function layerTowerExt(type: CloudType, activity: number): number {
  const e = CLOUD_TYPE_PROFILES[type].towerExt;
  return activity > 0 ? e + (CLOUD_TYPE_PROFILES.towering.towerExt - e) * activity : e;
}

/** Type bias of the drawn layer (CLOUD_TYPE_SHAPE typeBias): the type's value toward the 'towering' value with the activity. */
export function layerTypeBias(type: CloudType, activity: number): number {
  const b = CLOUD_TYPE_SHAPE[type].typeBias;
  return activity > 0 ? b + (CLOUD_TYPE_SHAPE.towering.typeBias - b) * activity : b;
}

/**
 * Top of the low layer as the view march sees it (uLayer.y): the weather's nominal top extended by the layer's
 * tower extension (layerTowerExt), m MSL. The mid-level sheet is drawn and lights the scene only above this
 * altitude; the sky model (render/sky/SkySystem.ts) applies the same test.
 */
export function extendedLayerTopM(w: WeatherSettings): number {
  const base = Math.min(w.cloudBaseM, w.cloudTopM - 100);
  const nominalTop = Math.max(w.cloudTopM, base + 100);
  return base + (nominalTop - base) * layerTowerExt(cloudTypeOf(w), layerActivity(w));
}

export const CLOUD_MODEL_GLSL = /* glsl */ `
#define PI 3.14159265
${COVERAGE_GLSL}
uniform sampler3D uShapeTex;
uniform sampler3D uDetailTex;
uniform sampler3D uWarpTex;     // smooth vector field (rgb), same tile period as the detail
uniform sampler2D uWeatherTex;
uniform sampler2D uCirrusTex;
uniform vec4 uLayer;          // base alt, top alt (extended for towers), 1 / thickness, cloud cover 0..1
uniform vec3 uShapeOffset;    // wind drift of the shape noise, m
uniform vec3 uDetailOffset;   // wind drift plus slow churn of the detail noise, m
uniform vec4 uWeatherOffset;  // xy: drift of coverage field 0, zw: drift of coverage field 1, m
uniform vec2 uEvolve;         // cross-fade weights of the two coverage fields (coverage.ts evolveWeights)
uniform vec2 uCoverage;       // threshold on the coverage field and gap fill for the requested cover (coverageParams)
uniform float uExtinction;    // 1/m at density 1
uniform float uInvTwoR;       // 1 / (2 * earth radius)
uniform float uTopFrac;       // the weather's nominal cloud top as a fraction of the (extended) layer
uniform vec4 uCloudType;      // cloud type (CLOUD_TYPE_PROFILES): deck override, deck weight, extinction scale (not read: uExtinction carries it), shape frequency scale
uniform vec4 uCloudShape;     // cloud type (CLOUD_TYPE_SHAPE): deck top scale, base raggedness, erosion scale, type bias
uniform vec4 uStormClear[${MAX_STORMS}];  // storm cells: centre x, z (three.js world), drawn core radius R, core share
uniform int uStormClearCount;

const float WEATHER_FREQ = ${(1 / WEATHER_PERIOD).toExponential(6)};
const float SHAPE_FREQ = ${(1 / SHAPE_PERIOD).toExponential(6)};
const float DETAIL_FREQ = ${(1 / DETAIL_PERIOD).toExponential(6)};
const float CIRRUS_FREQ = ${(1 / CIRRUS_PERIOD).toExponential(6)};
const float CIRRUS_FIBRE_FREQ = ${(1 / CIRRUS_FIBRE_PERIOD).toExponential(6)};
const float CIRRUS_FIBRE_TEXEL = ${(CIRRUS_FIBRE_PERIOD / 1024).toFixed(3)};
const float WEATHER_TEXEL = ${(WEATHER_PERIOD / WEATHER_SIZE).toFixed(3)};  // m per texel of the weather map
const float SHAPE_TEXEL = ${(SHAPE_PERIOD / 128).toFixed(3)};     // m per texel of the 128^3 shape volume
const float DETAIL_TEXEL = ${(DETAIL_PERIOD / 64).toFixed(3)};    // m per texel of the 64^3 detail volume
// Frequency of the fine erosion octave (a quarter of the detail period).
const float FINE_FREQ = ${(4 / DETAIL_PERIOD).toExponential(6)};
// The finest octave (a sixteenth of the detail period, 2-10 m), for clouds within a few hundred metres: set by
// the view march around its own samples (0 elsewhere: light rays, bisection, shadows).
const float MICRO_FREQ = ${(16 / DETAIL_PERIOD).toExponential(6)};
const float MICRO_TEXEL = ${(DETAIL_PERIOD / 16 / 64).toFixed(4)};
float gMicroWeight = 0.0;
float gMicroLod = 0.0;
// Range of (eroded) shape margin over which the density rises from clear air to the cloud body. Real
// cumulus has no surface: its water content falls off over tens of metres, so thin rims and wisps are
// translucent and the sun shines through them.
const float EDGE_BAND = 0.2;
// Depth of the detail erosion, in shape-margin units (the margin rises by ~1 per ~200 m into a cloud, so up to
// ~100 m): deep enough to carve lobes, turrets and ragged wisps out of the shape, not just wrinkle its skin.
// The coarse shape (light rays, shadows) takes the mean erosion, half of it.
const float DETAIL_EROSION = 0.5;
// A thin, low-density fringe outside the eroded boundary (~25 m, in margin units): real cumulus edges are
// not cut out of the sky but fade through a translucent rim that the sun shines through (silver lining).
const float FRINGE = 0.07;
const float FRINGE_DENSITY = 0.05;

float remapClamped(float v, float a, float b, float c, float d) {
  return clamp(c + (v - a) / (b - a) * (d - c), min(c, d), max(c, d));
}

// The weather at a horizontal position: x = lateral coverage (0 outside a cloud, ramping to 1 over the outer
// part of its cell), y = the local cloud-top height as a fraction of the (extended) layer, z = cloud type
// (0 stratocumulus / flat, 1 towering cumulus). Always sampled with an explicit mip level: implicit
// derivatives are meaningless inside a ray-march loop (neighbouring pixels are at unrelated distances) and
// show up as two-pixel stripes.
//
// Each cloud is an envelope over its cell of the coverage field. The cell strength s (0 at the edge of the
// area above the threshold, 1 at the strongest point) sets the local top: the broad body reaches its full
// height within the outer part of the cell (steep, billowed sides above a flat base, not a gumdrop), and in
// cells of the towering type a narrower tower rises from the core toward the top of the extended layer
// (congestus). Small cells never get strong, so they stay low and flat (humilis): the size-height relation of
// real cumulus fields. The body height also varies with the type field (regional and cell-scale), so
// neighbouring clouds of the same size differ. As the cover closes up the tops flatten into a lumpy
// stratocumulus deck and the gaps fill (uCoverage.y), so overcast reads as a continuous layer.
// Near a cell's peak the (equalised) field falls off with the square of the distance (the area above u
// grows as (1 - u)), so this cell strength runs roughly linearly from the cloud's rim (0) to its core (1).
// How far the cover has closed into a stratocumulus deck (0 scattered cumulus, 1 overcast). A cloud type other
// than 'auto' replaces the cover-driven value by its own (uCloudType.y = 1); 'auto' has weight 0.
float deckness() { return mix(smoothstep(0.5, 0.9, uLayer.w), uCloudType.x, uCloudType.y); }

// Share of the cumulus coverage left around the storm cells (1 with none): 1 - sum core x smoothstep(CLEAR_OUTER R,
// CLEAR_INNER R, r), at least 0.
float stormClearing(vec2 xz) {
  float s = 0.0;
  for (int i = 0; i < ${MAX_STORMS}; i++) {
    if (i >= uStormClearCount) break;
    vec4 c = uStormClear[i];
    s += c.w * smoothstep(${CLEAR_OUTER.toFixed(2)} * c.z, ${CLEAR_INNER.toFixed(2)} * c.z, distance(xz, c.xy));
  }
  return max(1.0 - s, 0.0);
}

float cellStrength(float field, float threshold) {
  return clamp(1.0 - sqrt(max(1.0 - field, 0.0) / max(1.0 - threshold, 1e-3)), 0.0, 1.0);
}

vec3 cloudWeather(vec2 xz, float lod) {
  vec2 uv0 = (xz + uWeatherOffset.xy) * WEATHER_FREQ, uv1 = (xz + uWeatherOffset.zw) * WEATHER_FREQ;
  vec4 w0 = textureLod(uWeatherTex, uv0, lod);
  vec4 w1 = textureLod(uWeatherTex, uv1, lod);
  // Uniformly distributed at every stage of the cross-fade (coverage.ts); the threshold is calibrated so the
  // area under cloud matches the requested cover.
  float threshold = uCoverage.x;
  float cellS = cellStrength(blendFields(w0.r, w1.g, uEvolve), threshold);
  // Outside every cell (most of the sky at scattered cover) there is no cloud: skip the height lookups.
  if (cellS <= 0.0 && uCoverage.y <= 0.0) return vec3(0.0);
  // The height comes from the field blurred over ~500 m (mip 3): it measures the size of the cell rather
  // than the height of a narrow peak, so small puffs stay low and only broad cells tower (no spires).
  float lodB = max(lod, 3.5);
  float bigS = cellStrength(blendFields(textureLod(uWeatherTex, uv0, lodB).r, textureLod(uWeatherTex, uv1, lodB).g, uEvolve), threshold);
  float s = mix(cellS, 1.0, uCoverage.y);
  float sh = mix(min(bigS * 1.6, 1.0), 1.0, uCoverage.y);
  float deck = deckness();
  float type = clamp(w0.b * 1.3 - 0.15 + uCloudShape.w - 0.9 * deck, 0.0, 1.0);
  float hn = uTopFrac;
  // Cumulus: body up to 45-100 % of the nominal layer depth by type, a broad tower above it in the core.
  float bodyTop = hn * mix(0.45, 1.0, type);
  float towerTop = mix(bodyTop, 1.0, smoothstep(0.55, 1.0, type));
  float cap = bodyTop * sqrt(smoothstep(0.0, 0.5, sh)) + (towerTop - bodyTop) * smoothstep(0.3, 0.9, sh);
  // Steep, billowed sides up to that cap from the sharp outline: the tops are broad and flattish domes that
  // the shape noise heaps into turrets, never cones.
  float cu = min(cap, hn * (0.05 + 3.0 * s));
  // Stratocumulus deck: 30-55 % of the nominal depth, lumpy with the cell strength (stratus and nimbostratus
  // fill more of it: uCloudShape.x).
  float sc = hn * (0.3 + 0.25 * sh) * smoothstep(0.0, 0.2, s) * uCloudShape.x;
  float top = mix(cu, sc, deck);
  // The lateral mask ramps in from the outline: quickly for small clouds (compact puffs, not the spiky
  // noise peaks a weak coverage would leave), over a wider margin for big ones, whose flanks the shape
  // noise then carves into bulging towers rather than extruded walls.
  vec3 wt = vec3(smoothstep(0.0, mix(0.35, 0.7, sh), s), max(top, 0.0), 0.0);
  if (uStormClearCount > 0) wt.x *= stormClearing(xz);
  return wt;
}

// The weather at a point in 3D: its horizontal position is displaced by a smooth vector field (the detail
// volume's swirl channels, ~1.9 km period, coarse mip) that changes with height, so the outline of a cloud
// leans and bulges from base to top (by up to ~220 m) instead of being extruded straight up: without it the
// flanks are vertical walls that read as smooth shelves and cliffs, most of all in a zoomed view.
//
// z: lift of the local cloud base above the layer base (fraction of the layer). A deck's base is flat but
// not a plane: it undulates by some tens of metres over a few km (the warp field's third channel, ~1.9 km
// period); cumulus bases sit on the condensation level and stay within a few metres of it. A ragged deck
// (nimbostratus, uCloudShape.y) undulates up to three times as deep.
vec3 cloudWeather(vec3 p, float lod) {
  vec3 warp = textureLod(uWarpTex, (p + uShapeOffset) * (DETAIL_FREQ * 0.25), 0.0).rgb * 2.0 - 1.0;
  float h = clamp((p.y - uLayer.x) * uLayer.z, 0.0, 1.0);
  vec3 wt = cloudWeather(p.xz + warp.xy * (350.0 * mix(0.3, 1.0, smoothstep(0.0, 0.25, h))), lod);
  wt.z = mix(0.003, 0.022, deckness()) * mix(1.0, 3.0, uCloudShape.y) * clamp(warp.z + 0.5, 0.0, 1.5);
  return wt;
}

// Vertical coverage profile: a flat base on the condensation level (a sharp ~15 m ramp), full coverage up
// the lower part of the cloud (steep sides), then rounded shoulders falling to zero at the local top (a
// parabola, not a cone): the shape noise turns them into billowed, cauliflower tops.
float heightProfile(float h, vec3 wt) {
  h -= wt.z;
  // The base curves up toward the cloud's outline (by up to ~100 m), so the flat base turns into the flanks
  // through a rounded, ragged shoulder instead of a sharp edge between a flat underside and a vertical wall.
  float rim = 1.0 - wt.x;
  float base = 0.006 + 0.03 * rim * rim;
  float bottom = smoothstep(base, base + 0.03, h);
  float x = clamp((h - 0.1 * wt.y) / (0.9 * wt.y + 0.01), 0.0, 1.0);
  return bottom * (1.0 - x * x);
}

// Signed margin of the shape noise above the coverage threshold (> 0 inside the cloud). The noise is levelled
// to [0, 1]; lifting its floor keeps full-coverage cores solid so the noise mainly shapes the edges, as with
// the naturally high-valued Perlin-Worley of Nubis.
//
// A closing deck samples the shape noise at up to a third of its frequency: stratocumulus cells are 1-3 km
// across (the deck is a few hundred metres thick), and the ~400 m billows of cumulus would quilt its
// underside like altocumulus. The cloud type scales the frequency further (uCloudType.w: stratus cells tens of
// km across, a near-uniform sheet).
float shapeMargin(vec3 p, float cov, float lod) {
  float f = SHAPE_FREQ * mix(1.0, 0.3, deckness()) * uCloudType.w;
  return mix(0.1, 1.0, textureLod(uShapeTex, (p + uShapeOffset) * f, lod).r) - (1.0 - cov);
}

// Mottling of a cloud base, 0..1: pockets of ~150-300 m (shape volume) and ~50-100 m (detail volume), each in
// its own rotated, incommensurate tiling (a single tiling volume repeats every few hundred metres, which under
// a uniform deck shows as a lattice and at grazing angles as radial moire streaks). High values hang lower
// (cloudDensity) and are darker (the march): real bases are flat but lumpy, with darker pockets under the
// thicker parts. lod / dlod: mip levels of the shape / detail volume at their native scales.
// The field is 2D (one horizontal slice of each volume): the pockets are columns, darker where the cloud
// above is thicker. Sliced at the sample's altitude, a ray grazing the base crossed the volume's iso-surfaces
// and showed them as stacked, wavy contour lines ("ripples") across every distant base.
float baseMottleCoarse(vec3 p, float lod) {
  vec3 q = p + uShapeOffset;   // drifts with the cells
  vec3 qa = vec3(q.x * 0.825 + q.z * 0.565, 0.37 * 1170.0, q.z * 0.825 - q.x * 0.565) * (1.0 / 1170.0);
  return textureLod(uShapeTex, qa, clamp(lod + 0.36, 0.0, 4.0)).r;
}
float baseMottle(vec3 p, float lod, float dlod) {
  vec3 q = p + uShapeOffset;
  vec3 qb = vec3(q.x * 0.454 - q.z * 0.891, 0.61 * 370.0, q.z * 0.454 + q.x * 0.891) * (1.0 / 370.0);
  float mb = textureLod(uDetailTex, qb, clamp(dlod + 0.37, 0.0, 4.0)).r;
  return smoothstep(0.05, 0.95, 0.5 * baseMottleCoarse(p, lod) + 0.5 * mb);
}

// The flat base turns up into the flanks through a rounded shoulder (~140 m high, ~100 m of margin): without
// it the base meets the walls at a sharp edge that reads as a carved block seen from below.
float baseRounding(float h) {
  float x = 1.0 - smoothstep(0.0, 0.08, h);
  return 0.5 * x * x;
}

// The soft margin is widest at the base (diffuse, ragged bases) and a little narrower on the tops, where the
// billows are firmer.
//
// On the tops the band is thin (~10 m: the cauliflower turrets of a growing cumulus are crisp close up). The
// view march widens it to about two pixel footprints (gEdgeMin, margin units), which prefilters the edge: a
// distant silhouette is antialiased instead of hard-cut, a near one stays sharp.
float gEdgeMin = 0.0;
float edgeBand(float hr) { return max(EDGE_BAND * mix(1.2, 0.25, smoothstep(0.05, 0.6, hr)), gEdgeMin); }

// Density from the eroded margin m: a soft, wide rise (smoothstep, then a power, so rims and wisps stay thin),
// times a core gradient on the un-eroded margin m0 (denser deeper inside the shape). Thin, translucent edges,
// dense cores: the internal variation gives the light its structure (bright rims against the sun, soft
// shading elsewhere). The core gradient does not depend on the erosion, so wherever the erosion cannot reach
// the edge band the density is independent of the detail noise (cloudDensity skips it there).
// Outside the boundary (m in (-FRINGE, 0]) the faint fringe. The density without the fringe is left in
// gCoreDensity: the view march locates cloud surfaces on it (the fringe is too thin to need that).
float gCoreDensity = 0.0;
float marginDensity(float m, float m0, float band) {
  float x = clamp(m / band, 0.0, 1.0);
  float d = x * x * (3.0 - 2.0 * x);
  float f = clamp(1.0 + m / FRINGE, 0.0, 1.0);
  gCoreDensity = d * sqrt(d) * mix(0.3, 1.0, smoothstep(0.1, 0.75, m0));
  // The fringe belongs to the cloud's outer boundary (low un-eroded margin m0), not to the creases the erosion
  // cuts between lobes deeper in, which it would fill with haze (soft, washed-out cauliflower).
  return gCoreDensity + FRINGE_DENSITY * f * f * (1.0 - x) * (1.0 - smoothstep(0.0, 0.2, m0));
}

// Isolated noise peaks in the thin outer margin of a cell (where the coverage is low) leave small detached
// blobs floating around a cloud like confetti. The shape margin blurred over ~100 m (coarse mip) is low around
// such a peak and high next to the cloud body: pull the margin down where it is low.
float isolation(vec3 p, float cov, float lod) {
  if (cov > 0.75) return 0.0;
  float mb = mix(0.1, 1.0, textureLod(uShapeTex, (p + uShapeOffset) * (SHAPE_FREQ * mix(1.0, 0.3, deckness()) * uCloudType.w), lod + 3.0).r) - (1.0 - cov);
  return 0.5 * (1.0 - smoothstep(-0.12, 0.06, mb));
}

// Liquid water grows with height above the base (adiabatic ascent): bases are thinner and softer than the
// dense, bright tops.
float waterProfile(float hr) { return mix(0.55, 1.3, smoothstep(0.0, 0.75, hr)); }

// Density scale from coverage: clouds reach full density just inside their boundary. (Scaling linearly
// by coverage, as Nubis does, turns every cloud top into a translucent haze that grazing rays integrate
// into foam-like sheets.)
float coverageDensity(float cov) { return smoothstep(0.0, 0.3, cov); }

// Height within the local cloud (0 base, 1 local top).
float relHeight(float h, vec3 wt) { return clamp(h / max(wt.y, 0.02), 0.0, 1.0); }

// Erosion depth: deeper high up (turbulent, billowing tops) and where the coverage thins (dissipating
// margins, small clouds: ragged and wispy). Scaled by the cloud type (uCloudShape.z: a smooth stratus sheet).
float erosionDepth(float hr, float cov) {
  return DETAIL_EROSION * mix(0.85, 1.0, smoothstep(0.1, 0.7, hr)) * mix(1.7, 1.0, smoothstep(0.15, 0.75, cov)) * uCloudShape.z;
}

// A deck keeps its erosion (the cells) on its top: the lower part stays solid, with a flat base, and its
// underside shows soft undulations instead of holes and blotches.
float deckErosion(float hr) { return mix(1.0, mix(0.25, 1.0, smoothstep(0.35, 0.9, hr)), deckness()); }

// Coarse density (the mean detail erosion) for light and shadow rays.
float cloudShape(vec3 p, float h, vec3 wt, float lod) {
  float cov = wt.x * heightProfile(h, wt);
  if (cov < 0.01) return 0.0;
  h -= wt.z;
  float hr = relHeight(h, wt);
  float m0 = shapeMargin(p, cov, lod) - baseRounding(h) * (1.0 - 0.85 * deckness()) - isolation(p, cov, lod);
  float m = m0 - erosionDepth(hr, cov) * 0.5 * deckErosion(hr);
  if (m <= 0.0) return 0.0;
  return marginDensity(m, m0, edgeBand(hr)) * coverageDensity(cov) * waterProfile(hr);
}

// Full density: the shape margin is carved by the detail noise (up to DETAIL_EROSION deep, ~100 m) before the
// soft edge ramp is applied, so the erosion bites into the shape instead of only wrinkling its skin. Above the
// base the erosion follows the inverted Worley fBm: it cuts creases and keeps packed, rounded lobes, so the
// boundary becomes a cauliflower of lobes at two scales (160-40 m, and 40-10 m turrets for nearby clouds);
// at the base it follows the plain fBm, which frays it into wisps (Schneider 2017). The erosion grows with
// height and where the coverage is thin (small, dissipating clouds are ragged). Its domain is swirled by a
// smooth vector field so billows curl over each other and the base is mottled rather than streaked. The
// eroded margin then rises softly to full density (marginDensity): translucent rims, dense cores.
// lod / dlod: mip levels of the shape and detail volumes. fineWeight (0..1) adds the finer octave; warpWeight
// (0..1) scales the swirl.
float cloudDensity(vec3 p, float h, vec3 wt, float lod, float dlod, float detailWeight, float fineWeight, float warpWeight) {
  gCoreDensity = 0.0;
  float cov = wt.x * heightProfile(h, wt);
  if (cov < 0.01) return 0.0;
  h -= wt.z;
  float deck = deckness();
  float margin = shapeMargin(p, cov, lod) - baseRounding(h) * (1.0 - 0.85 * deck) - isolation(p, cov, lod);
  if (margin <= -FRINGE) return 0.0;
  float hr = relHeight(h, wt);
  float band = edgeBand(hr);
  float depth = erosionDepth(hr, cov) * deckErosion(hr);
  float m0 = margin;
  float erosion = 0.5;
  // Deeper than the erosion can reach (plus, near the base, the base lumps and the deeper fraying), the
  // density no longer depends on the detail: the detail fetches are skipped in the cores.
  float reach = depth + band + (h < 0.08 ? 0.25 + 0.3 * depth : 0.0);
  if (margin < reach && detailWeight > 0.0) {
    // The lowest ~40 m; a ragged deck (uCloudShape.y) keeps the fraying under the deck.
    float wispy = (1.0 - smoothstep(0.0, 0.025, h)) * max(1.0 - deck, uCloudShape.y);
    // Small clouds (and the low outer margins of big ones) fray into ragged fragments rather than staying
    // smooth pills: real humilis and dissipating edges are wispy, only the growing turrets are cauliflower.
    float ragged = max(wispy, 0.3 * (1.0 - smoothstep(0.06, 0.28, wt.y)));
    vec3 q = p + uDetailOffset;
    if (warpWeight > 0.0) q += (textureLod(uWarpTex, q * (DETAIL_FREQ * 0.5), dlod).rgb * 2.0 - 1.0) * (mix(45.0, 90.0, wispy) * warpWeight);
    // Two scales of Worley fBm: 160 / 80 / 40 m lobes and, for clouds seen at a footprint of a few tens of
    // metres or less, 40 / 20 / 10 m turrets and wisps on them.
    float dn = textureLod(uDetailTex, q * DETAIL_FREQ, dlod).r;
    // The finer octaves move with the detail (fixed offsets decorrelate them from it): drifting faster on their
    // own, their small structures swept past a nearby viewer at metres per second, a churn the temporal filter
    // could not follow (grain inside cloud).
    if (fineWeight > 0.0) dn = mix(dn, dn * 0.6 + 0.4 * textureLod(uDetailTex, (q + vec3(37.0, 11.0, 73.0)) * FINE_FREQ, dlod + 1.0).r, fineWeight);
    if (gMicroWeight > 0.0) dn = mix(dn, dn * 0.7 + 0.3 * textureLod(uDetailTex, (q.zxy + vec3(5.0, 23.0, 13.0)) * MICRO_FREQ, gMicroLod).r, gMicroWeight);
    // Contrast: the levelled fBm sits mostly mid-range; stretching it sharpens the creases between lobes.
    dn = smoothstep(0.1, 0.9, dn);
    // Billowy above the base: the inverted fBm erodes the creases between round lobes (cauliflower); wispy
    // at the base: the plain fBm frays it (Schneider 2017).
    // The wispy erosion uses an independent sample of the fBm (a blend of the inverted and plain field at
    // the same point would cancel to a constant); far away (footprint over ~30 m) the plain field stands in.
    float dw = dn;
    if (ragged > 0.01 && dlod < 2.0) dw = smoothstep(0.1, 0.9, textureLod(uDetailTex, q * (DETAIL_FREQ * 1.37) + vec3(0.31, 0.17, 0.53), dlod).r);
    erosion = mix(0.5, mix(1.0 - dn, dw, ragged), detailWeight);
    // The base is not a plane: rounded pendant lumps and pockets some tens of metres deep (baseMottle, smooth
    // and blobby, not the creases of the erosion, which read as marbled squiggles across a base seen from
    // below), shallower under a deck.
    // (View samples only, warpWeight > 0: the light march does not resolve them, and they would double its cost
    // under every base. The ~150-300 m pockets suffice for the geometry.)
    if (h < 0.08 && warpWeight > 0.0) {
      float bm = smoothstep(0.2, 0.8, baseMottleCoarse(p, lod));
      margin -= (1.0 - smoothstep(-0.01, 0.05, h - (0.004 + mix(0.04, 0.015, deck) * (1.0 - bm)))) * 0.25 * detailWeight;
    }
  }
  // The frayed base erodes deeper still (ragged, wispy undersides and rims).
  margin -= depth * erosion * (1.0 + 0.3 * (1.0 - smoothstep(0.0, 0.025, h)) * detailWeight);
  if (margin <= -FRINGE) return 0.0;
  float k = coverageDensity(cov) * waterProfile(hr);
  float dens = marginDensity(margin, m0, band) * k;
  gCoreDensity *= k;
  return dens;
}

// Diffuse transmission of a plane-parallel slab (two-stream approximation, Bohren 1987) with g = 0.85.
// Stands in for the light that reaches deep inside a cloud after many scattering events.
float diffuseTransmission(float tau) { return 1.0 / (1.0 + 0.75 * tau * (1.0 - 0.85)); }
`;

/**
 * The mid-level sheet's uniforms and its mean transmission, for the view march (marchShader.ts). GLSL twin of
 * render/sky/cloudSky.ts midSheetTransmission (the same two-stream slab, g = 0.85).
 */
export const MID_SHEET_GLSL = /* glsl */ `
uniform vec4 uMid;            // mid-level sheet: cover 0..1 (0 = none, or not above uLayer.y), altitude m MSL, kind (0 As, 1 Ac), tau at full cover
uniform vec2 uMidOffset;      // drift in the sheet's frame (x along the upper wind), m
const float MID_TAU_MIN = ${MID_TAU_MIN.toFixed(3)};
// Mean optical depth of the sheet inside its patches (midSheetTau).
float midTau() { return mix(MID_TAU_MIN, uMid.w, uMid.x); }
// Transmission of the sheet averaged over its patches for a beam at cos zenith mu0: x = the direct beam, y = direct
// plus diffusely transmitted light.
vec2 midTransmission(float mu0) {
  float tau = midTau();
  float direct = exp(-tau / max(mu0, 0.05));
  float total = min(1.0, (2.0 + 3.0 * mu0) / (4.0 + 0.45 * tau));
  return vec2(1.0 - uMid.x * (1.0 - direct), 1.0 - uMid.x * (1.0 - total));
}
`;

/** Vertical density slice for CloudsEffect.renderDensitySlice (development aid). */
export const SLICE_FRAG = /* glsl */ `
${CLOUD_MODEL_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform vec2 uSliceOrigin;
uniform vec2 uSliceDir;
uniform float uSliceLength;
uniform float uSliceMode;   // green channel: 0 coarse shape, 1 raw shape noise, 2 raw detail noise
void main() {
  vec2 xz = uSliceOrigin + uSliceDir * (vUv.x * uSliceLength);
  float h = vUv.y;
  vec3 p = vec3(xz.x, mix(uLayer.x, uLayer.y, h), xz.y);
  vec3 wt = cloudWeather(p, 0.0);
  float n = textureLod(uShapeTex, (p + uShapeOffset) * SHAPE_FREQ, 0.0).r;
  float dn = textureLod(uDetailTex, (p + uDetailOffset) * DETAIL_FREQ, 0.0).r;
  outColor = vec4(cloudDensity(p, h, wt, 0.0, 0.0, 1.0, 1.0, 1.0), uSliceMode > 0.5 ? (uSliceMode > 2.5 ? wt.x : uSliceMode > 1.5 ? dn : n) : cloudShape(p, h, wt, 0.0), wt.x * 0.5 + 0.5 * step(h, wt.y), 1.0);
}
`;

export interface CloudModelUniforms {
  [name: string]: THREE.IUniform;
  uShapeTex: THREE.IUniform<THREE.Texture | null>;
  uDetailTex: THREE.IUniform<THREE.Texture | null>;
  uWarpTex: THREE.IUniform<THREE.Texture | null>;
  uWeatherTex: THREE.IUniform<THREE.Texture | null>;
  uCirrusTex: THREE.IUniform<THREE.Texture | null>;
  uLayer: THREE.IUniform<THREE.Vector4>;
  uShapeOffset: THREE.IUniform<THREE.Vector3>;
  uDetailOffset: THREE.IUniform<THREE.Vector3>;
  uWeatherOffset: THREE.IUniform<THREE.Vector4>;
  uEvolve: THREE.IUniform<THREE.Vector2>;
  uCoverage: THREE.IUniform<THREE.Vector2>;
  uExtinction: THREE.IUniform<number>;
  uInvTwoR: THREE.IUniform<number>;
  uTopFrac: THREE.IUniform<number>;
  /** Cloud type profile (CLOUD_TYPE_PROFILES): deck override, deck weight, extinction scale (not read in GLSL: uExtinction carries it), shape frequency scale. */
  uCloudType: THREE.IUniform<THREE.Vector4>;
  /** Cloud type shape terms (CLOUD_TYPE_SHAPE): deck top scale, base raggedness, erosion scale, type bias. */
  uCloudShape: THREE.IUniform<THREE.Vector4>;
  /** Mid-level sheet: cover 0..1 (0 = none, or not above the extended layer top), altitude m MSL, kind (0 altostratus, 1 altocumulus), MID_TAU_MAX of the kind. */
  uMid: THREE.IUniform<THREE.Vector4>;
  /** Drift of the mid-level sheet in its own frame (as cirrusOffset: x along the upper wind), m. */
  uMidOffset: THREE.IUniform<THREE.Vector2>;
  /** Storm cells clearing the cumulus: centre x, z (three.js world), drawn core radius, core share; MAX_STORMS entries. */
  uStormClear: THREE.IUniform<THREE.Vector4[]>;
  /** Number of uStormClear entries in use (0: no clearing). */
  uStormClearCount: THREE.IUniform<number>;
}

/** Owns the uniforms of the cloud field and advances wind drift and evolution each frame. */
export class CloudModel {
  readonly uniforms: CloudModelUniforms;
  /**
   * Accumulated drifts (three.js world x, z), each wrapped to a period its texture tiles with, so wrapping
   * never shows. Sampling at (p + offset) with offset = -displacement moves a pattern downwind.
   */
  private readonly shapeDrift = new THREE.Vector2();
  private readonly detailDrift = new THREE.Vector2();
  private readonly fieldDrift = new THREE.Vector2();
  /**
   * Drift of the cirrus deck (upper-level wind), for the march pass, in the deck's own frame: x along the
   * wind (the fibre axis), y across it. Only x moves, wrapped to CIRRUS_PERIOD, which every cirrus
   * texture period divides.
   */
  readonly cirrusOffset = new THREE.Vector2();
  /** Unit vector (three.js x, z) of the upper wind: the cirrus fibres are stretched along it. */
  readonly cirrusAxis = new THREE.Vector2(1, 0);
  /** How far the wind carried the clouds in the last update, m (three.js world; y = 0): for reprojection. */
  readonly drift = new THREE.Vector3();
  /** The mid-level sheet of the last update (midLayerOf). */
  readonly mid: MidLayer = { cover: 0, type: 'altostratus', altM: 0 };
  /** Whether the sheet of the last update has cover and lies above the extended layer top (extendedLayerTopM). */
  midAboveLayer = false;

  constructor() {
    this.uniforms = {
      uShapeTex: { value: null },
      uDetailTex: { value: null },
      uWarpTex: { value: null },
      uWeatherTex: { value: null },
      uCirrusTex: { value: null },
      uLayer: { value: new THREE.Vector4() },
      uShapeOffset: { value: new THREE.Vector3() },
      uDetailOffset: { value: new THREE.Vector3() },
      uWeatherOffset: { value: new THREE.Vector4() },
      uEvolve: { value: evolveWeights(0.5, new THREE.Vector2()) },
      uCoverage: { value: new THREE.Vector2(1, 0) },
      uExtinction: { value: EXTINCTION },
      uInvTwoR: { value: 1 / (2 * EARTH_RADIUS) },
      uTopFrac: { value: 1 / TOWER_EXTENSION },
      uCloudType: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCloudShape: { value: new THREE.Vector4(1, 0, 1, 0) },
      uMid: { value: new THREE.Vector4() },
      uMidOffset: { value: new THREE.Vector2() },
      uStormClear: { value: Array.from({ length: MAX_STORMS }, () => new THREE.Vector4()) },
      uStormClearCount: { value: 0 },
    };
  }

  setTextures(noise: CloudNoiseTextures): void {
    this.uniforms.uShapeTex.value = noise.shape;
    this.uniforms.uDetailTex.value = noise.detail;
    this.uniforms.uWarpTex.value = noise.warp;
    this.uniforms.uWeatherTex.value = noise.weather;
    this.uniforms.uCirrusTex.value = noise.cirrus;
  }

  update(ctx: SimContext, dt: number): void {
    const w = ctx.weather;
    const base = Math.min(w.cloudBaseM, w.cloudTopM - 100);
    const nominalTop = Math.max(w.cloudTopM, base + 100);
    // The 'auto' profile's towerExt is TOWER_EXTENSION and its scales are 1: the uniforms of the cover-driven look.
    const type = cloudTypeOf(w);
    const profile = CLOUD_TYPE_PROFILES[type];
    const shape = CLOUD_TYPE_SHAPE[type];
    const activity = layerActivity(w);
    const towerExt = layerTowerExt(type, activity);
    const top = base + (nominalTop - base) * towerExt;
    const cover = THREE.MathUtils.clamp(w.cloudCover, 0, 1);
    this.uniforms.uLayer.value.set(base, top, 1 / (top - base), cover);
    coverageParams(cover, this.uniforms.uCoverage.value);
    this.uniforms.uTopFrac.value = 1 / towerExt;
    this.uniforms.uExtinction.value = EXTINCTION * profile.extinctionScale;
    this.uniforms.uCloudType.value.set(profile.deckOverride, profile.deckWeight, profile.extinctionScale, profile.shapeFreqScale);
    this.uniforms.uCloudShape.value.set(shape.deckTopScale, shape.baseRagged, shape.erosionScale, layerTypeBias(type, activity));
    this.updateStormClearing(ctx);
    const mid = midLayerOf(w, this.mid);
    // A sheet at or below the extended top is not drawn (cover 0 in uMid), so the march and the shadow map agree.
    this.midAboveLayer = mid.cover > 0 && mid.altM > top;
    this.uniforms.uMid.value.set(this.midAboveLayer ? mid.cover : 0, mid.altM, mid.type === 'altocumulus' ? 1 : 0, MID_TAU_MAX[mid.type]);

    // Wind blows FROM windDirectionDeg; the air moves toward the opposite heading. NED (n, e) -> three (x = e, z = -n).
    const speed = w.windSpeedKt * KT * CLOUD_WIND_FACTOR;
    const from = THREE.MathUtils.degToRad(w.windDirectionDeg);
    const vx = -Math.sin(from) * speed;
    const vz = Math.cos(from) * speed;
    advect(this.shapeDrift, vx, vz, dt, WEATHER_PERIOD);
    this.drift.set(vx * dt, 0, vz * dt);
    // Detail noise moves a little faster than the cells so their edges boil while the cells hold their shape.
    // Gently (6 %, and 0.3 m/s of rise): close up the churn reads as fast motion that the temporal filter
    // cannot follow (it reprojects with the cells' drift), which left the clouds grainy when flying through.
    advect(this.detailDrift, vx * 1.06, vz * 1.06, dt, WEATHER_PERIOD);
    // The second coverage field drifts slightly off-wind so the cross-fade between fields never repeats.
    advect(this.fieldDrift, vx * 0.9 + 0.35, vz * 0.9 - 0.2, dt, WEATHER_PERIOD);
    this.cirrusAxis.set(-Math.sin(from), Math.cos(from));
    this.cirrusOffset.set(wrap(this.cirrusOffset.x - speed * CIRRUS_WIND_FACTOR * dt, CIRRUS_PERIOD), 0);
    // The mid-level sheet drifts along the same axis (its textures tile with CIRRUS_PERIOD too).
    const mo = this.uniforms.uMidOffset.value;
    mo.set(wrap(mo.x - speed * MID_WIND_FACTOR * dt, CIRRUS_PERIOD), 0);

    const t = ctx.simTime;
    const u = this.uniforms;
    u.uShapeOffset.value.set(this.shapeDrift.x, 0, this.shapeDrift.y);
    u.uDetailOffset.value.set(this.detailDrift.x, wrap(-t * 0.3, DETAIL_PERIOD), this.detailDrift.y);
    u.uWeatherOffset.value.set(
      this.shapeDrift.x + WEATHER_PHASE[0],
      this.shapeDrift.y + WEATHER_PHASE[1],
      this.fieldDrift.x + WEATHER_PHASE[0],
      this.fieldDrift.y + WEATHER_PHASE[1],
    );
    evolveWeights(0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / EVOLVE_PERIOD), u.uEvolve.value);
  }

  /** The storm cells of the frame (cameraStormsAt) with a core share, at ctx.simTime, into uStormClear. */
  private updateStormClearing(ctx: SimContext): void {
    const cells = cameraStormsAt(ctx);
    const out = this.uniforms.uStormClear.value;
    let n = 0;
    for (let i = 0; i < Math.min(cells.length, MAX_STORMS); i++) {
      const core = stormShare(cells[i], 'core');
      if (!(core > 0)) continue;
      stormCentreAt(cells[i], ctx.simTime, _ne);
      out[n++].set(_ne.east, -_ne.north, drawnCoreRadiusM(cells[i]), core);
    }
    this.uniforms.uStormClearCount.value = n;
  }
}

const _ne: NorthEast = { north: 0, east: 0 };

/** Move a drift offset by -velocity * dt (see the field comment), wrapped to period. */
function advect(offset: THREE.Vector2, vx: number, vz: number, dt: number, period: number): void {
  offset.set(wrap(offset.x - vx * dt, period), wrap(offset.y - vz * dt, period));
}

function wrap(v: number, period: number): number {
  return v - Math.floor(v / period) * period;
}
