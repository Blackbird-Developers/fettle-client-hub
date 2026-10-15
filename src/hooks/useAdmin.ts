import { useEffect, useState } from "react";
import { queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, classifyApiError } from "@/lib/api-errors";
import { readCachedAdminData, writeCachedAdminData } from "@/lib/adminDataCache";
import { type AdminDataSource, timeLoad } from "@/lib/adminLoadProgress";
import { normalizeProgression } from "@/lib/customerInsights";
import {
  type CustomerFollowup,
  type FollowupPatch,
  NOTE_MAX_LENGTH,
  applyFollowupPatch,
  isMissingTableError,
  replaceFollowup,
} from "@/lib/customerFollowups";
import { appendNote, runWithConcurrency } from "@/lib/bulkFollowups";
import {
  type AttemptMeta,
  type ContactAttempt,
  type OutcomeInput,
  applyOutcome,
  attemptInsert,
  countFollowUpsDue,
} from "@/lib/contactOutcomes";

const FOLLOWUPS_QUERY_KEY = ["customer-followups"];
const CONTACT_HISTORY_QUERY_KEY = ["customer-contact-history"];
const NO_ANSWER_QUERY_KEY = ["no-answer-sequences"];
const HUB_FEEDBACK_QUERY_KEY = ["hub-feedback"];
import type {
  AdoptionView,
  GradeDefinition,
  ProgressionView,
} from "../../supabase/functions/admin-customer-insights/logic.ts";
import type { LeadsView } from "../../supabase/functions/admin-leads/logic.ts";
import type { BundlesView } from "../../supabase/functions/admin-bundles/logic.ts";
import type { AssessmentView, PsychiatryView } from "../../supabase/functions/admin-clinical/logic.ts";
import type { RecentAttempt } from "@/lib/hotLeads";
import type { EmailSendRow } from "@/lib/portalEmails";
import { type NoAnswerSequence, countDue } from "@/lib/noAnswer";
import type { FeedbackStatus, HubFeedback } from "@/lib/hubFeedback";

// Types for admin metrics response
interface AdminMetricsResponse {
  revenue: {
    totalRevenue: number;
    thisMonthRevenue: number;
    lastMonthRevenue: number;
    monthOverMonthChange: number;
    totalPackagesSold: number;
    averagePackageValue: number;
    thisMonthPackages: number;
  };
  sessions: {
    totalCompleted: number;
    totalUpcoming: number;
    thisMonthCompleted: number;
    lastMonthCompleted: number;
    monthOverMonthGrowth: number;
    uniqueClientsThisMonth: number;
    firstTimersThisMonth: number;
    canceledThisMonth: number;
  };
  engagement: {
    totalActiveCredits: number;
    uniqueClients: number;
    activePackageHolders: number;
    clientsWithoutPackages: number;
  };
  retention: {
    totalClients: number;
    firstSession: number;
    secondSession: number;
    thirdSession: number;
    fourthSession: number;
    firstToSecondRate: number;
    secondToThirdRate: number;
    thirdToFourthRate: number;
  };
}

// Check if current user is admin
export function useIsAdmin() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;

      const { data, error } = await supabase.rpc("has_role", {
        check_role: "admin",
      });

      if (error) {
        console.error("Error checking admin role:", error);
        return false;
      }

      return data === true;
    },
    enabled: !!user?.id,
  });
}

// Get list of all admins
export function useAdminList() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ["admin-list"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-roles?role=admin`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch admin list");
      }

      return response.json();
    },
    enabled: isAdmin === true,
  });
}

// Invite a new admin by email
export function useInviteAdmin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (email: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-roles`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, role: "admin" }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to invite admin");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
    },
  });
}

