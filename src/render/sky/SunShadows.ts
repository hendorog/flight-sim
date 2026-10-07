// Cascaded shadow maps for the sun (or moon), built from ordinary DirectionalLights so every built-in
// three.js material receives them without per-material setup.
//
// The same patch applies the Earth's shadow per fragment (see the block below).
//
// Each cascade is a DirectionalLight with its own shadow map, fitted to a bounding sphere of one slice
// of the view frustum (rotation-invariant size) and snapped to its texel grid (no shimmer when the
// camera moves). A patched lights_fragment_begin chunk lights the fragment once, with light 0's colour,
// and takes the shadow from the finest cascade whose map covers it, cross-fading near map edges; the
// other lights carry no colour. The patch is installed when this module is imported, before any
// material compiles.

import * as THREE from 'three';
import type { QualityLevel } from '../../core/context';
import { EARTH_RADIUS_KM, SUN_ANGULAR_RADIUS } from './params';

interface CascadeConfig {
  /** Far distance of each cascade along the view axis, m. */
  splits: number[];
  mapSize: number;
  /** Re-render cascade i every updatePeriod[i] frames; far cascades change slowly. */
  updatePeriod: number[];
}

const CASCADES: Record<QualityLevel, CascadeConfig> = {
  low: { splits: [20, 600], mapSize: 1024, updatePeriod: [1, 2] },
  medium: { splits: [8, 80, 1500], mapSize: 2048, updatePeriod: [1, 1, 2] },
  // The last cascade of high and ultra reaches far enough for ridges to shade valleys at low sun as seen
  // from altitude; it re-renders every 4th frame (its texels are 10-25 m, so the lag is invisible).
  high: { splits: [6, 40, 300, 2500, 12000], mapSize: 2048, updatePeriod: [1, 1, 1, 2, 4] },
  ultra: { splits: [5, 30, 180, 1200, 6000, 25000], mapSize: 2048, updatePeriod: [1, 1, 1, 1, 2, 4] },
};

/** Fraction of a cascade's map (from its edge) over which it fades into the next cascade. */
const CASCADE_BLEND = 0.05;
/** PCF kernel radius, texels. */
const PCF_RADIUS = 1.5;

const EARTH_RADIUS_M = EARTH_RADIUS_KM * 1000;
/** Half-width of the terminator blend, rad: the sun's radius plus a little for refraction. */
const TERMINATOR_WIDTH = (SUN_ANGULAR_RADIUS * 1.5).toFixed(6);

const DIRECTIONAL_BLOCK_START = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';

const CASCADED_DIRECTIONAL_BLOCK = /* glsl */ `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

	// Cascaded sun shadows (src/render/sky/SunShadows.ts): light 0 carries the sun's colour, every
	// shadow-casting directional light is one cascade of it.
	DirectionalLight directionalLight = directionalLights[ 0 ];
	getDirectionalLightInfo( directionalLight, directLight );

	// Earth's shadow: the light's colour is computed for the camera's altitude, so scale it by the
	// planet shadow at this fragment's altitude relative to the camera's (flat scene geometry: the light's
	// elevation is the same everywhere, only the altitude differs). After sunset at
	// the ground an aircraft at altitude stays lit while the terrain below goes dark.
	{
		mat3 csmViewToWorld = transpose( mat3( viewMatrix ) );
		vec3 csmOffset = csmViewToWorld * geometryPosition;
		float csmMu = ( csmViewToWorld * directLight.direction ).y;
		float csmSinF = ${EARTH_RADIUS_M.toFixed(1)} / ( ${EARTH_RADIUS_M.toFixed(1)} + max( cameraPosition.y + csmOffset.y, 0.0 ) );
		float csmSinC = ${EARTH_RADIUS_M.toFixed(1)} / ( ${EARTH_RADIUS_M.toFixed(1)} + max( cameraPosition.y, 0.0 ) );
		float csmLitF = smoothstep( -${TERMINATOR_WIDTH}, ${TERMINATOR_WIDTH}, ( csmMu + sqrt( 1.0 - csmSinF * csmSinF ) ) / csmSinF );
		float csmLitC = smoothstep( -${TERMINATOR_WIDTH}, ${TERMINATOR_WIDTH}, ( csmMu + sqrt( 1.0 - csmSinC * csmSinC ) ) / csmSinC );
		directLight.color *= min( 1.0, csmLitF / max( csmLitC, 1e-3 ) );
	}

	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	if ( directLight.visible && receiveShadow ) {

		DirectionalLightShadow directionalLightShadow;
		float csmShadow = 0.0;
		float csmRemaining = 1.0;
		vec3 csmCoord;
		vec2 csmEdge;
		float csmWeight;
		// three's hardware-PCF getShadow adds the bias whatever the depth convention (its VSM and basic
		// paths flip it for reversed-Z). The bias is set for forward depth (toward the light = smaller z),
		// so flip it here, or under reversed-Z it would push receivers away from the light (acne).
		#if defined( USE_REVERSED_DEPTH_BUFFER ) && defined( SHADOWMAP_TYPE_PCF )
			const float csmBiasSign = -1.0;
		#else
			const float csmBiasSign = 1.0;
		#endif

		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			csmCoord = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
			csmEdge = min( csmCoord.xy, 1.0 - csmCoord.xy );
			// Inside the cascade's depth slab in either depth convention: with reversed-Z the shadow camera's
			// far plane maps to 0, so a fragment beyond it has z < 0 and would compare as occluded against
			// the map (cleared to 0). Such fragments fall through to the next, larger cascade.
			csmWeight = csmCoord.z >= 0.0 && csmCoord.z <= 1.0 ? csmRemaining * clamp( min( csmEdge.x, csmEdge.y ) * ${(1 / CASCADE_BLEND).toFixed(1)}, 0.0, 1.0 ) : 0.0;
			if ( csmWeight > 0.0 ) {
				directionalLightShadow = directionalLightShadows[ i ];
				csmShadow += csmWeight * getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, csmBiasSign * directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );
				csmRemaining -= csmWeight;
			}
		}
		#pragma unroll_loop_end

		directLight.color *= csmShadow + csmRemaining;

	}
	#endif

	RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

#endif`;

