import { format, parseISO } from "date-fns";

// Hub feedback: sent by clients from the Feedback page, read by staff on the
// admin Feedback page. Values match the checks in the hub_feedback migration.

export const FEEDBACK_CATEGORIES = [
  { id: "hub_experience", label: "Hub experience / navigation" },
  { id: "accessibility", label: "Accessibility" },
  { id: "therapist", label: "Psychologist / therapist (overall)" },
  { id: "psychiatry", label: "Psychiatry" },
  { id: "other", label: "Other" },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["id"];

export const FEEDBACK_STATUSES = [
  { id: "new", label: "New" },
  { id: "read", label: "Read" },
  { id: "actioned", label: "Actioned" },
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]["id"];

export const FEEDBACK_MESSAGE_MAX_LENGTH = 4000;

export interface HubFeedback {
  id: string;
  user_id: string;
  category: string;
  message: string;
  rating: number | null;
  page: string | null;
  status: string;
  created_at: string;
  sender_email: string | null;
  sender_name: string | null;
  status_updated_at: string | null;
  status_updated_by_email: string | null;
}

/** Label for a category id; unknown ids are shown as they are. */
export function categoryLabel(id: string): string {
  return FEEDBACK_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function statusLabel(id: string): string {
  return FEEDBACK_STATUSES.find((s) => s.id === id)?.label ?? id;
}

// Hub pages a client can open Feedback from, for the "page" column.
const PAGE_NAMES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/sessions": "My Sessions",
  "/psychiatry": "Psychiatry",
  "/invoices": "Invoices",
  "/profile": "Profile",
  "/referrals": "Refer & Earn",
  "/help": "Help Center",
  "/get-started": "Get started",
  "/booking-success": "Booking confirmation",
};

/** Readable name for a hub path, e.g. "/sessions" → "My Sessions". */
export function pageLabel(path: string | null): string | null {
  if (!path) return null;
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  if (path.startsWith("/help/")) return "Help article";
  return path;
}

/**
 * The page to record with new feedback: where the client came from, if the
 * Feedback page was opened from another hub page. Ignores anything that
 * isn't an in-app path (or is the Feedback page itself).
 */
export function feedbackSourcePage(state: unknown): string | null {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return null;
  if (from === "/feedback") return null;
  return from.slice(0, 200);
}

export interface FeedbackFilters {
  category: FeedbackCategory | "all";
  status: FeedbackStatus | "all";
  /** Inclusive local dates, "yyyy-MM-dd"; empty means no limit. */
  from: string;
  to: string;
}

export const DEFAULT_FEEDBACK_FILTERS: FeedbackFilters = {
  category: "all",
  status: "all",
  from: "",
  to: "",
};

/** Feedback matching the filters, newest first. */
export function filterFeedback(rows: HubFeedback[], filters: FeedbackFilters): HubFeedback[] {
  return rows
    .filter((row) => {
      if (filters.category !== "all" && row.category !== filters.category) return false;
      if (filters.status !== "all" && row.status !== filters.status) return false;
      const day = format(parseISO(row.created_at), "yyyy-MM-dd");
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface FeedbackSummary {
  total: number;
  new: number;
  /** Average of the rated ones, to one decimal place; null when none are rated. */
  averageRating: number | null;
  rated: number;
}

export function summariseFeedback(rows: HubFeedback[]): FeedbackSummary {
  const ratings = rows.map((row) => row.rating).filter((r): r is number => r !== null);
  return {
    total: rows.length,
    new: rows.filter((row) => row.status === "new").length,
    averageRating:
      ratings.length === 0
        ? null
        : Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10,
    rated: ratings.length,
  };
}
