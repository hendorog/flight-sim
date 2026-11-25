// Richard Pearse 1903 Monoplane: pure panel layout constants shared by panel.ts and visual.ts.
// Kept free of closures and browser imports so visual.ts stays loadable inside liveryWorker.ts.

export const PEARSE_PANEL_PX_RECT = { x: 0, y: 0, w: 1280, h: 580 } as const;
export const PEARSE_PANEL_WIDTH = 0.64;
export const PEARSE_PANEL_PX_PER_M = PEARSE_PANEL_PX_RECT.w / PEARSE_PANEL_WIDTH; // 2000 px/m
export const PEARSE_PANEL_CENTRE_PX = PEARSE_PANEL_PX_RECT.x + PEARSE_PANEL_PX_RECT.w / 2;

export const PEARSE_FLAP_SLOT = { x: 930, y: 124 } as const;
export const PEARSE_PARKING_BRAKE = [74, 492] as const;