// Remove admin role
export function useRemoveAdmin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-roles`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId, role: "admin" }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove admin");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
    },
  });
}

// Main hook to fetch all admin metrics from the edge function
export function useAdminMetrics() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<AdminMetricsResponse, ApiError>({
    queryKey: ["admin-metrics"],
    queryFn: async (): Promise<AdminMetricsResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw {
          type: "unauthorized",
          message: "Not authenticated",
          retryable: false,
        } as ApiError;
      }

      let response: Response;
      try {
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-metrics`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (fetchError) {
        // Network/CORS errors throw before we get a response
        const apiError = classifyApiError(fetchError);
        throw apiError;
      }

      if (!response.ok) {
        const apiError = classifyApiError(
          new Error(`HTTP ${response.status}`),
          response
        );
        throw apiError;
      }

      const data = await response.json();

      if (data.error) {
        throw {
          type: "server_error",
          message: data.error,
          retryable: true,
        } as ApiError;
      }

      return data as AdminMetricsResponse;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: (failureCount, error) => {
      // Don't retry auth/permission/cors/network errors
      const nonRetryableTypes = ["unauthorized", "forbidden", "cors", "network"];
      if (error?.type && nonRetryableTypes.includes(error.type)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

// Get all clients/profiles (admin only)
export function useAllClients() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ["all-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
  });
}

// Get all packages (admin only) - still useful for detailed package list
export function useAllPackages() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ["all-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_packages")
        .select(`
          *,
          profiles:user_id (
            email,
            first_name,
            last_name
          )
        `)
        .order("purchased_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
  });
}

// Retention funnel - uses edge function data
export function useRetentionFunnel() {
  const { data, isLoading, error } = useAdminMetrics();

  const funnel = data?.retention ?? {
    totalClients: 0,
    firstSession: 0,
    secondSession: 0,
    thirdSession: 0,
    fourthSession: 0,
    firstToSecondRate: 0,
    secondToThirdRate: 0,
    thirdToFourthRate: 0,
  };

  return { funnel, loading: isLoading, error: error ?? null };
}

// Revenue metrics - uses edge function data
export function useRevenueMetrics() {
  const { data, isLoading, error } = useAdminMetrics();

  const metrics = data?.revenue ?? {
    totalRevenue: 0,
    thisMonthRevenue: 0,
    lastMonthRevenue: 0,
    monthOverMonthChange: 0,
    totalPackagesSold: 0,
    averagePackageValue: 0,
    thisMonthPackages: 0,
  };

  return { metrics, isLoading, error: error ?? null };
}

// Session metrics - uses edge function data
export function useSessionMetrics() {
  const { data, isLoading, error } = useAdminMetrics();

  const metrics = data?.sessions ?? {
    totalCompleted: 0,
    totalUpcoming: 0,
    thisMonthCompleted: 0,
    lastMonthCompleted: 0,
    monthOverMonthGrowth: 0,
    uniqueClientsThisMonth: 0,
    firstTimersThisMonth: 0,
    canceledThisMonth: 0,
  };

  return { metrics, loading: isLoading, error: error ?? null };
}

// Engagement stats - uses edge function data
export function useEngagementStats() {
  const { data, isLoading, error } = useAdminMetrics();

  const stats = data?.engagement ?? {
    totalActiveCredits: 0,
    uniqueClients: 0,
    activePackageHolders: 0,
    clientsWithoutPackages: 0,
  };

  return { stats, isLoading, error: error ?? null };
}

// Response of the admin-customer-insights edge function (row types come from
// the function's own logic module so the two can't drift apart).
export interface CustomerInsightsResponse {
  generatedAt: string;
  activeWindowDays: number;
  progressionPeriods: number[];
  adoption: AdoptionView & { legend: GradeDefinition[] };
  /** One view per range: Session 1–2, 2–3, 3–4, 4–5. */
  progression: (ProgressionView & { legend: GradeDefinition[] })[];
  dataIssues: {
    incompleteDates: string[];
    unknownTypes: { type: string; count: number }[];
    customersWithoutEmail: number;
    customersWithoutPhone: number;
    unverifiedHistory: number;
  };
  diagnostics: {
    windowAppointments: number;
    customersInWindow: number;
    historyLookups: number;
    acuityRequests: number;
    durationMs: number;
  };
}

