// Control wheels ("ram's-horn" yokes) and centre sticks of the aeroplane cockpits, built from a parametric style.
//
// A yoke is: a hub (a bevelled extrusion of a rounded-trapezoid plan, facing the pilot, with an emblem plate or
// checklist card on it), the lower bar and horns (one spline centreline per side swept with a varying
// superellipse section: the bar's height and depth blend into the grip's width and depth, finger ridges on the
// grip's forward face, a domed tip), parts fixed to a horn (switch pods, trim rockers, push-to-talk and
// autopilot-disconnect buttons, in the horn's frame at a point along it), the column (round or square tube) with
// a collar at the hub, and the boot or escutcheon where the column enters the panel (static, built with the
// panel). The right half is built and mirrored, so the two horns match exactly; parts on one horn go on the
// outboard horn of each yoke (the left horn of the pilot's, the right horn of the copilot's).
//
// Everything plastic is one vertex-coloured material (yokeMaterial; one draw per yoke), the column tube the
// shared metal or black material (a second draw). ~2.5-3.5k triangles per yoke.
//
// Yoke space: x right, y up, z aft (toward the pilot), m; the origin is on the column axis at the hub, which is
// the point the yoke turns about. Proportions are from the MSFS reference frames scaled against the 3-1/8 in
// instrument bezels (work/cockpit-refs/dimensions.md): PHOTO/ESTIMATE, about +/-15 %.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CockpitDef, YokeStyleName } from './airframe/types';
import { frd, MeshBatch } from './geometry';
import type { AircraftMaterials } from './materials';

type Rgb = readonly [number, number, number];
type V3 = readonly [number, number, number];

/** One key of a swept section along the centreline: at arc-length fraction `t`, width (along the in-plane normal), forward and aft depth, m; `n` the superellipse exponent (2 ellipse, 4+ rounded rectangle). */
export interface SectionKey { t: number; w: number; dF: number; dB: number; n: number }

/** A swept tube: centreline points (the right half for a yoke), section keys, and finger ridges on the forward face. */
export interface SweepDef {
  points: readonly V3[];
  keys: readonly SectionKey[];
  /** Length of the domed tip, m (0: open end). */
  tip: number;
  /** Finger ridges on the forward face between t0 and t1: `count` bumps of `amp` (share of the forward depth). */
  ridges?: { t0: number; t1: number; count: number; amp: number };
  /** Rings from the start up to arc-length fraction `t` in another colour (a bare tube under a slid-on grip). */
  band?: { t: number; colour: Rgb };
  rings: number;
  segments: number;
}

/**
 * A part fixed to a horn (or a stick grip): a rounded box, a cylinder (button), or a split rocker, `at` the
 * arc-length fraction along the sweep (1 = the tip), offset [out, along, aft] in the frame there (out: across the
 * grip toward the outboard side, along: the centreline tangent, aft: toward the pilot), turned by `rot` (rad about
 * out, along, aft), size [out, along, aft] m.
 */
export interface Fitting {
  shape: 'box' | 'button' | 'rocker';
  at: number;
  offset: V3;
  size: V3;
  rot?: V3;
  colour: Rgb;
  /** Corner radius of a box, m. */
  r?: number;
}

/** Plan of the hub (or an emblem plate) as the pilot sees it: a rounded trapezoid. */
export interface Plate {
  /** Centre height, m (yoke space y). */
  y: number;
  wBottom: number;
  wTop: number;
  h: number;
  /** Corner radius, m. */
  r: number;
  /** Aft face z, m (the pilot side); the plate extends `depth` forward from it. */
  z: number;
  depth: number;
  bevel: number;
  colour: Rgb;
}

export interface YokeStyle {
  /** Body plastic. */
  colour: Rgb;
  /**
   * How far the wheel (bar, horns, hub, fittings) is raised on the column axis, m. The sim's columns leave the panel
   * ~4-6 cm lower than in the reference frames (the panel layouts keep the boots below the engine gauges), so the
   * wheels sit that much high on their columns: from the pilot eye the horn tops then reach the lower edge of the
   * main instruments, as in the references. The column still enters the hub, and the wheel turns about it.
   */
  hang: number;
  /** The right half of the lower bar and the right horn. */
  horn: SweepDef;
  hub: Plate;
  /** Emblem plate, checklist card, badge rim, speaker grille, visor: plates on the hub (drawn in order, each over the last). */
  plates: readonly Plate[];
  /** Rounded boxes in yoke space (visors, saddles): centre, size, radius, colour. */
  blocks?: readonly { c: V3; size: V3; r: number; colour: Rgb }[];
  /** On the outboard horn. */
  fittings: readonly Fitting[];
  /** The copilot's yoke has the fittings too (otherwise only the pilot's, and the copilot's has `copilot`). */
  copilotFittings: boolean;
  /** The copilot's own fittings when it does not have the pilot's (on its outboard horn). */
  copilot?: readonly Fitting[];
  column: { section: 'round' | 'square'; r: number; metal: 'chrome' | 'satin' | 'black'; collar: { r: number; len: number; colour: Rgb } };
  /** Where the column enters the panel: a round boot, a square escutcheon plate, or a large shroud (half-sizes, m). */
  boot: { kind: 'round' | 'square' | 'shroud'; w: number; h: number; depth: number };
}

// --- Colours (sRGB 0-255) ---
const BLACK: Rgb = [24, 24, 26];
const SATIN_BLACK: Rgb = [30, 31, 33];
const RED: Rgb = [178, 22, 20];
const MID_GREY: Rgb = [92, 94, 97];
const LIGHT_GREY: Rgb = [150, 151, 152];
const CREAM: Rgb = [212, 204, 182];
const CHROME_RIM: Rgb = [172, 174, 178];
const WHITE: Rgb = [226, 226, 222];

