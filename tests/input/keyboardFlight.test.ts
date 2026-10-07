// Keyboard flying against the REAL flight model (src/sim/SimPhysics, real terrain and airport), through the
// real InputSystem, driven only by key presses. Guards the hold-position virtual-yoke tuning: taps must be fine
// enough for precise corrections, holds strong enough for manoeuvres and the flare without being abrupt, and
// the response must feel the same at every airspeed. The scripted pilot (keyboardPilot.ts) then flies whole
// circuits.
//
// The blocks are in keyboardFlight.ts (they take the aircraft type); this file runs them for the Cessna 172S,
// the type the keyboard was tuned on.

import { describeKeyboardFlight } from './keyboardFlight';

describeKeyboardFlight();
