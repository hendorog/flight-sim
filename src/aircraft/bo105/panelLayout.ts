// MBB Bo 105 CB-4: the cockpit layout CONTRACT shared by the panel (PN: gauges painted inside the face) and the 3D cockpit
// (BX: the pedestal, overhead console and power levers built around it). FROZEN at the scaffold: integrator-owned,
// changes only through PR text, so BX and PN (running in parallel) always agree. Plan revision 2, section 6.3-6.4.
//
// The Bo 105 carries all instruments on a NARROW CENTRE PEDESTAL (P5 FM Fig 7-2/7-3 "typical"; P TM 00-24..00-27; photos
// docs/bo105-sources.md): three columns, seven rows; the switch panel on the centre console below it; the overhead
// console with the fuel-pump, light and generator switches; the TWO POWER LEVERS hanging from the cabin roof just
// forward of the overhead console. The pilot sits RIGHT. Sizes and positions: 3V ESTIMATE from the cockpit photos
// (Christoph 7, Policia CB) and the FM figures; no drawing dimension was found.
import { roundedPanelOutline } from '../../core/roundedOutline';
import { x, z } from './dimensions';

export const BO105_PANEL_PX_PER_M = 2400;
/** Pedestal face: 0.34 m wide x 0.62 m tall (three 3-1/8 in columns, seven rows), 816 x 1488 px. ESTIMATE */
export const BO105_PANEL_CANVAS = { w: 816, h: 1488 } as const;
export const BO105_PANEL_OUTLINE = roundedPanelOutline([[0, 0], [816, 0], [816, 1488], [0, 1488]], 24);
/** Face centre on the centreline at STA 1.18 m, 1.20 m above the skid soles; tilted back 12 deg. ESTIMATE */
export const BO105_PANEL_FACE = { centre: { x: x(1.18), y: 0, z: z(1.20) },
  width: BO105_PANEL_CANVAS.w / BO105_PANEL_PX_PER_M, height: BO105_PANEL_CANVAS.h / BO105_PANEL_PX_PER_M, tiltBackDeg: 12 } as const;
/** Centre console (switch panel, FM Fig 7-4) below the pedestal, sloping back. ESTIMATE */
export const BO105_CENTRE_CONSOLE = { centre: { x: x(1.45), y: 0, z: z(0.80) }, width: 0.30, depth: 0.40, tiltBackDeg: 60 } as const;
/** Overhead console (FM Fig 7-5) on the cabin roof between the seats. ESTIMATE */
export const BO105_OVERHEAD_CONSOLE = { centre: { x: x(1.85), y: 0, z: z(1.98) }, width: 0.26, length: 0.42 } as const;
/** The two power levers (OFF - IDLE - FLIGHT), hanging from the roof forward of the overhead console; engine 1 left,
 *  engine 2 right; lever travel arc, deg, from OFF to FLIGHT. ESTIMATE */
export const BO105_POWER_LEVERS = { pivot: { x: x(1.58), z: z(2.00) }, ys: [-0.045, 0.045], length: 0.16, travelDeg: 60 } as const;
/** Column x (px) and row y (px) centres on the face for the FM Fig 7-3 grid (PN places gauges on them). ESTIMATE */
export const BO105_COLS = [136, 408, 680] as const;
export const BO105_ROWS = [110, 300, 500, 700, 900, 1100, 1300] as const;
