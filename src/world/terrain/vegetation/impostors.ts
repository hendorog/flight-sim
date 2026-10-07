// Hemi-octahedral impostors (after Ryan Brucks' octahedral impostors, restricted to the upper hemisphere):
// each species is rendered once at start-up from IMPOSTOR_GRID^2 directions spread evenly over the
// hemisphere, into an albedo atlas and an object-space normal atlas. At run time a camera-facing quad
// shows the frames around the actual view direction (dither-blended), and the normal atlas lets
// the standard lighting shade the impostor like the mesh it replaces.
//
// Atlas: 2x2 species quadrants of IMPOSTOR_GRID x IMPOSTOR_GRID frames of IMPOSTOR_FRAME pixels.

import * as THREE from 'three';
import { SPECIES_COUNT } from './placement';
import { TREE_BOUND_RADIUS } from './treeModels';

export const IMPOSTOR_GRID = 8;
export const IMPOSTOR_FRAME = 128;
const QUAD = IMPOSTOR_GRID * IMPOSTOR_FRAME;
const SIZE = QUAD * 2;

export interface ImpostorAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  dispose(): void;
}

/** GLSL: hemi-octahedral mapping between upper-hemisphere unit vectors (y up) and [-1, 1]^2. */
export const HEMI_OCT_GLSL = /* glsl */ `
vec2 hemiOctEncode(vec3 v) {
  v /= (abs(v.x) + abs(v.y) + abs(v.z));
  return vec2(v.x + v.z, v.x - v.z);
}
`;

function hemiOctDecode(ex: number, ey: number): THREE.Vector3 {
  const tx = (ex + ey) * 0.5;
  const tz = (ex - ey) * 0.5;
  return new THREE.Vector3(tx, 1 - Math.abs(tx) - Math.abs(tz), tz).normalize();
}

const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vCol;
void main() {
  vUv = uv;
  vN = normal;
  vCol = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BAKE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform int uMode;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vCol;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  if (uMode == 0) gl_FragColor = vec4(pow(t.rgb * vCol, vec3(1.0 / 2.2)), 1.0);
  else gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
}
`;

export function bakeImpostors(renderer: THREE.WebGLRenderer, geometries: THREE.BufferGeometry[], foliage: THREE.Texture): ImpostorAtlas {
  const target = (): THREE.WebGLRenderTarget => {
    const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      type: THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    rt.texture.anisotropy = 4;
    return rt;
  };
  const albedoRT = target();
  const normalRT = target();
  // Allocate the mip chain now, then skip regenerating it after each of the 512 frame renders; it is
  // generated once at the end.
  for (const rt of [albedoRT, normalRT]) {
    renderer.initRenderTarget(rt);
    rt.texture.generateMipmaps = false;
  }
  const material = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    uniforms: { map: { value: foliage }, uMode: { value: 0 } },
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometries[0], material);
  scene.add(mesh);
  const R = TREE_BOUND_RADIUS;
  const camera = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, 4);
  const centre = new THREE.Vector3(0, 0.5, 0);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevScissor = renderer.getScissorTest();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  const passes: Array<[THREE.WebGLRenderTarget, number, THREE.Color]> = [
    // Transparent texels carry a foliage-like colour so mipmaps do not bleed black into the edges.
    [albedoRT, 0, new THREE.Color(0.2, 0.29, 0.18)],
    [normalRT, 1, new THREE.Color(0.5, 0.9, 0.5)],
  ];
  // Background fill: a quad writing the colour with alpha 0. (A clear cannot do it: three premultiplies the
  // clear colour by its alpha, which left black texels that filtered into a dark rim around every crown and
  // an invalid normal at the silhouette.)
  const fillMat = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 0.0); }',
    uniforms: { uColor: { value: new THREE.Vector3() } },
    depthTest: false,
    depthWrite: false,
  });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fillMat);
  fill.frustumCulled = false;
  const fillScene = new THREE.Scene();
  fillScene.add(fill);
  for (const [rt, mode, clear] of passes) {
    material.uniforms.uMode.value = mode;
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    fillMat.uniforms.uColor.value.set(clear.r, clear.g, clear.b);
    renderer.render(fillScene, camera);
    renderer.setScissorTest(true);
    for (let s = 0; s < Math.min(SPECIES_COUNT, geometries.length); s++) {
      mesh.geometry = geometries[s];
      for (let j = 0; j < IMPOSTOR_GRID; j++) {
        for (let i = 0; i < IMPOSTOR_GRID; i++) {
          const d = hemiOctDecode(((i + 0.5) / IMPOSTOR_GRID) * 2 - 1, ((j + 0.5) / IMPOSTOR_GRID) * 2 - 1);
          camera.position.copy(centre).addScaledVector(d, 2);
          camera.up.set(0, 1, 0);
          camera.lookAt(centre);
          camera.updateMatrixWorld();
          const x = (s % 2) * QUAD + i * IMPOSTOR_FRAME;
          const y = Math.floor(s / 2) * QUAD + j * IMPOSTOR_FRAME;
          rt.viewport.set(x, y, IMPOSTOR_FRAME, IMPOSTOR_FRAME);
          rt.scissor.set(x, y, IMPOSTOR_FRAME, IMPOSTOR_FRAME);
          renderer.setRenderTarget(rt);
          renderer.clear(false, true, false);
          renderer.render(scene, camera);
        }
      }
    }
    rt.viewport.set(0, 0, SIZE, SIZE);
    rt.scissor.set(0, 0, SIZE, SIZE);
    // An empty render with mipmapping re-enabled makes three regenerate the mip chain once.
    rt.texture.generateMipmaps = true;
    renderer.setScissorTest(false);
    renderer.setRenderTarget(rt);
    renderer.render(new THREE.Scene(), camera);
  }
  renderer.setScissorTest(prevScissor);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setRenderTarget(prevTarget);
  material.dispose();
  fillMat.dispose();
  fill.geometry.dispose();

  return {
    albedo: albedoRT.texture,
    normal: normalRT.texture,
    dispose() {
      albedoRT.dispose();
      normalRT.dispose();
    },
  };
}
