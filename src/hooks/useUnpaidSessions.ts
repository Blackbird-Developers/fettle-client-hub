import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuros } from '@/hooks/useReferrals';

/**
 * A session the unpaid-sessions function has confirmed is genuinely unpaid.
 * See docs/UNPAID_SESSIONS_FRONTEND.md for the full contract.
 */
export interface UnpaidSession {
  /** Acuity appointment id. */
  id: number;
  type: string;
  /** May be empty for pooled appointment types. */
  therapist: string;
  /** ISO datetime with offset, e.g. "2026-09-29T19:00:00+0100". */
  datetime: string;
  /** EUR as a string, e.g. "95.00". */
  price: string;
  amountPaid: string;
  /** True when the session has already happened. */
  isPast: boolean;
}

export const UNPAID_SESSIONS_QUERY_KEY = ['unpaid-sessions'];

/**
 * Query param on the return_url for redirect-based wallets:
 * /sessions?settled={appointmentId}. usePaymentRedirectReturn skips these;
 * useSettlementRedirectReturn completes them.
 */
export const SETTLEMENT_RETURN_PARAM = 'settled';

const DEFAULT_TIME_ZONE = 'Europe/Dublin';

function isUnpaidSession(value: unknown): value is UnpaidSession {
  const session = value as UnpaidSession | null;
  return (
    !!session &&
    typeof session.id === 'number' &&
    typeof session.datetime === 'string' &&
    !Number.isNaN(new Date(session.datetime).getTime()) &&
    parseFloat(session.price) > 0
  );
}

/**
 * The signed-in client's genuinely unpaid sessions. The server is fail-safe and
 * so is this hook: an error or a `degraded` response means there is nothing to
 * show, so the dashboard looks exactly as it does without this feature.
 */
export function useUnpaidSessions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...UNPAID_SESSIONS_QUERY_KEY, user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // once per login-ish; it hits Acuity + Stripe
    retry: false, // fail silent, never hammer
    queryFn: async (): Promise<UnpaidSession[]> => {
      const { data, error } = await supabase.functions.invoke('unpaid-sessions');
      if (error) throw error;
      // A downstream check was unavailable and the results are conservative.
      // Never surface them.
      if (data?.degraded) return [];
      const sessions: unknown[] = Array.isArray(data?.unpaidSessions)
        ? data.unpaidSessions
        : [];
      return sessions.filter(isUnpaidSession);
    },
  });
}

export function sessionPriceCents(session: UnpaidSession): number {
  return Math.round(parseFloat(session.price) * 100);
}

export function formatSessionPrice(session: UnpaidSession): string {
  return formatEuros(sessionPriceCents(session));
}

/** e.g. "Tue 29 Sept, 19:00" in the client's profile timezone. */
export function formatSessionDate(datetime: string, timeZone?: string | null): string {
  const date = new Date(datetime);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat('en-IE', {
      ...options,
      timeZone: timeZone || DEFAULT_TIME_ZONE,
    }).format(date);
  } catch {
    // Unrecognised profile timezone.
    return new Intl.DateTimeFormat('en-IE', {
      ...options,
      timeZone: DEFAULT_TIME_ZONE,
    }).format(date);
  }
}

/**
 * sessionStorage key for a dismissed banner. Scoped to the exact set of
 * sessions, so the banner returns on the next login or when the list changes.
 */
export function unpaidDismissKey(sessions: UnpaidSession[]): string {
  const ids = sessions.map((session) => session.id).sort((a, b) => a - b);
  return `unpaid-dismissed-${ids.join('-')}`;
}
