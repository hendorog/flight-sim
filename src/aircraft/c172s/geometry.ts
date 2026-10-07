// Cessna 172S: the geometric facts physics and the 3D model must agree on. This is the C172 object of
// core/c172.ts (by reference: nothing is retyped) with the discriminants a general aircraft needs: where the
// wing and the tailplane are mounted, fixed gear, one clockwise propeller.

import { C172 } from '../../core/c172';
import type { AircraftGeometry } from '../types';

export const C172S_GEOMETRY: AircraftGeometry = {
  wing: { mount: 'high', ...C172.wing },
  hTail: { mount: 'fuselage', allMoving: false, ...C172.hTail },
  vTail: C172.vTail,
  fuselage: C172.fuselage,
  gear: { ...C172.gear, retractable: false },
  propellers: [{ hub: C172.prop.hub, diameter: C172.prop.diameter, blades: C172.prop.blades, rotation: 1 }],
  // The reference point is 1.25 m above the ground when the aircraft rests on its wheels (core/c172.ts).
  restHeight: 1.25,
  bounds: { radius: 6.5, fitSize: 13 },
};
