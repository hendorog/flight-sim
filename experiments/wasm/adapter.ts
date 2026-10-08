export { luFactor, luSolve } from './backend.mjs';
// Trim uses the independent Gaussian elimination routine; this spike only ports
// the LU routines called by liftingLine.ts.
export { solveDenseInPlace } from '../../src/physics/aero/linalg.ts';
