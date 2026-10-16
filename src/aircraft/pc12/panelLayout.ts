// Pilatus PC-12/47: panel-face facts shared by the panel (panel.ts) and the 3D cockpit (visual.ts), in canvas px.
// SCAFFOLD SEED (plan 5.6); owner afterwards: P3, who may move gauges but keeps these exported names. The canvas maps
// onto the panel face at PC12_PANEL_PX_PER_M, centred on the aircraft centreline.

/** Canvas size, px (the C208's scale family; AGENT choice). */
export const PC12_PANEL_SIZE = { w: 2048, h: 1024 } as const;
export const PC12_PANEL_PX_PER_M = 1250;
export const PC12_PANEL_CENTRE_PX = PC12_PANEL_SIZE.w / 2;
/** Canvas x of a lateral body position y, m. */
export const pc12PanelPx = (y: number): number => PC12_PANEL_CENTRE_PX + y * PC12_PANEL_PX_PER_M;

/** The pilot's basic-T centre (ADI), the copilot's, the EIS 3x3 grid and the CAWS 6x8 grid (centres / origin, px). */
export const PC12_PILOT_T = { x: 420, y: 330 } as const;
export const PC12_COPILOT_T = { x: 1628, y: 330 } as const;
export const PC12_EIS = { x: 1024, y: 300, cell: 140 } as const;
export const PC12_CAWS = { x0: 844, y0: 520, cols: 6, rows: 8, cellW: 60, cellH: 24 } as const;
/** Gear handle (left of the CAWS) and flap position gauge (top left). */
export const PC12_GEAR_HANDLE = { x: 760, y: 760 } as const;
export const PC12_FLAP_GAUGE = { x: 120, y: 110, r: 55 } as const;
/** Centre pedestal: outline and the lever slots (PCL with beta/reverse aft of the gate; condition lever with three detents; MOR drawn fixed). */
export const PC12_PEDESTAL = { x0: 904, x1: 1144, y0: 860, levers: { mor: 950, power: 1000, condition: 1080, flaps: 1120 } } as const;
/** Yoke hubs, px. */
export const PC12_YOKES = { y: 700, xs: [pc12PanelPx(-0.4), pc12PanelPx(0.4)] as const, r: 60 } as const;