/** The tip pod with a split trim rocker (two segments), as on the Cessna and Piper left horns. */
function trimRocker(at: number, offset: V3, rot: V3 = [0, 0, 0]): Fitting[] {
  return [
    { shape: 'rocker', at, offset: [offset[0] - 0.006, offset[1], offset[2]], size: [0.009, 0.006, 0.018], rot, colour: SATIN_BLACK },
    { shape: 'rocker', at, offset: [offset[0] + 0.006, offset[1], offset[2]], size: [0.009, 0.006, 0.018], rot, colour: SATIN_BLACK },
  ];
}

/** The push-to-talk button on the outboard face of a 172 horn (the copilot's yoke has only this). */
const PTT_172: Fitting = { shape: 'button', at: 0.72, offset: [0.022, 0, 0.012], size: [0.009, 0.004, 0.009], rot: [0, 0, -Math.PI / 2], colour: SATIN_BLACK };

/**
 * Cessna 172S (1970s 172M factory photo, cessnaowner.org, and the MSFS frames): a straight bar from the lower half of a
 * wide rounded hub (~13-14 cm, wider at the top, ~9 cm tall, 2 cm proud) turns up at a tight elbow into a near-upright
 * grip (~3.4 cm, finger ridges) whose top leans in a few degrees (palm slightly down, never canted out), ~31 cm outside
 * to outside; a flat-black badge plate (SKYHAWK SP); a trim/AP-disconnect pod on the pilot's left horn (split DN/UP
 * rocker, red AP DISC button), PTT on both yokes; a satin black 1 in column.
 */
const CESSNA_SINGLE: YokeStyle = {
  colour: BLACK,
  hang: 0.04,
  horn: {
    points: [[0, -0.03, 0], [0.09, -0.03, 0], [0.118, -0.03, 0], [0.13, -0.025, 0], [0.136, -0.013, 0.001], [0.136, 0.005, 0.002], [0.133, 0.04, 0.004], [0.129, 0.075, 0.007], [0.127, 0.088, 0.008]],
    keys: [
      { t: 0, w: 0.028, dF: 0.018, dB: 0.018, n: 3 },
      { t: 0.42, w: 0.03, dF: 0.019, dB: 0.019, n: 3 },
      { t: 0.6, w: 0.033, dF: 0.022, dB: 0.021, n: 3.4 },
      { t: 0.88, w: 0.035, dF: 0.024, dB: 0.022, n: 3.6 },
      { t: 1, w: 0.034, dF: 0.023, dB: 0.021, n: 4 },
    ],
    tip: 0.01,
    ridges: { t0: 0.5, t1: 0.88, count: 4, amp: 0.12 },
    rings: 32,
    segments: 16,
  },
  hub: { y: -0.012, wBottom: 0.128, wTop: 0.138, h: 0.086, r: 0.016, z: 0.03, depth: 0.05, bevel: 0.005, colour: BLACK },
  plates: [
    { y: -0.008, wBottom: 0.104, wTop: 0.112, h: 0.056, r: 0.008, z: 0.0325, depth: 0.003, bevel: 0.001, colour: [14, 14, 15] },
    { y: -0.024, wBottom: 0.05, wTop: 0.05, h: 0.016, r: 0.01, z: 0.0345, depth: 0.002, bevel: 0.0005, colour: CHROME_RIM },
  ],
  fittings: [
    { shape: 'box', at: 0.9, offset: [0, 0.002, 0], size: [0.042, 0.034, 0.054], rot: [-0.25, 0, 0], colour: SATIN_BLACK, r: 0.009 },
    ...trimRocker(0.9, [0, 0.016, -0.006], [-0.55, 0, 0]),
    { shape: 'button', at: 0.9, offset: [0, 0.014, 0.014], size: [0.01, 0.004, 0.01], rot: [-0.25, 0, 0], colour: RED },
    PTT_172,
  ],
  copilotFittings: false,
  copilot: [PTT_172],
  column: { section: 'round', r: 0.0135, metal: 'black', collar: { r: 0.02, len: 0.035, colour: BLACK } },
  boot: { kind: 'round', w: 0.028, h: 0.028, depth: 0.02 },
};

/**
 * Cessna 152 (owner's photo of a removed wheel, scaled to a 31 cm span): a deep rounded-box hub (~16.5 cm wide,
 * ~8 cm tall, a little narrower at the bottom) with a raised face panel and an elongated chrome "Cessna" badge low
 * on it; flattened ~2.8 cm bars leave the lower sides of the hub, turn up at a rounded elbow into nearly upright
 * grips (~11 cm, a little fuller near the top), and the top of each grip hooks inward into a flat knob; black.
 */
