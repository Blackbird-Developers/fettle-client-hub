import { format, parseISO } from "date-fns";
import type {
  GradeDefinition,
  NextSessionStatus,
  ProgressionRow,
  ProgressionView,
} from "../../supabase/functions/admin-customer-insights/logic.ts";

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

// Until the admin-customer-insights function is redeployed it still returns
// the old single first-to-second view (an object with `firstSession…` /
// `secondSession…` fields). Convert that into the Session 1–2 view so the
// page keeps working; the other ranges stay missing until the deploy.
interface LegacyProgressionRow {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  firstSessionAt: string;
  firstSessionType: string | null;
  daysSinceFirstSession: number;
  secondSessionStatus: NextSessionStatus;
  secondSessionAt: string | null;
  secondSessionType: string | null;
  portalStatus: ProgressionRow["portalStatus"];
  historyStatus: ProgressionRow["historyStatus"];
  historyNote: string | null;
  grade: ProgressionRow["grade"];
  gradeReason: string | null;
}

type ProgressionViewWithLegend = ProgressionView & { legend: GradeDefinition[] };

export function normalizeProgression(raw: unknown): ProgressionViewWithLegend[] {
  if (Array.isArray(raw)) return raw as ProgressionViewWithLegend[];
  if (!raw || typeof raw !== "object") return [];

  const legacy = raw as { rows?: LegacyProgressionRow[]; legend?: GradeDefinition[] };
  const rows: ProgressionRow[] = (legacy.rows ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    email: row.email,
    phone: row.phone,
    fromSessionAt: row.firstSessionAt,
    fromSessionType: row.firstSessionType,
    daysSinceFromSession: row.daysSinceFirstSession,
    nextSessionStatus: row.secondSessionStatus,
    nextSessionAt: row.secondSessionAt,
    nextSessionType: row.secondSessionType,
    portalStatus: row.portalStatus,
    historyStatus: row.historyStatus,
    historyNote: row.historyNote,
    grade: row.grade,
    gradeReason: row.gradeReason,
  }));
  const unverified = rows.filter((row) => row.historyStatus === "unverified").length;

  return [
    {
      fromSession: 1,
      rows,
      totals: { verified: rows.length - unverified, unverified },
      legend: legacy.legend ?? [],
    },
  ];
}
