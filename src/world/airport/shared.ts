// Uniforms shared by every airport material, and the shader patch that adds the apron floodlight pools.
//
// Real three.js spot lights would add per-fragment cost to every lit material in the scene (terrain included),
// so the apron floodlights are evaluated only in the airport's own materials: a few analytic cone lights whose
// Lambertian response is added as emitted radiance. They switch on with the night factor.

import * as THREE from 'three';
import { FLOODLIGHTS, APRON_RECT, localToNed } from './layout';
import { nedToThree } from '../../core/frames';
import { AIRPORT } from '../../core/world';
import { SCENE_UNITS_PER_LUX } from '../../core/context';
import { FLOOD_HEAD_CD, FLOOD_HEADS } from './lights';

export interface SharedUniforms {
  /** 0 by day, 1 at night: drives every light and lit window. */
  uNight: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uFloodPos: THREE.IUniform<THREE.Vector3[]>;
  uFloodDir: THREE.IUniform<THREE.Vector3[]>;
  /** Floodlight colour x radiant intensity (irradiance at 1 m on axis), already scaled by the night factor. */
  uFloodColor: THREE.IUniform<THREE.Color>;
  /** Street-light illuminance under a lamp (colour x lux x SCENE_UNITS_PER_LUX), already scaled by the night factor. */
  uStreetColor: THREE.IUniform<THREE.Color>;
}

/**
 * Linear colour of the 4000 K LED floodlights (unit luminance) and the on-axis intensity of one mast, in scene
 * units (candela x SCENE_UNITS_PER_LUX). With the beam below, a 14 m mast gives a pool of about 50 lux 10 m in front
 * of it and 20 lux at 20 m, falling to about 1 lux between the masts and at the far side of the apron (ICAO apron
 * floodlighting: 20 lux mean on the stands, uniformity 4:1 or worse on a GA apron lit from one side).
 */
export const FLOOD_COLOR = new THREE.Color(1.0, 0.9, 0.78).multiplyScalar(1 / (0.2126 + 0.7152 * 0.9 + 0.0722 * 0.78));
export const FLOOD_INTENSITY = FLOOD_HEAD_CD * FLOOD_HEADS * SCENE_UNITS_PER_LUX;
/** High-pressure sodium street lighting: unit-luminance colour and ~30 lux under a lamp (scene units). */
export const STREET_COLOR = new THREE.Color(1.0, 0.36, 0.04).multiplyScalar(1 / (0.2126 + 0.7152 * 0.36 + 0.0722 * 0.04));
export const STREET_ILLUMINANCE = 30 * SCENE_UNITS_PER_LUX;

export function createSharedUniforms(): SharedUniforms {
  const pos = FLOODLIGHTS.map((l) => {
    const n = localToNed(l.u, l.v);
    return nedToThree({ x: n.north, y: n.east, z: -(AIRPORT.elevation + l.height) });
  });
  // Each fixture is aimed FLOOD_BEAM.aim below the horizon, across the apron toward its centreline.
  const dir = FLOODLIGHTS.map((l, i) => {
    const t = localToNed(l.u, (APRON_RECT.v0 + APRON_RECT.v1) / 2);
    const aim = nedToThree({ x: t.north, y: t.east, z: -AIRPORT.elevation }).sub(pos[i]);
    aim.y = 0;
    aim.normalize().multiplyScalar(Math.cos(FLOOD_BEAM.aim));
    aim.y = -Math.sin(FLOOD_BEAM.aim);
    return aim.normalize();
  });
  return {
    uNight: { value: 0 },
    uTime: { value: 0 },
    uFloodPos: { value: pos },
    uFloodDir: { value: dir },
    uFloodColor: { value: new THREE.Color(0, 0, 0) },
    uStreetColor: { value: new THREE.Color(0, 0, 0) },
  };
}

const DEG = Math.PI / 180;
/**
 * Beam of one floodlight mast (its heads fanned across the apron as one wide asymmetric flood), angles in rad:
 * aimed `aim` below the horizon; full intensity within `elFull` of the aim in elevation, gone at `elZero` above it
 * (a sharp cut-off toward the horizon, for glare control) or `elZeroBelow` below it (toward the mast foot); full
 * within `azFull` in azimuth, gone at `azZero`; `floor` is the spill all round (downward hemisphere).
 */
