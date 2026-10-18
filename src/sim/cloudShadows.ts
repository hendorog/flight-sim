// Scene-wide material patches that join modules together (integration layer):
//
// 1. CLOUD SHADOWS on the direct sunlight of every lit material (render/clouds + the sky module's shared
//    light chunk). The clouds module can darken the frame under cloud shadows in its composite pass, but it
//    does so from depth and scales the whole pixel, so ambient light is darkened too: the cockpit interior
//    and the aircraft went dim under a cloud although only the sun is blocked. Here the shadow is applied
//    where it belongs, to light 0's colour (the sun or moon) inside the cascaded-shadow block SunShadows.ts
//    installs in THREE.ShaderChunk.lights_fragment_begin, and the composite shadows are switched off.
// 2. GROUND FOG on the same sun term (render/weather/fogGlsl.ts, WeatherSettings.fogTopM / fogVisibilityM). A
//    fragment inside the fog layer receives the direct beam through the fog between it and the layer top along the
//    sun direction: light 0's colour is scaled by exp(-tau), so the aircraft's cascade shadow fades with the beam.
//    The beam the fog removes is returned as diffuse light (through RE_IndirectDiffuse, unshadowed by the cascades)
//    up to the layer's total transmission (FOG_DIFFUSE_K), so a lit and a shaded face differ less. Without
//    a fog layer (uFog.w = 0) the block is skipped by a uniform branch and the shading is unchanged.
// 3. APRON FLOODLIGHT POOLS (world/airport injectFloodlight) on the player aircraft's exterior and the
//    terrain ground / airfield grass, which the airport's own materials alone did not cover (a lit apron
//    next to a dark aircraft and dark grass). The cabin is left out: it would be lit through the skin.
//
// Mechanism: the cloud-shadow chunk code compiles only under USE_CLOUD_SHADOW. SceneMaterialPatches walks
// the scene and opts every MeshStandardMaterial / MeshPhysicalMaterial in: it wraps the material's
// onBeforeCompile (keeping the module's own patch) to add the define, uniforms and floodlight code, and
// extends its program cache key. New materials (terrain tiles, trees) are picked up by a periodic scan.

import * as THREE from 'three';
import '../render/sky/SunShadows'; // the cascade patch must be installed before this one
import { CLOUD_SHADOW_GLSL, type CloudShadowUniforms } from '../render/clouds';
import { injectFloodlight, type SharedUniforms } from '../world/airport';
import type { WeatherSettings } from '../core/types';
import { FOG_GLSL, fogUniformValue } from '../render/weather/fogGlsl';
import { FOG_SUN_G, FOG_SUN_MIN_MU } from '../render/weather/fogModel';

/**
 * How strongly the cloud transmittance dims the sun. The map stores the direct beam only, exp(-tau); the light a
 * cloud transmits diffusely is in the sky module's cloud-aware ambient, so thick cloud cuts the sun completely.
 */
const MATERIAL_SHADOW_STRENGTH = 1.0;
/** Rescan the scene for new materials every this many frames. */
const SCAN_PERIOD = 20;
/** Terrain materials (by name) that receive the apron floodlight pools. */
const FLOODLIT_TERRAIN = new Set(['terrain', 'airfield-grass']);

/**
 * Total (direct + diffuse) transmission of the fog layer, two-stream (Eddington) approximation for a non-absorbing
 * layer: T = 1 / (1 + FOG_DIFFUSE_K (1 - g) tau), tau the vertical optical depth above the fragment, g = FOG_SUN_G.
 * Ground reflection and the incidence angle are left out; unconfirmed as a match for this fog layer.
 */
const FOG_DIFFUSE_K = 0.75;

const EARTH_SHADOW_END = 'directLight.color *= min( 1.0, csmLitF / max( csmLitC, 1e-3 ) );\n\t}';

function installChunks(): void {
  const frag = THREE.ShaderChunk.lights_fragment_begin;
  if (!frag.includes('Cloud shadows (src/sim/cloudShadows.ts)')) {
    const at = frag.indexOf(EARTH_SHADOW_END);
    if (at < 0) throw new Error('cloudShadows: the SunShadows cascade block changed; update the anchor');
    const patch = /* glsl */ `

	// Cloud shadows (src/sim/cloudShadows.ts): the sun is dimmed by the cloud layer above this fragment.
	#ifdef USE_CLOUD_SHADOW
	directLight.color *= cloudShadow( transpose( mat3( viewMatrix ) ) * geometryPosition + cameraPosition );

	// Ground fog (src/sim/cloudShadows.ts): the direct sun is dimmed by the fog between this fragment and the layer
	// top along the sun; the removed beam returns as diffuse light up to the layer's total transmission.
	if ( uFog.w > 0.5 ) {
		mat3 fsViewToWorld = transpose( mat3( viewMatrix ) );
		vec3 fsPos = fsViewToWorld * geometryPosition + cameraPosition;
		float fsSunY = ( fsViewToWorld * directLight.direction ).y;
		float fsMu = max( fsSunY, ${FOG_SUN_MIN_MU.toFixed(3)} );
		float fsRise = max( uFog.z - fsPos.y, 0.0 );
		// The layer is horizontally uniform: the slant optical depth is the vertical one over mu.
		float fsTau = fogOpticalDepth( fsPos, fsPos + vec3( 0.0, fsRise, 0.0 ) ) / fsMu;
		float fsDirect = exp( -fsTau );
		float fsTotal = 1.0 / ( 1.0 + ${(FOG_DIFFUSE_K * (1 - FOG_SUN_G)).toFixed(4)} * fsTau * fsMu );
		vec3 fsDiffuse = directLight.color * ( max( fsSunY, 0.0 ) * max( fsTotal - fsDirect, 0.0 ) );
		directLight.color *= fsDirect;
		RE_IndirectDiffuse( fsDiffuse, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#endif`;
    const end = at + EARTH_SHADOW_END.length;
    THREE.ShaderChunk.lights_fragment_begin = frag.slice(0, end) + patch + frag.slice(end);
  }
  const pars = THREE.ShaderChunk.lights_pars_begin;
  if (!pars.includes('float cloudShadow(')) {
    THREE.ShaderChunk.lights_pars_begin = `${pars}\n#ifdef USE_CLOUD_SHADOW\n${CLOUD_SHADOW_GLSL}\n${FOG_GLSL}\n#endif\n`;
  }
}
installChunks();

