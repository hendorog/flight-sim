// Golden master of the Diamond DA20-C1's flight model, recorded on its acceptance at wave D2 (contract 4.5): the
// C172S flight golden's scripts with the DA20's speeds (typeFlight.ts), compared at the relative 1e-9 also under
// FS_GOLDEN_EXACT=1.
//
// REGENERATE ONLY DELIBERATELY (a fix whose request names the da20), and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/da20Flight.golden.test.ts

import DA20_DEFINITION from '../../src/aircraft/da20/index';
import { describeTypeFlightGolden } from './typeFlight';

// The handbook's indicated speeds as true airspeed at the record's height (the DA20's static source reads 5-10 kt
// low, AFM 5.3.1): cruise 111 KTAS (105 KIAS, the training cruise), approach 67 (60 KIAS with flaps T/O, lever 1/3,
// AFM 3.2), best glide 81 (73 KIAS, AFM 3.2); the electric fuel pump on for the start (AFM 4.4.5).
describeTypeFlightGolden(DA20_DEFINITION, { cruiseKt: 111, approachKt: 67, approachFlaps: 1 / 3, glideKt: 81, fuelPump: true });
