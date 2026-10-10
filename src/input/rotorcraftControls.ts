import type { ControlInputs } from '../core/types';

export const CLUTCH_POSITIONS = ['engage', 'hold', 'release'] as const;
export function clutchPosition(c: ControlInputs): number {
  return CLUTCH_POSITIONS.indexOf(c.rotorClutchCommand ?? (c.rotorClutch ? 'engage' : 'release'));
}
export function selectClutch(c: ControlInputs, position: number): void {
  if (!c.rotorClutchGuardOpen) return;
  c.rotorClutchCommand = CLUTCH_POSITIONS[Math.max(0, Math.min(2, position))];
  // Boolean compatibility remains the engage switch position, never belt tension.
  c.rotorClutch = c.rotorClutchCommand === 'engage';
}
export function toggleClutchGuard(c: ControlInputs): void {
  // The closed guard retains ENGAGE (RFM 4-16). Opening never moves the lever.
  if (c.rotorClutchGuardOpen) selectClutch(c, 0);
  c.rotorClutchGuardOpen = !c.rotorClutchGuardOpen;
}
