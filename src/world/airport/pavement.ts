// Runway, taxiway and apron meshes. Geometry is trivial (flat quads in the airport-local frame); the look comes
// from the per-pixel pavement shaders in pavementGlsl.ts patched into MeshStandardMaterial, so the surfaces take
// part in normal scene lighting and shadows.
//
// Z-fighting: by default the renderer uses a reversed-Z float depth buffer (about 2^-24 relative precision,
// and polygonOffset works; three flips its sign), with logarithmic depth written per fragment as the fallback
// (depth=log), where polygonOffset is ineffective. So as not to depend on either, the surfaces sit at distinct
// heights: terrain 0, taxiways/apron +5 cm, runway +9 cm.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_BAY_WIDTH, CAR_PARK, CAR_PARK_ROWS, FILLET_RADIUS, PAVED_RECTS, RUNWAY_HALF_LENGTH, RUNWAY_HALF_WIDTH } from './layout';
import { PAVEMENT_COMMON_GLSL, runwayGlsl, taxiwayGlsl } from './pavementGlsl';
import { injectFloodlight, type SharedUniforms } from './shared';

export const TAXIWAY_HEIGHT = 0.05;
export const RUNWAY_HEIGHT = 0.09;

export interface PavementTextures {
  asphalt: THREE.Texture;
  concrete: THREE.Texture;
  crack: THREE.Texture;
  noise: THREE.Texture;
}

/** A horizontal quad in the airport-local frame (three x = v, z = -u) covering a local rectangle. */
function localQuad(u0: number, u1: number, v0: number, v1: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(v1 - v0, u1 - u0).rotateX(-Math.PI / 2);
  return g.translate((v0 + v1) / 2, 0, -(u0 + u1) / 2);
}

