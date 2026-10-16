// MD 500E: the panel face shared by the panel (panel.ts, M3) and the 3D cockpit (visual.ts / exterior, M2).
// SCAFFOLD SEED; owner afterwards: M3, who keeps the exported names. Sizes: MD spec pp 10-12 (M): instrument panel
// 17.3 x 13.7 in, slant console 16.3 x 10.1 in, crew seat to panel 18.5 in. The panel is on the centreline; the pilot
// sits LEFT. Face position and tilt ESTIMATE (3V from RFM Fig 1-1 / 6-3 and the Radecki cockpit photo).
import { roundedPanelOutline } from '../../core/roundedOutline';
import { SKID_Z } from './dimensions';

const IN = 0.0254;
export const MD500_PANEL_PX_PER_M = 2400;
/** Canvas: the 17.3 x 13.7 in face at 2400 px/m (1054 x 835 px, rounded up to a multiple of 8). */
export const MD500_PANEL_CANVAS = { w: 1056, h: 840 } as const;
export const MD500_PANEL_OUTLINE = roundedPanelOutline([[0, 0], [1056, 0], [1056, 840], [0, 840]], 24);
/** Face centre: STA 47 (ESTIMATE), 1.40 m above the skid soles; tilted back 15 deg. */
export const MD500_PANEL_FACE = { centre: { x: (100 - 47) * IN, y: 0, z: SKID_Z - 1.4 },
  width: MD500_PANEL_CANVAS.w / MD500_PANEL_PX_PER_M, height: MD500_PANEL_CANVAS.h / MD500_PANEL_PX_PER_M, tiltBackDeg: 15 } as const;
/** Slant console below the face (16.3 x 10.1 in). */
export const MD500_CONSOLE = { width: 16.3 * IN, height: 10.1 * IN, tiltBackDeg: 45 } as const;

/**
 * Where the instruments sit on the 1056 x 840 face, px (M3; ESTIMATE from RFM Fig 4-2 and the Radecki cockpit photo:
 * columns left to right are ASI over tach, attitude over DG (optional fit), altimeter over VSI, the engine stack, the
 * right column). The face keeps the frozen 17.3 x 13.7 in; the lower console (slant panel, 16.3 x 10.1 in in the
 * aircraft) is painted on the same canvas below y 650 because the face is ONE texture (M2 reads only the names above).
 */
export const MD500_COLS = { asi: 118, att: 326, alt: 534, engine: 760, right: 930 } as const;
export const MD500_ROWS = { top: 186, second: 394 } as const;
/** The four engine / right-column gauge rows (2-1/4 in cases, 137 px). */
export const MD500_STACK_Y = [150, 292, 434, 576] as const;
export const MD500_CONSOLE_TOP = 652;
/** The 16 press-to-test lenses (RFM Fig 3-1), legends on the lens caps: 60 x 58 px cells (25 x 24 mm), as tall as the oil gauges below allow. */
export const MD500_ANNUNCIATOR_STRIP = { x: 32, y: 20, cell: 62, h: 58 } as const;
