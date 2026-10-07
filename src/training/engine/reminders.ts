// Reminders that follow the student's state (owner playtest: "The instructor is just repeating the same thing,
// without consideration for what the student needs to know"). Two rules every reminder in the engine keeps:
//   1. It says what is still missing, not the whole instruction again (the callers build their candidates
//      from the state: "The mixture is still lean: push it fully in").
//   2. It never repeats the previous reminder's wording: a candidate that reads the same (ignoring case,
//      punctuation and numbers' spacing) as the last one said is skipped; with nothing new to say, nothing is said.
// After two reminders on the same thing the instructor offers help instead ("Would you like me to show you?
// Press the left bracket.").

/** Reminders on one thing before the instructor offers to show it. */
export const REMINDERS_BEFORE_HELP = 2;

/** Comparable form of a line: lower case, letters and digits only, single spaces. */
export function normaliseLine(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The first candidate that does not read the same as `previous` (null when all of them do, or none given). */
export function differentLine(candidates: readonly string[], previous: string | null): string | null {
  const prev = previous === null ? null : normaliseLine(previous);
  for (const c of candidates) {
    if (!c) continue;
    if (prev === null || normaliseLine(c) !== prev) return c;
  }
  return null;
}

/**
 * One reminder ladder (a task's nudges, a ground coach topic): counts the reminders, remembers the last
 * wording, and says when it is time to offer help.
 */
export class ReminderLadder {
  count = 0;
  last: string | null = null;
  helpOffered = false;

  /** Pick the next reminder from state-driven candidates (best first); null: nothing new to say. */
  next(candidates: readonly string[]): string | null {
    const line = differentLine(candidates, this.last);
    if (line === null) return null;
    this.count++;
    this.last = line;
    return line;
  }

  /** Two reminders have been given and help has not been offered yet. */
  get dueForHelp(): boolean {
    return !this.helpOffered && this.count >= REMINDERS_BEFORE_HELP;
  }

  offerHelp(): void {
    this.helpOffered = true;
  }

  reset(): void {
    this.count = 0;
    this.last = null;
    this.helpOffered = false;
  }
}
