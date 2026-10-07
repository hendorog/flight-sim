// Conformance of the Cessna 172S (quick tier always; flown tier with FS_AIRCRAFT=c172s or all).

import { describeAircraft } from './suite';
import { C172S_TARGETS } from './targets/c172s';

describeAircraft(C172S_TARGETS);
