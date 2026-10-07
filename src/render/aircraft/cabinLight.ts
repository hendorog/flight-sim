// Ambient occlusion of the cabin interior: how much of the outside world (sky, ground, via
// scene.environment) each interior vertex sees through the windows.
//
// For every vertex of the cabin meshes a set of cosine-weighted rays is traced through a simplified cabin
// (floor, headliner, flat sides, baggage bulkhead, instrument panel and glareshield, raked windscreen); a
// ray that leaves through a window opening (the same window outlines the livery bakes, livery.windowSdf)
// counts as seeing outside. The result is a per-vertex attribute `cabinVis` that the patched cabin materials
// use in place of three's aoMap term: it scales the indirect (environment) diffuse and specular light, while
// direct sun through the windows, which the skin's shadow already masks, stays at full strength. The
// footwells and the space under the panel end up dark, the door sills and seat tops bright.
//
// Where the escaping rays go is kept too, as an ambient cube (the visibility split over the six model axes
// by the squared direction cosines, attributes `cabinCubeP` / `cabinCubeN`): the environment light is then
// looked up in the directions the vertex actually sees out of, not along its normal. A headliner facing
// down sees out through the side windows toward the horizon, not the ground straight below it.
//
// The rest of each vertex's hemisphere (1 - cabinVis) sees the cabin's own surfaces. That light is not the
// sky's colour: it is sunlight and skylight that entered through the glazing and bounced off grey and tan
// trim. It is estimated per frame (updateCabinBounce) with the classic enclosure radiosity result
// E = rho / (1 - rho) * Phi_in / A for the flux Phi_in entering through the windows, the cabin's mean
// albedo rho and its interior area A, and added as a separate, near-neutral irradiance.
//
// Cost: pure arithmetic, 64 rays per vertex against six planes; ~0.1-0.3 s for the ~20k cabin vertices,
// so the simulator runs it in the bake worker (liveryWorker.ts) together with the livery.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { SkyState } from '../../core/context';
import type { AirframeVisualDef, CockpitDef } from './airframe/types';
import { makeWindowSdf, windowSdf, type WindowSdf } from './livery';

const RAYS = 64;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cosine-weighted directions about +Z (local), stratified on a Fibonacci spiral. */
const LOCAL_DIRS: number[] = (() => {
  const out: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < RAYS; i++) {
    const u = (i + 0.5) / RAYS;
    const r = Math.sqrt(u);
    const a = i * golden;
    out.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - u)));
  }
  return out;
})();

/** Fraction of a ray from body point p along direction d (FRD) that reaches the outside. */
type TraceOut = (px: number, py: number, pz: number, dx: number, dy: number, dz: number) => number;

/**
 * The ray tracer of one cabin: the definition's simplified cabin (CockpitDef.box, body axes, z down, m) with
 * the window outlines of its glazing.
 */
