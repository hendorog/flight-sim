// Lockheed AH-56A Cheyenne: the REAR-SEAT pilot cockpit layout CONTRACT shared by the panel (PN) and the 3D cockpit
// (AX). FROZEN at the scaffold: integrator-owned, changes only through PR text. Plan revision 2, sections 7.5-7.6.
//
// No photograph of the rear (pilot) panel exists in the sources: this is an AGENT reconstruction from report text
// (research-ah56 section 12), marked UNVERIFIED. Centre stack of vertical-tape engine gauges, basic T around an ADI/HSI,
// collective blade-angle and prop beta indicators. Sizes and positions ESTIMATE.
import { roundedPanelOutline } from '../../core/roundedOutline';
import { x, z } from './dimensions';

export const AH56_PANEL_PX_PER_M = 2400;
/** Rear panel face: 0.62 m wide x 0.40 m tall, 1488 x 960 px. ESTIMATE */
export const AH56_PANEL_CANVAS = { w: 1488, h: 960 } as const;
export const AH56_PANEL_OUTLINE = roundedPanelOutline([[0, 0], [1488, 0], [1488, 960], [0, 960]], 32);
/** Face centre on the centreline about 0.72 m ahead of the rear eye point, tilted back 10 deg. ESTIMATE */
export const AH56_PANEL_FACE = { centre: { x: x(140), y: 0, z: z(118) },
  width: AH56_PANEL_CANVAS.w / AH56_PANEL_PX_PER_M, height: AH56_PANEL_CANVAS.h / AH56_PANEL_PX_PER_M, tiltBackDeg: 10 } as const;
/** Side consoles (gear handle and tail-wheel lock lever left; the ICS roll-compensator and pitch-desensitizer buttons).
 *  ESTIMATE */
export const AH56_SIDE_CONSOLES = { left: { centre: { x: x(165), y: -0.36, z: z(108) } }, right: { centre: { x: x(165), y: 0.36, z: z(108) } },
  width: 0.14, length: 0.50 } as const;
/** Vertical-tape engine stack (torque, TIT, Ng, Nf/Nr) in the centre of the face, px. ESTIMATE */
export const AH56_TAPE_STACK = { x: 620, y: 80, w: 248, h: 800 } as const;
