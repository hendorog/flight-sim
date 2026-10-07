// FXAA (Lottes 2009, the compact "console" variant) for the 'low' quality level, which renders without
// MSAA. Runs on the tone-mapped, sRGB-encoded image, where its luma edge detection is designed to work.

export const FXAA_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
const float REDUCE_MIN = 1.0 / 128.0;
const float REDUCE_MUL = 1.0 / 8.0;
const float SPAN_MAX = 8.0;
void main() {
  const vec3 LUMA = vec3(0.299, 0.587, 0.114);
  vec3 rgbM = texture2D(tSrc, vUv).rgb;
  float nw = dot(texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb, LUMA);
  float ne = dot(texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb, LUMA);
  float sw = dot(texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb, LUMA);
  float se = dot(texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb, LUMA);
  float m = dot(rgbM, LUMA);
  float lumaMin = min(m, min(min(nw, ne), min(sw, se)));
  float lumaMax = max(m, max(max(nw, ne), max(sw, se)));
  vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float reduce = max((nw + ne + sw + se) * 0.25 * REDUCE_MUL, REDUCE_MIN);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -SPAN_MAX, SPAN_MAX) * uTexel;
  vec3 a = 0.5 * (texture2D(tSrc, vUv - dir / 6.0).rgb + texture2D(tSrc, vUv + dir / 6.0).rgb);
  vec3 b = 0.5 * a + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lb = dot(b, LUMA);
  gl_FragColor = vec4(lb < lumaMin || lb > lumaMax ? a : b, 1.0);
}
`;
