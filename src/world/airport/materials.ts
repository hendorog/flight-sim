// PBR materials for buildings and props. Albedo comes from vertex colours (baked per part by GeometryBatch)
// multiplied by a grime map; detail comes from tileable normal maps (ribbed steel cladding on walls, roofs and
// hangar doors, stucco on render and concrete). Building materials are weathered per fragment (injectWeathering:
// tint variation, rain streaks, splash-back dirt, contact and eave occlusion). Every material receives the apron
// floodlight pools at night (see shared.ts).

import * as THREE from 'three';
import { SCENE_UNITS_PER_LUX } from '../../core/context';
import { floodlit, type SharedUniforms } from './shared';
import { CLADDING_TILE, type BuildingTextures } from './textures';

export type MaterialKey =
  | 'metalWall'
  | 'metalRoof'
  | 'door'
  | 'concrete'
  | 'render'
  | 'glass'
  | 'glassLit'
  | 'trim'
  | 'steel'
  | 'rubber'
  | 'paint';

export type MaterialSet = Record<MaterialKey, THREE.MeshStandardMaterial>;

/** Linear emissive colour of lit interiors behind glass (warm fluorescent/LED mix). */
const INTERIOR_LIGHT = new THREE.Color(1.0, 0.78, 0.52);

export function createMaterials(tex: BuildingTextures, shared: SharedUniforms): MaterialSet {
  tex.corrugated.repeat.set(1 / CLADDING_TILE, 1);
  tex.grime.repeat.set(1 / 4, 1 / 4);
  tex.grimeRough.repeat.set(1 / 4, 1 / 4);
  tex.stucco.repeat.set(1 / 2, 1 / 2);

  const std = (key: string, p: THREE.MeshStandardMaterialParameters, weathered = false): THREE.MeshStandardMaterial =>
    floodlit(new THREE.MeshStandardMaterial({ vertexColors: true, ...p }), shared, weathered ? injectWeathering : undefined, `airport-${key}`);

  const glassLit = std('glassLit', {
    color: 0x34414a,
    roughness: 0.05,
    metalness: 0.5,
    emissive: INTERIOR_LIGHT,
    emissiveIntensity: 0,
  });
  return {
    metalWall: std('metalWall', {
      map: tex.grime,
      normalMap: tex.corrugated,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: tex.grimeRough,
      roughness: 0.75,
      metalness: 0.15,
    }, true),
    metalRoof: std('metalRoof', {
      map: tex.grime,
      normalMap: tex.corrugated,
      roughnessMap: tex.grimeRough,
      roughness: 0.6,
      metalness: 0.35,
    }, true),
    door: std('door', { map: tex.grime, normalMap: tex.corrugated, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.55, metalness: 0.1 }, true),
    concrete: std('concrete', { map: tex.grime, normalMap: tex.stucco, roughnessMap: tex.grimeRough, roughness: 1, metalness: 0 }, true),
    render: std('render', { map: tex.grime, normalMap: tex.stucco, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.85, metalness: 0 }, true),
    glass: std('glass', { color: 0x34414a, roughness: 0.05, metalness: 0.5 }),
    glassLit,
    trim: std('trim', { roughness: 0.45, metalness: 0.2 }, true),
    steel: std('steel', { roughness: 0.5, metalness: 0.7 }),
    rubber: std('rubber', { roughness: 0.9, metalness: 0 }),
    paint: std('paint', { roughness: 0.4, metalness: 0 }),
  };
}

/**
 * Weathering of buildings, applied per fragment from the per-part data GeometryBatch bakes into the 'weather'
 * attribute (part base and top height, seed, stands-on-ground flag) and the airport-local position:
 *   - per-part tint and paint-fade variation, and large chalky blotches;
 *   - rain streaks running down from the top of each wall (gutters, sills, cab floors), fading downward;
 *   - splash-back dirt and grass stain along the bottom of walls that stand on the ground;
 *   - ambient occlusion (indirect light only) in the wall-ground corner and under the eaves;
 *   - streaks down the roof slopes.
 * Parts without the attribute (height range 0) are left untouched.
 */