function installCascadeShadowChunk(): void {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  if (src.includes('Cascaded sun shadows')) return;
  const start = src.indexOf(DIRECTIONAL_BLOCK_START);
  const loopEnd = src.indexOf('#pragma unroll_loop_end', start);
  const end = src.indexOf('#endif', loopEnd);
  if (start < 0 || loopEnd < 0 || end < 0) throw new Error('SunShadows: lights_fragment_begin layout changed; update the cascade patch');
  THREE.ShaderChunk.lights_fragment_begin = src.slice(0, start) + CASCADED_DIRECTIONAL_BLOCK + src.slice(end + '#endif'.length);
}
installCascadeShadowChunk();

/**
 * Specular anti-aliasing (Tokuyoshi & Kaplanyan 2019, "Improved Geometric Specular Antialiasing"): the
 * screen-space variance of the shading normal (normal maps, procedural water waves, curved panels
 * seen edge-on) widens the specular lobe, so sub-pixel highlights neither sparkle nor crawl. Installed
 * into the shared lights_physical_fragment chunk, like the cascade patch, for every standard/physical
 * material. three already widens it for the interpolated geometric normal; this adds the perturbed one.
 */
function installSpecularAntialiasing(): void {
  const src = THREE.ShaderChunk.lights_physical_fragment;
  if (src.includes('Specular anti-aliasing')) return;
  const anchor = 'material.roughness = min( material.roughness, 1.0 );';
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error('SunShadows: lights_physical_fragment layout changed; update the specular AA patch');
  const patch = /* glsl */ `
	// Specular anti-aliasing (src/render/sky/SunShadows.ts): alpha^2 += min(2 sigma^2, 0.18), alpha = roughness^2.
	{
		vec3 saaDx = dFdx( normal );
		vec3 saaDy = dFdy( normal );
		float saaKernel = min( 0.5 * ( dot( saaDx, saaDx ) + dot( saaDy, saaDy ) ), 0.18 );
		float saaA2 = material.roughness * material.roughness * material.roughness * material.roughness;
		material.roughness = sqrt( sqrt( min( saaA2 + saaKernel, 1.0 ) ) );
	}`;
  THREE.ShaderChunk.lights_physical_fragment = src.slice(0, at + anchor.length) + patch + src.slice(at + anchor.length);
}
installSpecularAntialiasing();

const _forward = new THREE.Vector3();
const _center = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _up = new THREE.Vector3();

export class SunShadows {
  readonly group = new THREE.Group();
  private lights: THREE.DirectionalLight[] = [];
  private config: CascadeConfig = CASCADES.high;
  private frame = 0;

