// R22 Beta II reference geometry shared by the flight model (physics), the exterior (render) and the cockpit.
// Body axes FRD, metres, origin on the main-rotor mast axis; z = +SKID_Z is the bottom of the skids, so the
// ground is at z = SKID_Z when the aircraft rests level. Physics and render import these values; neither
// side keeps its own copy.
//
// Provenance: R22 POH Section 1 (General) three-view and dimensions table, where published; the rest are
// ESTIMATES from the three-view proportions and are marked as such. Changing a value here moves both the
// model and the mesh; record the source of any change in docs/r22-flight-model.md.

/** Published: main rotor 25 ft 2 in diameter, two blades, 7.2–7.7 in chord. */
export const MAIN_ROTOR_RADIUS = 3.8354;
/** Published: tail rotor 42 in diameter, 4 in chord. */
export const TAIL_ROTOR_RADIUS = 0.5334;
/** Published: skid tread 6 ft 4 in. */
export const SKID_HALF_TRACK = 0.965;
/** Published: cabin width 44 in. */
export const CABIN_WIDTH = 1.12;
/** Published: overall height 8 ft 9 in (ground to top of the rotor head). */
export const OVERALL_HEIGHT = 2.67;
/** Published: overall length 28 ft 8 in with rotors fore and aft; fuselage length 20 ft 8 in. */
export const OVERALL_LENGTH = 8.74;
export const FUSELAGE_LENGTH = 6.3;

/** Bottom of the skid tubes below the origin. Kept from the first implementation (the physics datum). */
export const SKID_Z = 0.9;
/** Skid tube fore/aft extent: ESTIMATE from three-view. */
export const SKID_FRONT_X = 1.15;
export const SKID_REAR_X = -1.25;
/** Skid contact points used by the gear model (where the cross tubes meet the skids): ESTIMATE. */
export const SKID_CONTACT_FRONT_X = 0.85;
export const SKID_CONTACT_REAR_X = -1.1;

/** Teetering hub centre: ~0.12 m below the top of the rotor head. Derived from OVERALL_HEIGHT. */
export const MAIN_HUB = { x: 0, y: 0, z: SKID_Z - (OVERALL_HEIGHT - 0.12) } as const;
/** Tail rotor hub: fore/aft from overall length (main disc tip forward, tail disc tip aft); height and lateral
 * offset ESTIMATES. The R22 tail rotor is on the LEFT side of the boom. */
export const TAIL_HUB = {
  x: -(OVERALL_LENGTH - MAIN_ROTOR_RADIUS - TAIL_ROTOR_RADIUS),
  y: -0.17,
  z: SKID_Z - 1.62,
} as const;
/** Nose (forward tip of the cabin bubble) and aft end of the tail assembly, from FUSELAGE_LENGTH: ESTIMATE split. */
export const NOSE_X = 1.7;
export const TAIL_END_X = NOSE_X - FUSELAGE_LENGTH;

/** Right seat is the pilot (command) seat in the R22; solo from the right. Eye point ESTIMATE. */
export const PILOT_EYE = { x: 0.72, y: 0.28, z: SKID_Z - 1.5 } as const;

/** Console and pedestal: ESTIMATE scaled from the 3-1/8 inch instruments in POH 7-21 and IPC fig 95-1.
 * https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_ipc_95_b93d8d009d.pdf
 * The 0.34 m upper pod narrows to a 0.20 m radio pedestal; total face height 0.68 m. The outline is
 * shared by canvas and mesh, so instrument spacing, silhouette and click UVs have one definition.
 * Position, 15 degree rake and 0.20 m enclosure depth remain photographic estimates, not POH dimensions. */
export const PANEL_PX_PER_M = 2400;
export const PANEL_CANVAS = { w: 816, h: 1632 } as const;
export const PANEL_OUTLINE = [
  [90, 0], [726, 0], [780, 36], [816, 110], [816, 505], [790, 578],
  [650, 606], [648, 1576], [614, 1632], [202, 1632], [168, 1576],
  [166, 606], [26, 578], [0, 505], [0, 110], [36, 36],
] as const;
export const PANEL_FACE = {
  centre: { x: 1.26, y: 0, z: SKID_Z - 0.99 },
  width: PANEL_CANVAS.w / PANEL_PX_PER_M,
  height: PANEL_CANVAS.h / PANEL_PX_PER_M,
  /** Face normal tilted up from horizontal-aft by this much (0 = vertical face). */
  tiltBackDeg: 15,
} as const;
