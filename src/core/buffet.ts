// Stall buffet as the pilot feels and hears it: the shaking that separated flow puts into the airframe.
//
// The buffet is the pressure fluctuation of the separated wake on the wing and tail, so its force scales with the
// dynamic pressure, like every other aerodynamic load (ESDU 87012; Mabey, "Some aspects of aircraft buffeting").
// stallFraction (the flight model's share of the wing area past its stall) says only that the flow has separated:
// a parked aircraft with a light breeze from the side or behind has its wing "stalled" at an angle of attack
// that the wind swings by tens of degrees from one moment to the next, with no force behind it. Without the dynamic
// pressure the cockpit camera and the buffet rumble shook a parked aircraft as hard as a full stall in flight.

/**
 * Airspeed from which the buffet is felt at full strength, m/s (about 29 kt): below every type's stalling speed, so
 * a stall in flight buffets as it always has; below it the buffet falls with the dynamic pressure.
 */
export const BUFFET_FULL_IAS = 15;

/** Felt strength of the stall buffet, [0, 1]: the stalled share of the wing times the dynamic pressure, full from BUFFET_FULL_IAS. */
export function stallBuffet(stallFraction: number, ias: number): number {
  const q = Math.min(1, (Math.max(0, ias) / BUFFET_FULL_IAS) ** 2);
  return Math.min(1, Math.max(0, stallFraction)) * q;
}
