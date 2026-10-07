// Contact shadow: the ambient occlusion the aircraft throws on the ground right under it, which the sun's
// shadow map cannot give (sky light is blocked too, and the tyres sit in a dark crease where they touch).
//
// A quad lying on the ground under the aircraft, oriented with its heading and the ground normal, multiplies
// the scene colour (dst * src) by 1 - occlusion. The occlusion is analytic in body (x, y): tight dark
// patches where each tyre touches (only while that wheel is loaded and its leg is down), a soft band under
// the fuselage and a faint broad one under the wing, all fading with height above the ground, so the shadow
// melts away during the take-off climb and is gone by ~15 m.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import { nedToThree } from '../../core/frames';
import type { SimContext } from '../../core/context';
import type { AirframeVisualDef } from './airframe/types';

/** Height of the quad above the ground function (pavement included), m. */
const LIFT = 0.035;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vBody;
void main() {
  vBody = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

/** A number as a GLSL float literal. */
const glsl = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** The occlusion of one airframe's shape: the body's blob and the wing's band are the definition's (AirframeVisualDef.shadow). */
const fragment = (shadow: AirframeVisualDef['shadow']): string => /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uWheels[3];    // body x, y of the contact; z = load weight 0..1
uniform float uHeight;      // height of the reference point above the ground minus its on-ground height, m
uniform float uStrength;
varying vec2 vBody;
float blob(vec2 d, vec2 r) { vec2 q = d / r; return exp(-dot(q, q)); }
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vBody;
  float h = max(uHeight, 0.0);
  float occ = 0.0;
  // Tyre contact creases.
  for (int i = 0; i < 3; i++) {
    vec3 w = uWheels[i];
    occ = max(occ, w.z * 0.55 * blob(p - w.xy, vec2(0.23, 0.12)));
    occ = max(occ, w.z * 0.25 * blob(p - w.xy, vec2(0.5, 0.3)));
  }
  // Fuselage (belly ~0.8 m up): a soft band from the cowling to the tail cone.
  float spread = 1.0 + h * 0.25;
  float fus = blob(vec2(max(abs(p.x + ${glsl(-shadow.fuselage[0])}) - ${glsl(shadow.fuselage[1])}, 0.0), p.y), vec2(0.9, ${glsl(shadow.fuselage[2])}) * spread);
  // Wing (~${glsl(shadow.wingHeight)} m up): very soft and faint.
  float wing = blob(vec2(p.x + ${glsl(-shadow.wingX)}, max(abs(p.y) - ${glsl(shadow.wingY)}, 0.0)), vec2(1.5, 1.6) * spread);
  float fade = 1.0 / (1.0 + h * h * 0.06);
  occ = max(occ, (0.32 * fus + 0.1 * wing) * fade);
  gl_FragColor = vec4(vec3(1.0 - occ * uStrength), 1.0);
}
`;

export class GroundShadow {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly wheels = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly n = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  /** Height of the reference point above the ground when the aircraft stands on its wheels, m. */
  private readonly restHeight: number;

  /**
   * @param shadow the shadow's shape and
   * @param gear   the wheels (nose, left, right) of the airframe definition (default: the Cessna 172S)
   */
  constructor(
    shadow: AirframeVisualDef['shadow'] = C172S_VISUAL.shadow,
    private readonly gear: AirframeVisualDef['gear'] = C172S_VISUAL.gear,
  ) {
    this.restHeight = shadow.restHeight ?? 1.25;
    const g = new THREE.PlaneGeometry(2 * shadow.halfY, 2 * shadow.halfX, 1, 1);
    // Plane in local (X = body right, Y = body forward); uv carries body (x, y) metres.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getY(i), pos.getX(i));
    this.mat = new THREE.ShaderMaterial({
      name: 'aircraftContactShadow',
      vertexShader: VERT,
      fragmentShader: fragment(shadow),
      uniforms: {
        uWheels: { value: this.wheels },
        uHeight: { value: 0 },
        uStrength: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'aircraftContactShadow';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(ctx: SimContext): void {
    const s = ctx.state;
    const ground = ctx.env.groundElevation(s.position.x, s.position.y);
    const height = s.altitudeMSL - ground - this.restHeight;
    this.mesh.visible = height < 25 && !s.crashed;
    if (!this.mesh.visible) return;
    this.mat.uniforms.uHeight.value = height;
    // Dimmer when the scene is lit mostly by a small bright source (low sun / night): keep it simple.
    this.mat.uniforms.uStrength.value = 0.35 + 0.65 * ctx.sky.dayFactor;
    for (let i = 0; i < 3; i++) {
      const w = s.wheels[i];
      const contact = this.gear[i].contact;
      const load = w.onGround ? 1 : Math.max(0, 1 - (height - w.compression) / 0.4);
      // A leg that is not down has no tyre near the ground: no crease under it.
      const down = s.gear.extension[i] >= 0.99 ? 1 : 0;
      this.wheels[i].set(contact[0], contact[1], Math.min(1, load) * down);
    }
    // Frame: origin on the ground below the reference point, +Z up (ground normal), +Y along the heading.
    const gn = ctx.env.groundNormal(s.position.x, s.position.y);
    nedToThree(gn, this.n).normalize();
    nedToThree({ x: Math.cos(s.heading), y: Math.sin(s.heading), z: 0 }, this.fwd);
    this.fwd.addScaledVector(this.n, -this.fwd.dot(this.n)).normalize();
    this.right.crossVectors(this.fwd, this.n).normalize();
    const o = nedToThree({ x: s.position.x, y: s.position.y, z: -(ground + LIFT) });
    this.m.makeBasis(this.right, this.fwd, this.n).setPosition(o);
    this.mesh.matrix.copy(this.m);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