function makeTraceOut(def: Pick<AirframeVisualDef, 'cockpit' | 'glazing'>, sdf: WindowSdf): TraceOut {
  const box = def.cockpit.box;
  const FLOOR = box.floor;
  const ROOF = box.roof;
  const SIDE = box.side;
  const REAR = box.rear;
  /** Instrument panel face and glareshield top; the windscreen sill (forward of the panel). */
  const PANEL_X = box.panelX;
  const GLARESHIELD_Z = box.glareshieldZ;
  const SILL_Z = box.sillZ;
  const WINDSCREEN_X = box.windscreenX;
  /** A window that reaches above the roof plane wraps over the roof aft of its front edge (the rear window). */
  let REAR_WINDOW_X = -Infinity;
  for (const w of def.glazing.windows) {
    if (Math.min(...w.pts.map((p) => p[1])) < ROOF) REAR_WINDOW_X = Math.max(REAR_WINDOW_X, ...w.pts.map((p) => p[0]));
  }
  /** The windscreen's upper edge (the wing leading edge at the roof, livery.windscreenSdf). */
  const WINDSCREEN_TOP_X = def.glazing.windscreen?.topX ?? Infinity;
  const ROOF_GLAZED = box.roofGlazed;
  return (px, py, pz, dx, dy, dz) => {
    let t = Infinity;
    let hit = 0; // 1 floor, 2 roof, 3 side, 4 rear, 5 front
    if (dz > 1e-6) {
      const tt = (FLOOR - pz) / dz;
      if (tt < t) ((t = tt), (hit = 1));
    } else if (dz < -1e-6) {
      const tt = (ROOF - pz) / dz;
      if (tt < t) ((t = tt), (hit = 2));
    }
    if (Math.abs(dy) > 1e-6) {
      const tt = ((dy > 0 ? SIDE : -SIDE) - py) / dy;
      if (tt < t) ((t = tt), (hit = 3));
    }
    if (dx < -1e-6) {
      const tt = (REAR - px) / dx;
      if (tt < t) ((t = tt), (hit = 4));
    } else if (dx > 1e-6) {
      const front = px < PANEL_X - 0.01 ? PANEL_X : WINDSCREEN_X;
      const tt = (front - px) / dx;
      if (tt < t) ((t = tt), (hit = 5));
    }
    t = Math.max(0, t);
    const x = px + dx * t;
    const y = py + dy * t;
    const z = pz + dz * t;
    switch (hit) {
      case 2:
        // The rear window over the tail cone, and forward of the wing leading edge the raked windscreen,
        // which in this box model takes the place of the roof over the glareshield.
        return ROOF_GLAZED || x < REAR_WINDOW_X || x > WINDSCREEN_TOP_X ? 1 - smooth(-0.03, 0.03, sdf(x, y, z)) : 0;
      case 3:
        return 1 - smooth(-0.03, 0.03, sdf(x, y, z));
      case 5:
        // Panel plane: below the glareshield the panel blocks; above it the windscreen opens up. Forward of
        // the panel (glareshield top, compass) the windscreen reaches down to the sill.
        return x < WINDSCREEN_X - 0.01 ? smooth(GLARESHIELD_Z + 0.015, GLARESHIELD_Z - 0.015, z) : smooth(SILL_Z + 0.02, SILL_Z - 0.02, z);
      default:
        return 0;
    }
  };
}

/** The Cessna 172S cabin (the default of cabinVisibility). */
const C172S_TRACE = makeTraceOut(C172S_VISUAL, windowSdf);

/** Result of cabinVisibility: per-vertex visibility and its ambient cube (6 per vertex: +X +Y +Z -X -Y -Z, model axes). */
export interface CabinVisData {
  vis: Float32Array;
  cube: Float32Array;
}

/**
 * Cabin visibility for a batch of vertices given in aircraft model space: positions and normals (xyz
 * interleaved per vertex) and a per-vertex flag for double-sided surfaces (no meaningful normal: the
 * average of both hemispheres is taken). Pure arithmetic, so it runs in the bake worker too.
 * @param def the airframe whose cabin it is: its box model and glazing (default: the Cessna 172S)
 */
