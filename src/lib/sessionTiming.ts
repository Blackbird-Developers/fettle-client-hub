import { addMinutes, endOfDay, isPast, parseISO } from 'date-fns';

/**
 * A session stays "upcoming" (and joinable) until the end of the day it is
 * scheduled for, not just until its start time. This gives clients who are
 * running a few minutes late, or having trouble connecting, a way back into
 * the call from the portal.
 */
export function isSessionActive(datetime: string): boolean {
  return !isPast(endOfDay(parseISO(datetime)));
}

/** True once the session's start time has passed (it may still be active today). */
export function hasSessionStarted(datetime: string): boolean {
  return isPast(parseISO(datetime));
}

/**
 * True once the session has finished: start time plus its duration (Acuity
 * sends duration in minutes as a string). Falls back to the start time if the
 * duration is missing.
 */
export function hasSessionEnded(datetime: string, duration?: string | number): boolean {
  const minutes = Number(duration);
  const start = parseISO(datetime);
  return isPast(Number.isFinite(minutes) ? addMinutes(start, minutes) : start);
}
