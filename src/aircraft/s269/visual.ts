// PLACEHOLDER: R22 bubble/engine-detail carrier with Schweizer contract geometry and individual sticks.
// This is not an accepted 300CB exterior. See docs/s269-sources.md and the exterior worker's handoff.
import type { AirframeVisualDef, FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { R22_VISUAL as base } from '../r22/visual';
import { CABIN_WIDTH as R22_CABIN_WIDTH } from '../r22/dimensions';
import { S269_ROTORCRAFT } from './rotorcraft';
import * as D from './dimensions';
const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];
const old = base.rotorcraftVisual!;
const rotorcraftVisual: RotorcraftVisualDef = {
  ...old, nominalVoltage: 28,
  interior: { ...old.interior!, collectiveFittings: false },
  main: { ...old.main, hub: point(D.MAIN_HUB), radius: D.MAIN_ROTOR_RADIUS,
    chord: [D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD], twist: D.MAIN_ROTOR_TWIST_DEG * Math.PI / 180,
    paint: { rootUpper: 0xb5b8b3, rootLower: 0x333738, capLength: 0.015,
      bands: [{ tipDistance: 0.15, upper: 0xe3b83d, lower: 0xe3b83d }] } },
  tail: { ...old.tail, hub: point(D.TAIL_HUB), radius: D.TAIL_ROTOR_RADIUS, chord: D.TAIL_ROTOR_CHORD,
    twist: D.TAIL_ROTOR_TWIST_DEG * Math.PI / 180, precone: 0 },
  boom: { front: old.boom.front, rear: [D.TAIL_HUB.x, 0, D.TAIL_HUB.z], radii: old.boom.radii },
  mast: { ...old.mast, top: [0, 0, D.MAIN_HUB.z + 0.28] },
  fins: [
    { name: 'verticalFin', axis: 'y', thickness: 0.0254, outline: D.VERTICAL_FIN_OUTLINE.map(point) },
    { name: 'horizontalStabiliser', axis: 'z', thickness: 0.025, outline: D.HORIZONTAL_STABILIZER_OUTLINE.map(point) },
  ],
  guard: D.TAIL_STINGER.map(point), guardRadius: D.TAIL_STINGER_RADIUS,
  skids: { halfTrack: D.SKID_HALF_TRACK, z: D.SKID_Z, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X,
    crossTubes: [D.SKID_CONTACT_FRONT_X, D.SKID_CONTACT_REAR_X], tubeRadius: D.SKID_TUBE_RADIUS,
    dampers: D.SKID_DAMPERS.map(d => ({ ...d, upper: point(d.upper), lower: point(d.lower) })) },
  panel: { centre: point(D.PANEL_FACE.centre), width: D.PANEL_FACE.width, height: D.PANEL_FACE.height,
    tiltBackDeg: D.PANEL_FACE.tiltBackDeg, canvas: D.PANEL_CANVAS, outline: D.PANEL_OUTLINE,
    pedestal: D.PANEL_PEDESTAL, enclosureDepth: D.PANEL_ENCLOSURE_DEPTH, poweredVolts: [18, 24] },
  cyclic: { kind: 'individual', gripYs: [D.SEAT_CENTRES[0].y, D.SEAT_CENTRES[1].y], barTiltDeg: 0,
    stem: [[0, 0, 0], [-0.04, 0, -0.25], [-0.12, 0, -0.48]] },
  collective: { pivots: D.SEAT_CENTRES.map(s => [s.x - 0.12, s.y - 0.23, 0.25] as const), length: 0.51 },
};
export const S269_VISUAL: AirframeVisualDef = {
  ...base, id: 's269', rotorcraft: S269_ROTORCRAFT, rotorcraftVisual,
  // Scale just the inherited loft to the shared nose/width. Details/glazing still need replacement.
  fuselage: { ...base.fuselage, frontX: D.NOSE_X, keys: base.fuselage.keys.map(k =>
    [k[0] * D.NOSE_X / base.fuselage.frontX, k[1], k[2], k[3], k[4] * D.CABIN_WIDTH / R22_CABIN_WIDTH, k[5], k[6], k[7]]) },
  cockpit: { ...base.cockpit, pilotEye: point(D.PILOT_EYE),
    panel: { x: D.PANEL_FACE.centre.x, zTop: D.PANEL_FACE.centre.z - D.PANEL_FACE.height / 2, width: D.PANEL_FACE.width },
    seats: D.SEAT_CENTRES.map(s => ({ ...base.cockpit.seats[0], x: s.x + 0.35, y: s.y })),
    occupants: [{ seat: D.PILOT_SEAT }],
    column: { kind: 'stick', pivot: [0.87, 0, 0.40], height: 0.48, pitchDeg: 12, rollDeg: 12, ys: D.SEAT_CENTRES.map(s => s.y) },
    lamps: { flood: { pos: [0.85, 0, -0.30], aim: point(D.PANEL_FACE.centre) } },
  },
  lamps: base.lamps.map(l => l.id === 'navTail' ? { ...l, pos: [D.TAIL_HUB.x, 0, D.TAIL_HUB.z - 0.3] as const } : l),
  livery: { ...base.livery, registration: 'N269FS' },
  shadow: { ...base.shadow, wingHeight: -D.MAIN_HUB.z + D.SKID_Z, restHeight: D.SKID_Z,
    skids: { halfTrack: D.SKID_HALF_TRACK, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X } },
};
export default S269_VISUAL;