const CESSNA_152: YokeStyle = {
  colour: [38, 38, 40],
  hang: 0.05,
  horn: {
    points: [[0.06, -0.031, 0], [0.1, -0.031, 0], [0.126, -0.035, 0], [0.139, -0.024, 0], [0.142, 0.005, 0], [0.143, 0.048, 0.002], [0.142, 0.07, 0.004], [0.135, 0.081, 0.008], [0.124, 0.084, 0.01]],
    keys: [
      { t: 0, w: 0.028, dF: 0.015, dB: 0.015, n: 3 },
      { t: 0.25, w: 0.028, dF: 0.015, dB: 0.015, n: 3 },
      { t: 0.4, w: 0.028, dF: 0.015, dB: 0.015, n: 2.6 },
      { t: 0.78, w: 0.032, dF: 0.017, dB: 0.017, n: 2.6 },
      { t: 0.9, w: 0.024, dF: 0.017, dB: 0.017, n: 2.8 },
      { t: 1, w: 0.02, dF: 0.015, dB: 0.015, n: 2.8 },
    ],
    tip: 0.008,
    ridges: { t0: 0.45, t1: 0.75, count: 3, amp: 0.06 },
    rings: 36,
    segments: 16,
  },
  hub: { y: -0.02, wBottom: 0.15, wTop: 0.165, h: 0.08, r: 0.022, z: 0.035, depth: 0.065, bevel: 0.01, colour: [38, 38, 40] },
  plates: [
    { y: -0.026, wBottom: 0.128, wTop: 0.138, h: 0.058, r: 0.016, z: 0.039, depth: 0.008, bevel: 0.002, colour: [44, 44, 46] },
    { y: -0.03, wBottom: 0.07, wTop: 0.07, h: 0.022, r: 0.008, z: 0.0415, depth: 0.004, bevel: 0.0012, colour: CHROME_RIM },
    { y: -0.03, wBottom: 0.062, wTop: 0.062, h: 0.016, r: 0.006, z: 0.0435, depth: 0.004, bevel: 0.0008, colour: [196, 150, 140] },
  ],
  fittings: [{ shape: 'button', at: 0.97, offset: [0, 0, 0.004], size: [0.009, 0.004, 0.009], rot: [Math.PI / 2, 0, 0], colour: LIGHT_GREY }],
  copilotFittings: false,
  column: { section: 'round', r: 0.012, metal: 'black', collar: { r: 0.019, len: 0.03, colour: [38, 38, 40] } },
  boot: { kind: 'round', w: 0.026, h: 0.026, depth: 0.018 },
};

/**
 * Piper PA-34 Seneca: black, one smooth U. The bar leaves the bottom of a tall tapered shield hub (10 cm wide at
 * the base, 6 at the top, 14 tall; black with a chrome-rimmed badge), sweeps out and up into tall upright horns
 * that swell to rounded "ear" tops hooking inboard; a raised trim-rocker pod with buttons on the outboard horn of
 * each yoke; a black column through a square escutcheon.
 */
const PIPER_SENECA: YokeStyle = {
  colour: BLACK,
  hang: 0.06,
  horn: {
    points: [[0, -0.078, 0], [0.08, -0.078, 0], [0.113, -0.075, 0], [0.129, -0.062, 0], [0.135, -0.042, -0.001], [0.134, 0.0, -0.002], [0.13, 0.06, -0.003], [0.126, 0.1, -0.003], [0.121, 0.116, -0.002]],
    keys: [
      { t: 0, w: 0.03, dF: 0.017, dB: 0.017, n: 2.6 },
      { t: 0.35, w: 0.03, dF: 0.017, dB: 0.017, n: 2.6 },
      { t: 0.6, w: 0.036, dF: 0.021, dB: 0.02, n: 2.6 },
      { t: 0.88, w: 0.046, dF: 0.026, dB: 0.024, n: 2.4 },
      { t: 1, w: 0.044, dF: 0.024, dB: 0.022, n: 2.2 },
    ],
    tip: 0.016,
    ridges: { t0: 0.48, t1: 0.78, count: 3, amp: 0.1 },
    rings: 32,
    segments: 16,
  },
  hub: { y: -0.035, wBottom: 0.1, wTop: 0.06, h: 0.14, r: 0.016, z: 0.03, depth: 0.06, bevel: 0.006, colour: BLACK },
  plates: [
    { y: -0.042, wBottom: 0.078, wTop: 0.046, h: 0.11, r: 0.012, z: 0.0355, depth: 0.003, bevel: 0.0012, colour: CHROME_RIM },
    { y: -0.042, wBottom: 0.072, wTop: 0.04, h: 0.104, r: 0.01, z: 0.0375, depth: 0.003, bevel: 0.0008, colour: [14, 14, 16] },
    { y: -0.062, wBottom: 0.05, wTop: 0.05, h: 0.026, r: 0.012, z: 0.0395, depth: 0.0015, bevel: 0.0005, colour: [140, 142, 146] },
  ],
  fittings: [
    { shape: 'box', at: 0.9, offset: [0.004, 0.004, 0.006], size: [0.04, 0.026, 0.05], rot: [0, 0, 0.25], colour: SATIN_BLACK, r: 0.01 },
    ...trimRocker(0.9, [0.004, 0.004, 0.031], [Math.PI / 2, 0, 0.25]),
    { shape: 'button', at: 0.9, offset: [0.026, 0.004, 0.006], size: [0.01, 0.004, 0.01], rot: [0, 0, -Math.PI / 2], colour: [60, 62, 66] },
    { shape: 'button', at: 0.95, offset: [0.004, 0.015, 0.025], size: [0.008, 0.004, 0.008], rot: [Math.PI / 2, 0, 0], colour: [60, 62, 66] },
  ],
  copilotFittings: true,
  column: { section: 'round', r: 0.015, metal: 'black', collar: { r: 0.02, len: 0.03, colour: BLACK } },
  boot: { kind: 'square', w: 0.035, h: 0.035, depth: 0.006 },
};

/**
 * Piper PA-38 Tomahawk (owner's photo of a removed wheel, scaled against its ~3 cm grips): a wide, low moulded hub,
 * ~21 cm across its flat bottom, its top sloping from the column boss to rounded points at the ends, with a raised
 * centre panel; from each end a short bare steel tube (~1.2 cm) bends up into a separate rubber grip (~10 cm tall,
 * ~3 cm at the bottom swelling to ~4 cm at the top, finger grooves on the forward face, leaning slightly in), ~29 cm
 * outside to outside; the red radio transmit button on the top of the left grip; black throughout. No trim switch: the Tomahawk's pitch trim is the overhead crank.
 */