export function cabinVisibility(
  positions: Float32Array,
  normals: Float32Array,
  doubleSided: Uint8Array,
  def: Pick<AirframeVisualDef, 'cockpit' | 'glazing'> = C172S_VISUAL,
): CabinVisData {
  const traceOut = def === C172S_VISUAL ? C172S_TRACE : makeTraceOut(def, makeWindowSdf(def.glazing));
  const count = positions.length / 3;
  const vis = new Float32Array(count);
  const cube = new Float32Array(count * 6);
  const D = LOCAL_DIRS;
  for (let i = 0; i < count; i++) {
    // Model (X, Y, Z) -> body FRD (x, y, z) = (-Z, X, -Y).
    const px = -positions[i * 3 + 2];
    const py = positions[i * 3];
    const pz = -positions[i * 3 + 1];
    let nx = -normals[i * 3 + 2];
    let ny = normals[i * 3];
    let nz = -normals[i * 3 + 1];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // Tangent frame about the normal.
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (Math.abs(nx) < 0.9) {
      // (1, 0, 0) x n
      ty = -nz;
      tz = ny;
    } else {
      // (0, 1, 0) x n
      tx = nz;
      tz = -nx;
    }
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    const sides = doubleSided[i] ? 2 : 1;
    const norm = 1 / (RAYS * sides);
    const c = i * 6;
    let sum = 0;
    for (let side = 0; side < sides; side++) {
      const s = side === 0 ? 1 : -1;
      // Start a couple of centimetres off the surface so a vertex on the shell does not see itself.
      const ox = px + s * nx * 0.02;
      const oy = py + s * ny * 0.02;
      const oz = pz + s * nz * 0.02;
      for (let k = 0; k < D.length; k += 3) {
        const a = D[k];
        const b = D[k + 1];
        const cz = D[k + 2] * s;
        const dx = tx * a + bx * b + nx * cz;
        const dy = ty * a + by * b + ny * cz;
        const dz = tz * a + bz * b + nz * cz;
        const out = traceOut(ox, oy, oz, dx, dy, dz);
        if (out <= 0) continue;
        sum += out;
        // Ambient cube in model axes: X = y, Y = -z, Z = -x (squared cosines sum to 1).
        const w = out * norm;
        const X = dy;
        const Y = -dz;
        const Z = -dx;
        cube[c + (X >= 0 ? 0 : 3)] += w * X * X;
        cube[c + (Y >= 0 ? 1 : 4)] += w * Y * Y;
        cube[c + (Z >= 0 ? 2 : 5)] += w * Z * Z;
      }
    }
    vis[i] = sum * norm;
  }
  return { vis, cube };
}

/** Visibility used until the bake arrives (typical of the cabin as a whole). */
export const CABIN_VIS_DEFAULT = 0.3;

/** One interior geometry and where its vertices go in the batched bake arrays. */
interface CabinBatchItem {
  attribute: THREE.BufferAttribute;
  cubeP: THREE.BufferAttribute;
  cubeN: THREE.BufferAttribute;
  offset: number;
  count: number;
}

/**
 * Collects interior geometries, gives each a `cabinVis` attribute (CABIN_VIS_DEFAULT until baked), and
 * packs their model-space positions and normals for cabinVisibility() - on the main thread or in a worker.
 */
export class CabinBake {
  private readonly items: CabinBatchItem[] = [];
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly dbl: number[] = [];
  private readonly p = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly nm = new THREE.Matrix3();

  add(geometry: THREE.BufferGeometry, toModel: THREE.Matrix4, doubleSided: boolean): void {
    const pos = geometry.getAttribute('position');
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const nrm = geometry.getAttribute('normal');
    let attr = geometry.getAttribute('cabinVis') as THREE.BufferAttribute | undefined;
    if (!attr) {
      attr = new THREE.BufferAttribute(new Float32Array(pos.count).fill(CABIN_VIS_DEFAULT), 1);
      geometry.setAttribute('cabinVis', attr);
    } else return; // shared geometry already queued
    // Until baked the cube is empty and the shader falls back to the normal direction.
    const cubeP = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    const cubeN = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    geometry.setAttribute('cabinCubeP', cubeP);
    geometry.setAttribute('cabinCubeN', cubeN);
    this.nm.getNormalMatrix(toModel);
    this.items.push({ attribute: attr, cubeP, cubeN, offset: this.dbl.length, count: pos.count });
    for (let i = 0; i < pos.count; i++) {
      this.p.fromBufferAttribute(pos, i).applyMatrix4(toModel);
      this.n.fromBufferAttribute(nrm, i).applyMatrix3(this.nm).normalize();
      this.pos.push(this.p.x, this.p.y, this.p.z);
      this.nrm.push(this.n.x, this.n.y, this.n.z);
      this.dbl.push(doubleSided ? 1 : 0);
    }
  }

  get vertexCount(): number {
    return this.dbl.length;
  }

