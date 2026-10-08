import type { Tables } from "@/integrations/supabase/types";

// Staff follow-up (contacted + note) on the admin Progression pages. Rows are
// keyed by the insights customer key, so a save only ever touches one customer.

export type CustomerFollowup = Tables<"customer_followups">;

export type FollowupPatch = { contacted: boolean } | { note: string | null };

/** Matches the CHECK constraint on customer_followups.note. */
export const NOTE_MAX_LENGTH = 2000;

/** Trimmed note, or null when blank (the database stores blank notes as null). */
export function normalizeNote(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed : null;
}

/** Error message for a note draft, or null when it can be saved. */
export function validateNote(text: string): string | null {
  const length = normalizeNote(text)?.length ?? 0;
  return length > NOTE_MAX_LENGTH
    ? `Notes can be up to ${NOTE_MAX_LENGTH} characters (currently ${length}).`
    : null;
}

/** True when saving the draft would change the stored note. */
export function noteChanged(saved: string | null | undefined, draft: string): boolean {
  return normalizeNote(saved) !== normalizeNote(draft);
}

/** A customer with nothing recorded yet. */
export function blankFollowup(customerKey: string): CustomerFollowup {
  return {
    customer_key: customerKey,
    contacted: false,
    contacted_at: null,
    contacted_by: null,
    contacted_by_email: null,
    note: null,
    note_updated_at: null,
    note_updated_by: null,
    note_updated_by_email: null,
    outcome: null,
    outcome_at: null,
    outcome_by: null,
    outcome_by_email: null,
    not_continuing_reasons: null,
    not_continuing_other: null,
    follow_up_due: null,
    attempt_count: 0,
    last_attempt_at: null,
    last_reached_at: null,
    customer_name: null,
    updated_at: new Date().toISOString(),
  };
}

export function indexFollowups(rows: CustomerFollowup[]): Map<string, CustomerFollowup> {
  return new Map(rows.map((row) => [row.customer_key, row]));
}

// Optimistic cache update: replaces (or adds) only the row for `customerKey`.
// The server's trigger fills in the who/when columns on the real response.
export function applyFollowupPatch(
  rows: CustomerFollowup[],
  customerKey: string,
  patch: FollowupPatch
): CustomerFollowup[] {
  const existing = rows.find((row) => row.customer_key === customerKey);
  const base = existing ?? blankFollowup(customerKey);
  const next: CustomerFollowup =
    "note" in patch ? { ...base, note: normalizeNote(patch.note) } : { ...base, ...patch };
  return existing
    ? rows.map((row) => (row.customer_key === customerKey ? next : row))
    : [...rows, next];
}

/** Server row replaces the optimistic one (and only that one). */
export function replaceFollowup(
  rows: CustomerFollowup[],
  saved: CustomerFollowup
): CustomerFollowup[] {
  return rows.some((row) => row.customer_key === saved.customer_key)
    ? rows.map((row) => (row.customer_key === saved.customer_key ? saved : row))
    : [...rows, saved];
}

// Supabase errors are plain objects with a message, not Error instances.
export function followupErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : "Please try again.";
}

// The table doesn't exist until the migration is applied. PostgREST reports
// that as PGRST205 (not in schema cache); Postgres itself as 42P01.
export function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "PGRST205" || code === "42P01";
}
