// Golden master of the Piper PA-38-112 Tomahawk II's flight model, recorded on its acceptance at wave D2 (contract
// 4.5): the C172S flight golden's scripts with the Tomahawk's speeds (typeFlight.ts), compared at the relative 1e-9
// also under FS_GOLDEN_EXACT=1.
//
// REGENERATE ONLY DELIBERATELY (a fix whose request names the pa38), and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/pa38Flight.golden.test.ts

import PA38_DEFINITION from '../../src/aircraft/pa38/index';
import { describeTypeFlightGolden } from './typeFlight';

// The handbook's indicated speeds as true airspeed at the record's height: cruise 98 KTAS (95 KIAS, 2360 rpm),
// approach 73 (70 KIAS with flaps 21, the lever's first notch, POH 4.5), best glide 74 (70 KIAS, POH 3.3); the
// electric fuel pump on for the start (POH 4.5).
describeTypeFlightGolden(PA38_DEFINITION, { cruiseKt: 98, approachKt: 73, approachFlaps: 21 / 34, glideKt: 74, fuelPump: true });
