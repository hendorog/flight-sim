// Pilatus PC-12/47: panel-face facts shared by the panel (panel.ts) and the 3D cockpit (visual.ts), in canvas px.
// Owner: P3 (the scaffold seed of plan 5.6 was moved: see below). The canvas maps onto the panel face at
// PC12_PANEL_PX_PER_M, centred on the aircraft centreline; the 3D cockpit derives the face from PC12_PANEL_SIZE and
// PC12_PANEL_PX_PER_M, so changing either changes the face (AGENT choices, reasons below).
//
// Scale: 2000 px/m (the C208's), not the seed's 1250. The panel is drawn at native instrument size (a 3-1/8" case
// is the 172 px bezel) and the flat Upper view of src/instruments/fixedPanel.ts needs that size to keep the
// instruments at least 120 CSS px across on a 1366 x 768 laptop (tests/instruments/fixedPanel.test.ts).
//
// The arrangement is read from the legacy /47 photographs (research-pc12.md section 15, Commons C-GMPY and
// PilatusPC-12Cockpit): standby instruments outboard, then the pilot's basic T (ASI, attitude, altimeter over
// RMI, horizontal situation, VSI), the EIS 3 x 3 window grid in the centre with the CAWS grid below it and the
// gear handle at its left, the radio stack right of the EIS, the co-pilot's T, the switches at the lower left, the
// centre pedestal under the CAWS. Coordinates are ESTIMATE from the photographs.

import type { Rect } from '../types';

/** Canvas size (2.8 m x 1.04 m of face), px, and its scale. */
export const PC12_PANEL_SIZE = { w: 2800, h: 1040 } as const;
export const PC12_PANEL_PX_PER_M = 2000;
export const PC12_PANEL_PX_RECT: Rect = { x: 0, y: 0, w: PC12_PANEL_SIZE.w, h: PC12_PANEL_SIZE.h };
export const PC12_PANEL_CENTRE_PX = PC12_PANEL_SIZE.w / 2;
/** Canvas x of a lateral body position y, m. */
export const pc12PanelPx = (y: number): number => PC12_PANEL_CENTRE_PX + y * PC12_PANEL_PX_PER_M;

/** Control-wheel hubs, left and right seat (y = -/+0.40 m): the shaft boots stand here and nothing may be under them. */
export const PC12_YOKES = { y: 720, xs: [pc12PanelPx(-0.4), pc12PanelPx(0.4)] as const, r: 60 } as const;

/** The pilot's attitude indicator (centre of the basic T) and the co-pilot's, px. */
export const PC12_PILOT_T = { x: pc12PanelPx(-0.4), y: 150 } as const;
export const PC12_COPILOT_T = { x: pc12PanelPx(0.4), y: 150 } as const;
/** Column and row pitch of a basic T (px): ASI left of the attitude indicator, altimeter right; RMI, horizontal situation, VSI below. */
export const PC12_T_PITCH = { x: 184, y: 184 } as const;

/** The EIS: (x, y) the centre of the 3 x 3 window grid, (x0, y0) its top left, `cell` the window size, px. */
export const PC12_EIS = { x: 1125, y: 289, x0: 900, y0: 64, cell: 150, cols: 3, rows: 3 } as const;
/** The CAWS 6 x 8 legend grid: origin, bounds and cell size (cells share the bounds with a 5 px gap), px. */
export const PC12_CAWS = { x0: 900, y0: 560, cols: 6, rows: 8, w: 430, h: 300, cellW: 66, cellH: 32 } as const;
/** Gear handle (left of the CAWS) and the light cluster above it: three greens and the red unsafe light. */
export const PC12_GEAR_HANDLE = { x: 796, y: 770 } as const;
export const PC12_GEAR_LIGHTS: Rect = { x: 740, y: 560, w: 112, h: 150 };
/** Flap position gauge (round, below the RMI). */
export const PC12_FLAP_GAUGE = { x: PC12_PILOT_T.x - 184, y: 520, r: 55 } as const;
/** Centre pedestal: outline and the lever slots (MOR, PCL with beta/reverse aft of the gate, condition lever with three detents, flap lever). */
export const PC12_PEDESTAL = { x0: 1210, x1: 1590, y0: 880, levers: { mor: 1282, power: 1362, condition: 1490, flaps: 1554 } } as const;

/** The 3D parts that stand on the panel, for visual.ts. */
export const PC12_PANEL_PARTS = { yokes: PC12_YOKES, pedestal: PC12_PEDESTAL, gearHandle: PC12_GEAR_HANDLE } as const;