const PIPER_TOMAHAWK: YokeStyle = {
  colour: BLACK,
  hang: 0.03,
  horn: {
    points: [[0.085, -0.03, 0], [0.104, -0.03, 0], [0.116, -0.025, 0], [0.123, -0.014, 0], [0.125, 0.0, 0], [0.123, 0.032, 0], [0.12, 0.067, 0.002], [0.117, 0.094, 0.004]],
    keys: [
      { t: 0, w: 0.012, dF: 0.006, dB: 0.006, n: 2 },
      { t: 0.3, w: 0.012, dF: 0.006, dB: 0.006, n: 2 },
      { t: 0.34, w: 0.03, dF: 0.0145, dB: 0.0145, n: 2.4 },
      { t: 0.42, w: 0.029, dF: 0.014, dB: 0.014, n: 2.4 },
      { t: 0.85, w: 0.04, dF: 0.019, dB: 0.019, n: 2.6 },
      { t: 1, w: 0.039, dF: 0.018, dB: 0.018, n: 2.6 },
    ],
    tip: 0.012,
    ridges: { t0: 0.45, t1: 0.85, count: 4, amp: 0.1 },
    band: { t: 0.32, colour: [70, 70, 72] },
    rings: 32,
    segments: 16,
  },
  hub: { y: -0.006, wBottom: 0.21, wTop: 0.05, h: 0.058, r: 0.012, z: 0.03, depth: 0.05, bevel: 0.01, colour: BLACK },
  plates: [{ y: -0.008, wBottom: 0.075, wTop: 0.045, h: 0.044, r: 0.006, z: 0.035, depth: 0.008, bevel: 0.0015, colour: [34, 34, 36] }],
  fittings: [{ shape: 'button', at: 1, offset: [0, 0.0015, 0], size: [0.01, 0.004, 0.01], colour: RED }],
  copilotFittings: false,
  column: { section: 'round', r: 0.013, metal: 'black', collar: { r: 0.018, len: 0.03, colour: BLACK } },
  boot: { kind: 'round', w: 0.026, h: 0.026, depth: 0.018 },
};

/**
 * Cessna 208 Caravan: the 172's U made larger and heavier, satin grey. A wide flat lower bar with rounded corners
 * into faceted rectangular-section horns (13 cm tall, ~37 cm span) with flat tops; a tall shield hub carrying a
 * white checklist card under a visor and a speaker grille below it; on the outboard horn of each yoke a pod with
 * the red AP/TRIM DISC button, the split trim rocker and a round grey button; 3 cm column.
 */
const CESSNA_208: YokeStyle = {
  colour: [74, 76, 80],
  hang: 0.065,
  horn: {
    points: [[0, -0.07, 0], [0.1, -0.07, 0], [0.142, -0.068, 0], [0.158, -0.058, 0], [0.164, -0.04, -0.001], [0.163, 0.0, -0.005], [0.159, 0.05, -0.012], [0.155, 0.095, -0.019], [0.154, 0.106, -0.021]],
    keys: [
      { t: 0, w: 0.034, dF: 0.022, dB: 0.022, n: 4 },
      { t: 0.35, w: 0.034, dF: 0.022, dB: 0.022, n: 4 },
      { t: 0.55, w: 0.042, dF: 0.026, dB: 0.025, n: 4 },
      { t: 0.92, w: 0.04, dF: 0.026, dB: 0.025, n: 4.5 },
      { t: 1, w: 0.038, dF: 0.025, dB: 0.024, n: 5 },
    ],
    tip: 0.006,
    ridges: { t0: 0.55, t1: 0.9, count: 4, amp: 0.1 },
    rings: 32,
    segments: 16,
  },
  hub: { y: -0.022, wBottom: 0.088, wTop: 0.104, h: 0.15, r: 0.014, z: 0.034, depth: 0.065, bevel: 0.006, colour: [74, 76, 80] },
  plates: [
    { y: 0.012, wBottom: 0.06, wTop: 0.064, h: 0.07, r: 0.004, z: 0.0385, depth: 0.003, bevel: 0.001, colour: [44, 45, 48] },
    { y: 0.012, wBottom: 0.052, wTop: 0.056, h: 0.061, r: 0.003, z: 0.0405, depth: 0.003, bevel: 0.0006, colour: WHITE },
    { y: -0.06, wBottom: 0.05, wTop: 0.05, h: 0.026, r: 0.011, z: 0.0385, depth: 0.003, bevel: 0.001, colour: [40, 41, 44] },
  ],
  blocks: [{ c: [0, 0.056, 0.03], size: [0.11, 0.016, 0.03], r: 0.006, colour: [74, 76, 80] }],
  fittings: [
    { shape: 'box', at: 1, offset: [0.012, 0.004, -0.006], size: [0.06, 0.024, 0.044], rot: [0, 0, -0.35], colour: SATIN_BLACK, r: 0.006 },
    { shape: 'button', at: 1, offset: [0.032, 0.018, -0.012], size: [0.013, 0.006, 0.013], rot: [0, 0, -0.35], colour: RED },
    ...trimRocker(1, [0.006, 0.017, -0.008], [0, 0, -0.35]),
    { shape: 'button', at: 1, offset: [-0.012, 0.022, -0.006], size: [0.011, 0.004, 0.011], rot: [0, 0, -0.35], colour: LIGHT_GREY },
  ],
  copilotFittings: true,
  column: { section: 'round', r: 0.015, metal: 'black', collar: { r: 0.022, len: 0.035, colour: [60, 62, 65] } },
  boot: { kind: 'square', w: 0.04, h: 0.04, depth: 0.008 },
};