  /** The packed inputs of cabinVisibility(). */
  inputs(): { positions: Float32Array; normals: Float32Array; doubleSided: Uint8Array } {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), doubleSided: new Uint8Array(this.dbl) };
  }

  /**
   * Distribute a cabinVisibility() result into the geometries' attributes. The cube stays in model axes
   * (the shader maps it with the aircraft root's rotation), whatever each mesh's own placement.
   */
  apply(data: CabinVisData): void {
    const { vis, cube } = data;
    for (const it of this.items) {
      (it.attribute.array as Float32Array).set(vis.subarray(it.offset, it.offset + it.count));
      it.attribute.needsUpdate = true;
      const p = it.cubeP.array as Float32Array;
      const n = it.cubeN.array as Float32Array;
      for (let v = 0; v < it.count; v++) {
        const c = (it.offset + v) * 6;
        p[v * 3] = cube[c];
        p[v * 3 + 1] = cube[c + 1];
        p[v * 3 + 2] = cube[c + 2];
        n[v * 3] = cube[c + 3];
        n[v * 3 + 1] = cube[c + 4];
        n[v * 3 + 2] = cube[c + 5];
      }
      it.cubeP.needsUpdate = true;
      it.cubeN.needsUpdate = true;
    }
  }

  /** Bake synchronously on this thread, for the cabin of `def` (default: the Cessna 172S). */
  bakeNow(def?: Pick<AirframeVisualDef, 'cockpit' | 'glazing'>): void {
    const i = this.inputs();
    this.apply(cabinVisibility(i.positions, i.normals, i.doubleSided, def));
  }
}

// --- Inter-reflected (bounce) light ------------------------------------------------------------------

// The glazing panels (outward unit normal, FRD, and area, m^2) and the interior surface area (floor,
// headliner, sides, panel, bulkhead and seats, less the glazing) are the definition's: CockpitDef.glazingPanels
// and .interiorArea.
/** Glazing transmittance (glass material opacity 0.14 plus reflection). */
const GLASS_T = 0.84;
/**
 * Area-weighted linear albedo of the cabin: lining and trim (~0.38, 60 %), seats (~0.07, 15 %), carpet
 * (~0.04, 15 %), panel and glareshield (~0.02, 10 %).
 */
const CABIN_ALBEDO = [0.253, 0.249, 0.242] as const;
/** Albedo of the ground seen through the lower half of the side windows. */
const GROUND_ALBEDO = 0.14;

/**
 * Shared uniform: irradiance (scene units, like a light's colour x intensity) on interior surfaces from
 * light bounced inside the cabin. Updated by updateCabinBounce(); read by every patched cabin material.
 */
export const cabinBounce = { value: new THREE.Color(0, 0, 0) };

const _sun = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Update `cabinBounce` from the sky state and the aircraft attitude (`modelToWorld`: the aircraft root's
 * world quaternion). `extraFlux` adds interior sources (lumens x SCENE_UNITS_PER_LUX, linear RGB), e.g. the
 * panel flood light. `cabin` is the cockpit of the airframe (default: the Cessna 172S). Returns the uniform's
 * colour.
 */
export function updateCabinBounce(
  sky: SkyState,
  modelToWorld: THREE.Quaternion,
  extraFlux?: THREE.Color,
  cabin: Pick<CockpitDef, 'glazingPanels' | 'interiorArea'> = C172S_VISUAL.cockpit,
): THREE.Color {
  // Sun direction in body axes: world -> model (inverse attitude), then model (X, Y, Z) -> FRD (-Z, X, -Y).
  _sun.copy(sky.sunDir).applyQuaternion(_q.copy(modelToWorld).invert());
  const sx = -_sun.z;
  const sy = _sun.x;
  const sz = -_sun.y;
  // Sun beam through the glazing: projected area of each panel toward the sun. The wing above the cabin
  // shades the windscreen's upper part and the rear window when the sun is high; the airframe's shadow on
  // the cabin interior is the skin's job, this is only the flux budget.
  let projected = 0;
  let glazingArea = 0;
  for (const g of cabin.glazingPanels) {
    projected += g.area * Math.max(0, g.n[0] * sx + g.n[1] * sy + g.n[2] * sz);
    glazingArea += g.area;
  }
  const upSun = Math.max(0, sky.sunDir.y);
  const out = cabinBounce.value;
  const c = sky.sunColor;
  const k = sky.skyColor;
  const m = sky.moonColor;
  for (let ch = 0; ch < 3; ch++) {
    const sun = ch === 0 ? c.r : ch === 1 ? c.g : c.b;
    const skyL = ch === 0 ? k.r : ch === 1 ? k.g : k.b;
    const moon = ch === 0 ? m.r : ch === 1 ? m.g : m.b;
    // Diffuse radiance at the windows: sky above, sunlit ground below (half of the glazing each).
    const groundL = GROUND_ALBEDO * ((sun * upSun + moon) / Math.PI + skyL);
    const diffuseFlux = glazingArea * Math.PI * (0.5 * skyL + 0.5 * groundL);
    const beamFlux = sun * projected;
    let flux = GLASS_T * (diffuseFlux + beamFlux);
    if (extraFlux) flux += ch === 0 ? extraFlux.r : ch === 1 ? extraFlux.g : extraFlux.b;
    const rho = CABIN_ALBEDO[ch];
    const e = ((rho / (1 - rho)) * flux) / cabin.interiorArea;
    if (ch === 0) out.r = e;
    else if (ch === 1) out.g = e;
    else out.b = e;
  }
  return out;
}

