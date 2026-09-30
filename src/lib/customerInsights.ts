import { format, parseISO } from "date-fns";

// Display helpers for the admin Portal adoption / Progression tabs.

export function formatDate(iso: string | null): string {
  return iso ? format(parseISO(iso), "d MMM yyyy") : "—";
}

export function formatDateTime(iso: string | null): string {
  return iso ? format(parseISO(iso), "d MMM yyyy, HH:mm") : "—";
}

export function daysAgoLabel(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** Case-insensitive match on name or email; phone matches on digits. */
export function matchesSearch(
  row: { name: string | null; email: string | null; phone: string | null },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const phoneDigits = (row.phone ?? "").replace(/\D/g, "");
  const qDigits = q.replace(/\D/g, "");
  return (
    (row.name ?? "").toLowerCase().includes(q) ||
    (row.email ?? "").toLowerCase().includes(q) ||
    (qDigits.length >= 3 && phoneDigits.includes(qDigits))
  );
}