/**
 * Pilatus PC-12: dark grey satin; slender horns that swell into bulbous, slightly forward-curved grips (~4 x 5 cm,
 * ~12 cm tall) on a deep curved saddle bar (the whole wheel one smooth U, 31 cm span); a tall lighter-grey hub
 * with the PILATUS plate; red and black buttons on the outboard horn's top and inboard face; the column enters a
 * large boot under the panel.
 */
const PILATUS: YokeStyle = {
  colour: [48, 49, 51],
  hang: 0.06,
  horn: {
    points: [[0, -0.085, 0], [0.07, -0.084, 0], [0.108, -0.079, 0], [0.126, -0.064, 0], [0.134, -0.042, -0.001], [0.135, 0.0, -0.003], [0.132, 0.06, -0.007], [0.128, 0.1, -0.01], [0.126, 0.112, -0.01]],
    keys: [
      { t: 0, w: 0.034, dF: 0.019, dB: 0.019, n: 2.6 },
      { t: 0.35, w: 0.03, dF: 0.017, dB: 0.017, n: 2.6 },
      { t: 0.5, w: 0.032, dF: 0.019, dB: 0.018, n: 2.6 },
      { t: 0.85, w: 0.043, dF: 0.026, dB: 0.024, n: 2.4 },
      { t: 1, w: 0.04, dF: 0.024, dB: 0.022, n: 2.2 },
    ],
    tip: 0.016,
    ridges: { t0: 0.52, t1: 0.82, count: 3, amp: 0.08 },
    rings: 32,
    segments: 16,
  },
  hub: { y: -0.03, wBottom: 0.07, wTop: 0.064, h: 0.13, r: 0.02, z: 0.036, depth: 0.07, bevel: 0.008, colour: [118, 116, 110] },
  plates: [{ y: -0.07, wBottom: 0.05, wTop: 0.05, h: 0.016, r: 0.004, z: 0.0415, depth: 0.002, bevel: 0.0006, colour: [92, 90, 86] }],
  fittings: [
    { shape: 'button', at: 1, offset: [0, 0.002, 0.004], size: [0.012, 0.005, 0.012], colour: [30, 30, 32] },
    { shape: 'button', at: 0.86, offset: [-0.021, 0, 0.004], size: [0.01, 0.004, 0.01], rot: [0, 0, Math.PI / 2], colour: RED },
    { shape: 'button', at: 0.74, offset: [-0.018, 0, 0.006], size: [0.009, 0.004, 0.009], rot: [0, 0, Math.PI / 2], colour: [30, 30, 32] },
    ...trimRocker(0.96, [0, 0.012, -0.016], [-1.1, 0, 0]),
  ],
  copilotFittings: true,
  column: { section: 'square', r: 0.016, metal: 'black', collar: { r: 0.024, len: 0.04, colour: [48, 49, 51] } },
  boot: { kind: 'shroud', w: 0.05, h: 0.045, depth: 0.035 },
};

export const YOKE_STYLES: Readonly<Record<YokeStyleName, YokeStyle>> = {
  cessnaSingle: CESSNA_SINGLE,
  cessna152: CESSNA_152,
  piperSeneca: PIPER_SENECA,
  piperTomahawk: PIPER_TOMAHAWK,
  cessna208: CESSNA_208,
  pilatus: PILATUS,
};

/** Centre-stick grip: the grip sweep (from the top of the tube), its fittings, tube and boot. */
export interface StickStyle {
  colour: Rgb;
  grip: SweepDef;
  fittings: readonly Fitting[];
  /** Tube radius, m, and the boot round the pivot (radius at the floor, height, colour, folds). */
  tubeR: number;
  boot: { r: number; h: number; colour: Rgb; folds: number };
}

/**
 * Diamond DA20: a tall black ergonomic grip (~13 cm) with a palm swell, its top swept forward into a flat cap
 * (the Diamond logo), a trim rocker on the top and a push-to-talk button on the forward face; a dark tube and a
 * folded tan leather boot at the floor.
 */
export const DIAMOND_STICK: StickStyle = {
  colour: [20, 20, 22],
  grip: {
    points: [[0, 0, 0], [0, 0.04, 0.004], [0, 0.085, 0.006], [0, 0.115, -0.002], [0, 0.13, -0.014], [0, 0.134, -0.022]],
    keys: [
      { t: 0, w: 0.028, dF: 0.015, dB: 0.015, n: 2 },
      { t: 0.18, w: 0.034, dF: 0.019, dB: 0.02, n: 2.2 },
      { t: 0.55, w: 0.044, dF: 0.025, dB: 0.028, n: 2.3 },
      { t: 0.85, w: 0.044, dF: 0.027, dB: 0.026, n: 2.6 },
      { t: 1, w: 0.04, dF: 0.025, dB: 0.024, n: 3 },
    ],
    tip: 0.012,
    ridges: { t0: 0.2, t1: 0.62, count: 3, amp: 0.07 },
    rings: 32,
    segments: 16,
  },
  fittings: [
    ...trimRocker(1, [0, 0.002, 0.004], [0, 0, 0]),
    { shape: 'button', at: 0.82, offset: [0, 0, -0.022], size: [0.01, 0.004, 0.01], rot: [-Math.PI / 2, 0, 0], colour: [60, 62, 66] },
  ],
  tubeR: 0.011,
  boot: { r: 0.045, h: 0.11, colour: [104, 74, 50], folds: 4 },
};

