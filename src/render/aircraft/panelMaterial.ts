// The instrument panel face shader shared by the aeroplane and rotorcraft cockpits: round instruments set into the
// face behind cover glass, by ray casting in the panel's own fragment shader (no extra geometry, draws or readback).
import * as THREE from 'three';
import { gaugeRecess, type PanelDef } from '../../instruments/panelDef';

/**
 * Round instruments of a panel definition in panel-mesh space: (x, y) centre and glass aperture radius, m, and how
 * far the dial sits behind the panel face, m (gaugeRecess: which gauges are round, how large and how deep).
 * @param toMesh mesh-local (x, y), m, of a panel canvas pixel
 * @param pxPerM canvas pixels per metre on the face
 */
export function panelRecesses(panel: PanelDef, toMesh: (px: number, py: number) => { x: number; y: number }, pxPerM: number): THREE.Vector4[] {
  const out: THREE.Vector4[] = [];
  for (const g of panel.gauges) {
    const r = gaugeRecess(g, panel.apertures);
    if (!r) continue;
    const c = toMesh(r.x, r.y);
    out.push(new THREE.Vector4(c.x, c.y, r.r / pxPerM, r.depth));
  }
  return out;
}

/**
 * Instrument recesses by ray casting in the panel shader (no extra geometry or draws): inside a gauge's
 * aperture the view ray is followed into a cylinder `depth` deep. Where it reaches the back it samples the
 * dial (and its needles) at the offset texture coordinate, so dial and needles shift against the bezel with
 * the viewpoint; where it hits the bore first the fragment is the dark bore wall. The glass over the
 * aperture adds a Fresnel reflection of the surroundings (panelGlass).
 */
const panelRecessPars = (gauges: number): string => /* glsl */ `
#define PANEL_GAUGE_COUNT ${gauges}
uniform vec3 panelEye;
uniform vec4 panelGauges[ PANEL_GAUGE_COUNT ];
varying vec3 vPanelPos;
`;
/** @param canvasM the whole panel canvas on the face, m: a shift across it, m, becomes one of the texture coordinate over the whole canvas */
const panelRecessMap = (canvasM: { w: number; h: number }): string => /* glsl */ `
	vec2 panelUv = vec2( 0.0 );
	#ifdef USE_MAP
		panelUv = vMapUv;
	#endif
	float panelWall = 0.0;
	float panelGlass = 0.0;
	float panelAo = 1.0;
	{
		vec3 ray = normalize( vPanelPos - panelEye );
		for ( int i = 0; i < PANEL_GAUGE_COUNT; i ++ ) {
			vec4 g = panelGauges[ i ];
			vec2 rel = vPanelPos.xy - g.xy;
			if ( dot( rel, rel ) < g.z * g.z ) {
				panelGlass = 1.0;
				// Distance along the panel plane travelled while going g.w deep (the face is +z, facing aft).
				vec2 shift = ray.xy * ( g.w / max( - ray.z, 0.08 ) );
				vec2 q = rel + shift;
				float rq = length( q ) / g.z;
				panelWall = step( 1.0, rq );
				panelUv += shift / vec2( ${canvasM.w.toFixed(3)}, ${canvasM.h.toFixed(3)} );
				// The bore shades the outer rim of the dial from the diffuse light.
				panelAo = 1.0 - 0.45 * smoothstep( 0.55, 1.0, rq );
				break;
			}
		}
	}
	#ifdef USE_MAP
		vec4 sampledDiffuseColor = texture2D( map, panelUv );
		diffuseColor *= sampledDiffuseColor;
	#endif
	diffuseColor.rgb = mix( diffuseColor.rgb * panelAo, vec3( 0.012 ), panelWall );
`;
/** @param occlusion GLSL float: the share of the reflection that sees out, where there is no cabin occlusion (CABIN_VIS) */
const panelGlass = (occlusion: string): string => /* glsl */ `
	#ifdef USE_ENVMAP
	if ( panelGlass > 0.5 ) {
		// Cover glass: a smooth dielectric reflecting what the cabin occlusion lets through.
		float glassNv = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 glassF = F_Schlick( vec3( 0.04 ), 1.0, glassNv );
		#ifdef CABIN_VIS
			float glassOcc = vCabinVis;
		#else
			float glassOcc = ${occlusion};
		#endif
		outgoingLight += glassF * getIBLRadiance( geometryViewDir, geometryNormal, 0.03 ) * glassOcc;
	}
	#endif
`;

/**
 * The recessed instruments of one panel face mesh. The face must be flat in its mesh's xy plane, facing +z (out of
 * the panel, toward the pilot), with the panel texture's coordinates on its `uv`. In the fragment shader after
 * `map_fragment`, `panelUv` is the parallax-shifted texture coordinate (sample the emissive map there too) and
 * `panelWall` is 1 on the bore wall (nothing glows there).
 */
export class PanelRecess {
  /** The eye in the panel mesh's own space, for the camera rendering it (bind). */
  readonly eye = { value: new THREE.Vector3(0, 0.1, 0.2) };
  private readonly pars: string;
  private readonly map: string;
  private readonly glass: string;

  /**
   * @param gauges panelRecesses: mesh-local centre, aperture radius and depth, m
   * @param canvasM the whole panel canvas mapped on the face (texture coordinates 0..1), m
   * @param glassOcclusion share of the cover glass's reflection that sees outside, for a panel without the per-vertex
   *        cabin occlusion (cabinLight.ts CABIN_VIS); with it, that is used instead
   */
  constructor(
    readonly gauges: THREE.Vector4[],
    canvasM: { w: number; h: number },
    glassOcclusion = 1,
  ) {
    this.pars = panelRecessPars(gauges.length);
    this.map = panelRecessMap(canvasM);
    this.glass = panelGlass(Number.isInteger(glassOcclusion) ? glassOcclusion.toFixed(1) : String(glassOcclusion));
  }

  /** Patch the shader (in onBeforeCompile): the recess map and the cover glass. */
  patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.panelEye = this.eye;
    shader.uniforms.panelGauges = { value: this.gauges };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPanelPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPanelPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${this.pars}`)
      .replace('#include <map_fragment>', this.map)
      .replace('#include <opaque_fragment>', `${this.glass}\n#include <opaque_fragment>`);
  }

  /** The recess parallax needs the eye in the panel's own space for the camera actually rendering. */
  bind(mesh: THREE.Mesh): void {
    mesh.onBeforeRender = (_r, _s, camera) => {
      this.eye.value.setFromMatrixPosition(camera.matrixWorld);
      mesh.worldToLocal(this.eye.value);
    };
  }
}
