// Posed creatures against the ground and across the launch (Deep Time WP4), through the CPU mirror of the
// vertex stage (poseMirror.ts): the Edmontosaurus's stance foot stays on the ground at every gait, the
// azhdarchid's folded hands stay planted through the launch crouch, and the launch hands over to flight
// without the wingtips jumping.

import { describe, expect, it } from 'vitest';
import { AZHDARCHID_GROUND_OFFSET_M as G } from '../../src/world/fauna/species/azhdarchid';
import { buildFaunaSpecies } from '../../src/world/fauna/species/index';
import { BONE } from '../../src/world/fauna/types';
import { posePositions, type PoseInput } from './poseMirror';

const ed = buildFaunaSpecies('edmontosaurus');
const qz = buildFaunaSpecies('quetzalcoatlus');
const minY = (p: [number, number, number][]): number => Math.min(...p.map((v) => v[1]));
const legs = (b: number): boolean => b === BONE.legHL || b === BONE.legHR || b === BONE.legFL || b === BONE.legFR;
const hind = (b: number): boolean => b === BONE.legHL || b === BONE.legHR;
const wings = (b: number): boolean => b === BONE.wingL || b === BONE.wingR;

describe('Edmontosaurus feet', () => {
  const rest = minY(posePositions(0, ed, ed.lod1, { phase: 0, gaitBlend: 0, flap: 0 }, legs));

  it.each([0.5, 1, 1.5, 2])('at gaitBlend %s no foot sinks and a hind foot stays planted through the stride', (gaitBlend) => {
    for (let k = 0; k < 16; k++) {
      const inp: PoseInput = { phase: k / 16, gaitBlend, flap: 0 };
      // No foot more than 5 cm into the ground, y = 0 (the run used to sink the stance foot ~0.2 m).
      expect(minY(posePositions(0, ed, ed.lod1, inp, legs))).toBeGreaterThan(-0.05);
      // The lower hind foot is where it stands at rest (no floating).
      expect(minY(posePositions(0, ed, ed.lod1, inp, hind)) - rest).toBeLessThan(0.02);
    }
  });
});

describe('azhdarchid quad launch', () => {
  it('keeps the folded hands on the ground through the crouch', () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      for (let gb = 1; gb <= 1.55 + 1e-9; gb += 0.025) {
        expect(minY(posePositions(1, qz, qz.lod1, { phase, gaitBlend: gb, flap: 1 }, wings)) + G).toBeGreaterThan(-0.03);
      }
    }
  });

  it('does not slide the planted hand while the body sinks', () => {
    // Phase 0.75: the right arm's walk swing is zero, so only the crouch moves the hand.
    const right = (b: number): boolean => b === BONE.wingR;
    const low = (gb: number): [number, number, number] =>
      posePositions(1, qz, qz.lod1, { phase: 0.75, gaitBlend: gb, flap: 1 }, right).reduce((m, p) => (p[1] < m[1] ? p : m));
    const h0 = low(1);
    for (let gb = 1; gb <= 1.3 + 1e-9; gb += 0.025) {
      const h = low(gb);
      expect(Math.hypot(h[0] - h0[0], h[1] - h0[1], h[2] - h0[2])).toBeLessThan(0.08);
    }
  });

  it.each([0, 1])('hands over to flight without the wingtips jumping (flap %s)', (flap) => {
    for (const phase of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const at = (gb: number): [number, number, number][] => posePositions(1, qz, qz.lod1, { phase, gaitBlend: gb, flap }, wings);
      let prev = at(1.7);
      for (let gb = 1.71; gb <= 2 + 1e-9; gb += 0.01) {
        const cur = at(Math.min(2, gb));
        const step = Math.max(...cur.map((p, i) => Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1], p[2] - prev[i][2])));
        // The fastest launch downstroke moves the tips ~0.3 m per 0.01 of gaitBlend; a hard switch moved metres.
        expect(step).toBeLessThan(0.6);
        prev = cur;
      }
      const end = at(1.999);
      const flying = at(2);
      expect(Math.max(...flying.map((p, i) => Math.hypot(p[0] - end[i][0], p[1] - end[i][1], p[2] - end[i][2])))).toBeLessThan(0.05);
    }
  });
});