const WEATHER_PARS = /* glsl */ `
varying vec3 vWeatherPos;
varying vec3 vWeatherNormal;
varying vec4 vWeather;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

function injectWeathering(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 weather;\nvarying vec3 vWeatherPos;\nvarying vec3 vWeatherNormal;\nvarying vec4 vWeather;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vWeatherPos = position;
      vWeatherNormal = normal;
      vWeather = weather;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${WEATHER_PARS}\nfloat wAO = 1.0;`)
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      if (vWeather.y - vWeather.x > 0.05) {
        vec3 wp = vWeatherPos;
        vec3 wn = normalize(vWeatherNormal);
        float seed = vWeather.z;
        float wall = 1.0 - smoothstep(0.45, 0.75, abs(wn.y));
        float roof = smoothstep(0.45, 0.75, wn.y);
        // Coordinate along the face, horizontally: walls face x or z; hangar roofs slope toward +-x.
        float along = abs(wn.x) > abs(wn.z) ? wp.z : wp.x;
        float across = abs(wn.x) > abs(wn.z) ? wp.x : wp.z;
        float fromTop = vWeather.y - wp.y;
        float fromBase = wp.y - vWeather.x;
        float n1 = wNoise(vec2(along * 1.7, wp.y * 0.09) + seed * 31.0);
        float n2 = wNoise(vec2(along * 6.0, wp.y * 0.35) + seed * 57.0);
        float blotch = wNoise(vec2(along, wp.y + across) * 0.22 + seed * 13.0) * 0.6 + wNoise(vec2(along, wp.y + across) * 0.9 + seed * 7.0) * 0.4;
        vec3 c = diffuseColor.rgb;
        // Per-part tint: paint batches and sun fading differ a little from panel to panel and building to building.
        c *= (1.0 + 0.10 * (seed - 0.5)) * vec3(1.0 + 0.04 * (fract(seed * 7.13) - 0.5), 1.0, 1.0 - 0.05 * (fract(seed * 3.71) - 0.5));
        c *= 1.0 + 0.16 * (blotch - 0.5);
        // Rain streaks from the top edge of walls.
        float streak = smoothstep(0.42, 0.9, 0.6 * n1 + 0.4 * n2);
        float rain = wall * streak * exp(-fromTop / (1.2 + 3.5 * n1));
        c *= 1.0 - 0.34 * rain;
        // Splash-back dirt at the foot of walls standing on the ground.
        float splash = vWeather.w * wall * (1.0 - smoothstep(0.1, 0.7 + 0.6 * n2, fromBase));
        c = mix(c, c * vec3(0.52, 0.47, 0.40), 0.8 * splash);
        // Roof slopes: dirt and oxidation streaks running down the slope.
        float rs = wNoise(vec2(along * 2.3, across * 0.12) + seed * 19.0);
        c *= 1.0 - roof * 0.22 * smoothstep(0.4, 0.9, rs);
        diffuseColor.rgb = c;
        // Ambient occlusion: the wall-ground corner and the band under the eaves / slab edges.
        wAO = 1.0 - wall * (0.45 * vWeather.w * (1.0 - smoothstep(0.0, 1.2, fromBase)) + 0.35 * (1.0 - smoothstep(0.0, 0.9, fromTop)) * step(1.5, vWeather.y - vWeather.x));
      }`,
    )
    .replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= wAO;
      reflectedLight.indirectSpecular *= wAO;`,
    );
}

const instancedVariants = new WeakMap<THREE.Material, THREE.Material>();

/**
 * The same material for use on an InstancedMesh. three.js keys the program on USE_INSTANCING per material, so a
 * material shared by a plain Mesh and an InstancedMesh swaps programs (re-running getParameters and the cache key)
 * on every draw. Instanced users get their own clone, sharing textures and the floodlight uniforms.
 */
export function forInstancing<M extends THREE.Material>(material: M): M {
  let v = instancedVariants.get(material);
  if (!v) {
    v = material.clone();
    v.name = `${material.name}-instanced`;
    v.onBeforeCompile = material.onBeforeCompile;
    v.customProgramCacheKey = material.customProgramCacheKey;
    instancedVariants.set(material, v);
  }
  return v as M;
}

/** Luminance of a lit interior seen through glazing, cd/m^2 (offices / lounges ~20-40). */
const INTERIOR_LUMINANCE = 25;

/** Per-frame: interior lights behind glass come on at dusk (emissive in scene units, see core/context.ts). */
export function updateMaterials(mats: MaterialSet, night: number): void {
  mats.glassLit.emissiveIntensity = INTERIOR_LUMINANCE * SCENE_UNITS_PER_LUX * night;
}
