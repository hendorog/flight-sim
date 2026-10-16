// Pilatus PC-12/47: extra mock readings for the dev instruments page (src/dev/instruments.ts loads every
// src/aircraft/<id>/devMock.ts and calls the one of the selected type after the generic mock flight). SCAFFOLD STUB
// (owner: P3): nothing yet. P3 adds beta/reverse, torque psi, ITT, Ng and Np for the EIS.
import type { DevMock } from '../../dev/devMock';

export const devMock: DevMock = () => {};
