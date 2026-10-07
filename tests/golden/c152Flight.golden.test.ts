// Golden master of the Cessna 152's flight model, recorded on its acceptance at wave D1 (contract 4.5): the C172S
// flight golden's scripts with the 152's speeds (typeFlight.ts), compared at the relative 1e-9 also under
// FS_GOLDEN_EXACT=1.
//
// REGENERATE ONLY DELIBERATELY (a fix whose request names the c152), and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c152Flight.golden.test.ts

import C152_DEFINITION from '../../src/aircraft/c152/index';
import { describeTypeFlightGolden } from './typeFlight';

// Cruise 95 KTAS (2300-2400 rpm school cruise), approach 65 with flap 20, best glide 60 (POH Fig 3-1); no fuel pump.
describeTypeFlightGolden(C152_DEFINITION, { cruiseKt: 95, approachKt: 65, glideKt: 60, fuelPump: false });
