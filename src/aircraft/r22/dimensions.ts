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
/** ESTIMATE traced from the POH 1-3 three-view for the merged exterior. Share its planform
 * with physics: the older independent 0.38 m² aerodynamic estimate exceeded this outline by 58%. */
export const HORIZONTAL_STABILIZER = {
  span: 0.98, leftChord: 0.22, rightChord: 0.27,
  leadingX: TAIL_HUB.x + 0.83, z: TAIL_HUB.z + 0.01,
} as const;
/** Nose (forward tip of the cabin bubble) and aft end of the tail assembly, from FUSELAGE_LENGTH: ESTIMATE split. */
export const NOSE_X = 1.7;
export const TAIL_END_X = NOSE_X - FUSELAGE_LENGTH;

/** Right seat is the pilot (command) seat in the R22; solo from the right. Eye point ESTIMATE. */
export const PILOT_EYE = { x: 0.72, y: 0.28, z: SKID_Z - 1.5 } as const;

/** Instrument console face (the pod above the centre pedestal, between the seats). The panel canvas
 * (aircraft/r22/panel.ts `size`) is PANEL_CANVAS px and maps onto this face at PANEL_PX_PER_M with no
 * cropping. Face centre, size and back-tilt are ESTIMATES from cockpit photographs. */
export const PANEL_PX_PER_M = 2400;
export const PANEL_CANVAS = { w: 1344, h: 720 } as const;
export const PANEL_FACE = {
  centre: { x: 1.12, y: 0, z: SKID_Z - 1.02 },
  width: PANEL_CANVAS.w / PANEL_PX_PER_M,
  height: PANEL_CANVAS.h / PANEL_PX_PER_M,
  /** Face normal tilted up from horizontal-aft by this much (0 = vertical face). */
  tiltBackDeg: 25,
} as const;
