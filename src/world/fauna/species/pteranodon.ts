// Pteranodon longiceps: the body and the material's rig view (WP4 owns this file). The export names are fixed:
// createPteranodon() (species/index.ts FAUNA_SPECIES.pteranodon.build) and PTERANODON_RENDER (.render).
//
// A Look-only variant on the azhdarchid rig (rig 1): the azhdarchid Look builder with a long, swept-back crest
// well past the skull, a pale grey-white body and neck, dark membranes and a red-brown crest, drawn at a 6.5 m
// span by the roster's SPECIES_REFERENCE_M. The azhdarchid fold and sub-joints are used as they are
// (AZHDARCHID_RENDER).
//
// KNOWN LIMITATION: the neck is the azhdarchid's long, stiff neck (the real Pteranodon had a short one). The
// crest, the pale/dark colour scheme and the 6.5 m span carry the read at flight ranges; faithful proportions
// are deferred to increment 3, if the owner asks.

import * as THREE from 'three';
import type { CreatureMeshSet, SpeciesRender } from '../types';
import { AZHDARCHID_RENDER, azhdarchidPivots, AZHDARCHID_SPAN_M, buildAzhdarchid, type AzhdarchidLook } from './azhdarchid';
import { PROFILE } from './pteranodon.data';

/**
 * Pteranodon colours: pale grey-white belly, neck and flanks, a darker back, nearly black wing membranes (the
 * wing tops read dark against the sky from below and the pale body is the contrast), a red-brown crest. The
 * crest is the shape cue against the azhdarchids: a tall blade (0.45 m of an 11-unit body) that sweeps 1.7 m
 * back past the skull (about 1.05 m at the 6.5 m span).
 */
export const PTERANODON_LOOK: AzhdarchidLook = {
  body: [0.15, 0.148, 0.138],
  back: [0.085, 0.08, 0.072],
  neck: [0.15, 0.147, 0.135],
  beak: [0.12, 0.112, 0.092],
  crest: [0.16, 0.06, 0.032],
  membrane: [0.034, 0.03, 0.028],
  membraneEdge: [0.022, 0.02, 0.019],
  crestFrom: 0.0,
  crestTo: 0.3,
  crestHeight: 0.45,
  crestBack: 1.7,
};

/** Skull rear (body units, azhdarchid HEAD[0].x): the crest's reach behind it is measured from here. */
export const PTERANODON_SKULL_REAR_X = 1.62;

// Detail per LOD (azhdarchid res() counts): LOD0 fits the 1500 triangle cap, the caster the 600 cap.
const DETAIL_LOD0 = 0.87;
const DETAIL_LOD1 = 0.2;
const DETAIL_CASTER = 0.45;

/**
 * Drop the smallest triangles until at most `max` remain. The azhdarchid builder's floor (res() minimums) sits a
 * few triangles above the Pteranodon's LOD1 and LOD2 caps; the trimmed ones are the slivers (eye, tip caps).
 */
function trimTriangles(g: THREE.BufferGeometry, max: number): THREE.BufferGeometry {
  const idx = g.index!;
  const n = idx.count / 3;
  if (n <= max) return g;
  const pos = g.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const area: { t: number; s: number }[] = [];
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, idx.getX(t * 3));
    b.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
    c.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
    area.push({ t, s: b.sub(a).cross(c.sub(a)).length() });
  }
  area.sort((p, q) => q.s - p.s);
  const keep = area.slice(0, max).map((x) => x.t).sort((p, q) => p - q);
  const out = new Uint16Array(keep.length * 3);
  keep.forEach((t, k) => {
    out[k * 3] = idx.getX(t * 3);
    out[k * 3 + 1] = idx.getX(t * 3 + 1);
    out[k * 3 + 2] = idx.getX(t * 3 + 2);
  });
  g.setIndex(new THREE.BufferAttribute(out, 1));
  return g;
}

export function createPteranodon(): CreatureMeshSet {
  const [, t1, t2] = PROFILE.render.tris;
  return {
    lod0: buildAzhdarchid(DETAIL_LOD0, PTERANODON_LOOK).geometry,
    lod1: trimTriangles(buildAzhdarchid(DETAIL_LOD1, PTERANODON_LOOK).geometry, t1),
    lod2: trimTriangles(buildAzhdarchid(0, PTERANODON_LOOK, true).geometry, t2),
    caster: buildAzhdarchid(DETAIL_CASTER, PTERANODON_LOOK).geometry,
    pivots: azhdarchidPivots(),
    lengthM: AZHDARCHID_SPAN_M,
  };
}

export const PTERANODON_RENDER: SpeciesRender = AZHDARCHID_RENDER;