// --- Geometry ---

const linear = (c: Rgb): THREE.Color => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

/** Give a geometry an index (identity when it has none) and a uniform vertex colour. */
function paint(g: THREE.BufferGeometry, colour: Rgb): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  const c = linear(colour);
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** The mirror image across the yoke's centre plane (x -> -x), with the triangles turned to face out again. */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const idx = m.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, b);
  }
  return m;
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

function sectionAt(keys: readonly SectionKey[], t: number): SectionKey {
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) {
      const s = smooth((t - a.t) / (b.t - a.t));
      return { t, w: a.w + (b.w - a.w) * s, dF: a.dF + (b.dF - a.dF) * s, dB: a.dB + (b.dB - a.dB) * s, n: a.n + (b.n - a.n) * s };
    }
  }
  return keys[keys.length - 1];
}

/** A frame on a sweep's centreline: point, tangent T, in-plane normal N (across the grip), D (toward the pilot). */
interface Frame { p: THREE.Vector3; T: THREE.Vector3; N: THREE.Vector3; D: THREE.Vector3; s: SectionKey }

const AFT = new THREE.Vector3(0, 0, 1);

/** The swept tube's centreline, its frames and its surface. */
export class Sweep {
  private readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;

  constructor(private readonly def: SweepDef) {
    this.curve = new THREE.CatmullRomCurve3(def.points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    this.length = this.curve.getLength();
  }

  frame(t: number): Frame {
    const p = this.curve.getPointAt(Math.min(1, Math.max(0, t)));
    const T = this.curve.getTangentAt(Math.min(1, Math.max(0, t))).normalize();
    // N across the grip in the yoke's plane (bar: down; right horn: outboard), D = N x T (toward the pilot).
    const N = new THREE.Vector3().crossVectors(T, AFT).normalize();
    const D = new THREE.Vector3().crossVectors(N, T).normalize();
    return { p, T, N, D, s: sectionAt(this.def.keys, t) };
  }

  geometry(colour: Rgb): THREE.BufferGeometry {
    const { rings, segments, tip, ridges } = this.def;
    // Ring stations: evenly along the body, then a quarter-circle of rings over the domed tip.
    const tipT = tip > 0 ? Math.min(0.3, tip / this.length) : 0;
    const capRings = tip > 0 ? 6 : 0;
    const stations: { t: number; scale: number }[] = [];
    const body = rings - capRings;
    // Body rings ~2.5x as dense over the finger ridges (a ridge needs ~4 rings), evenly spread elsewhere.
    const dens = (t: number): number => (ridges && t > ridges.t0 && t < ridges.t1 ? 2.5 : 1);
    const cdf: number[] = [0];
    const K = 200;
    for (let k = 1; k <= K; k++) cdf.push(cdf[k - 1] + dens(((k - 0.5) / K) * (1 - tipT)));
    for (let i = 0, k = 0; i < body; i++) {
      const want = (cdf[K] * i) / (body - 1);
      while (k < K && cdf[k + 1] < want) k++;
      const f = k >= K ? 0 : (want - cdf[k]) / Math.max(1e-9, cdf[k + 1] - cdf[k]);
      stations.push({ t: (Math.min(K, k + f) / K) * (1 - tipT), scale: 1 });
    }
    for (let k = 1; k <= capRings; k++) {
      const a = (k / capRings) * (Math.PI / 2);
      stations.push({ t: 1 - tipT + tipT * Math.sin(a), scale: Math.max(Math.cos(a), k === capRings ? 0 : 0.02) });
    }
    const pos: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    for (const st of stations) {
      const f = this.frame(st.t);
      const s = f.s;
      let ridge = 0;
      if (ridges && st.t > ridges.t0 && st.t < ridges.t1) {
        const u = (st.t - ridges.t0) / (ridges.t1 - ridges.t0);
        ridge = ridges.amp * Math.sin(Math.PI * u * ridges.count) ** 2 * Math.sin(Math.PI * u);
      }
      const e = 2 / s.n;
      for (let j = 0; j < segments; j++) {
        const th = (j / segments) * Math.PI * 2;
        const c = Math.cos(th), sn = Math.sin(th);
        const x = Math.sign(c) * Math.abs(c) ** e * (s.w / 2);
        const depth = sn > 0 ? s.dB : s.dF * (1 + ridge * Math.min(1, -sn * 1.6));
        const y = Math.sign(sn) * Math.abs(sn) ** e * depth;
        v.copy(f.p).addScaledVector(f.N, x * st.scale).addScaledVector(f.D, y * st.scale);
        pos.push(v.x, v.y, v.z);
      }
    }
    for (let i = 0; i + 1 < stations.length; i++) {
      const a = i * segments, b = (i + 1) * segments;
      for (let j = 0; j < segments; j++) {
        const j1 = (j + 1) % segments;
        idx.push(a + j, a + j1, b + j, a + j1, b + j1, b + j);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    paint(g, colour);
    const band = this.def.band;
    if (band) {
      const c = linear(band.colour);
      const col = g.getAttribute('color');
      stations.forEach((st, i) => {
        if (st.t <= band.t) for (let j = 0; j < segments; j++) col.setXYZ(i * segments + j, c.r, c.g, c.b);
      });
    }
    return g;
  }

  /** A fitting's geometry, placed in the frame at its station. */
  fitting(f: Fitting): THREE.BufferGeometry {
    const [sx, sy, sz] = f.size;
    let g: THREE.BufferGeometry;
    if (f.shape === 'button') {
      // A cylinder whose axis is `along`: its cap faces out of the end of the grip unless turned.
      g = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 12, 1).translate(0, sy / 2, 0);
    } else if (f.shape === 'rocker') {
      // A split rocker segment: a box with its pilot end raised.
      g = new RoundedBoxGeometry(sx, sy, sz, 1, Math.min(sx, sy, sz) * 0.3).translate(0, sy / 2, 0);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.max(0, p.getZ(i)) * 0.25);
      g.computeVertexNormals();
    } else {
      g = new RoundedBoxGeometry(sx, sy, sz, 1, Math.min(f.r ?? 0.004, sx / 2, sy / 2, sz / 2) * 0.99);
    }
    if (f.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(f.rot[0], f.rot[1], f.rot[2], 'XYZ')));
    const fr = this.frame(f.at);
    // The local frame: x = N (out), y = T (along), z = D (aft); at the tip the centreline ends on the dome's top.
    const base = fr.p.clone();
    const m = new THREE.Matrix4().makeBasis(fr.N, fr.T, fr.D).setPosition(base.addScaledVector(fr.N, f.offset[0]).addScaledVector(fr.T, f.offset[1]).addScaledVector(fr.D, f.offset[2]));
    g.applyMatrix4(m);
    return paint(g, f.colour);
  }
}

