// Source text of the synthesis AudioWorklet, with the shared parameter tables and the built-in sound profile
// (the Cessna 172S: what the worklet plays until it is sent a 'config' message) prepended.

import { C172S_AUDIO } from '../aircraft/c172s/audio';
import worklet from './worklet/aircraftSynth.js?raw';
import { ENGINE_P, P, PARAM_COUNT } from './params';

export const SYNTH_PROCESSOR_NAME = 'aircraft-synth';

export const SYNTH_SOURCE = `const P = ${JSON.stringify(P)};\nconst PARAM_COUNT = ${PARAM_COUNT};\nconst ENGINE_P = ${JSON.stringify(ENGINE_P)};\nconst DEFAULT_PROFILE = ${JSON.stringify(C172S_AUDIO)};\n${worklet}`;