// --- Interior lamps ----------------------------------------------------------------------------------

/**
 * Interior lamps, evaluated only in the patched cabin materials (no scene lights, so nothing outside is
 * lit and no other shader changes). Positions are aircraft model space; `cabinModelFromWorld` is the
 * inverse of the aircraft root's world matrix, updated every frame.
 *
 * - Flood: the overhead-console panel flood light between the front seats, aimed at the instrument panel.
 *   Intensity in candela x SCENE_UNITS_PER_LUX (colour carries it). Surfaces forward of the panel face and
 *   below the glareshield top are hidden from it by the panel.
 * - Dome: the dome light in the headliner over the rear seats, a downward Lambertian emitter.
 */
export const cabinLamps = {
  cabinModelFromWorld: { value: new THREE.Matrix4() },
  floodPos: { value: new THREE.Vector3() },
  floodAxis: { value: new THREE.Vector3(0, -1, 0) },
  floodColor: { value: new THREE.Color(0, 0, 0) },
  /** cos of the outer and inner cone half-angles. */
  floodCone: { value: new THREE.Vector2(Math.cos((44 * Math.PI) / 180), Math.cos((24 * Math.PI) / 180)) },
  /** Panel face (model z of its plane, aft of which the flood reaches everything) and the glareshield top (model y). */
  floodMask: { value: new THREE.Vector2(0, 0) },
  domePos: { value: new THREE.Vector3() },
  domeColor: { value: new THREE.Color(0, 0, 0) },
};

/**
 * Make a material use the per-vertex `cabinVis` attribute as its ambient occlusion (in place of aoMap).
 * Every mesh drawn with the returned material must carry the attribute.
 */
const LAMP_UNIFORMS = /* glsl */ `
uniform mat4 cabinModelFromWorld;
uniform vec3 floodPos;
uniform vec3 floodAxis;
uniform vec3 floodColor;
uniform vec2 floodCone;
uniform vec2 floodMask;
uniform vec3 domePos;
uniform vec3 domeColor;
`;

const LAMP_GLSL = /* glsl */ `
	if ( floodColor.r + domeColor.r > 0.0 ) {
		vec3 mp = ( cabinModelFromWorld * vec4( vCabinWorld, 1.0 ) ).xyz;
		vec3 mn = normalize( mat3( cabinModelFromWorld ) * inverseTransformDirection( normal, viewMatrix ) );
		vec3 brdf = BRDF_Lambert( material.diffuseContribution );
		// Flood: spot cone; the panel shadows everything forward of its face below the glareshield top.
		vec3 toF = floodPos - mp;
		float dF = max( dot( toF, toF ), 1e-3 );
		vec3 lF = toF * inversesqrt( dF );
		float cone = smoothstep( floodCone.x, floodCone.y, dot( -lF, floodAxis ) );
		float behindPanel = step( floodMask.x - 0.004, mp.z ) + step( floodMask.y, mp.y );
		reflectedLight.directDiffuse += floodColor * ( cone * min( behindPanel, 1.0 ) * saturate( dot( mn, lF ) ) / dF ) * brdf;
		// Dome: Lambertian emitter facing down.
		vec3 toD = domePos - mp;
		float dD = max( dot( toD, toD ), 1e-3 );
		vec3 lD = toD * inversesqrt( dD );
		reflectedLight.directDiffuse += domeColor * ( saturate( lD.y ) * saturate( dot( mn, lD ) ) / dD ) * brdf;
	}
`;

