// Front-end helpers for the admin Overview's "Marketing" tab: the
// admin-analytics query, money / rate formatting, and change labels. The
// numbers themselves come from supabase/functions/admin-analytics/marketing.ts.

import type { MarketingReport } from "../../supabase/functions/admin-analytics/marketing.ts";
import type { DateRange, GroupBy } from "../../supabase/functions/admin-analytics/logic.ts";
import { type BoardComparison, comparisonQuery } from "./adminAnalytics";
import type { Tone } from "@/components/admin/analytics/chartStyle";

export type MarketingResponse = MarketingReport & { generatedAt: string };

/** The admin-analytics query for the tab. */
export function marketingQuery(range: DateRange, groupBy: GroupBy, compare: BoardComparison): string {
  return new URLSearchParams({
    action: "marketing",
    from: range.from,
    to: range.to,
    group: groupBy,
    ...comparisonQuery(compare),
  }).toString();
}

const EURO_CENTS = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EURO_WHOLE = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** "€1,234", or "€12.50" under €100; "–" for null. */
export function formatMoney(value: number | null): string {
  if (value === null) return "–";
  return Math.abs(value) < 100 ? EURO_CENTS.format(value) : EURO_WHOLE.format(value);
}

/** Money in another currency, e.g. "US$42.50". */
export function formatForeignMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Google reports fractional conversions: "12", "12.5". */
export function formatConversions(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-IE") : value.toLocaleString("en-IE", { maximumFractionDigits: 1 });
}

/** Click-through rates are small, so two decimals: "1.23%". "n/a" for null. */
export function formatCtr(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(2)}%`;
}

/** "+€120 (+12%)" against the comparison; null when it can't be worked out. */
export function formatMoneyChange(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null;
  const diff = Math.round((current - previous) * 100) / 100;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  const percent = previous > 0 ? ` (${sign}${Math.abs(Math.round((diff / previous) * 100))}%)` : "";
  return `${sign}${formatMoney(Math.abs(diff))}${percent}`;
}

/** Green when a cost went down, red when it went up. */
export function costTone(current: number | null, previous: number | null): Tone {
  if (current === null || previous === null || current === previous) return "neutral";
  return current < previous ? "up" : "down";
}

/** "25 Nov, 03:00" (Dublin). */
export function formatSynced(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", {
    timeZone: "Europe/Dublin",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
