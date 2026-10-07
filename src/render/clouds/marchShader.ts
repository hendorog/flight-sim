// Low-resolution ray march of the cloud layer and the cirrus deck.
//
// Outputs (MRT, half float):
//   0: rgb = in-scattered radiance (already hazed), a = transmittance
//   1: r = log2(1 + cloud front distance), g = log2(1 + scene distance) the ray was clipped to
// The log encoding keeps metre-to-100-km distances within half-float precision (~0.1 %).
//
// Lighting (Hillaire, "Physically based sky, atmosphere and cloud rendering in Frostbite", 2016):
//   - energy-conserving analytic integration of each step
//   - sunlight: light march toward the sun, dual-lobe Henyey-Greenstein phase, Wrenninge-style
//     multiple-scattering octaves, Schneider's "powder" darkening of low-density regions seen away
//     from the sun
//   - sky ambient from above, ground bounce from below and diffusely transmitted sunlight, each
//     attenuated by a two-stream estimate of the cloud above/below the sample

import { DEPTH_GLSL } from '../../core/shaderLib';
import { BLUE_NOISE_SIZE } from './blueNoise';
import { ATMOSPHERE_GLSL, SKY_SAMPLING_GLSL } from '../sky/glsl/atmosphere';
import { AERIAL_ATLAS_GLSL } from '../post/AerialPerspectiveEffect';
import { CLOUD_MODEL_GLSL } from './cloudModel';
import { CLOUD_SHADOW_GLSL } from './cloudShadow';