/** How long the browser waits for an admin Acuity function before giving up. */
export const ADMIN_FUNCTION_TIMEOUT_MS = 120_000;

const ACUITY_TIMEOUT_ERROR: ApiError = {
  type: "timeout",
  message: "Acuity took too long to answer. Try again in a minute.",
  retryable: true,
};

// GETs one of the admin Acuity edge functions with the caller's session.
// Gives up after ADMIN_FUNCTION_TIMEOUT_MS; a gateway timeout (504) or the
// function hitting Supabase's limits (546) count as a timeout too.
async function fetchAdminFunction(name: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw {
      type: "unauthorized",
      message: "Not authenticated",
      retryable: false,
    } as ApiError;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADMIN_FUNCTION_TIMEOUT_MS);
  let data;
  try {
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
    } catch (fetchError) {
      throw controller.signal.aborted ? ACUITY_TIMEOUT_ERROR : classifyApiError(fetchError);
    }

    if (response.status === 504 || response.status === 546) {
      throw { ...ACUITY_TIMEOUT_ERROR, statusCode: response.status };
    }
    if (!response.ok) {
      throw classifyApiError(new Error(`HTTP ${response.status}`), response);
    }

    data = await response.json();
  } finally {
    clearTimeout(timer);
  }

  if (data.error) {
    throw {
      type: "server_error",
      message: data.error,
      retryable: true,
    } as ApiError;
  }
  return data;
}

// Shared by the Acuity-backed admin queries: slow to build, so fresh for 30
// minutes (Refresh reloads sooner), kept in memory for an hour, never
// refetched on window focus, retried once at most — but not after a timeout,
// which would only make the admin wait as long again.
const ACUITY_QUERY_OPTIONS = {
  staleTime: 1000 * 60 * 30,
  gcTime: 1000 * 60 * 60,
  refetchOnWindowFocus: false,
  retry: (failureCount: number, error: ApiError) => {
    const nonRetryableTypes = ["unauthorized", "forbidden", "cors", "network", "timeout"];
    if (error?.type && nonRetryableTypes.includes(error.type)) {
      return false;
    }
    return failureCount < 1;
  },
};

// Query for one Acuity-backed edge function. The load is timed for the
// progress loader, and the last good response is saved for this tab so a
// reload shows it at once (marked with its age, so it refreshes if stale).
function acuityQueryOptions<T>(
  source: AdminDataSource,
  userId: string | undefined,
  parse: (data: Record<string, unknown>) => T
) {
  return queryOptions<T, ApiError>({
    queryKey: [source],
    queryFn: async () => {
      const data = parse(await timeLoad(source, () => fetchAdminFunction(source)));
      writeCachedAdminData(source, userId, data);
      return data;
    },
    initialData: () => readCachedAdminData<T>(source, userId)?.data,
    initialDataUpdatedAt: () => readCachedAdminData<T>(source, userId)?.savedAt,
    ...ACUITY_QUERY_OPTIONS,
  });
}

const customerInsightsQuery = (userId: string | undefined) =>
  acuityQueryOptions(
    "admin-customer-insights",
    userId,
    (data) => ({ ...data, progression: normalizeProgression(data.progression) }) as unknown as CustomerInsightsResponse
  );

const hotLeadsQuery = (userId: string | undefined) =>
  acuityQueryOptions("admin-leads", userId, (data) => data as unknown as HotLeadsResponse);

const bundlesQuery = (userId: string | undefined) =>
  acuityQueryOptions("admin-bundles", userId, (data) => data as unknown as BundlesResponse);

// Portal adoption + session-to-session progression, built from Acuity.
// One request feeds every admin insights page. It can take a while (it walks Acuity
// history), so it is cached and never refetched on window focus.
export function useCustomerInsights() {
  const { data: isAdmin } = useIsAdmin();
  const { user } = useAuth();

  return useQuery({ ...customerInsightsQuery(user?.id), enabled: isAdmin === true });
}

