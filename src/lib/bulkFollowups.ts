import { format } from "date-fns";
import { NOTE_MAX_LENGTH, normalizeNote } from "./customerFollowups";

// Row selection and bulk saves on the admin Progression pages. Selection is
// a set of customer keys and only ever covers the rows currently shown.

export type HeaderCheckboxState = boolean | "indeterminate";

/** Header checkbox: ticked when every shown row is selected, partly when some are. */
export function headerCheckboxState(
  visibleKeys: readonly string[],
  selected: ReadonlySet<string>
): HeaderCheckboxState {
  const count = visibleKeys.filter((key) => selected.has(key)).length;
  if (count === 0) return false;
  return count === visibleKeys.length ? true : "indeterminate";
}

/** Header checkbox click: selects every shown row, or clears them if all were selected. */
export function toggleAllVisible(
  visibleKeys: readonly string[],
  selected: ReadonlySet<string>
): Set<string> {
  return headerCheckboxState(visibleKeys, selected) === true
    ? new Set()
    : new Set(visibleKeys);
}

export function toggleSelected(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Drops selected rows that are no longer shown (search, period or refreshed
 * data), so a bulk action never touches a customer staff can't see. Returns
 * the same set when nothing changed, so React can skip the re-render.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  visibleKeys: readonly string[]
): ReadonlySet<string> {
  const visible = new Set(visibleKeys);
  const kept = [...selected].filter((key) => visible.has(key));
  return kept.length === selected.size ? selected : new Set(kept);
}

export type BulkResult<T> =
  | { key: string; ok: true; value: T }
  | { key: string; ok: false; error: unknown };

/**
 * Runs `worker` for each key with at most `limit` running at once. Never
 * throws: each key ends up in the results as saved or failed, in input order.
 */
export async function runWithConcurrency<T>(
  keys: readonly string[],
  limit: number,
  worker: (key: string) => Promise<T>,
  onSettled?: (done: number, total: number) => void
): Promise<BulkResult<T>[]> {
  const results: BulkResult<T>[] = new Array(keys.length);
  let next = 0;
  let done = 0;

  const lane = async () => {
    while (next < keys.length) {
      const index = next++;
      const key = keys[index];
      try {
        results[index] = { key, ok: true, value: await worker(key) };
      } catch (error) {
        results[index] = { key, ok: false, error };
      }
      onSettled?.(++done, keys.length);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, keys.length)) }, lane));
  return results;
}

export function splitResults<T>(results: readonly BulkResult<T>[]) {
  const succeeded = results.filter((r): r is Extract<BulkResult<T>, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<BulkResult<T>, { ok: false }> => !r.ok);
  return { succeeded, failed };
}

/**
 * Bulk notes are added below any existing note, never replacing it. Each
 * entry starts with a dated line naming who added it, e.g.
 * "— 7 Oct 2026, alex@fettle.ie".
 */
export function appendNote(
  existing: string | null | undefined,
  text: string,
  author: string | null,
  at: Date = new Date()
): string {
  const entry = `— ${format(at, "d MMM yyyy")}${author ? `, ${author}` : ""}\n${normalizeNote(text) ?? ""}`;
  const current = normalizeNote(existing);
  return current ? `${current}\n\n${entry}` : entry;
}

/** True when appending would push the note past the database limit. */
export function appendWouldOverflow(
  existing: string | null | undefined,
  text: string,
  author: string | null,
  at: Date = new Date()
): boolean {
  return appendNote(existing, text, author, at).length > NOTE_MAX_LENGTH;
}

/** "Jane Doe, John Smith and 3 others" for toasts about failed rows. */
export function listNames(names: readonly string[], max = 3): string {
  if (names.length <= max) {
    return names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const rest = names.length - max;
  return `${names.slice(0, max).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

export const customersLabel = (count: number) =>
  `${count} customer${count === 1 ? "" : "s"}`;