const PATCHED = Symbol('scenePatched');
type Patchable = THREE.MeshStandardMaterial & { [PATCHED]?: true };
const defaultCacheKey = THREE.Material.prototype.customProgramCacheKey;

function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material;
  return !m ? [] : Array.isArray(m) ? m : [m];
}

export class SceneMaterialPatches {
  /** Uniforms given to the materials: the clouds' map and params by reference, our own light/strength. */
  private readonly uniforms: CloudShadowUniforms;
  /** The ground fog (fogGlsl.ts uFog), written from the weather in update(). */
  readonly fog: THREE.IUniform<THREE.Vector4> = { value: new THREE.Vector4(0, 0, 0, 0) };
  /** Aircraft exterior materials to floodlight (collected once from the aircraft root). */
  private readonly floodlitAircraft = new Set<THREE.Material>();
  private frame = 0;
  /** Materials opted in so far, and how many of them also got the floodlight pools (diagnostics). */
  patched = 0;
  floodlit = 0;

  /**
   * @param source   CloudsEffect.shadowUniforms
   * @param flood    AirportSystem.shared (floodlight pools), or null for none
   * @param aircraft root of the player aircraft model; its `cockpit` subtree (the cabin) is not floodlit
   */
  constructor(
    private readonly source: CloudShadowUniforms,
    private readonly flood: SharedUniforms | null,
    aircraft: THREE.Object3D | null,
  ) {
    this.uniforms = {
      cloudShadowMap: source.cloudShadowMap,
      cloudShadowParams: source.cloudShadowParams,
      cloudShadowLight: { value: new THREE.Vector4(0, 1, 0, 0) },
    };
    if (aircraft && flood) {
      const cabin = new Set<THREE.Material>();
      aircraft.getObjectByName('cockpit')?.traverse((o) => materialsOf(o).forEach((m) => cabin.add(m)));
      aircraft.traverse((o) => materialsOf(o).forEach((m) => cabin.has(m) || this.floodlitAircraft.add(m)));
    }
  }

  /**
   * Call once per frame before the scene renders. The clouds effect refreshes its map and light during
   * post, so materials see the previous frame's shadows (map and parameters stay consistent). The fog uniform
   * is computed from `weather` for this frame; without a weather it stays as it is ((0, 0, 0, 0) at first: no fog).
   */
  update(scene: THREE.Object3D, weather?: WeatherSettings): void {
    if (weather) fogUniformValue(weather, this.fog.value);
    const src = this.source.cloudShadowLight.value;
    this.uniforms.cloudShadowLight.value.set(src.x, src.y, src.z, src.w > 0 ? MATERIAL_SHADOW_STRENGTH : 0);
    if (this.frame++ % SCAN_PERIOD === 0) this.scan(scene);
  }

  /** Opt in every lit material under `root` that is not yet patched. */
  scan(root: THREE.Object3D): void {
    root.traverse((o) => {
      for (const m of materialsOf(o)) this.patch(m);
    });
  }

  private patch(material: THREE.Material): void {
    const m = material as Patchable;
    if (m[PATCHED] || !(m instanceof THREE.MeshStandardMaterial)) return;
    m[PATCHED] = true;
    this.patched++;
    const uniforms = this.uniforms;
    const fog = this.fog;
    const flood = this.flood && (this.floodlitAircraft.has(m) || FLOODLIT_TERRAIN.has(m.name)) ? this.flood : null;
    if (flood) this.floodlit++;
    const previous = m.onBeforeCompile;
    const ownKey = m.customProgramCacheKey !== defaultCacheKey ? m.customProgramCacheKey : null;
    const previousKey = ownKey ? null : previous.toString();
    const suffix = flood ? '|cloudShadow|flood' : '|cloudShadow';
    m.onBeforeCompile = function (shader, renderer) {
      previous.call(this, shader, renderer);
      shader.uniforms.cloudShadowMap = uniforms.cloudShadowMap;
      shader.uniforms.cloudShadowParams = uniforms.cloudShadowParams;
      shader.uniforms.cloudShadowLight = uniforms.cloudShadowLight;
      shader.uniforms.uFog = fog;
      shader.fragmentShader = `#define USE_CLOUD_SHADOW\n${shader.fragmentShader}`;
      if (flood && !shader.uniforms.uFloodPos) injectFloodlight(shader, flood);
    };
    m.customProgramCacheKey = function () {
      return `${ownKey ? ownKey.call(this) : previousKey}${suffix}`;
    };
    m.needsUpdate = true;
  }
}
