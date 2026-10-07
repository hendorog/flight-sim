// Requests (work/design/requests/<id>.md) that are still open. A conformance item whose Band or Range names one of
// these in `blockedBy` is reported as SKIPPED with the id; remove an id here when its request is closed, and every
// item it blocked is judged again (and fails if its number is still not met).

export const OPEN_REQUESTS: readonly string[] = [];