  constructor() {
    this.group.name = 'sunShadowCascades';
  }

  /** Rebuild the cascades for a quality level (changes the light count, so materials recompile once). */
  setQuality(q: QualityLevel): void {
    this.config = CASCADES[q];
    for (const l of this.lights) {
      l.shadow.dispose();
      this.group.remove(l, l.target);
    }
    this.lights = this.config.splits.map((_, i) => {
      const light = new THREE.DirectionalLight(0xffffff, i === 0 ? 1 : 0);
      light.name = `sunCascade${i}`;
      light.castShadow = true;
      light.shadow.mapSize.set(this.config.mapSize, this.config.mapSize);
      light.shadow.radius = PCF_RADIUS;
      light.shadow.autoUpdate = false;
      this.group.add(light, light.target);
      return light;
    });
    this.frame = 0;
  }

  /**
   * Point the cascades along `lightDir` (unit, toward the light) with colour `color` and refit them to
   * the camera. Shadow maps re-render only when the light is bright enough to matter. Only the first
   * `cascades` cascades cast shadows (moonlight: faint shadows matter only close by); the others keep
   * their maps but are switched off through their shadow intensity (a uniform, so no recompile) and are
   * not re-rendered.
   */
  update(camera: THREE.PerspectiveCamera, lightDir: THREE.Vector3, color: THREE.Color, cascades = Infinity): void {
    const lit = color.r + color.g + color.b > 1e-7;
    // Colour only: hiding the light would change the light count and recompile every material.
    this.lights[0].color.copy(color);

    camera.updateMatrixWorld();
    _forward.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const camPos = camera.getWorldPosition(_camPos);
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const k2 = tanY * tanY * (1 + camera.aspect * camera.aspect);

    // Light-space basis, identical to the one Object3D.lookAt builds for the shadow camera.
    _up.set(0, Math.abs(lightDir.y) > 0.99 ? 0 : 1, Math.abs(lightDir.y) > 0.99 ? 1 : 0);
    _x.crossVectors(_up, lightDir).normalize();
    _y.crossVectors(lightDir, _x);

    const { splits, mapSize, updatePeriod } = this.config;
    let near = camera.near;
    this.lights.forEach((light, i) => {
      const far = splits[i];
      const sliceNear = near;
      near = far;
      const active = i < cascades;
      if (light.shadow.intensity !== (active ? 1 : 0)) {
        light.shadow.intensity = active ? 1 : 0;
        // Refit and re-render as soon as it is switched back on.
        if (active) light.shadow.needsUpdate = true;
      }
      if (!active && this.frame > 0) return;
      // Maps must exist before a material samples them, so the first frame always renders.
      // Staggered by cascade index so the slow cascades do not all re-render on the same frame.
      if (this.frame > 0 && active && !light.shadow.needsUpdate && (!lit || (this.frame + i) % updatePeriod[i] !== 0)) return;

      // Smallest sphere around the frustum slice [sliceNear, far]; depends only on fov and aspect.
      const c = Math.min(far, ((far + sliceNear) * (1 + k2)) / 2);
      const radius = Math.sqrt((far - c) ** 2 + far * far * k2);
      _center.copy(camPos).addScaledVector(_forward, c);

      const texel = (2 * radius) / mapSize;
      const cx = Math.round(_center.dot(_x) / texel) * texel;
      const cy = Math.round(_center.dot(_y) / texel) * texel;
      const cz = _center.dot(lightDir);
      _center.copy(_x).multiplyScalar(cx).addScaledVector(_y, cy).addScaledVector(lightDir, cz);

      // Casters up to `margin` beyond the sphere toward the light (terrain relief, the wing over the cabin).
      const margin = THREE.MathUtils.clamp(radius, 100, 30_000);
      light.target.position.copy(_center);
      light.position.copy(_center).addScaledVector(lightDir, radius + margin);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();

      const cam = light.shadow.camera;
      cam.up.copy(_up);
      cam.left = -radius;
      cam.right = radius;
      cam.top = radius;
      cam.bottom = -radius;
      cam.near = 0;
      cam.far = 2 * radius + margin;
      cam.updateProjectionMatrix();
      light.shadow.bias = (-0.5 * texel) / cam.far;
      light.shadow.normalBias = 1.2 * texel;
      light.shadow.needsUpdate = true;
    });
    this.frame++;
  }

  dispose(): void {
    for (const l of this.lights) l.shadow.dispose();
    this.group.removeFromParent();
  }
}
