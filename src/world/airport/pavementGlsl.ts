// GLSL for the runway, taxiways and apron. Markings are evaluated analytically per pixel from the layout data
// (no marking textures), so they are sharp at 2 m. Every marking is box-filtered over the pixel footprint in the
// local (u, v) plane, which removes aliasing and moire at grazing angles and at 3 km+.
//
// Shader inputs: vec2 p = (u, v) local runway coordinates in metres (see layout.ts).
// The layout constants are baked into the generated source as literals.

import {
  APRON_RECT,
  APRON_TAXILANE_V,
  CENTRELINE_ARCS,
  centrelineLayout,
  FILLET_RADIUS,
  FUEL_ISLAND,
  HOLD_LINE_V,
  MARKINGS,
  PARKING_ROW_A_V,
  PARKING_ROW_B_V,
  PARKING_SPACING,
  PARKING_SPOTS,
  PAVED_RECTS,
  RUNWAY_CONNECTORS,
  RUNWAY_HALF_LENGTH,
  RUNWAY_HALF_WIDTH,
  TAXIWAY_WIDTH,
  TAXIWAYS,
  type LocalRect,
} from './layout';

/** Albedo of the white runway marking paint (fresh-to-maintained traffic paint with glass beads: 0.7-0.85). */
export const RUNWAY_PAINT_ALBEDO = 0.8;

const f = (x: number): string => {
  const s = x.toFixed(4);
  return s.includes('.') ? s : `${s}.0`;
};
const v2 = (a: number, b: number): string => `vec2(${f(a)}, ${f(b)})`;

const rectCall = (r: LocalRect): string =>
  `rectSD(p, ${v2((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2)}, ${v2((r.u1 - r.u0) / 2, (r.v1 - r.v0) / 2)})`;

/** Common helpers: filtered pulses, distance functions, hashing. */
export const PAVEMENT_COMMON_GLSL = /* glsl */ `
uniform sampler2D tAsphalt;
uniform sampler2D tConcrete;
uniform sampler2D tCrack;
uniform sampler2D tNoise;

// Fraction of the pixel footprint [x - w/2, x + w/2] covered by the interval [lo, hi].
float band(float x, float lo, float hi, float w) {
  return clamp((min(hi, x + 0.5 * w) - max(lo, x - 0.5 * w)) / w, 0.0, 1.0);
}
// Integral of a pulse train (pulses [0, d) every P) from 0 to x, and its box-filtered value.
float pulseInt(float x, float P, float d) { return floor(x / P) * d + min(mod(x, P), d); }
float pulses(float x, float P, float d, float w) {
  return (pulseInt(x + 0.5 * w, P, d) - pulseInt(x - 0.5 * w, P, d)) / w;
}
// A line of half-width hw at unsigned distance d, filtered.
float line(float d, float hw, float w) { return band(d, -hw, hw, w); }

float rectSD(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sminP(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// Distance to the circular arc from angle a0 to a1 (a0 < a1, counter-clockwise), centre c, radius r.
float arcDist(vec2 p, vec2 c, float r, float a0, float a1) {
  vec2 q = p - c;
  float a = a0 + mod(atan(q.y, q.x) - a0, 6.2831853);
  if (a <= a1) return abs(length(q) - r);
  return min(length(q - r * vec2(cos(a0), sin(a0))), length(q - r * vec2(cos(a1), sin(a1))));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// Paint condition 0 (worn through) .. 1 (intact): patchy at metre scale, chipped at aggregate scale.
float paintWear(vec2 p, float grain) {
  float patchy = texture(tNoise, p / 19.0).b * 0.65 + texture(tNoise, p / 7.3).g * 0.35;
  return smoothstep(0.3, 0.62, patchy + 1.4 * grain);
}

struct Pave {
  vec3 albedo;
  float roughness;
  vec2 slope;   // surface normal tilt (n.u, n.v); n.up reconstructed
  float alpha;  // coverage of the paved shape (taxiways only)
};

// Packed pavement texel (R albedo, G roughness, BA normal) sampled at two decorrelated scales and rotations
// blended by a low-frequency mask, which hides the tile repeat.
vec4 samplePacked(sampler2D t, vec2 p, float tile) {
  vec4 a = texture(t, p / tile);
  vec4 b = texture(t, rot2(p, 0.61) / (tile * 1.37) + 0.31);
  float m = smoothstep(0.35, 0.65, texture(tNoise, p / 61.0).b);
  return mix(a, b, m);
}
`;

