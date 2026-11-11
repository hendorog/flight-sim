// Requests (work/design/requests/<id>.md) that are still open. A conformance item whose Band or Range names one of
// these in `blockedBy` is reported as SKIPPED with the id; remove an id here when its request is closed, and every
// item it blocked is judged again (and fails if its number is still not met).

export const OPEN_REQUESTS: readonly string[] = [
  // PC-12 half-beta taxi with the idle power-turbine runaway (fix/pc12-idle-drag, 2026-11-09): the owner decides
  // whether 0 kt at half beta is acceptable (re-base the band) or the beta schedule moves.
  'PC12-idle-runaway',
];
