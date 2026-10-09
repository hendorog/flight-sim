// C016-7 main blades, C029-3 tail blades. MM Fig. 28-19 (Aug 2025), Fig. 30-6 (Dec 2021).
// Distances are measured INBOARD from the tip, not from the hub. The renderer's metallic leading-edge
// strip is still approximate; the real C016-7 has an 84 in ProtectaClear strip and a painted inboard edge.
import type { RotorBladePaint } from '../../render/aircraft/airframe/types';

const IN = 0.0254;
const WHITE = 0xe4e6e1, YELLOW = 0xe1b536, BLACK = 0x202225;

export const R44_MAIN_PAINT: RotorBladePaint = {
  bands: [
    { tipDistance: 12 * IN, upper: YELLOW, lower: YELLOW },
    { tipDistance: 48 * IN, upper: WHITE, lower: BLACK },
    { tipDistance: 84 * IN, upper: YELLOW, lower: BLACK },
    { tipDistance: 120 * IN, upper: WHITE, lower: BLACK },
  ],
  rootUpper: YELLOW, rootLower: BLACK, capLength: 0.008,
};

export const R44_TAIL_PAINT: RotorBladePaint = {
  bands: [4.1, 7.9, 11.7, 15.5, 19.3].map((inches, i) => ({
    tipDistance: inches * IN, upper: i % 2 ? BLACK : WHITE, lower: i % 2 ? BLACK : WHITE,
  })),
  rootUpper: BLACK, rootLower: BLACK, capLength: 0.004,
};