export const MARCH_FRAG = /* glsl */ `
${DEPTH_GLSL}
${CLOUD_MODEL_GLSL}
${CLOUD_SHADOW_GLSL}
${AERIAL_ATLAS_GLSL}
#ifdef CLOUDS_ATMOSPHERE
${ATMOSPHERE_GLSL}
${SKY_SAMPLING_GLSL}
#endif

in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;

uniform sampler2D uDepth;
uniform sampler2D uScene;       // the frame so far (after the aerial perspective): the background
uniform vec2 uFullSize;
uniform vec2 uLowSize;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;

uniform sampler2D uBlueNoise;
uniform float uJitter;          // per-frame golden-ratio offset added to the blue noise
uniform vec2 uPixelJitter;      // per-frame sub-pixel ray offset (Halton 2,3), low-res pixels
uniform float uPixelAngle;      // angular size of a low-res pixel, rad

uniform vec3 uLightDir;
uniform vec3 uLightColor;       // key light (sun or moon) at the camera
uniform float uSunByAltitude;   // 1: the key light is the sun; evaluate it at each sample's altitude
uniform vec3 uSkyColor;
uniform vec3 uGroundRadiance;
uniform vec3 uHazeColor;
uniform vec2 uHaze;             // sea-level extinction 1/m, scale height m
uniform float uAerialOn;        // 1: haze from the shared aerial-perspective volume (Atmosphere.aerial), 0: exponential haze

uniform int uMaxSteps;
uniform int uLightSteps;
uniform int uLightDetailSteps;  // light-march steps (from the first) that include the detail erosion
uniform float uMinStep;
uniform float uMaxDist;
uniform float uDetailDist;      // beyond this distance detail erosion fades out (60 degree field of view)
uniform float uDetailScale;     // 1 / (angular size of a low-res pixel at a 60 degree field of view)

uniform vec2 uCirrus;           // cirrus cover 0..1, altitude m
uniform vec2 uCirrusOffset;    // drift in the deck frame (x along the wind)
uniform vec2 uCirrusAxis;      // upper-wind unit vector (world x, z)

// Diffusely transmitted sunlight reaching a sample through optical depth tau toward the light. The two-stream
// slab result (diffuseTransmission, g = 0.85) overestimates it for a finite cloud: in a cumulus the diffusing
// light also leaks out through the sides (Davis & Marshak 2010 "3D radiative transfer in cloudy atmospheres":
// the shadowed flank of an isolated cloud is several times darker than a slab of the same optical depth).
// An effective asymmetry of 0.6 gives the shaded flanks their 5-8x contrast against the sunlit side.

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Strong forward lobe (silver lining when looking toward the sun) plus a weak back lobe.
float cloudPhase(float c, float k) {
  return mix(hg(c, 0.8 * k), hg(c, -0.25 * k), 0.35);
}

// Interval of t over which the ray is below altitude H on the curved earth:
// alt(t) = camY + dy t + k t^2, with k = horizontal length^2 / 2R. Returns (1, 0) when empty.
vec2 belowInterval(float H, float camY, float dy, float k) {
  float c = camY - H;
  if (k < 1e-14) {
    if (abs(dy) < 1e-9) return c < 0.0 ? vec2(-1e9, 1e9) : vec2(1.0, 0.0);
    float r = -c / dy;
    return dy > 0.0 ? vec2(-1e9, r) : vec2(r, 1e9);
  }
  float disc = dy * dy - 4.0 * k * c;
  if (disc < 0.0) return vec2(1.0, 0.0);
  float s = sqrt(disc);
  float q = -0.5 * (dy + (dy >= 0.0 ? s : -s));
  q = abs(q) < 1e-12 ? 1e-12 : q;
  float r1 = q / k, r2 = c / q;
  return vec2(min(r1, r2), max(r1, r2));
}

// Optical depth of the altitude-dependent haze between the camera and a point dist away along the ray.
float hazeDepth(float dist, float y0, float y1) {
  float H = uHaze.y;
  float dh = y1 - y0;
  float avg = abs(dh) < 1.0 ? exp(-y0 / H) : H * (exp(-y0 / H) - exp(-y1 / H)) / dh;
  return uHaze.x * dist * avg;
}

// Haze between the camera and a point dist along the ray at altitude yEnd: rgb = in-scattered radiance,
// a = transmittance. Uses the same atmosphere integration as the terrain's aerial perspective when available.
//
// Behind opaque haze an object must look exactly like the sky (or fogged terrain) around it, or clouds hidden
// by fog still show as silhouettes. The aerial volume's slices are coarse near the camera and, below a cloud
// layer, the sky dome and the aerial perspective light the air differently from the volume; so as the haze in
// front of a cloud closes up, its in-scattering blends from the volume's value toward what the frame shows
// behind the cloud, times the haze opacity: (1 - T)^2 keeps the volume (and its accurate sunset colours) for
// clear-air distant clouds and gives the background in fog.
//
// Below the 5 % contrast threshold (the visibility distance) the remaining transmittance fades to zero, so a
// cloud deep in fog leaves no trace at all (it otherwise kept ~3 % of its radiance, visible as faint shapes).
float fogCut(float Th) { return Th * smoothstep(0.004, 0.05, Th); }
vec4 hazeAlong(vec2 uv, float dist, float yEnd, vec3 behind) {
  if (uAerialOn > 0.5) {
    vec4 ap = aerialPerspective(uv, dist);
    float Th = fogCut(ap.a);
    float o = 1.0 - Th;
    return vec4(mix(ap.rgb, behind * o, o * o), Th);
  }
  float Th = fogCut(exp(-hazeDepth(dist, uCamPos.y, yEnd)));
  return vec4(uHazeColor * (1.0 - Th), Th);
}

// Direct sunlight at an altitude (m): the atmosphere's transmittance and the planet's shadow there, so the
// cloud tops stay lit, reddened, after the sun has set at the camera (and bases darken first).
#ifdef CLOUDS_ATMOSPHERE
uniform vec3 uSunE;
vec3 sunAt(float altM) {
  float r = uRb + max(altM, 1.0) * 0.001;
  return uSunE * transmittanceToTop(r, uLightDir.y) * planetShadow(r, uLightDir.y);
}
#endif

// Radiance of the background behind the clouds toward dir: the frame's own sky (or distant terrain) as the
// sky dome and the aerial perspective drew it, capped by the clear-sky dome so the sun disc does not shine
// through a fogged-out cloud.
vec3 behindRadiance(vec3 dir, vec2 uv) {
#ifdef CLOUDS_ATMOSPHERE
  vec3 dome = skyViewRadiance(dir).rgb;
  return min(textureLod(uScene, uv, 0.0).rgb, dome * 1.5);
#else
  return vec3(0.0);
#endif
}

// Multiple-scattering octaves: weight and extinction multiplier (the phase flattens by half per octave).
const float MS1_W = 0.45, MS1_K = 0.4;
const float MS2_W = 0.2, MS2_K = 0.1;
// MS_ISO: the high orders of scattering, falling off as 1 / (1 + K tau). They diffuse with the transport optical
// depth tau (1 - g), so a sunlit face is lit from tens of metres deep and reflects ~E / 4 like a white Lambertian
// surface, brighter than the white wing. The slab value K = 0.75 (1 - g) = 0.11 (g = 0.85) flattens the
// lobes' self-shading; K = 0.5 with a larger weight keeps their relief. (The earlier 0.2 / (1 + 0.9 tau) left the
// lit sides grey.)
const float MS_ISO = 0.3, MS_ISO_K = 0.5;
// Deep inside a finite cloud the diffusing light leaks out through the sides instead of reaching the far side
// (Davis & Marshak 2010): an exponential cut-off on top of the slab falloff, which keeps the shaded flanks of
// an isolated cumulus several times darker than its sunlit side.
const float MS_LEAK = 0.04;
// Sky and ground-bounce light reaching a sample through the cloud around it, relative to the incident radiance
// (multiple scattering evens it out over directions; slightly below 1 for the light lost out of the sides).
const float AMBIENT_SKY = 0.85;
const float AMBIENT_GROUND = 0.35;

// The view march stops once the transmittance falls below this: what lies behind adds under 2 % (and is
// mostly hidden by the remap to full opacity below).
const float T_STOP = 0.02;

// Fine steps (near cloud surfaces) relative to the coarse step.
const float FINE_FRACTION = 0.65;
// First step into a located cloud surface, m: about one optical depth of a dense core.
const float SKIN_STEP = 10.0;

// Number of steps ds = max(uMinStep, g t) needs to cover [t0, t1]: constant steps near the camera (so
// flying through cloud stays smooth), geometric further out.
float stepCount(float t0, float t1, float g) {
  float tg = clamp(uMinStep / g, t0, t1);
  return (tg - t0) / uMinStep + log(t1 / tg) / log(1.0 + g);
}

// Smallest growth rate that covers [t0, t1] within the step budget. Solved continuously (bisection in
// log g) so neighbouring pixels never jump between discrete step patterns.
float stepGrowth(float t0, float t1, float budget) {
  float lo = log(0.003), hi = log(0.4);
  if (stepCount(t0, t1, exp(lo)) <= budget) return exp(lo);
  for (int i = 0; i < 10; i++) {
    float mid = 0.5 * (lo + hi);
    if (stepCount(t0, t1, exp(mid)) > budget) lo = mid; else hi = mid;
  }
  return exp(hi);
}

vec3 rayDirView(vec2 uv) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(v.xyz / v.w);
}

// Scene distance of a low-res pixel: the farthest of four full-res taps across its footprint, so thin
// foreground edges never hide the clouds behind them (the composite pass handles the foreground side).
float sceneDistance(vec3 dirView) {
  vec2 scale = uFullSize / uLowSize;
  vec2 base = floor(vUv * uLowSize) * scale;
  float d = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i & 1), float(i >> 1)) * 0.5 + 0.25;
    ivec2 px = ivec2(min(base + o * scale, uFullSize - 1.0));
    d = max(d, texelFetch(uDepth, px, 0).r);
  }
  return isSky(d) ? 1e7 : viewZFromDepth(d) / max(-dirView.z, 1e-4);
}

void main() {
  // The ray is jittered across the pixel footprint every frame, so the temporal filter integrates the
  // whole footprint: without it, distant clouds and cirrus alias into scanlines at grazing angles.
  vec2 rayUv = vUv + uPixelJitter / uLowSize;
  vec3 dv = rayDirView(rayUv);
  vec3 dir = normalize(mat3(uCamWorld) * dv);
  float sceneDist = sceneDistance(dv);
  float tEnd = min(sceneDist, uMaxDist);

  float camY = uCamPos.y;
  float k = dot(dir.xz, dir.xz) * uInvTwoR;
  vec2 top = belowInterval(uLayer.y, camY, dir.y, k);
  vec2 bot = belowInterval(uLayer.x, camY, dir.y, k);
  // Layer = (below top) minus (below base): up to two segments, before and after the dip below the base.
  vec2 seg0, seg1;
  if (bot.x > bot.y) { seg0 = top; seg1 = vec2(1.0, 0.0); }
  else { seg0 = vec2(top.x, min(top.y, bot.x)); seg1 = vec2(max(top.x, bot.y), top.y); }
  seg0 = vec2(max(seg0.x, 0.0), min(seg0.y, tEnd));
  seg1 = vec2(max(seg1.x, 0.0), min(seg1.y, tEnd));
  if (uLayer.w <= 0.0) { seg0 = vec2(1.0, 0.0); seg1 = seg0; }   // cirrus only

  float noise = fract(texelFetch(uBlueNoise, ivec2(gl_FragCoord.xy) & ${BLUE_NOISE_SIZE - 1}, 0).r + uJitter);
  float cosTheta = dot(dir, uLightDir);
  float phase0 = cloudPhase(cosTheta, 1.0);
  float phase1 = cloudPhase(cosTheta, 0.5);
  float phase2 = cloudPhase(cosTheta, 0.25);
  // Powder darkening is a back-scatter effect: fade it out when looking toward the light (Schneider 2017).
  float powderAmount = 0.35 * clamp(0.6 - 0.6 * cosTheta, 0.0, 1.0);
  // A closed deck is a horizontally extended slab: the diffusing light cannot leak out of its sides (no
  // MS_LEAK), so its underside is evenly lit by the sunlight diffusing through it (an overcast's grey) instead
  // of dark between bright thin spots.
  float deck = deckness();
  float msLeak = MS_LEAK * (1.0 - deck);

  // Light-march step growth: six steps from 16 m cover ~1 km toward a high sun; toward a low sun the path out
  // of a cloud runs sideways through it (km), so the steps stretch to cover ~3.5 km, or the bases and far
  // sides of clouds glow at sunset.
  float lightGrowth = mix(2.7, 2.0, smoothstep(0.1, 0.5, uLightDir.y));
  vec3 lightBase = uLightColor, lightTop = uLightColor;
#ifdef CLOUDS_ATMOSPHERE
  if (uSunByAltitude > 0.5) { lightBase = sunAt(uLayer.x); lightTop = sunAt(uLayer.y); }
#endif

  // Sky light on the clouds: the clear-sky dome's own upper-hemisphere mean (cosine weighted) from the sky-view
  // LUT. ctx.sky.skyColor already has the clouds blended in (their lit sides dominate it at sunset), so lighting
  // the clouds with it would light them with themselves: orange bases under a low sun.
  vec3 skyAmb = uSkyColor;
#ifdef CLOUDS_ATMOSPHERE
  skyAmb = 0.4 * skyViewRadiance(vec3(0.0, 1.0, 0.0)).rgb;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * (PI / 3.0);
    skyAmb += 0.1 * skyViewRadiance(normalize(vec3(cos(a), 0.45, sin(a)))).rgb;
  }
#endif
  vec3 L = vec3(0.0);
  float T = 1.0;
  float frontSum = 0.0, frontW = 0.0;
  int steps = 0;

  for (int s = 0; s < 2; s++) {
    vec2 seg = s == 0 ? seg0 : seg1;
    if (seg.y <= seg.x || T < T_STOP) continue;
    float t = seg.x;
    // The step plan leaves headroom for fine steps, surface bisection and the skin ramp. (Since the surfaces
    // are located by bisection, the coarse steps can be long: 40 % of the budget.)
    float growth = stepGrowth(seg.x, seg.y, float(uMaxSteps - steps) * 0.4);
    t += max(uMinStep, t * growth) * noise;
    // Coarse steps through empty space, fine steps (a fraction of the coarse one) once the ray has met
    // cloud, back to coarse after a run of empty samples (Schneider 2015).
    //
    // Where the ray enters a cloud (a sample turns optically significant after one that was not), the
    // surface is located by bisection between the two samples (to about the first skin step) and the march restarts
    // there with a skin ramp: steps of 1/8, 1/4, 1/2 of the fine step, then full steps (only as many halvings
    // as bring the first step down to ~SKIN_STEP, about one optical depth of a dense core). A fine step at a few
    // km is 50-100 m, five to ten optical depths of cumulus: without this the first sample inside lands at a
    // depth set by the step grid, and its light march (bright at the sunlit skin, dark 50 m in) turns that
    // grid into bands. The grid starts on the (flat) base plane, so every ray samples the same altitude
    // levels and the bands are horizontal streaks across bases and flanks that no jitter or temporal filter
    // removes. With the surface located, the lit skin is integrated in a few short steps whatever the grid.
    bool fine = false;
    int emptyRun = 0;
    int skin = 3;            // samples since the surface was located: steps of 1/8, 1/4, 1/2, then 1
    int skinLevels = 0;      // halvings of the first skin step
    bool armed = true;       // an entry into cloud may be refined (re-armed on leaving cloud)
    bool wasSig = false;     // the previous sample was optically significant
    float tPrev = t;         // the previous sample and the integration state before it
    vec4 prevA = vec4(L, T);
    vec2 prevF = vec2(frontSum, frontW);
    for (; steps < uMaxSteps && t < seg.y && T > T_STOP; steps++) {
      float coarse = max(uMinStep, t * growth);
      // Fine steps matter only until the ray has entered the cloud (where the surface is located and the
      // lit skin is sampled); once most of the light is absorbed coarse steps do.
      float ds = min((fine && T > 0.55 ? coarse * FINE_FRACTION : coarse) * exp2(-float(max(skinLevels - skin, 0))), seg.y - t);
      float tHere = t;
      vec4 hereA = vec4(L, T);
      vec2 hereF = vec2(frontSum, frontW);
      vec3 p = uCamPos + dir * t;
      vec2 horiz = p.xz - uCamPos.xz;
      p.y -= dot(horiz, horiz) * uInvTwoR;        // curved-earth altitude
      float h = (p.y - uLayer.x) * uLayer.z;
      float footprint = t * uPixelAngle;
      float wlod = max(0.0, log2(footprint / WEATHER_TEXEL));
      vec3 wt = cloudWeather(p, wlod);
      // Where the weather map and height profile rule out cloud, coarse mode skips ahead without touching
      // the 3D noise. In fine mode keep stepping finely (it ends after a run of empty samples): skipping
      // there would bounce the ray back and forth across every cloud top.
      bool possible = wt.x * heightProfile(h, wt) >= 0.01;
      if (!possible && !fine) {
        t += coarse * 1.5;
        tPrev = tHere; prevA = hereA; prevF = hereF;
        wasSig = false; armed = true;
        continue;
      }

      // Pixel-footprint mip levels, capped so distant clouds keep their billows instead of blurring into
      // the smooth coverage shape (the temporal filter absorbs the extra aliasing).
      float lod = clamp(log2(footprint / SHAPE_TEXEL), 0.0, 2.0);
      float dlod = clamp(log2(footprint / DETAIL_TEXEL), 0.0, 3.0);
      // Detail erosion fades out by pixel footprint (uDetailDist is the distance at which it ends for the
      // reference 60 degree field of view), so a zoomed-in view keeps it on distant clouds.
      float detail = 1.0 - smoothstep(uDetailDist * 0.6, uDetailDist, footprint * uDetailScale);
      // A finer erosion octave (10-40 m turrets and wisps) while the pixel footprint is small enough to
      // resolve it (clouds within a few km at a 60 degree field of view, further when zoomed).
      // Behind the first optical depth or so of cloud (T < ~0.3) the finest structure no longer shows: the fine
      // octave, the domain swirl and the detailed light samples are dropped there (a large saving in cost).
      float visible = smoothstep(0.12, 0.35, T);
      float fineW = (1.0 - smoothstep(3.0, 10.0, footprint)) * visible;
      float warpW = (1.0 - smoothstep(20.0, 40.0, footprint)) * visible;
      float dens = 0.0, core = 0.0;
      // The finest erosion octave (2-10 m) for clouds within a few hundred metres.
      gMicroWeight = (1.0 - smoothstep(0.6, 2.0, footprint)) * visible;
      gMicroLod = max(0.0, log2(footprint / MICRO_TEXEL));
      gEdgeMin = footprint * 0.0125;   // ~2.5 low-res pixels (the margin rises by ~1 per 200 m)
      if (possible) { dens = cloudDensity(p, h, wt, lod, dlod, detail, fineW, warpW); core = gCoreDensity; }
      gMicroWeight = 0.0;
      gEdgeMin = 0.0;
      // Only optically significant samples switch to fine steps: faint wisps integrate accurately enough
      // at coarse steps and would otherwise keep fine mode (and its cost) on across clear sky.
      // (On the density without the faint fringe around every cloud, which coarse steps integrate well enough.)
      float sigThreshold = 0.1 / (uExtinction * coarse);
      bool significant = core > sigThreshold;
      if (significant && !wasSig && armed) {
        // Locate the surface between the previous sample and this one, then restart from just outside it
        // with the integration state from before the previous sample (which was not significant).
        float lo = tPrev, hi = t;
        skinLevels = int(clamp(round(log2(coarse * FINE_FRACTION / SKIN_STEP)), 0.0, 3.0));
        // Bisect to about one skin step (the first step after the restart is that long anyway).
        for (int b = 0; b < max(skinLevels, 1); b++) {
          float tm = 0.5 * (lo + hi);
          vec3 pm = uCamPos + dir * tm;
          vec2 hm2 = pm.xz - uCamPos.xz;
          pm.y -= dot(hm2, hm2) * uInvTwoR;
          float hm = (pm.y - uLayer.x) * uLayer.z;
          vec3 wm = cloudWeather(pm, wlod);
          gCoreDensity = 0.0;
          gEdgeMin = footprint * 0.0125;
          if (wm.x * heightProfile(hm, wm) >= 0.01) cloudDensity(pm, hm, wm, lod, dlod, detail, 0.0, warpW);
          gEdgeMin = 0.0;
          if (gCoreDensity > sigThreshold) hi = tm; else lo = tm;
        }
        // Restart at the first significant point: [lo, hi] is a short stretch of near-zero optical depth.
        L = prevA.rgb; T = prevA.a; frontSum = prevF.x; frontW = prevF.y;
        t = hi;
        tPrev = lo; prevA = vec4(L, T); prevF = vec2(frontSum, frontW);
        fine = true; emptyRun = 0; skin = 0; armed = false; wasSig = false;
        continue;
      }
      // Re-armed after two non-significant samples in a row (a real gap between lobes or clouds, not the
      // flicker of a noisy edge, which would restart the march over and over), while the surface behind the
      // gap can still show (T > 0.3).
      if (emptyRun >= 1 && !significant && T > 0.3) armed = true;
      wasSig = significant;
      emptyRun = significant ? 0 : emptyRun + 1;
      if (emptyRun > 6) fine = false;
      skin++;
      if (dens > 0.0) {
        float sigmaT = dens * uExtinction;
        // Light march toward the light: six steps doubling in length from 16 m cover ~1 km. The first
        // uLightDetailSteps (up to ~110 m) include the detail erosion, so neighbouring billows and lobes shade
        // each other (the rounded, self-shadowed cauliflower relief and creases of a real cumulus), the rest
        // the coarse shape.
        float tauL = 0.0;
        // Close up (pixel footprint under a few metres) the first step shrinks to 6 m so small turrets shade
        // each other crisply, and the growth rises to keep the reach.
        float lds = mix(6.0, 16.0, smoothstep(0.7, 3.0, footprint));
        float lg = lightGrowth * pow(16.0 / lds, 0.2);
        float lt = 0.0;
        vec3 lwt = wt;
        // Once the view ray is mostly absorbed the sample contributes little: the long, far steps (which
        // matter only for a low sun) are dropped there.
        // The faint fringe (no core density) contributes little: a short, coarse light march does for it.
        int lightSteps = T > 0.45 && core > 0.0 ? uLightSteps : min(uLightSteps, 4);
        // The lobes' shading of each other (detail in the light march) shows only where the lobes are resolved:
        // nearby clouds (pixel footprint under ~15 m); further out one detailed step is enough.
        int detailSteps = footprint < 15.0 && T > 0.45 ? uLightDetailSteps : min(uLightDetailSteps, core > 0.0 ? 1 : 0);
        for (int j = 0; j < 6; j++) {
          if (j >= lightSteps) break;
          vec3 lp = p + uLightDir * (lt + lds * 0.5);
          float lh = (lp.y - uLayer.x) * uLayer.z;
          // Beyond the first steps the light ray leaves the sample's cell: look the coverage up again, or a
          // small cumulus would shade itself as if it were part of a deck (and its sunlit side stay grey).
          // One (blurred) lookup serves the far steps. It must use the same height-warped outline as the view
          // samples (cloudWeather(vec3)): an unwarped lookup shades a sample from a phantom copy of its cloud
          // displaced by up to ~350 m, which cut sharp, flat shadow 'shelves' across nearby clouds.
          if (j == 3) { vec3 lq = lp + uLightDir * (lds * 0.75); lwt = cloudWeather(lq, 2.5); }
          float ld = j < detailSteps && detail > 0.0 && visible > 0.0 ? cloudDensity(lp, lh, lwt, lod, dlod + 0.5 * float(j + 1), detail, 0.0, 0.0)
                                           : cloudShape(lp, lh, lwt, lod + float(j) * 0.5);
          tauL += ld * lds;
          lt += lds;
          lds *= lg;
        }
        tauL *= uExtinction;
        float hr = relHeight(h, wt);
        // Sunlight: single scattering plus two multiple-scattering octaves (Wrenninge 2013 / Hillaire 2016:
        // each octave sees a fraction of the extinction and a flatter phase), which carry light into the
        // shaded side without flattening the lit/shaded contrast, and the powder term: a sample just inside a
        // lit surface has had little cloud in front of it to scatter light toward the viewer, so creases and
        // the rims of billows facing away from the sun read darker (Schneider 2015), faded out toward the sun.
        float powder = 1.0 - exp(-tauL * 2.0 - sigmaT * 12.0);
        vec3 sunL = mix(lightBase, lightTop, clamp(h, 0.0, 1.0));
        // MS_ISO: the high orders of scattering, which make a thick cloud a near-Lambertian reflector (albedo
        // ~0.8: the sunlit side shines at ~E / 4 whatever the view), falling off with the optical depth toward
        // the sun as diffusion does (two-stream).
        vec3 sun = sunL * (exp(-tauL) * phase0 + MS1_W * exp(-tauL * MS1_K) * phase1 + MS2_W * exp(-tauL * MS2_K) * phase2
                           + MS_ISO * exp(-msLeak * tauL) / (1.0 + MS_ISO_K * tauL))
                 * mix(1.0, powder, powderAmount);
        // A low sun grazes the flat base: the underside presents almost no area to the beam, which reaches it
        // only through kilometres of cloud or by diffusion from the sunlit flank. The ray-marched base is a
        // soft layer that the shadow ray crosses too easily, so away from the sunlit skin (tauL > ~1) the
        // base's share of sunlight is cut as the sun gets low, or the underside glows as brightly as the
        // flanks at sunset. With a high sun the light march already darkens it.
        float grazing = (1.0 - smoothstep(0.05, 0.5, hr)) * (1.0 - smoothstep(0.08, 0.4, uLightDir.y)) * smoothstep(0.4, 0.9, wt.x) * smoothstep(0.0, 1.0, tauL);
        sun *= 1.0 - 0.85 * grazing;
        // Sky light arrives through the cloud above the sample, ground bounce through the cloud below. The
        // column above reaches this cloud's own top (lower toward its edges), so the bases darken under the
        // thick cores and stay lighter under thin parts (mottled bases), and the lit tops get the full sky.
        float colAbove = max(uLayer.x + wt.y / uLayer.z - p.y, 0.0);
        // The local density sets part of the column's optical depth: denser patches of the base (under the
        // turrets) are darker, the wispy ones between them lighter, which mottles the base.
        float up = diffuseTransmission(mix(uExtinction * 0.5, sigmaT, 0.6) * colAbove);
        float down = diffuseTransmission(uExtinction * 0.6 * max(p.y - uLayer.x, 0.0));
        vec3 ambient = AMBIENT_SKY * skyAmb * mix(up, 1.0, 0.04 + 0.26 * hr) + AMBIENT_GROUND * uGroundRadiance * down;
        // The base is lit by light diffusing down through the cloud above it, whose optical thickness varies
        // from turret to turret: real bases are mottled, darker under the dense cores and lighter under thin
        // parts. The coarse light march is too smooth to show it, so the lower part of each cloud takes a
        // soft ~60-250 m modulation from the detail noise (within ~10 km, where a base can be seen at all).
        float baseMix = (1.0 - smoothstep(0.03, 0.12, h - wt.z)) * (1.0 - smoothstep(20.0, 40.0, footprint));
        if (baseMix > 0.0) {
          float mt = baseMottle(p, lod, dlod);
          float mott = mix(1.0, mix(mix(1.3, 1.08, deck), mix(0.45, 0.8, deck), mt), baseMix);
          sun *= mott;
          ambient *= mott;
        }
        vec3 S = (sun + ambient) * sigmaT * 0.99;   // single-scattering albedo of water droplets ~0.99
        float Tstep = exp(-sigmaT * ds);
        L += T * (S - S * Tstep) / sigmaT;
        frontSum += t * T * (1.0 - Tstep);
        frontW += T * (1.0 - Tstep);
        T *= Tstep;
      }
      tPrev = tHere; prevA = hereA; prevF = hereF;
      t += ds;
    }
  }

  // The march stops at T = T_STOP; remap so an absorbed ray is fully opaque (otherwise the sun disc, a
  // hundred times brighter than the cloud, shows through) while thin cloud stays continuous.
  T = max(0.0, (T - T_STOP) / (1.0 - T_STOP));
  float front = frontW > 1e-4 ? frontSum / frontW : tEnd;
  // Distant clouds fade into the horizon haze.
  vec3 behind = behindRadiance(dir, rayUv);
  vec4 hz = hazeAlong(rayUv, front, camY + dir.y * front, behind);
  // The haze's forward-scattering peak around the sun (the aureole) is direct sunlight scattered by the air;
  // the air under a cloud is in its shadow and has none, or a thick cloud base would show a glow where the
  // sun is behind it. Within ~25 degrees of the sun, dim the in-scattering by the mean cloud shadow along the
  // first few kilometres of the path (the aerial-perspective volume only knows the layer's mean shading).
  //
  // Away from the sun the same holds more weakly: below the layer the air in front of a distant cloud is
  // partly in cloud shadow (under an overcast, almost all of it), so its in-scattered sunlight is dimmed by the
  // mean shadow along the path. Beyond the shadow map (40 km) the mean shadow of the cover stands in: without
  // it the far underside of a deck fades into a bright, sunlit-haze band on the horizon.
  float forward = smoothstep(0.9, 0.99, cosTheta);
  float below = 1.0 - smoothstep(uLayer.x - 200.0, uLayer.x, camY);
  if (T < 0.99 && (forward > 0.0 || below > 0.0)) {
    float len = min(front, forward > 0.0 ? 6000.0 : 16000.0);
    float sh = 0.0;
    for (int k = 0; k < 3; k++) sh += cloudShadow(uCamPos + dir * (len * (float(k) + 0.5) / 3.0));
    sh /= 3.0;
    float farShade = 1.0 - min(uLayer.w, 1.0) * 0.9 * cloudShadowLight.w;
    sh = mix(sh, farShade, smoothstep(12000.0, 40000.0, front) * below);
    hz.rgb *= mix(1.0, sh, max(forward, 0.8 * below));
  }
  L = L * hz.a + hz.rgb * (1.0 - T);

  // Cirrus: a thin ice-crystal sheet (optical depth ~0.02-0.3) on the curved cirrus altitude. Coverage
  // patches come from the weather map, the fibres from the cirrus texture, both in the deck's own frame
  // with the fibres stretched along the upper wind. Single scattering with an ice-crystal phase function
  // (strong forward peak: bright only near the sun) plus sky light; thin enough for blue sky to show through.
  if (uCirrus.x > 0.0 && camY < uCirrus.y && T > 0.01) {
    vec2 ci = belowInterval(uCirrus.y, camY, dir.y, k);
    float tc = ci.y;
    if (tc > 0.0 && tc < min(sceneDist, uMaxDist * 1.5)) {
      vec3 p = uCamPos + dir * tc;
      // Sine of the local elevation where the ray crosses the (curved) sheet: sets the slant path.
      float mu = max(dir.y + tc * 2.0 * uInvTwoR, 0.03);
      // The footprint on the sheet stretches by 1 / mu; use the geometric mean of both axes.
      float footprint = tc * uPixelAngle / sqrt(mu);
      vec2 q = vec2(dot(p.xz, uCirrusAxis), dot(p.xz, vec2(-uCirrusAxis.y, uCirrusAxis.x))) + uCirrusOffset;
      float cov = textureLod(uWeatherTex, q * CIRRUS_FREQ, max(0.0, log2(footprint / 60.0))).a;
      float thr = 1.0 - uCirrus.x;
      float patchy = smoothstep(thr, thr + 0.05 + 0.5 * uCirrus.x, cov);
      float lodF = max(0.0, log2(footprint / CIRRUS_FIBRE_TEXEL));
      float f1 = textureLod(uCirrusTex, q * CIRRUS_FIBRE_FREQ, lodF).r;
      float f2 = textureLod(uCirrusTex, q * (CIRRUS_FIBRE_FREQ / 3.0) + vec2(0.0, 0.43), max(0.0, lodF - 1.58)).g;
      // Filaments: a power of the fibre fields. Where the texture is minified the filtered value tends to its
      // mean, so blend toward the mean of the power there and distant cirrus keeps its optical depth.
      // Large strands (f2, 30 km tile) carry the structure seen from afar, fine ones (f1) the detail overhead.
      float lodM = smoothstep(0.0, 4.0, lodF);
      float big = f2 * f2;
      float fine = mix(f1 * f1 * sqrt(f1), 0.29, lodM);
      float strands = big * mix(0.35, 1.0, fine) + 0.25 * fine;
      float tau = patchy * (0.004 + 0.3 * strands) * mix(0.7, 1.3, uCirrus.x);
      float alpha = (1.0 - exp(-tau / mu)) * smoothstep(-0.02, 0.04, dir.y);
      float iceP = 0.5 * hg(cosTheta, 0.85) + 0.5 * hg(cosTheta, 0.3);
      vec3 cirrusLight = uLightColor;
#ifdef CLOUDS_ATMOSPHERE
      if (uSunByAltitude > 0.5) cirrusLight = sunAt(uCirrus.y);
#endif
      vec3 lc = cirrusLight * iceP + skyAmb;
      vec4 hc = hazeAlong(rayUv, tc, uCirrus.y, behind);
      vec3 Lc = alpha * (lc * hc.a + hc.rgb);
      L += T * Lc;
      // Front distance for reprojection: opacity-weighted mean of the cumulus front and the cirrus sheet.
      front = (front * (1.0 - T) + tc * T * alpha) / max(1.0 - T + T * alpha, 1e-4);
      T *= 1.0 - alpha;
    }
  }

  outColor = vec4(L, T);
  outAux = vec4(log2(1.0 + front), log2(1.0 + sceneDist), hz.a, dot(behind, vec3(0.2126, 0.7152, 0.0722)));
}
`;