/**
 * Replaces the environment irradiance lookup along the normal: the irradiance of each model axis direction
 * the vertex sees out along, weighted by its share of the visibility (normalised: the ambientOcclusion
 * factor applied later scales it by the visibility itself). Before the bake arrives the cube is empty.
 */
const CABIN_ENV_GLSL = /* glsl */ `
	{
		float cubeSum = dot( vCabinCubeP + vCabinCubeN, vec3( 1.0 ) );
		if ( cubeSum > 1e-4 ) {
			// Model axes in view space (the aircraft root carries no scale).
			mat3 m = mat3( viewMatrix ) * transpose( mat3( cabinModelFromWorld ) );
			vec3 e = vCabinCubeP.x * getIBLIrradiance( m[ 0 ] ) + vCabinCubeN.x * getIBLIrradiance( - m[ 0 ] )
				+ vCabinCubeP.y * getIBLIrradiance( m[ 1 ] ) + vCabinCubeN.y * getIBLIrradiance( - m[ 1 ] )
				+ vCabinCubeP.z * getIBLIrradiance( m[ 2 ] ) + vCabinCubeN.z * getIBLIrradiance( - m[ 2 ] );
			iblIrradiance += e / cubeSum;
		} else {
			iblIrradiance += getIBLIrradiance( geometryNormal );
		}
	}
`;

export function patchCabinMaterial<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.aoMap = null;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.uniforms.cabinBounce = cabinBounce;
    Object.assign(shader.uniforms, cabinLamps);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float cabinVis;\nattribute vec3 cabinCubeP;\nattribute vec3 cabinCubeN;\nvarying float vCabinVis;\nvarying vec3 vCabinCubeP;\nvarying vec3 vCabinCubeN;\nvarying vec3 vCabinWorld;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvCabinVis = cabinVis;\n\tvCabinCubeP = cabinCubeP;\n\tvCabinCubeN = cabinCubeN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvCabinWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    // The only point lights in the scene are the aircraft's own strobe and beacon flashes, which cast no
    // shadows: without this they would light the cabin through the fuselage skin.
    // (The chunk is read at compile time: the sky module patches it globally for its shadow cascades.)
    const lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lightsBegin);
    // Environment irradiance from the directions the vertex sees out of (the ambient cube), not its normal.
    const envLine = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
    if (!THREE.ShaderChunk.lights_fragment_maps.includes(envLine)) throw new Error('cabinLight: lights_fragment_maps changed');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace(envLine, CABIN_ENV_GLSL));
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n#define CABIN_VIS\nvarying float vCabinVis;\nvarying vec3 vCabinCubeP;\nvarying vec3 vCabinCubeN;\nvarying vec3 vCabinWorld;\nuniform vec3 cabinBounce;\n' + LAMP_UNIFORMS).replace(
      '#include <aomap_fragment>',
      /* glsl */ `
	// The part of the hemisphere that sees outside keeps the environment light; the rest sees the cabin's
	// own surfaces, lit by what came in through the windows (cabinBounce).
	float ambientOcclusion = vCabinVis;
	reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * ambientOcclusion
		+ ( 1.0 - ambientOcclusion ) * cabinBounce * BRDF_Lambert( material.diffuseContribution );
	// Likewise the occluded part of the reflection mirrors the cabin (mean radiance cabinBounce / PI, see
	// updateCabinBounce), not the blue sky the environment map holds.
	reflectedLight.indirectSpecular += ( 1.0 - ambientOcclusion ) * cabinBounce * RECIPROCAL_PI * material.specularColorBlended;
	#if defined( USE_CLEARCOAT )
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN )
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
	${LAMP_GLSL}
`,
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `cabinVis2|${key()}`;
  m.needsUpdate = true;
  return m;
}