// Response of the admin-leads edge function.
export interface HotLeadsResponse {
  generatedAt: string;
  lookbackDays: number;
  leads: LeadsView;
  dataIssues: {
    incompleteDates: string[];
    leadsWithoutEmail: number;
    unverifiedHistory: number;
  };
  diagnostics: {
    windowAppointments: number;
    leads: number;
    acuityRequests: number;
    durationMs: number;
  };
}

// Hot leads (Let's Talk no-shows and quotes), built from Acuity.
export function useHotLeads() {
  const { data: isAdmin } = useIsAdmin();
  const { user } = useAuth();

  return useQuery({ ...hotLeadsQuery(user?.id), enabled: isAdmin === true });
}

// Response of the admin-bundles edge function.
export interface BundlesResponse {
  generatedAt: string;
  /** True when this is the copy saved by the hourly rebuild, not a live build. */
  fromSnapshot?: boolean;
  lookbackDays: number;
  bundles: BundlesView;
  dataIssues: {
    incompleteDates: string[];
    bundlesWithoutEmail: number;
    matchedByEmailOnly: number;
  };
  diagnostics: {
    certificates: number;
    windowAppointments: number;
    acuityRequests: number;
    durationMs: number;
  };
}

// Session bundles (Acuity certificates) with credits used and left.
export function useBundles() {
  const { data: isAdmin } = useIsAdmin();
  const { user } = useAuth();

  return useQuery({ ...bundlesQuery(user?.id), enabled: isAdmin === true });
}

// Response of the admin-clinical edge function.
export interface ClinicalResponse {
  generatedAt: string;
  lookbackDays: number;
  psychiatryRule: { contactAfterDays: number; followUpByDays: number };
  psychiatry: PsychiatryView;
  assessments: AssessmentView;
  dataIssues: {
    incompleteDates: string[];
    psychiatryWithoutEmail: number;
    assessmentsWithoutEmail: number;
  };
  diagnostics: {
    windowAppointments: number;
    acuityRequests: number;
    durationMs: number;
  };
}

const clinicalQuery = (userId: string | undefined) =>
  acuityQueryOptions("admin-clinical", userId, (data) => data as unknown as ClinicalResponse);

// Psychiatry follow-ups and assessment next steps, built from Acuity. One
// request feeds both pages. Not preloaded with the others: it's only needed
// on those two pages.
export function useClinical() {
  const { data: isAdmin } = useIsAdmin();
  const { user } = useAuth();

  return useQuery({ ...clinicalQuery(user?.id), enabled: isAdmin === true });
}

// Follow-ups and contact outcomes for a page's Contact column, with why
// they're disabled when they can't load.
export function useFollowupsForPage() {
  const followups = useCustomerFollowups();
  const outcomesCheck = useContactOutcomesAvailable();
  const unavailable = followups.isPending
    ? "Loading follow-ups…"
    : followups.isError
      ? isMissingTableError(followups.error)
        ? "Available once the follow-ups database update is deployed"
        : "Couldn't load follow-ups. Refresh the page to try again."
      : null;
  const outcomesUnavailable = outcomesCheck.isPending
    ? "Loading…"
    : outcomesCheck.isError
      ? isMissingTableError(outcomesCheck.error)
        ? "Outcomes are available once the contact-outcomes database update is deployed"
        : "Couldn't load contact outcomes. Refresh the page to try again."
      : null;
  return { followups: followups.data, unavailable, outcomesUnavailable };
}

// Loads the Acuity-backed pages' data in the background once an admin opens
// /admin, so it is usually ready by the time they click into a page. One
// request at a time to stay clear of Acuity's rate limit; data that's still
// fresh isn't fetched again.
export function usePreloadAdminData(enabled: boolean) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    const preloads = [
      () => queryClient.prefetchQuery(customerInsightsQuery(userId)),
      () => queryClient.prefetchQuery(hotLeadsQuery(userId)),
      () => queryClient.prefetchQuery(bundlesQuery(userId)),
    ];
    (async () => {
      for (const preload of preloads) {
        if (cancelled) return;
        await preload();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId, queryClient]);
}