function roundedTrapezoid(p: Plate): THREE.Shape {
  const hb = p.wBottom / 2, ht = p.wTop / 2, hh = p.h / 2;
  const r = Math.min(p.r, hb, ht, hh) * 0.999;
  // Corners: bottom-left, bottom-right, top-right, top-left; rounded with quadratic arcs.
  const pts = [new THREE.Vector2(-hb, -hh), new THREE.Vector2(hb, -hh), new THREE.Vector2(ht, hh), new THREE.Vector2(-ht, hh)];
  const s = new THREE.Shape();
  for (let i = 0; i < 4; i++) {
    const c = pts[i], prev = pts[(i + 3) % 4], next = pts[(i + 1) % 4];
    const a = c.clone().add(prev.clone().sub(c).normalize().multiplyScalar(r));
    const b = c.clone().add(next.clone().sub(c).normalize().multiplyScalar(r));
    if (i === 0) s.moveTo(a.x, a.y);
    else s.lineTo(a.x, a.y);
    s.quadraticCurveTo(c.x, c.y, b.x, b.y);
  }
  s.closePath();
  return s;
}

function plateGeometry(p: Plate): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(roundedTrapezoid(p), {
    depth: Math.max(0.0005, p.depth - 2 * p.bevel),
    bevelEnabled: p.bevel > 0,
    bevelThickness: p.bevel,
    bevelSize: p.bevel,
    bevelSegments: 2,
    // Round plans (the Tomahawk's hub, badges) get more segments per corner.
    curveSegments: p.r > 0.02 ? 8 : 4,
  });
  // Aft face at z (the extrusion's far face plus the bevel), extending `depth` forward.
  g.translate(0, p.y, p.z - p.depth + p.bevel);
  g.deleteAttribute('uv');
  return paint(g, p.colour);
}

/** The vertex-coloured plastic of the yokes and sticks (one per cockpit; the cabin occlusion patches it in place). */
export function yokeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name: 'yokePlastic', vertexColors: true, roughness: 0.6 });
}

/**
 * All the geometry of one yoke in yoke space: the plastic (vertex-coloured) and the column tube.
 * @param outboard -1: the pilot's yoke (its fittings on the left horn), +1: the copilot's (on the right; its own
 *                 `copilot` fittings unless it has the pilot's), 0: none
 */
export function yokeGeometry(style: YokeStyle, outboard: -1 | 0 | 1): { plastic: THREE.BufferGeometry[]; tube: THREE.BufferGeometry } {
  const plastic: THREE.BufferGeometry[] = [];
  const sweep = new Sweep(style.horn);
  const right = sweep.geometry(style.colour);
  plastic.push(right, mirrorX(right));
  if (outboard !== 0) {
    for (const f of outboard > 0 && !style.copilotFittings ? (style.copilot ?? []) : style.fittings) {
      const g = sweep.fitting(f);
      plastic.push(outboard < 0 ? mirrorX(g) : g);
      if (outboard < 0) g.dispose();
    }
  }
  plastic.push(plateGeometry(style.hub));
  for (const p of style.plates) plastic.push(plateGeometry(p));
  for (const b of style.blocks ?? []) {
    const g = new RoundedBoxGeometry(b.size[0], b.size[1], b.size[2], 1, Math.min(b.r, ...b.size.map((s) => s / 2)) * 0.99);
    plastic.push(paint(g.translate(...b.c), b.colour));
  }
  for (const g of plastic) g.translate(0, style.hang, 0);
  // Collar: the boss on the hub's forward face that the column tube enters.
  const col = style.column;
  const hubFront = style.hub.z - style.hub.depth;
  const collar = col.section === 'round' ? new THREE.CylinderGeometry(col.collar.r, col.collar.r * 1.08, col.collar.len, 20) : new RoundedBoxGeometry(col.collar.r * 2, col.collar.r * 2, col.collar.len, 1, col.collar.r * 0.3);
  if (col.section === 'round') collar.rotateX(Math.PI / 2);
  plastic.push(paint(collar.translate(0, 0, hubFront - col.collar.len / 2 + 0.004), col.collar.colour));
  // Column tube, long enough to stay inside the panel at full forward travel.
  const len = 0.36;
  const tube = col.section === 'round' ? new THREE.CylinderGeometry(col.r, col.r, len, 16).rotateX(Math.PI / 2) : new RoundedBoxGeometry(col.r * 2, col.r * 2, len, 1, col.r * 0.25);
  tube.translate(0, 0, hubFront - len / 2);
  return { plastic, tube };
}

