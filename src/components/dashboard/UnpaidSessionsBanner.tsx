import { useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { PaySessionModal } from "@/components/booking/PaySessionModal";
import {
  formatSessionDate,
  formatSessionPrice,
  sessionPriceCents,
  unpaidDismissKey,
  useUnpaidSessions,
  type UnpaidSession,
} from "@/hooks/useUnpaidSessions";
import { formatEuros } from "@/hooks/useReferrals";

/** How many sessions to list in the banner before pointing to My Sessions. */
const MAX_LISTED = 3;

function readDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/**
 * Gentle nudge for genuinely unpaid sessions. Renders nothing at all when the
 * list is empty, errored or degraded, so the dashboard is unchanged for
 * everyone else.
 */
export function UnpaidSessionsBanner() {
  const { profile } = useAuth();
  const { data: sessions = [] } = useUnpaidSessions();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [payingSession, setPayingSession] = useState<UnpaidSession | null>(null);

  const dismissKey = unpaidDismissKey(sessions);
  const dismissed = dismissedKey === dismissKey || readDismissed(dismissKey);

  // Keep the modal mounted while paying, even once the list refreshes empty.
  if ((sessions.length === 0 || dismissed) && !payingSession) return null;

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(dismissKey, "true");
    } catch {
      /* private mode: dismiss for this render only */
    }
    setDismissedKey(dismissKey);
  };

  const timeZone = profile?.timezone;
  const withTherapist = (session: UnpaidSession) =>
    session.therapist ? ` with ${session.therapist}` : "";
  const single = sessions.length === 1 ? sessions[0] : null;

  let message = "";
  if (single) {
    const date = formatSessionDate(single.datetime, timeZone);
    const price = formatSessionPrice(single);
    message = single.isPast
      ? `Your session${withTherapist(single)} on ${date} is awaiting payment (${price}).`
      : `Your session${withTherapist(single)} on ${date} hasn't been paid yet (${price}). Please settle it before your appointment.`;
  } else if (sessions.length > 1) {
    const total = sessions.reduce((sum, session) => sum + sessionPriceCents(session), 0);
    message = `You have ${sessions.length} unpaid sessions totalling ${formatEuros(total)}.`;
  }

  return (
    <>
      {sessions.length > 0 && !dismissed && (
        <Alert className="mb-4 sm:mb-6 pr-10 border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-50 [&>svg]:text-amber-600 animate-fade-in">
          <button
            type="button"
            onClick={handleDismiss}
            className="absolute right-2 top-2 p-1 rounded-md text-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/60 transition-colors"
            aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
          <CreditCard className="h-4 w-4" />
          <AlertDescription>
            <p>{message}</p>

            {single ? (
              <Button size="sm" className="mt-3" onClick={() => setPayingSession(single)}>
                Pay now
              </Button>
            ) : (
              <div className="mt-3 space-y-2">
                {sessions.slice(0, MAX_LISTED).map((session) => (
                  <div
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/70 dark:bg-background/10 px-3 py-2">
                    <span className="text-sm">
                      {session.therapist || "Session"} · {formatSessionDate(session.datetime, timeZone)} ·{" "}
                      {formatSessionPrice(session)}
                    </span>
                    <Button size="sm" onClick={() => setPayingSession(session)}>
                      Pay now
                    </Button>
                  </div>
                ))}
                {sessions.length > MAX_LISTED && (
                  <Link
                    to="/sessions"
                    className="inline-block text-sm font-medium underline underline-offset-2">
                    View all in My Sessions
                  </Link>
                )}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <PaySessionModal
        session={payingSession}
        open={!!payingSession}
        onOpenChange={(open) => {
          if (!open) setPayingSession(null);
        }}
      />
    </>
  );
}