const RECENT_ATTEMPTS_QUERY_KEY = [...CONTACT_HISTORY_QUERY_KEY, "recent"];

// Contact attempts logged in the last `days` days, for counting attempts
// since each lead. Paged past the API's 1000-row cap.
export function useRecentContactAttempts(days: number) {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<RecentAttempt[], { code?: string; message: string }>({
    queryKey: [...RECENT_ATTEMPTS_QUERY_KEY, days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const rows: RecentAttempt[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("customer_contact_attempts")
          .select("customer_key, outcome, created_at")
          .gte("created_at", since)
          .order("created_at")
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

// Portal-adoption emails sent so far, plus how many addresses have
// unsubscribed, for the Portal adoption page's email panel. Admin-only by RLS.
export function usePortalEmailSends() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<
    { sends: EmailSendRow[]; unsubscribed: number },
    { code?: string; message: string }
  >({
    queryKey: ["portal-email-sends"],
    queryFn: async () => {
      const sends: EmailSendRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("email_sends")
          .select(
            "id, campaign, status, customer_name, email, sent_at, delivered_at, opened_at, first_clicked_at, bounced_at, complained_at, signed_up_at"
          )
          .order("created_at")
          .range(from, from + 999);
        if (error) throw error;
        sends.push(...(data as EmailSendRow[]));
        if (data.length < 1000) break;
      }
      const { count, error } = await supabase
        .from("email_suppressions")
        .select("email", { count: "exact", head: true })
        .eq("reason", "unsubscribed");
      if (error) throw error;
      return { sends, unsubscribed: count ?? 0 };
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    // Missing table = migration not applied yet; retrying won't help.
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

// Staff follow-up (contacted + note) per customer on the Progression pages.
// Read and written straight from the table; RLS limits both to admins.
export function useCustomerFollowups() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<CustomerFollowup[], { code?: string; message: string }>({
    queryKey: FOLLOWUPS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_followups").select("*");
      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    // Missing table = migration not applied yet; retrying won't help.
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

// Shared by the single-row and bulk saves.
async function saveFollowup(customerKey: string, patch: FollowupPatch) {
  const { data, error } = await supabase
    .from("customer_followups")
    .upsert({ customer_key: customerKey, ...patch }, { onConflict: "customer_key" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Adds a bulk note below the customer's current note. Reads the latest note
// first and only writes if it hasn't changed since, so a colleague's edit
// made in the meantime is never overwritten (that customer fails instead).
async function appendFollowupNote(customerKey: string, text: string, author: string | null) {
  const { data: current, error: readError } = await supabase
    .from("customer_followups")
    .select("note")
    .eq("customer_key", customerKey)
    .maybeSingle();
  if (readError) throw readError;

  const note = appendNote(current?.note, text, author);
  if (note.length > NOTE_MAX_LENGTH) {
    throw { message: `Their note would go over ${NOTE_MAX_LENGTH} characters.` };
  }

  const changedMeanwhile = { message: "Someone else changed this note just now. Try again." };
  if (!current) {
    const { data, error } = await supabase
      .from("customer_followups")
      .insert({ customer_key: customerKey, note })
      .select()
      .single();
    // 23505: a row for this customer was created since we looked.
    if (error) throw error.code === "23505" ? changedMeanwhile : error;
    return data;
  }

  const update = supabase
    .from("customer_followups")
    .update({ note })
    .eq("customer_key", customerKey);
  const { data, error } = await (current.note === null
    ? update.is("note", null)
    : update.eq("note", current.note)
  )
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw changedMeanwhile;
  return data;
}

// Records an outcome as a new contact attempt; the database updates the
// customer's summary row, which is read back for the page.
async function recordOutcome(
  customerKey: string,
  customerName: string | null,
  input: OutcomeInput,
  meta?: AttemptMeta
) {
  const { error } = await supabase
    .from("customer_contact_attempts")
    .insert(attemptInsert(customerKey, customerName, input, meta));
  if (error) throw error;

  const { data, error: readError } = await supabase
    .from("customer_followups")
    .select("*")
    .eq("customer_key", customerKey)
    .single();
  if (readError) throw readError;
  return data;
}

export type BulkFollowupAction =
  | { kind: "contacted"; contacted: boolean }
  | { kind: "appendNote"; text: string }
  | { kind: "outcome"; input: OutcomeInput };

/** Customers saved at once by a bulk action. */
export const BULK_CONCURRENCY = 4;

// Applies one action to many customers, a few at a time. Never throws: the
// result says which customers saved and which failed. Saved rows go into the
// table as each one lands; failed ones keep their previous values.
export function useBulkUpdateFollowups() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: async ({
      keys,
      action,
      nameOf,
      metaOf,
    }: {
      keys: string[];
      action: BulkFollowupAction;
      /** Customer names, stored with outcomes for the Follow-ups report. */
      nameOf?: (key: string) => string | null;
      /** Phone, source etc. saved with each outcome. */
      metaOf?: (key: string) => AttemptMeta;
    }) => {
      setProgress({ done: 0, total: keys.length });
      const save =
        action.kind === "contacted"
          ? (key: string) => saveFollowup(key, { contacted: action.contacted })
          : action.kind === "outcome"
            ? (key: string) => recordOutcome(key, nameOf?.(key) ?? null, action.input, metaOf?.(key))
            : (key: string) => appendFollowupNote(key, action.text, user?.email ?? null);
      return runWithConcurrency(
        keys,
        BULK_CONCURRENCY,
        async (key) => {
          const saved = await save(key);
          queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
            replaceFollowup(rows ?? [], saved)
          );
          return saved;
        },
        (done, total) => setProgress({ done, total })
      );
    },
    onSettled: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: CONTACT_HISTORY_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: NO_ANSWER_QUERY_KEY });
    },
  });

  return { run: mutation.mutateAsync, isPending: mutation.isPending, progress };
}

// Saves one customer's contacted status or note. The table updates
// straight away and rolls back if the save fails.
export function useUpdateFollowup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ customerKey, patch }: { customerKey: string; patch: FollowupPatch }) =>
      saveFollowup(customerKey, patch),
    onMutate: async ({ customerKey, patch }) => {
      await queryClient.cancelQueries({ queryKey: FOLLOWUPS_QUERY_KEY });
      const previous = queryClient.getQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY);
      queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
        applyFollowupPatch(rows ?? [], customerKey, patch)
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(FOLLOWUPS_QUERY_KEY, context?.previous);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
        replaceFollowup(rows ?? [], saved)
      );
    },
  });
}

