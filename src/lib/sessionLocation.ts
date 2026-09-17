/**
 * Fettle sessions are delivered online. Acuity appointments usually have an
 * empty `location`, which used to render as "In-Person" and confused clients,
 * so a session only counts as in person when its location explicitly says so.
 */
export function isInPersonSession(location?: string | null): boolean {
  return /\bin[\s-]?person\b|\bface[\s-]?to[\s-]?face\b/i.test(location ?? "");
}
