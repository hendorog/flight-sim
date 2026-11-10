// Round V A2 (PLAN-V section 1, "a temporary setter in the style of setSlopeParams"): the build variants that
// scripts/probes/a2Attrib.test.ts measures, and the few values it records on the way. Only that probe calls setA2;
// every flag false is A1 as built. Deleted, with every reference to it, in A3's commit.
//   (b) noCore: no river core held in the slope pass (heightfield.ts mountainSlopes: riverCore of no axes; V4's floor)
//   (c) cornerOff 'delta': the corner fix (erosion.ts buildErosion) left out of the drawn delta only (the lattice the
//       drainage settles its lakes on, the carve's surface and the valley depth keep it; the routing never had it);
//       'all': the corner fix not applied at all (the drawn lattice, its lakes and cuts, the carve's surface too)
//   (d) noMarkCourse: markCourse not called (heightfield.ts buildWater)
//   (e) noValley: the network's second valley off (riverNetwork.ts valleyInfluence 1 m: RN19's reach and HF12's
//       excess-t^2 gorge; the floodplain and the channel stay)
export interface A2Variant {
  noCore: boolean;
  cornerOff: false | 'delta' | 'all';
  noMarkCourse: boolean;
  noValley: boolean;
  /** Record the values below while building and sampling. */
  record: boolean;
}
export const A2: A2Variant = { noCore: false, cornerOff: false, noMarkCourse: false, noValley: false, record: false };
export function setA2(p: Partial<A2Variant>): void {
  Object.assign(A2, p);
}
/** Recorded (A2.record): the lattice's change without the corner fix (copyEdges as the drawn one), and how far the
 * corner fix lowered each lattice cell, m (both n x n, erosion.ts buildErosion). */
export const A2rec: { deltaRouted: Float32Array | null; lowered: Float32Array | null; pre: number; valley: number } = { deltaRouted: null, lowered: null, pre: 0, valley: 0 };