// Records one customer's contact outcome. The table updates straight away
// and rolls back if the save fails.
export function useRecordOutcome() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: ({
      customerKey,
      customerName,
      input,
      meta,
    }: {
      customerKey: string;
      customerName: string | null;
      input: OutcomeInput;
      meta?: AttemptMeta;
    }) => recordOutcome(customerKey, customerName, input, meta),
    onMutate: async ({ customerKey, customerName, input }) => {
      await queryClient.cancelQueries({ queryKey: FOLLOWUPS_QUERY_KEY });
      const previous = queryClient.getQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY);
      queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
        applyOutcome(rows ?? [], customerKey, customerName, input, user?.email ?? null)
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(FOLLOWUPS_QUERY_KEY, context?.previous);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
        replaceFollowup(rows ?? [], saved)
      );
    },
    onSettled: (_data, _error, { customerKey }) => {
      void queryClient.invalidateQueries({ queryKey: [...CONTACT_HISTORY_QUERY_KEY, customerKey] });
      void queryClient.invalidateQueries({ queryKey: RECENT_ATTEMPTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: NO_ANSWER_QUERY_KEY });
    },
  });
}

/** "Continue later" customers due a call today or earlier (0 until loaded). */
export function useFollowUpsDueCount(): number {
  const { data } = useCustomerFollowups();
  return data ? countFollowUpsDue(data) : 0;
}

