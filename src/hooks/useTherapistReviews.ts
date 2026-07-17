import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TherapistReview {
  id: string;
  appointment_id: string;
  calendar_id: number;
  therapist_name: string;
  rating: number;
  comment: string | null;
  public_consent: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface SubmitReviewInput {
  appointmentId: string | number;
  rating: number;
  comment?: string | null;
  publicConsent?: boolean;
}

/**
 * Loads the current user's therapist reviews and returns them keyed by
 * appointment id, so session cards can render a "reviewed" state and prefill
 * the edit dialog. RLS restricts the query to the caller's own rows.
 *
 * The `therapist_reviews` table was added in the 20260717120000 migration and is
 * not yet in the generated Supabase types, so the query client is loosely cast
 * (same approach as useReferrals for the referral RPCs).
 */
export function useTherapistReviews() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["therapist-reviews", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, TherapistReview>> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => Promise<{ data: TherapistReview[] | null; error: unknown }>;
        };
      })
        .from("therapist_reviews")
        .select(
          "id, appointment_id, calendar_id, therapist_name, rating, comment, public_consent, created_at, updated_at",
        );
      if (error) throw error;
      const map = new Map<string, TherapistReview>();
      for (const row of data ?? []) {
        map.set(String(row.appointment_id), row);
      }
      return map;
    },
  });

  return {
    reviewsByAppointment: query.data ?? new Map<string, TherapistReview>(),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * Submit (or edit) a therapist review. All verification — that the appointment
 * belongs to the user and is a completed, non-cancelled session — happens
 * server-side in the `submit-therapist-review` edge function. The therapist
 * identity is derived from Acuity there, not from anything sent here.
 */
export async function submitTherapistReview(input: SubmitReviewInput): Promise<TherapistReview> {
  const { data, error } = await supabase.functions.invoke("submit-therapist-review", {
    body: {
      appointmentId: input.appointmentId,
      rating: input.rating,
      comment: input.comment ?? null,
      publicConsent: input.publicConsent ?? false,
    },
  });

  if (error) {
    // Edge function errors surface the JSON body on `context` for non-2xx.
    let message = error.message || "Failed to submit review";
    try {
      const parsed = await (error as { context?: Response }).context?.json?.();
      if (parsed?.error) message = parsed.error;
    } catch {
      // ignore — fall back to the generic message
    }
    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  return data.review as TherapistReview;
}