/** The boot or escutcheon where a column enters the panel, at FRD (x on the panel face, y, z), for the panel's static batch (black). */
export function columnBoot(style: YokeStyle, x: number, y: number, z: number): THREE.BufferGeometry {
  const b = style.boot;
  const c = frd(x - b.depth / 2 + 0.002, y, z);
  let g: THREE.BufferGeometry;
  if (b.kind === 'round') g = new THREE.CylinderGeometry(b.w, b.w * 1.1, b.depth, 20).rotateX(Math.PI / 2);
  else if (b.kind === 'square') g = new RoundedBoxGeometry(b.w * 2, b.h * 2, b.depth, 1, 0.004);
  else {
    // A shroud: a tapered rubber boot from a wide flange on the panel to the column.
    g = new THREE.CylinderGeometry(style.column.r * 1.6, b.w, b.depth, 20, 3).rotateX(-Math.PI / 2);
    g.scale(1, b.h / b.w, 1);
  }
  return g.translate(c.x, c.y, c.z);
}

/** A control column in the cabin: its node, and how it follows the pilot's inputs. */
export interface ControlColumn {
  readonly group: THREE.Group;
  /** @param elevator [-1, 1], + = back; @param aileron [-1, 1], + = right */
  pose(elevator: number, aileron: number): void;
}

type YokeDef = Extract<CockpitDef['column'], { kind: 'yoke' }>;
type StickDef = Extract<CockpitDef['column'], { kind: 'stick' }>;

const tubeMaterial = (mat: AircraftMaterials, metal: YokeStyle['column']['metal']): THREE.Material =>
  metal === 'chrome' ? mat.chrome : metal === 'satin' ? mat.aluminium : mat.darkMetal;

/** The style of a yoke definition (the Cessna single's when it names none). */
export const yokeStyle = (column: YokeDef): YokeStyle => YOKE_STYLES[column.style ?? 'cessnaSingle'];

/** A ram's-horn yoke on a column through the panel: it slides fore and aft and turns. */
export class YokeColumn implements ControlColumn {
  readonly group = new THREE.Group();

  /** @param y the column's FRD y (negative: the pilot's, on the left) */
  constructor(
    mat: AircraftMaterials,
    plasticMat: THREE.Material,
    private readonly column: YokeDef,
    y: number,
  ) {
    frd(column.x, y, column.z, this.group.position);
    const style = yokeStyle(column);
    const pilot = y < 0;
    const { plastic, tube } = yokeGeometry(style, pilot ? -1 : 1);
    const b = new MeshBatch();
    b.add(tubeMaterial(mat, style.column.metal), tube);
    for (const g of plastic) b.add(plasticMat, g);
    this.group.add(...b.build('yoke').children);
  }

  pose(elevator: number, aileron: number): void {
    const column = this.column;
    const YOKE_ROLL = (column.rollDeg * Math.PI) / 180;
    this.group.position.z = -column.x + column.travel * elevator;
    this.group.rotation.z = -YOKE_ROLL * aileron;
  }
}

/** All the geometry of a centre stick `h` tall from its pivot (stick space: y up from the pivot, z aft). */
export function stickGeometry(style: StickStyle, h: number): { plastic: THREE.BufferGeometry[]; tube: THREE.BufferGeometry } {
  const sweep = new Sweep(style.grip);
  const gripLen = style.grip.points[style.grip.points.length - 1][1];
  const top = h - gripLen;
  const lift = new THREE.Matrix4().makeTranslation(0, top, 0);
  const plastic = [sweep.geometry(style.colour).applyMatrix4(lift)];
  for (const f of style.fittings) plastic.push(sweep.fitting(f).applyMatrix4(lift));
  // Boot: a folded cone round the pivot (rings of alternating radius).
  const b = style.boot;
  const prof: THREE.Vector2[] = [];
  const steps = b.folds * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const r = b.r + (style.tubeR * 1.6 - b.r) * u ** 0.8;
    prof.push(new THREE.Vector2(r * (i % 2 ? 0.88 : 1), u * b.h));
  }
  plastic.push(paint(new THREE.LatheGeometry(prof, 20), b.colour));
  const tube = new THREE.CylinderGeometry(style.tubeR, style.tubeR * 1.15, top + 0.01, 12).translate(0, (top + 0.01) / 2, 0);
  return { plastic, tube };
}

/** A centre stick pivoted near the floor: it leans fore and aft and sideways. */
export class StickColumn implements ControlColumn {
  readonly group = new THREE.Group();

  constructor(
    mat: AircraftMaterials,
    plasticMat: THREE.Material,
    private readonly column: StickDef,
    y: number,
  ) {
    frd(column.pivot[0], y, column.pivot[2], this.group.position);
    const { plastic, tube } = stickGeometry(DIAMOND_STICK, column.height);
    const b = new MeshBatch();
    b.add(mat.darkMetal, tube);
    for (const g of plastic) b.add(plasticMat, g);
    this.group.add(...b.build('stick').children);
  }

  pose(elevator: number, aileron: number): void {
    const rad = Math.PI / 180;
    // Stick back = the top moves aft (model +Z); stick right = the top moves to +X.
    this.group.rotation.x = this.column.pitchDeg * rad * elevator;
    this.group.rotation.z = -this.column.rollDeg * rad * aileron;
  }
}
