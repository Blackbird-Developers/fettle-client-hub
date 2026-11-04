// Server copy of the rule in src/lib/sessionTiming.ts: a client can cancel or
// reschedule a session until its start time; after that only Join remains.
// Keep the two in step.

export function hasSessionStarted(datetime: string, now: Date = new Date()): boolean {
  const start = Date.parse(datetime);
  if (Number.isNaN(start)) return true; // unknown time: treat as too late
  return start <= now.getTime();
}

export const TOO_LATE_MESSAGE =
  "This session has already started, so it can't be changed here. Please contact hello@fettle.ie.";