// ------------------------------------------------------------------------------------------------------------
// Runway

function digitGlsl(): string {
  const d = MARKINGS.designation;
  const hw = d.stroke / 2;
  const xa = d.digitWidth / 2 - hw;
  const ya = d.height / 2 - hw;
  const ym = 0.8;
  const r = xa;
  const e2 = [r * Math.cos(-0.5), ya - r + r * Math.sin(-0.5)];
  return /* glsl */ `
// FAA runway designation digits (AC 150/5340-1 fig. A-4 proportions): distance from q to the stroke centreline.
// q is in metres, origin at the glyph centre, +y away from the threshold.
float digitDist(int n, vec2 q) {
  const float XA = ${f(xa)}, YA = ${f(ya)};
  if (n == 0) return abs(segDist(q, vec2(0.0, -(YA - XA)), vec2(0.0, YA - XA)) - XA);
  if (n == 7) return min(segDist(q, vec2(-XA, YA), vec2(XA, YA)), segDist(q, vec2(XA, YA), vec2(-0.3 * XA, -YA)));
  if (n == 2) {
    float d = arcDist(q, vec2(0.0, YA - XA), XA, -0.5, 2.95);
    d = min(d, segDist(q, ${v2(e2[0], e2[1])}, vec2(-XA, -YA)));
    return min(d, segDist(q, vec2(-XA, -YA), vec2(XA, -YA)));
  }
  // 5
  const float YM = ${f(ym)};
  float d = segDist(q, vec2(XA, YA), vec2(-XA, YA));
  d = min(d, segDist(q, vec2(-XA, YA), vec2(-XA, YM)));
  d = min(d, segDist(q, vec2(-XA, YM), vec2(0.0, YM)));
  d = min(d, arcDist(q, vec2(0.0, YM - XA), XA, 0.0, 1.5708));
  d = min(d, segDist(q, vec2(XA, YM - XA), vec2(XA, -YA + XA)));
  return min(d, arcDist(q, vec2(0.0, -YA + XA), XA, -2.75, 0.0));
}
`;
}

/**
 * Lead-on / lead-off lines (AC 150/5340-1 fig. A-5): each connector's yellow taxiway centreline continues onto
 * the runway on a curve and runs 200 ft beside the runway centreline, 3 ft to the connector's side.
 * A1 and A4 (the runway ends) lead on toward the far end only; A2 and A3 both ways.
 */
function leadOnGlsl(): string {
  const off = 0.9144; // 3 ft
  const R = RUNWAY_HALF_WIDTH - off;
  const lines: string[] = [];
  for (const c of RUNWAY_CONNECTORS) {
    const a = TAXIWAYS.find((t) => t.name === c.name)!.a.u;
    const dirs = a < -RUNWAY_HALF_LENGTH + 100 ? [1] : a > RUNWAY_HALF_LENGTH - 100 ? [-1] : [1, -1];
    for (const s of dirs) {
      const cu = a + s * R, cv = -off - R;
      const [a0, a1] = s > 0 ? [Math.PI / 2, Math.PI] : [0, Math.PI / 2];
      lines.push(`d = min(d, arcDist(p, ${v2(cu, cv)}, ${f(R)}, ${f(a0)}, ${f(a1)}));`);
      lines.push(`d = min(d, segDist(p, ${v2(cu, -off)}, ${v2(cu + s * 200 * 0.3048, -off)}));`);
    }
  }
  return /* glsl */ `
float leadOnDist(vec2 p) {
  float d = 1e6;
  ${lines.join('\n  ')}
  return d;
}
`;
}

