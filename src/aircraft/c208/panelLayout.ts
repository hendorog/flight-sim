// Cessna 208 Caravan 675: the few panel-face facts that the instrument panel (panel.ts) and the 3D cockpit
// (visual.ts) must agree on, in canvas px. Plain data. panel.ts lays out everything else around them; visual.ts
// builds the 3D parts (control wheels, the centre pedestal's levers, the flap selector, the parking brake) at
// these px on the face.
//
// The analogue Caravan panel spans the 1.62 m cabin: flight instruments in front of the left seat (y = -0.38 m),
// the engine instruments in a vertical column left of centre (torque, ITT, Np, Ng, fuel flow, oil), the radio
// stack in the centre, the co-pilot's instruments on the right; the pedestal below the centre carries the power,
// propeller and condition levers, the fuel shut-off and the trim wheels; the flap selector is on the right of the
// lower panel (POH sect. 7).

import type { Rect } from '../types';

/** Canvas px per metre of the face (instruments drawn at their real size, as on every other type). */
export const C208_PANEL_PX_PER_M = 2000;
/** The canvas, and the part of it the face shows (all of it): 1.46 m by 0.46 m. */
export const C208_PANEL_SIZE = { w: 2920, h: 920 } as const;
export const C208_PANEL_PX_RECT: Rect = { x: 0, y: 0, w: C208_PANEL_SIZE.w, h: C208_PANEL_SIZE.h };
/** px column of the aircraft's centreline. */
export const C208_PANEL_CENTRE_PX = C208_PANEL_PX_RECT.x + C208_PANEL_PX_RECT.w / 2;
/** px column of a body y, m. */
export const c208PanelPx = (y: number): number => C208_PANEL_CENTRE_PX + y * C208_PANEL_PX_PER_M;

/** Control-wheel shafts through the panel, left and right seats (y = -/+0.38 m). */
export const C208_YOKES = { y: 640, xs: [c208PanelPx(-0.38), c208PanelPx(0.38)] as const, r: 60 } as const;
/**
 * The centre pedestal in front of the lower centre of the face: its body covers x0 .. x1 from y0 down past the
 * panel's lower edge (nothing is painted there). Its levers, left to right: POWER, PROP, CONDITION (lever x px at
 * the face, the slot top at y0 + 20).
 */
export const C208_PEDESTAL = { x0: 1310, x1: 1610, y0: 700, levers: { power: 1380, propeller: 1460, condition: 1540 } } as const;
/** The flap selector and its position indicator on the right of the lower panel: lever slot x, 0 deg at y, FULL `travel` px lower. */
export const C208_FLAP_SELECTOR = { x: 1790, y: 660, travel: 200 } as const;
/** The parking brake handle at the lower left of the panel. */
export const C208_PARKING_BRAKE = [90, 820] as const;

/** The 3D parts that stand on the panel, for visual.ts. */
export const C208_PANEL_PARTS = {
  yokes: C208_YOKES,
  pedestal: C208_PEDESTAL,
  flapSelector: C208_FLAP_SELECTOR,
  parkingBrake: C208_PARKING_BRAKE,
} as const;
