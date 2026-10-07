// One place that creates the renderer and camera with the project's conventions, used by both the
// simulator entry point and the dev harness pages.
//
// DEPTH BUFFER
//   'reversed' (the simulator's default where EXT_clip_control exists): reversed-Z with float depth
//   targets. Depth is 1 at the near plane and 0 at the far plane (cleared to 0), which with a 32-bit float
//   depth attachment gives ~1e-7 relative precision at every distance, like log depth, but without writing
//   gl_FragDepth: the GPU keeps early-Z and rejects hidden fragments before shading them. Only render
//   targets with a FloatType DepthTexture (the post pipeline's scene target) get the full precision; the
//   default framebuffer's 24-bit depth does not, so pages that draw the 3D scene straight to the canvas
//   should keep 'log'.
//   'log': three's logarithmic depth buffer (gl_FragDepth per fragment), the fallback.
//   Full-screen passes decode either with DEPTH_GLSL (shaderLib.ts), which switches on three's
//   USE_REVERSED_DEPTH_BUFFER define.

import * as THREE from 'three';
import { CAMERA_FAR, CAMERA_NEAR } from './context';

export type DepthMode = 'log' | 'reversed';

let clipControlSupport: boolean | null = null;

/** Whether this browser offers EXT_clip_control on WebGL 2 (probed once with a throw-away context). */
export function supportsReversedDepth(): boolean {
  if (clipControlSupport !== null) return clipControlSupport;
  clipControlSupport = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      clipControlSupport = gl.getExtension('EXT_clip_control') !== null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    clipControlSupport = false;
  }
  return clipControlSupport;
}

/** The depth convention a renderer was created with. */
export function depthModeOf(renderer: THREE.WebGLRenderer): DepthMode {
  return renderer.capabilities.reversedDepthBuffer ? 'reversed' : 'log';
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  opts: { antialias?: boolean; /** Default 'log'. 'auto' = reversed where supported, else log. */ depth?: DepthMode | 'auto' } = {},
): THREE.WebGLRenderer {
  const want = opts.depth ?? 'log';
  const reversed = want !== 'log' && supportsReversedDepth();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: opts.antialias ?? false,
    logarithmicDepthBuffer: !reversed,
    reversedDepthBuffer: reversed,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function createCamera(aspect: number, fovDeg = 60): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(fovDeg, aspect, CAMERA_NEAR, CAMERA_FAR);
}