function pavementMaterial(kind: 'runway' | 'taxiway', tex: PavementTextures, shared: SharedUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const surfaceFn = kind === 'runway' ? 'runwaySurface' : 'taxiwaySurface';
  const glsl = kind === 'runway' ? runwayGlsl() : taxiwayGlsl();
  if (kind === 'taxiway') mat.alphaToCoverage = true;
  mat.onBeforeCompile = (shader) => {
    injectFloodlight(shader, shared);
    shader.uniforms.tAsphalt = { value: tex.asphalt };
    shader.uniforms.tConcrete = { value: tex.concrete };
    shader.uniforms.tCrack = { value: tex.crack };
    shader.uniforms.tNoise = { value: tex.noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLocal;\nvarying vec3 vAxisU;\nvarying vec3 vAxisV;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLocal = vec2(-position.z, position.x);
        vAxisU = normalize(normalMatrix * vec3(0.0, 0.0, -1.0));
        vAxisV = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vLocal;\nvarying vec3 vAxisU;\nvarying vec3 vAxisV;\n${PAVEMENT_COMMON_GLSL}\n${glsl}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Pixel footprint in metres along u and v, for filtering the analytic markings.
        vec2 pw = max(vec2(length(vec2(dFdx(vLocal.x), dFdy(vLocal.x))), length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))), vec2(1e-4));
        Pave pv = ${surfaceFn}(vLocal, pw);
        ${kind === 'taxiway' ? 'if (pv.alpha < 0.3) discard;' : ''}
        diffuseColor = vec4(pv.albedo, pv.alpha);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = pv.roughness;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(normal * sqrt(max(1.0 - dot(pv.slope, pv.slope), 0.0)) + pv.slope.x * vAxisU + pv.slope.y * vAxisV);`,
      );
  };
  mat.customProgramCacheKey = () => `airport-pavement-${kind}`;
  return mat;
}

/** Build the runway and taxiway/apron meshes as children of the airport-local group. */
export function createPavement(tex: PavementTextures, shared: SharedUniforms): THREE.Mesh[] {
  const runway = new THREE.Mesh(
    localQuad(-RUNWAY_HALF_LENGTH, RUNWAY_HALF_LENGTH, -RUNWAY_HALF_WIDTH, RUNWAY_HALF_WIDTH),
    pavementMaterial('runway', tex, shared),
  );
  runway.position.y = RUNWAY_HEIGHT;
  runway.name = 'runway';

  // Each paved rectangle padded so the junction fillets are covered; the shader discards outside the shape.
  // Overlaps render identical colour (the shading depends only on position), so they cannot z-fight visibly.
  const pad = FILLET_RADIUS * 0.5;
  const taxiway = new THREE.Mesh(
    mergeGeometries(PAVED_RECTS.map((r) => localQuad(r.u0 - pad, r.u1 + pad, r.v0 - pad, r.v1 + pad))),
    pavementMaterial('taxiway', tex, shared),
  );
  taxiway.position.y = TAXIWAY_HEIGHT;
  taxiway.name = 'taxiways';

  for (const m of [runway, taxiway]) {
    m.receiveShadow = true;
    m.castShadow = false;
  }
  return [runway, taxiway];
}

/**
 * Asphalt material for roads and the car park. Markings come from the `uv` attribute in metres:
 *   'road'     uv = (distance along, offset across) for a road `width` metres wide: white edge lines, dashed centre
 *   'carpark'  uv = airport-local (u, v): bay lines from CAR_PARK_ROWS
 * markings: false for unmarked farm tracks.
 * depthBias (fraction of view distance, e.g. 0.002) pulls the surface toward the camera so roads draped over a
 * terrain mesh of unknown tessellation stay visible; 0 for surfaces on the flat airfield.
 * streetLights: the geometry has a vec4 `aStreet` attribute (intensity relative to STREET_ILLUMINANCE's lamp, 0 =
 * unlit; lamp phase: distance of the run start past a lamp; lamp spacing, m; 1 for 4000 K LED, 0 for sodium);
 * lit streets receive the pools of their lamps (alternating sides, see valley.ts) at night.
 */
const LED_4000K = [1.0, 0.8, 0.6];
const ledUnit = LED_4000K.map((x) => x / (0.2126 * LED_4000K[0] + 0.7152 * LED_4000K[1] + 0.0722 * LED_4000K[2]));

export function createRoadMaterial(
  kind: 'road' | 'carpark',
  tex: PavementTextures,
  shared: SharedUniforms,
  opts: { width?: number; depthBias?: number; markings?: boolean; streetLights?: boolean } = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const hw = (opts.width ?? 7) / 2;
  const bias = opts.depthBias ?? 0;
  const rows = CAR_PARK_ROWS.map(
    (r) => `paint = max(paint, band(q.y, ${r.v0.toFixed(3)}, ${r.v1.toFixed(3)}, w.y) * (pulses(q.x + 0.06, ${CAR_BAY_WIDTH.toFixed(3)}, 0.12, w.x) + band(q.y, ${(r.facing > 0 ? r.v1 - 0.12 : r.v0).toFixed(3)}, ${(r.facing > 0 ? r.v1 : r.v0 + 0.12).toFixed(3)}, w.y)));`,
  );
  const marked = opts.markings ?? true;
  const lit = opts.streetLights ?? false;
  const markings =
    kind === 'road'
      ? marked
        ? `float ay = abs(q.y);
         paint = band(ay, ${(hw - 0.35).toFixed(3)}, ${(hw - 0.23).toFixed(3)}, w.y) + band(q.y, -0.06, 0.06, w.y) * pulses(q.x, 12.0, 3.0, w.x);
         edge = smoothstep(${(hw - 0.6).toFixed(3)}, ${hw.toFixed(3)}, ay);`
        : `edge = 0.6 + 0.4 * smoothstep(${(hw - 1.2).toFixed(3)}, ${hw.toFixed(3)}, abs(q.y));`
      : `q -= vec2(${CAR_PARK.u0.toFixed(3)}, ${CAR_PARK.v0.toFixed(3)});
         ${rows.join('\n         ')}`;
  mat.onBeforeCompile = (shader) => {
    injectFloodlight(shader, shared);
    shader.uniforms.tAsphalt = { value: tex.asphalt };
    shader.uniforms.tConcrete = { value: tex.concrete };
    shader.uniforms.tCrack = { value: tex.crack };
    shader.uniforms.tNoise = { value: tex.noise };
    shader.uniforms.uStreetColor = shared.uStreetColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vRoad;${lit ? '\nattribute vec4 aStreet;\nvarying vec4 vStreet;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRoad = uv;${lit ? '\nvStreet = aStreet;' : ''}`)
      .replace(
        '#include <project_vertex>',
        bias > 0 ? `#include <project_vertex>\nmvPosition.xyz *= ${(1 - bias).toFixed(6)};\ngl_Position = projectionMatrix * mvPosition;` : '#include <project_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vRoad;\n${PAVEMENT_COMMON_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 q = vRoad;
        vec2 w = max(vec2(length(vec2(dFdx(q.x), dFdy(q.x))), length(vec2(dFdx(q.y), dFdy(q.y)))), vec2(1e-4));
        vec4 tex = samplePacked(tAsphalt, q, 4.0);
        float big = texture(tNoise, q / 300.0).r;
        float paint = 0.0, edge = 0.0;
        ${markings}
        float albedo = tex.r * (0.85 + 0.35 * big) * (1.0 + 0.4 * edge);
        float crack = texture(tCrack, q / 64.0).r * smoothstep(0.4, 0.7, big);
        albedo = mix(albedo, 0.03, crack);
        diffuseColor.rgb = mix(vec3(albedo) * vec3(1.0, 0.98, 0.95), vec3(0.72), clamp(paint, 0.0, 1.0) * 0.9);
        float roughPave = mix(tex.g, 0.6, clamp(paint, 0.0, 1.0));`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = roughPave;');
    if (lit) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uStreetColor;\nvarying vec4 vStreet;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          if (vStreet.x > 0.0 && uStreetColor.r > 0.0) {
            // Two nearest lamps (7.5 m poles every S m, ~4.5 m to the side): E = E0 h^3 / (h^2 + r^2)^1.5.
            float S = vStreet.z;
            float xm = mod(vRoad.x + vStreet.y, S);
            float a = 56.25 + 20.25;
            float e = pow(a / (a + xm * xm), 1.5) + pow(a / (a + (S - xm) * (S - xm)), 1.5);
            // 4000 K LED streets: same luminance, whiter colour.
            vec3 led = vec3(${ledUnit.map((x) => x.toFixed(5)).join(', ')}) * dot(uStreetColor, vec3(0.2126, 0.7152, 0.0722));
            totalEmissiveRadiance += diffuseColor.rgb * RECIPROCAL_PI * mix(uStreetColor, led, vStreet.w) * (e * vStreet.x);
          }`,
        );
    }
  };
  mat.customProgramCacheKey = () => `airport-road-${kind}-${hw}-${bias}-${marked}-${lit}`;
  return mat;
}
