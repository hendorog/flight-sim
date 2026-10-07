// GLSL shared by full-screen passes.

import { CAMERA_FAR, CAMERA_NEAR } from './context';

/**
 * Decode the scene depth texture, for either depth convention of renderSetup.ts (the choice follows three's
 * USE_REVERSED_DEPTH_BUFFER define, which three adds to every ShaderMaterial; a RawShaderMaterial must
 * define it itself when renderer.capabilities.reversedDepthBuffer is true).
 *   reversed-Z: depth = near / (far - near) * (far / w - 1): 1 at the near plane, 0 at the far plane
 *   logarithmic: depth = log2(1 + w) / log2(1 + far)
 * where w is the view-space distance along the camera axis. Both assume the camera's near/far are
 * CAMERA_NEAR / CAMERA_FAR.
 *
 *   float viewZFromDepth(float d)      -> positive distance along the camera's forward axis, metres
 *   bool  isSky(float d)               -> true where nothing was rendered (the cleared depth)
 *
 * To get the world-space position of a pixel, build the view ray from the inverse projection and
 * camera world matrix and scale it so its forward component equals viewZFromDepth(d).
 */
export const DEPTH_GLSL = /* glsl */ `
#ifdef USE_REVERSED_DEPTH_BUFFER
const float DEPTH_NEAR = ${CAMERA_NEAR.toExponential(6)};
const float DEPTH_FAR = ${CAMERA_FAR.toFixed(1)};
float viewZFromDepth(float d) {
  return DEPTH_NEAR * DEPTH_FAR / (d * (DEPTH_FAR - DEPTH_NEAR) + DEPTH_NEAR);
}
bool isSky(float d) {
  return d <= 0.0;
}
#else
const float LOG_DEPTH_FAR = ${CAMERA_FAR.toFixed(1)};
float viewZFromDepth(float d) {
  return pow(LOG_DEPTH_FAR + 1.0, d) - 1.0;
}
bool isSky(float d) {
  return d >= 0.99999;
}
#endif
`;
