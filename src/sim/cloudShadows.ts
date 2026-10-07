// Scene-wide material patches that join modules together (integration layer):
//
// 1. CLOUD SHADOWS on the direct sunlight of every lit material (render/clouds + the sky module's shared
//    light chunk). The clouds module can darken the frame under cloud shadows in its composite pass, but it
//    does so from depth and scales the whole pixel, so ambient light is darkened too: the cockpit interior
//    and the aircraft went dim under a cloud although only the sun is blocked. Here the shadow is applied
//    where it belongs, to light 0's colour (the sun or moon) inside the cascaded-shadow block SunShadows.ts
//    installs in THREE.ShaderChunk.lights_fragment_begin, and the composite shadows are switched off.
// 2. APRON FLOODLIGHT POOLS (world/airport injectFloodlight) on the player aircraft's exterior and the
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

/**
 * How strongly the cloud transmittance dims the sun. The map stores the direct beam only, exp(-tau); the light a
 * cloud transmits diffusely is in the sky module's cloud-aware ambient, so thick cloud cuts the sun completely.
 */
const MATERIAL_SHADOW_STRENGTH = 1.0;
/** Rescan the scene for new materials every this many frames. */
const SCAN_PERIOD = 20;
/** Terrain materials (by name) that receive the apron floodlight pools. */
const FLOODLIT_TERRAIN = new Set(['terrain', 'airfield-grass']);

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
	#endif`;
    const end = at + EARTH_SHADOW_END.length;
    THREE.ShaderChunk.lights_fragment_begin = frag.slice(0, end) + patch + frag.slice(end);
  }
  const pars = THREE.ShaderChunk.lights_pars_begin;
  if (!pars.includes('float cloudShadow(')) {
    THREE.ShaderChunk.lights_pars_begin = `${pars}\n#ifdef USE_CLOUD_SHADOW\n${CLOUD_SHADOW_GLSL}\n#endif\n`;
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
   * post, so materials see the previous frame's shadows (map and parameters stay consistent).
   */
  update(scene: THREE.Object3D): void {
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
      shader.fragmentShader = `#define USE_CLOUD_SHADOW\n${shader.fragmentShader}`;
      if (flood && !shader.uniforms.uFloodPos) injectFloodlight(shader, flood);
    };
    m.customProgramCacheKey = function () {
      return `${ownKey ? ownKey.call(this) : previousKey}${suffix}`;
    };
    m.needsUpdate = true;
  }
}
