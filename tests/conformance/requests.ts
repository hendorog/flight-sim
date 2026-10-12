// Requests (work/design/requests/<id>.md) that are still open. A conformance item whose Band or Range names one of
// these in `blockedBy` is reported as SKIPPED with the id; remove an id here when its request is closed, and every
// item it blocked is judged again (and fails if its number is still not met).

export const OPEN_REQUESTS: readonly string[] = [
  // Beta and reverse on the PT6A turboprop: without them the propeller pulls about 3.5 kN at idle on the landing
  // roll (docs/turbine-model.md, "Not modelled yet").
  'C208-beta',
];