export function runwayGlsl(): string {
  const m = MARKINGS;
  const HL = RUNWAY_HALF_LENGTH, HW = RUNWAY_HALF_WIDTH;
  const cl = centrelineLayout();
  const t = m.threshold;
  const tx0 = t.outerEdge - (t.count - 1) * t.stripeWidth; // 4 stripes per side, as a pulse train from tx0
  const d = m.designation;
  const digitCx = d.gap / 2 + d.digitWidth / 2;
  const tdz = m.touchdownZone;
  const tdzGroups = tdz.groups
    .map(([s0, n]) => {
      const span = n * tdz.barWidth + (n - 1) * tdz.barGap;
      return `paint = max(paint, band(s, ${f(s0)}, ${f(s0 + tdz.length)}, w.x) * pulses(ax - ${f(tdz.innerX)}, ${f(tdz.barWidth + tdz.barGap)}, ${f(tdz.barWidth)}, w.y) * band(ax, ${f(tdz.innerX)}, ${f(tdz.innerX + span)}, w.y));`;
    })
    .join('\n    ');
  return /* glsl */ `
${digitGlsl()}
${leadOnGlsl()}

// White paint coverage of the runway markings at p, filtered over footprint w (metres along u, v).
float runwayPaint(vec2 p, vec2 w) {
  float ax = abs(p.y);
  // Side stripes along the full length between thresholds.
  float paint = band(ax, ${f(HW - m.sideStripe.edgeInset - m.sideStripe.width)}, ${f(HW - m.sideStripe.edgeInset)}, w.y)
              * band(abs(p.x), -1.0, ${f(HL)}, w.x);
  // Centreline stripes.
  paint = max(paint, band(p.y, ${f(-m.centreline.width / 2)}, ${f(m.centreline.width / 2)}, w.y)
                   * pulses(p.x - ${f(cl.first)}, ${f(cl.period)}, ${f(m.centreline.stripe)}, w.x)
                   * band(p.x, ${f(cl.first)}, ${f(-cl.first)}, w.x));
  // Per-end markings: s = distance in from the nearest threshold, x = lateral, + right of the landing direction.
  float endSign = p.x < 0.0 ? -1.0 : 1.0;
  float s = ${f(HL)} - abs(p.x);
  float x = -endSign * p.y;
  if (s < 900.0) {
    // Threshold stripes: 4 each side of the centreline.
    paint = max(paint, band(s, ${f(t.start)}, ${f(t.start + t.length)}, w.x)
                     * pulses(ax - ${f(tx0)}, ${f(2 * t.stripeWidth)}, ${f(t.stripeWidth)}, w.y)
                     * band(ax, ${f(tx0)}, ${f(t.outerEdge)}, w.y));
    // Aiming point.
    paint = max(paint, band(s, ${f(m.aimingPoint.start)}, ${f(m.aimingPoint.start + m.aimingPoint.length)}, w.x)
                     * band(ax, ${f(m.aimingPoint.innerX)}, ${f(m.aimingPoint.innerX + m.aimingPoint.width)}, w.y));
    // Touchdown zone bars.
    ${tdzGroups}
    // Designation: "07" at the west end, "25" at the east end, read from the approach.
    if (s > ${f(d.start - 1)} && s < ${f(d.start + d.height + 1)} && ax < ${f(digitCx + d.digitWidth)}) {
      bool left = x < 0.0;
      int digit = endSign < 0.0 ? (left ? 0 : 7) : (left ? 2 : 5);
      vec2 q = vec2(x - (left ? ${f(-digitCx)} : ${f(digitCx)}), s - ${f(d.start + d.height / 2)});
      float sd = digitDist(digit, q) - ${f(d.stroke / 2)};
      paint = max(paint, clamp(0.5 - sd / (0.5 * (w.x + w.y)), 0.0, 1.0));
    }
  }
  return paint;
}

Pave runwaySurface(vec2 p, vec2 w) {
  vec4 tex = samplePacked(tAsphalt, p, 4.0);
  vec4 big = texture(tNoise, p / 400.0);
  vec4 mid = texture(tNoise, p / 90.0);
  float ax = abs(p.y);
  float s = ${f(HL)} - abs(p.x);

  float albedo = tex.r;
  float rough = tex.g;
  vec2 slope = tex.ba * 2.0 - 1.0;

  // Paving lanes 7.5 m wide, each laid from a slightly different batch; oxidation varies over hundreds of metres.
  float lane = floor((p.y + ${f(HW)}) / 7.5);
  albedo *= 0.94 + 0.12 * hash12(vec2(lane, 3.0)) + 0.22 * (big.r - 0.5) + 0.1 * (mid.g - 0.5);
  // Oil drips and tyre polish along the centreline; untrafficked edges are lighter and dusty.
  albedo *= 1.0 - 0.18 * exp(-ax * ax / 3.0) * (0.6 + 0.8 * mid.a);
  float edge = smoothstep(${f(HW - 3.5)}, ${f(HW)}, ax);
  albedo = mix(albedo, albedo * 1.25 + 0.03, edge * (0.5 + 0.5 * mid.r));

  // Patch repairs: rectangular overlays of newer, darker asphalt aligned with the paving lanes.
  vec2 cellSize = vec2(37.0, 7.5);
  vec2 cell = floor(vec2(p.x, p.y + ${f(HW)}) / cellSize);
  float hc = hash12(cell + 17.0);
  if (hc < 0.1) {
    vec2 lp = vec2(p.x, p.y + ${f(HW)}) - cell * cellSize;
    vec2 lo = vec2(hash12(cell + 1.3) * 18.0 + 2.0, hash12(cell + 2.7) * 2.5 + 0.3);
    vec2 hi = lo + vec2(4.0 + hash12(cell + 4.1) * 12.0, 1.5 + hash12(cell + 5.9) * 3.5);
    hi.y = min(hi.y, 7.2);
    float inPatch = band(lp.x, lo.x, hi.x, w.x) * band(lp.y, lo.y, hi.y, w.y);
    float seam = inPatch * (1.0 - band(lp.x, lo.x + 0.06, hi.x - 0.06, w.x) * band(lp.y, lo.y + 0.06, hi.y - 0.06, w.y));
    albedo = mix(albedo, albedo * 0.62, inPatch);
    rough = mix(rough, rough * 0.93, inPatch);
    albedo = mix(albedo, 0.03, seam * 0.8);
  }

  // Tar crack sealant: dark, smooth, slightly glossy bands.
  float crack = texture(tCrack, p / 64.0).r * (0.55 + 0.45 * smoothstep(0.3, 0.6, big.g));
  albedo = mix(albedo, 0.028, crack);
  rough = mix(rough, 0.45, crack);
  slope *= 1.0 - crack;

  // Rubber deposits in the touchdown zones, streaked along the direction of travel.
  float tdz = smoothstep(90.0, 260.0, s) * (1.0 - smoothstep(480.0, 820.0, s));
  float lateral = exp(-p.y * p.y / (2.0 * 4.5 * 4.5));
  float streak = texture(tNoise, vec2(p.x / 140.0, p.y / 2.2)).g * 0.7 + texture(tNoise, vec2(p.x / 37.0, p.y / 0.9)).a * 0.5;
  float rubber = tdz * smoothstep(0.35, 0.95, streak * (0.55 + 0.6 * lateral) + 0.35 * lateral);
  albedo = mix(albedo, 0.022, rubber * 0.92);
  rough = mix(rough, 0.5, rubber);
  slope *= 1.0 - 0.7 * rubber;

  // Markings: maintained retro-reflective beaded paint (albedo ~0.8 against ~0.11 asphalt), only lightly worn
  // except in the touchdown-zone wheel paths, where tyres scrub it and rubber covers it.
  float paint = runwayPaint(p, w);
  float wear = paintWear(p, tex.r - 0.2);
  float wheelPath = lateral * tdz;
  paint *= mix(mix(0.86, 1.0, wear), mix(0.45, 1.0, wear), wheelPath) * (1.0 - 0.8 * rubber);
  // Yellow lead-on lines from the connectors (only on the taxiway side of the centreline).
  float yellow = p.y < 0.0 && p.y > -16.0 ? line(leadOnDist(p), 0.075, 0.5 * (w.x + w.y)) * mix(0.6, 1.0, wear) : 0.0;
  vec3 col = vec3(1.02, 1.0, 0.97) * albedo;
  col = mix(col, vec3(${f(RUNWAY_PAINT_ALBEDO)}, ${f(RUNWAY_PAINT_ALBEDO)}, ${f(RUNWAY_PAINT_ALBEDO * 0.97)}), paint);
  col = mix(col, vec3(0.70, 0.47, 0.05), yellow);
  paint = max(paint, yellow);
  rough = mix(rough, 0.62, paint);
  slope *= 1.0 - 0.6 * paint;

  return Pave(col, rough, slope, 1.0);
}
`;
}