// Whether the contact-outcomes database update has been applied. Until it
// is, the outcome buttons are disabled with the reason.
export function useContactOutcomesAvailable() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<boolean, { code?: string; message: string }>({
    queryKey: [...CONTACT_HISTORY_QUERY_KEY, "available"],
    queryFn: async () => {
      const { error } = await supabase.from("customer_contact_attempts").select("id").limit(1);
      if (error) throw error;
      return true;
    },
    enabled: isAdmin === true,
    staleTime: Infinity,
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

/** Everything recorded for one customer, newest first. */
export function useContactHistory(customerKey: string, enabled: boolean) {
  return useQuery<ContactAttempt[], { code?: string; message: string }>({
    queryKey: [...CONTACT_HISTORY_QUERY_KEY, customerKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_contact_attempts")
        .select("*")
        .eq("customer_key", customerKey)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled,
  });
}

// No-answer follow-up sequences (the No answer page and its sidebar badge).
// Read straight from the table; RLS limits it to admins. Paged past the
// API's 1000-row cap.
export function useNoAnswerSequences() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<NoAnswerSequence[], { code?: string; message: string }>({
    queryKey: NO_ANSWER_QUERY_KEY,
    queryFn: async () => {
      const rows: NoAnswerSequence[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("no_answer_sequences")
          .select("*")
          .order("started_at")
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    // Missing table = migration not applied yet; retrying won't help.
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

/** Sequences with an attempt due today or earlier (0 until loaded). */
export function useNoAnswerDueCount(): number {
  const { data } = useNoAnswerSequences();
  return data ? countDue(data) : 0;
}

// Ends an open sequence by hand; the reason is required.
export function useCloseSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sequenceId, reason }: { sequenceId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("close_no_answer_sequence", {
        p_sequence_id: sequenceId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: NO_ANSWER_QUERY_KEY }),
  });
}

// Starts a new sequence by hand (e.g. within 60 days of the last one finishing).
export function useRestartSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      customerKey,
      customerName,
      customerPhone,
    }: {
      customerKey: string;
      customerName: string | null;
      customerPhone: string | null;
    }) => {
      const { data, error } = await supabase.rpc("restart_no_answer_sequence", {
        p_customer_key: customerKey,
        p_customer_name: customerName ?? "",
        p_customer_phone: customerPhone ?? "",
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: NO_ANSWER_QUERY_KEY }),
  });
}

// Feedback clients send from the hub's Feedback page. Read straight from the
// table; RLS limits it to admins. Paged past the API's 1000-row cap.
export function useHubFeedback() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<HubFeedback[], { code?: string; message: string }>({
    queryKey: HUB_FEEDBACK_QUERY_KEY,
    queryFn: async () => {
      const rows: HubFeedback[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("hub_feedback")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    // Missing table = migration not applied yet; retrying won't help.
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

/** Feedback nobody has read yet (0 until loaded). */
export function useNewFeedbackCount(): number {
  const { data } = useHubFeedback();
  return data ? data.filter((row) => row.status === "new").length : 0;
}

// Marks feedback new / read / actioned. Updates the cached list straight away
// and rolls back if the save fails.
export function useUpdateFeedbackStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: FeedbackStatus }) => {
      const { data, error } = await supabase
        .from("hub_feedback")
        .update({ status })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as HubFeedback;
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: HUB_FEEDBACK_QUERY_KEY });
      const previous = queryClient.getQueryData<HubFeedback[]>(HUB_FEEDBACK_QUERY_KEY);
      queryClient.setQueryData<HubFeedback[]>(HUB_FEEDBACK_QUERY_KEY, (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, status } : row))
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(HUB_FEEDBACK_QUERY_KEY, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: HUB_FEEDBACK_QUERY_KEY }),
  });
}