export const FLOOD_BEAM = { aim: 30 * DEG, elFull: 12 * DEG, elZero: 35 * DEG, elZeroBelow: 60 * DEG, azFull: 40 * DEG, azZero: 65 * DEG, floor: 0.04 } as const;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Relative intensity (0..1) of a mast aimed along unit `aim` toward unit direction `d` (from the lamp). */
export function floodBeamGain(d: THREE.Vector3, aim: THREE.Vector3): number {
  const B = FLOOD_BEAM;
  const dd = Math.asin(Math.min(Math.max(-d.y, -1), 1)) - Math.asin(-aim.y);
  const gEl = 1 - smoothstep(B.elFull, dd > 0 ? B.elZeroBelow : B.elZero, Math.abs(dd));
  const hd = Math.hypot(d.x, d.z), ha = Math.hypot(aim.x, aim.z);
  const cosAz = (d.x * aim.x + d.z * aim.z) / Math.max(hd * ha, 1e-8);
  const gAz = smoothstep(Math.cos(B.azZero), Math.cos(B.azFull), cosAz);
  return B.floor + (1 - B.floor) * gEl * gAz;
}

const _L = new THREE.Vector3();
const _D = new THREE.Vector3();
/**
 * Floodlight irradiance at a world position on a surface with world normal `n` (default: facing up), lux, at full
 * power (night). The CPU twin of the shader's floodIrradiance(), e.g. for the exposure reference of a viewer on the
 * apron (see AirportSystem.artificialIlluminance).
 */
export function floodIlluminance(u: SharedUniforms, pos: THREE.Vector3, n: THREE.Vector3 = new THREE.Vector3(0, 1, 0)): number {
  let e = 0;
  u.uFloodPos.value.forEach((fp, i) => {
    _L.subVectors(fp, pos);
    const d2 = Math.max(_L.lengthSq(), 1);
    _L.multiplyScalar(1 / Math.sqrt(d2));
    _D.copy(_L).negate();
    e += (Math.max(n.dot(_L), 0) * floodBeamGain(_D, u.uFloodDir.value[i])) / d2;
  });
  return e * FLOOD_HEAD_CD * FLOOD_HEADS;
}

const f = (x: number): string => x.toExponential(6);
const FLOOD_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uFloodPos[${FLOODLIGHTS.length}];
uniform vec3 uFloodDir[${FLOODLIGHTS.length}];
uniform vec3 uFloodColor;
varying vec3 vFloodWorld;
// Irradiance from the apron floodlights at a world position with world normal n (see FLOOD_BEAM).
vec3 floodIrradiance(vec3 pos, vec3 n) {
  float e = 0.0;
  for (int i = 0; i < ${FLOODLIGHTS.length}; i++) {
    vec3 L = uFloodPos[i] - pos;
    float d2 = max(dot(L, L), 1.0);
    L *= inversesqrt(d2);
    vec3 A = uFloodDir[i];
    float dd = asin(clamp(L.y, -1.0, 1.0)) - asin(-A.y);
    float gEl = 1.0 - smoothstep(${f(FLOOD_BEAM.elFull)}, dd > 0.0 ? ${f(FLOOD_BEAM.elZeroBelow)} : ${f(FLOOD_BEAM.elZero)}, abs(dd));
    float cosAz = -dot(L.xz, A.xz) * inversesqrt(max(dot(L.xz, L.xz) * dot(A.xz, A.xz), 1e-12));
    float gAz = smoothstep(${f(Math.cos(FLOOD_BEAM.azZero))}, ${f(Math.cos(FLOOD_BEAM.azFull))}, cosAz);
    e += max(dot(n, L), 0.0) * (${f(FLOOD_BEAM.floor)} + ${f(1 - FLOOD_BEAM.floor)} * gEl * gAz) / d2;
  }
  return e * uFloodColor;
}
`;

/**
 * Patch a MeshStandardMaterial shader (inside onBeforeCompile) so it receives the floodlight pools.
 * Works with instanced meshes.
 */
export function injectFloodlight(shader: THREE.WebGLProgramParametersWithUniforms, u: SharedUniforms): void {
  shader.uniforms.uFloodPos = u.uFloodPos;
  shader.uniforms.uFloodDir = u.uFloodDir;
  shader.uniforms.uFloodColor = u.uFloodColor;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFloodWorld;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        fw = instanceMatrix * fw;
        #endif
        vFloodWorld = (modelMatrix * fw).xyz;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FLOOD_FRAGMENT_PARS}`)
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      if (uFloodColor.r > 0.0) {
        totalEmissiveRadiance += diffuseColor.rgb * RECIPROCAL_PI * floodIrradiance(vFloodWorld, inverseTransformDirection(normal, viewMatrix));
      }`,
    );
}

/** Make a standard material floodlit (and optionally apply a further patch). */
export function floodlit<M extends THREE.MeshStandardMaterial>(
  material: M,
  u: SharedUniforms,
  extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
  cacheKey = 'airport-floodlit',
): M {
  material.onBeforeCompile = (shader) => {
    injectFloodlight(shader, u);
    extra?.(shader);
  };
  material.customProgramCacheKey = () => cacheKey;
  return material;
}
