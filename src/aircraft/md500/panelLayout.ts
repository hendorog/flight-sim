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