// ------------------------------------------------------------------------------------------------------------
// Taxiways and apron

export function taxiwayGlsl(): string {
  const pavedLines = [`float d = ${rectCall(PAVED_RECTS[0])};`];
  for (const r of PAVED_RECTS.slice(1)) pavedLines.push(`d = sminP(d, ${rectCall(r)}, ${f(FILLET_RADIUS)});`);

  // Centrelines: taxiway segments (clipped to the runway edge), B connectors continued to the apron taxilane,
  // and the taxilane along the apron.
  const segs: [number, number, number, number][] = [];
  for (const t of TAXIWAYS) {
    const b = { ...t.b };
    if (t.name.startsWith('A') && t.name !== 'A') b.v = -RUNWAY_HALF_WIDTH;
    if (t.name.startsWith('B')) b.v = APRON_TAXILANE_V;
    segs.push([t.a.u, t.a.v, b.u, b.v]);
  }
  segs.push([APRON_RECT.u0 + 8, APRON_TAXILANE_V, APRON_RECT.u1 - 8, APRON_TAXILANE_V]);
  const clLines = segs.map((s) => `d = min(d, segDist(p, ${v2(s[0], s[1])}, ${v2(s[2], s[3])}));`);
  for (const a of CENTRELINE_ARCS) {
    // quarter toward the junction corner: direction (-su, -sv) from the centre
    const mid = Math.atan2(-a.sv, -a.su);
    clLines.push(`d = min(d, arcDist(p, ${v2(a.cu, a.cv)}, ${f(a.r)}, ${f(mid - Math.PI / 4)}, ${f(mid + Math.PI / 4)}));`);
  }

  const holdUs = RUNWAY_CONNECTORS.map((c) => TAXIWAYS.find((t) => t.name === c.name)!.a.u);
  const lw = 12 * 0.0254; // hold-line stripes: 12 in wide, 12 in apart (AC 150/5340-1 fig. A-19)
  const holdLines = holdUs
    .map(
      (u) => `if (abs(p.x - ${f(u)}) < ${f(TAXIWAY_WIDTH / 2 + FILLET_RADIUS)}) {
      float y = p.y - ${f(HOLD_LINE_V)};
      float solid = band(y, ${f(-7 * lw)}, ${f(-6 * lw)}, w.y) + band(y, ${f(-5 * lw)}, ${f(-4 * lw)}, w.y);
      float dashed = (band(y, ${f(-3 * lw)}, ${f(-2 * lw)}, w.y) + band(y, ${f(-lw)}, 0.0, w.y)) * pulses(p.x - ${f(u)} + 0.4572, 1.8288, 0.9144, w.x);
      yellow = max(yellow, solid + dashed);
    }`,
    )
    .join('\n    ');

  const nA = PARKING_SPOTS.filter((s) => s.facing === 1).length;
  const firstU = PARKING_SPOTS[0].u;
  const nSlots = Math.round((APRON_RECT.u1 - firstU) / PARKING_SPACING) + 1;
  const validB = Array.from({ length: nSlots }, (_, k) =>
    PARKING_SPOTS.some((s) => s.facing === -1 && Math.abs(s.u - (firstU + k * PARKING_SPACING)) < 0.01) ? '1.0' : '0.0',
  );

  return /* glsl */ `
float pavedSD(vec2 p) {
  ${pavedLines.join('\n  ')}
  return d;
}
float apronSD(vec2 p) { return ${rectCall(APRON_RECT)}; }
float centrelineDist(vec2 p) {
  float d = 1e6;
  ${clLines.join('\n  ')}
  return d;
}
const float VALID_B[${nSlots}] = float[](${validB.join(', ')});

// Tie-down marking for one parking spot at c facing +v (facing = 1) or -v: yellow tee along the fuselage and
// wing lines, and three dark anchor rings. Returns (yellow, anchor, oil).
vec3 tieDown(vec2 p, vec2 c, float facing, vec2 w) {
  vec2 q = vec2(p.x - c.x, (p.y - c.y) * facing);
  float yellow = band(q.x, -0.075, 0.075, w.x) * band(q.y, -5.5, 2.5, w.y);
  yellow = max(yellow, band(q.y, -0.075, 0.075, w.y) * band(abs(q.x), 0.8, 5.0, w.x));
  float ring = min(min(length(q - vec2(-4.4, -0.4)), length(q - vec2(4.4, -0.4))), length(q - vec2(0.0, -5.2)));
  float anchor = band(ring, -0.16, 0.16, 0.5 * (w.x + w.y));
  // Engine oil and fuel stains under the nose, blotchy.
  float oil = smoothstep(1.4, 0.2, length((q - vec2(0.0, 1.6)) * vec2(1.0, 0.7)) + 0.6 * texture(tNoise, p / 3.0).a);
  // Smaller drips under the wheels' parking positions and rust bleeding from the anchor rings.
  oil = max(oil, 0.6 * smoothstep(0.9, 0.1, length(q - vec2(0.0, 0.3)) + 0.5 * texture(tNoise, p / 1.9).b));
  float rust = smoothstep(0.7, 0.16, ring + 0.25 * texture(tNoise, p / 1.3).g);
  return vec3(yellow, anchor, max(oil, 0.5 * rust));
}

Pave taxiwaySurface(vec2 p, vec2 w) {
  float fw = 0.5 * (w.x + w.y);
  float sd = pavedSD(p);
  float alpha = clamp(0.5 - sd / fw, 0.0, 1.0);
  float asd = apronSD(p);
  bool apron = asd < 0.0;
  vec4 mid = texture(tNoise, p / 90.0);
  vec4 big = texture(tNoise, p / 400.0);

  vec4 tex;
  float albedo;
  vec3 slabTint = vec3(1.0);
  if (apron) {
    // Portland cement concrete in 5 m slabs; each slab poured separately so its tone differs slightly.
    vec2 q = p - ${v2(APRON_RECT.u0, APRON_RECT.v0)};
    tex = samplePacked(tConcrete, q, 4.0);
    vec2 slab = floor(q / 5.0);
    float hs = hash12(slab);
    // Each slab was poured (or later replaced) separately: tone, cement colour and wear differ slab to slab.
    albedo = tex.r * (0.66 + 0.2 * hs + 0.2 * (big.b - 0.5) + 0.14 * (mid.r - 0.5));
    slabTint = vec3(1.0 + 0.03 * (hash12(slab + 7.7) - 0.5), 1.0, 1.0 - 0.05 * (hash12(slab + 3.1) - 0.5));
    if (hs > 0.94) albedo *= 1.18;                    // recently replaced slab: paler, cleaner cement
    // Corner and edge staining inside a slab (water ponds at the joints), blotchy at metre scale.
    vec2 sq = abs(fract(q / 5.0) - 0.5) * 2.0;
    float edgeDirt = smoothstep(0.75, 1.0, max(sq.x, sq.y)) * texture(tNoise, p / 4.1).b;
    albedo *= 1.0 - 0.18 * edgeDirt;
    // Water / rust / fuel staining at several scales.
    float stain = texture(tNoise, p / 13.0).a;
    albedo *= 0.88 + 0.2 * smoothstep(0.25, 0.75, stain);
    float spots = smoothstep(0.62, 0.8, texture(tNoise, p / 2.3 + 0.37).a * 0.6 + texture(tNoise, p / 9.0).g * 0.5);
    albedo *= 1.0 - 0.22 * spots * smoothstep(0.45, 0.7, texture(tNoise, p / 37.0 + 0.61).g);
    // The taxilane: tyre polish either side of the centreline and a line of oil drips along it.
    float dl = abs(p.y - ${f(APRON_TAXILANE_V)});
    float tyre = exp(-pow(dl - 1.3, 2.0) / 0.5) * texture(tNoise, vec2(p.x / 60.0, p.y / 1.5)).g;
    albedo *= 1.0 - 0.35 * tyre;
    float drip = exp(-dl * dl / 0.35) * smoothstep(0.45, 0.8, texture(tNoise, vec2(p.x / 1.7, p.y / 0.9)).a + 0.3 * texture(tNoise, p / 23.0).r);
    albedo *= 1.0 - 0.45 * drip;
    // Grime washed toward the building line and the grass edges.
    albedo *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 6.0, -asd)) * texture(tNoise, p / 7.0).r;
    float joint = max(pulses(q.x + 0.008, 5.0, 0.016, w.x), pulses(q.y + 0.008, 5.0, 0.016, w.y));
    albedo = mix(albedo, 0.05, joint * 0.85);
    tex.g = mix(tex.g, 0.55, joint);
  } else {
    tex = samplePacked(tAsphalt, p + 311.0, 4.0);
    albedo = tex.r * (0.95 + 0.24 * (big.r - 0.5) + 0.12 * (mid.g - 0.5));
    float crack = texture(tCrack, (p + 23.0) / 64.0).r * smoothstep(0.45, 0.7, big.a);
    albedo = mix(albedo, 0.03, crack);
    tex.g = mix(tex.g, 0.45, crack);
    tex.ba = mix(tex.ba, vec2(0.5), crack);
    // Lighter weathered margins where no tyres run.
    albedo *= 1.0 + 0.25 * smoothstep(-2.5, 0.0, sd);
  }
  float rough = tex.g;
  vec2 slope = tex.ba * 2.0 - 1.0;

  // Yellow markings.
  float cd = centrelineDist(p);
  float yellow = line(cd, 0.075, fw);
  float black = apron ? line(cd, 0.225, fw) : 0.0;  // black outline for contrast on concrete
  if (!apron && asd > 2.0) {
    // Taxiway edge marking: two continuous 6 in lines, 6 in apart, just inside the pavement edge.
    float e = -sd;
    yellow = max(yellow, band(e, 0.10, 0.25, fw) + band(e, 0.40, 0.55, fw));
  }
  if (p.y > ${f(HOLD_LINE_V - 3)} && p.y < ${f(HOLD_LINE_V + 1)}) {
    ${holdLines}
  }

  vec3 tie = vec3(0.0);
  if (apron) {
    // Nearest parking slot in each row.
    float k = clamp(floor((p.x - ${f(firstU)}) / ${f(PARKING_SPACING)} + 0.5), 0.0, ${f(nSlots - 1)});
    vec2 cA = vec2(${f(firstU)} + k * ${f(PARKING_SPACING)}, ${f(PARKING_ROW_A_V)});
    if (k < ${f(nA)} && abs(p.y - cA.y) < 7.0) tie = tieDown(p, cA, 1.0, w);
    vec2 cB = vec2(cA.x, ${f(PARKING_ROW_B_V)});
    if (VALID_B[int(k)] > 0.5 && abs(p.y - cB.y) < 7.0) tie = tieDown(p, cB, -1.0, w);
    // Fuel island pad outline.
    vec2 fq = p - ${v2(FUEL_ISLAND.u, FUEL_ISLAND.v)};
    float box = band(abs(fq.x), 5.8, 6.0, w.x) * band(abs(fq.y), -1.0, 4.0, w.y) + band(abs(fq.y), 3.8, 4.0, w.y) * band(abs(fq.x), -1.0, 6.0, w.x);
    yellow = max(yellow, max(box, tie.x));
    albedo = mix(albedo, albedo * 0.4, tie.z * 0.85);
  }
  float wear = paintWear(p, tex.r - (apron ? 0.28 : 0.2));
  yellow *= mix(0.6, 1.0, wear);
  black *= mix(0.7, 1.0, wear);

  vec3 col = albedo * (apron ? vec3(1.0, 0.99, 0.96) * slabTint : vec3(1.0, 0.98, 0.95));
  col = mix(col, vec3(0.025), max(black - yellow, 0.0));
  col = mix(col, vec3(0.70, 0.47, 0.05), yellow);
  col = mix(col, vec3(0.06), tie.y);
  rough = mix(rough, 0.6, max(yellow, black));
  slope *= 1.0 - 0.6 * max(yellow, black);
  return Pave(col, rough, slope, alpha);
}
`;
}
