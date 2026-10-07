// Instrument panel layout: plain data shared by the panel artwork, its click hotspots and the 3D cockpit
// (render/aircraft/cockpit.ts places rockers, the magneto key, dimmer knobs and gauge recesses from it).
// No imports, so the aircraft model can use it without pulling in the panel renderer.

export const PANEL_WIDTH = 2080;
export const PANEL_HEIGHT = 800;

/**
 * Panel layout in canvas pixels (origin top-left): u = x / PANEL_WIDTH, v = 1 - y / PANEL_HEIGHT.
 *
 * The 3D cockpit (render/aircraft/cockpit.ts) puts physical parts in front of the panel face, and the
 * artwork leaves room for them: the yoke columns enter at u = 0.24 / 0.76, v = 0.21 (px 499 / 1581, 632,
 * boots about 56 px in radius), the throttle and mixture shafts at px (1040, 720) and (1260, 720), and
 * the flap lever's slot plate at px x = 1540, y = 540..800 (lever 0 deg at y = 560, FULL at y = 760).
 */
export const PANEL_LAYOUT = {
  /** Left-seat centreline: the six-pack is centred on it (u = 0.24). */
  pilotCentreX: 499,
  sixPack: { cols: [315, 499, 683] as const, rows: [205, 393] as const },
  cdi: { x: 867, rows: [205, 393] as const },
  leftColumn: { x: 100, clock: 180, suction: 318, ammeter: 456 },
  /** The tach sits right of the pilot's yoke column (which enters the panel at x 499, y 632). */
  engineRow: { y: 585, fuel: 250, oil: 380, tach: 668, egt: 834 },
  /** Yoke column boots (3D), left and right, and their radius: keep artwork out of these circles. */
  yokes: { y: 632, xs: [499, 1581] as const, r: 58 },
  annunciator: { x: 244, y: 50, w: 510, h: 52 },
  switches: { x: 20, y: 680, w: 760, h: 116 },
  stack: { x: 962, gps: 34, navcom: 278, xpdr: 362, blank: 430 },
  throttle: [1040, 720] as [number, number],
  mixture: [1260, 720] as [number, number],
  /** Flap position scale beside the 3D lever slot; slot at local x 90, 0 deg at local y 60, FULL 200 px lower. */
  flaps: { x: 1440, y: 480, w: 130, h: 312 },
  /** Seam between the centre stack and the right sub-panel. */
  rightSeamX: 1302,
  circuitBreakers: { x: 1628, y: 676, w: 420, h: 116 },
  /**
   * The switch row inside `switches` (local px): rocker switches (painted by SwitchPanel, 3D rockers in the
   * cockpit, click hotspots), the magneto/starter key and the panel / radio light dimmers.
   */
  switchRow: {
    rockerTop: 44,
    rockerW: 24,
    rockerH: 42,
    rockers: [
      { key: 'alt', x: 138, red: true },
      { key: 'bat', x: 163, red: true },
      { key: 'fuelPump', x: 222 },
      { key: 'beacon', x: 280 },
      { key: 'landing', x: 322 },
      { key: 'taxi', x: 364 },
      { key: 'nav', x: 406 },
      { key: 'strobe', x: 448 },
      { key: 'avionics', x: 516 },
      { key: 'pitotHeat', x: 584 },
    ],
    magneto: { x: 58, y: 72 },
    dimmers: { panel: 650, radio: 710, y: 66 },
  },
  /** Glass aperture diameters of the round gauges, px: 3-1/8" (six-pack, CDIs, tach) and 2-1/4" instruments. */
  apertures: { sixPack: 74, small: 51 },
} as const;

export type RockerKey = (typeof PANEL_LAYOUT.switchRow.rockers)[number]['key'];
