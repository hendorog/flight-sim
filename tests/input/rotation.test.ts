// Keyboard rotation on take-off against the real flight model, with the hold-position keyboard yoke: a key
// held for a human reaction time must give a smooth rotation, holding the key through lift-off must keep the
// take-off attitude (the rotation guard acts while that key is held), and a simple closed-loop key pilot must
// be able to rotate and lift off in calm air and in a gusty crosswind.
//
// The block is in keyboardFlight.ts (it takes the aircraft type); this file runs it for the Cessna 172S.

import { describeKeyboardFlight } from './keyboardFlight';

describeKeyboardFlight({ blocks: ['rotation'] });
