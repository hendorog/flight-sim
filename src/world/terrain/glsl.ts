// GLSL shared by the terrain, water and vegetation shaders and the procedural texture generators.

/** Integer hashing (PCG) and periodic value noise / Voronoi for generating tileable textures. */
export const HASH_GLSL = /* glsl */ `
uint pcgHash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
// Same finaliser as hash2i() in noise.ts, so CPU and GPU agree on per-cell random values.
uint hash2u(int x, int y) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u);
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return h;
}
float hash2f(int x, int y) { return float(hash2u(x, y)) * (1.0 / 4294967296.0); }
`;

export const PERIODIC_NOISE_GLSL = /* glsl */ `
uniform int uSeed;
float hp(ivec2 c, int period) {
  c = ((c % period) + period) % period;
  return float(pcgHash(uint(c.x) + pcgHash(uint(c.y) + uint(uSeed) * 7919u))) * (1.0 / 4294967295.0);
}
vec2 hp2(ivec2 c, int period) {
  c = ((c % period) + period) % period;
  uint h = pcgHash(uint(c.x) + pcgHash(uint(c.y) + uint(uSeed) * 7919u));
  return vec2(float(h & 0xffffu), float(h >> 16)) * (1.0 / 65535.0);
}
// Value noise on a lattice of 'period' cells across the unit square, tileable.
float vnoise(vec2 uv, int period) {
  vec2 p = uv * float(period);
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hp(i, period), b = hp(i + ivec2(1, 0), period);
  float c = hp(i + ivec2(0, 1), period), d = hp(i + ivec2(1, 1), period);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 uv, int period, int octaves, float gain) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    s += a * vnoise(uv, period);
    n += a;
    a *= gain;
    period *= 2;
  }
  return s / n;
}
// Tileable Voronoi: x = distance to nearest point, y = second nearest, z = random id of the nearest cell.
vec3 voronoi(vec2 uv, int period, float jitter) {
  vec2 p = uv * float(period);
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      ivec2 c = i + ivec2(x, y);
      vec2 o = vec2(x, y) + 0.5 + jitter * (hp2(c, period) - 0.5) - f;
      float d = length(o);
      if (d < d1) { d2 = d1; d1 = d; id = hp(c + ivec2(17, 31), period); }
      else if (d < d2) d2 = d;
    }
  return vec3(d1, d2, id);
}
`;

/** Rotation of 2D texture coordinates by a fixed angle, for decorrelating repeated samples. */
export const ROT_GLSL = /* glsl */ `
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
`;
