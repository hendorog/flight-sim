// Requests (work/design/requests/<id>.md) that are still open. A conformance item whose Band or Range names one of
// these in `blockedBy` is reported as SKIPPED with the id; remove an id here when its request is closed, and every
// item it blocked is judged again (and fails if its number is still not met).

export const OPEN_REQUESTS: readonly string[] = [
  // The C208's beta range on a cam: with the blade angle linear in the lever between the low-pitch stop and ground
  // fine (governor.ts), half the pitch-only travel puts the blades at about 5 deg, where this propeller's static
  // thrust at idle is as high as on the gate (it is partly stalled there); the real lever slows the taxi from the
  // first part of its travel. Needs a lever-to-blade-angle schedule in BetaDef (turbine core).
  'C208-beta-cam',
  // The PC-12's items that need the turbine core's beta, reverse, condition-lever feather, latching starter,
  // torque limiter and pusher conformance plumbing (package T1a). Removed by the integrator once T1a and P1 are merged.
  'PC12-beta',
];
