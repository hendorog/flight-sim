// Golden master of the Piper PA-34-200 Seneca I's flight model, recorded on its acceptance at wave D3a2 (contract
// 4.5): the C172S flight golden's scripts with the Seneca's speeds (typeFlight.ts), and the twin's one-engine
// cruise, compared at the relative 1e-9 also under FS_GOLDEN_EXACT=1.
//
// REGENERATE ONLY DELIBERATELY (a fix whose request names the pa34), and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/pa34Flight.golden.test.ts

import PA34_DEFINITION from '../../src/aircraft/pa34/index';
import { describeTypeFlightGolden } from './typeFlight';

// The handbook's indicated speeds as true airspeed at the record's height: cruise 152 (145 KIAS, s.11), approach
// 93 (91 KIAS, 105 mph with flaps 25, s.10), best glide 95 (91 KIAS, 105 mph, s.8), one-engine cruise 105 on the
// right engine with the left feathered; the electric fuel pumps prime both engines for the start (s.10).
describeTypeFlightGolden(PA34_DEFINITION, { cruiseKt: 152, approachKt: 93, approachFlaps: 25 / 40, glideKt: 95, fuelPump: true, oeiCruiseKt: 105 });
