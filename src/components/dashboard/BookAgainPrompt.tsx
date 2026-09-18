import { useMemo, useState } from "react";
import { differenceInCalendarDays, isPast, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarPlus, Gift, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcuityAppointments } from "@/hooks/useAcuity";
import { useTherapistImages } from "@/hooks/useTherapistImages";
import { useActivePackages } from "@/hooks/useUserPackages";
import { useReferrals, formatEuros } from "@/hooks/useReferrals";
import { BookingModal } from "@/components/booking/BookingModal";
import { TherapistAvatar } from "@/components/dashboard/MyTherapist";

/** Days since the last session before we nudge a client to book again. */
const INACTIVE_DAYS = 21;

/**
 * Re-engagement card: shown to clients with nothing booked who either have
 * unused credit or haven't had a session in a while. Offers a one-tap rebook
 * with the therapist they saw last, so they never have to start from scratch.
 */
export function BookAgainPrompt() {
  const { user } = useAuth();
  const { appointments, loading } = useAcuityAppointments(user?.email);
  const { images: therapistImages } = useTherapistImages();
  const { totalRemainingSessions } = useActivePackages();
  const { data: referralData } = useReferrals();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [keepTherapist, setKeepTherapist] = useState(true);

  const { lastSession, hasUpcoming } = useMemo(() => {
    const active = appointments.filter((apt) => !apt.canceled);
    const past = active
      .filter((apt) => isPast(parseISO(apt.datetime)))
      .sort(
        (a, b) => parseISO(b.datetime).getTime() - parseISO(a.datetime).getTime()
      );
    return {
      lastSession: past[0] ?? null,
      hasUpcoming: active.some((apt) => !isPast(parseISO(apt.datetime))),
    };
  }, [appointments]);

  // Nothing to nudge about while loading, when a session is already booked, or
  // before the client has had a first session.
  if (loading || hasUpcoming || !lastSession) return null;

  const daysSinceLastSession = differenceInCalendarDays(
    new Date(),
    parseISO(lastSession.datetime)
  );
  const referralCreditCents = referralData?.balance_cents ?? 0;
  const hasSessionCredits = totalRemainingSessions > 0;
  const hasReferralCredit = referralCreditCents > 0;
  const isInactive = daysSinceLastSession >= INACTIVE_DAYS;

  if (!hasSessionCredits && !hasReferralCredit && !isInactive) return null;

  const firstName = lastSession.calendar.split(" ")[0];
  const weeksSinceLastSession = Math.floor(daysSinceLastSession / 7);

  const headline = hasSessionCredits
    ? `You have ${totalRemainingSessions} session credit${
        totalRemainingSessions === 1 ? "" : "s"
      } left`
    : hasReferralCredit
    ? `You have ${formatEuros(referralCreditCents)} credit to use`
    : "Ready for your next session?";

  const subline = hasSessionCredits
    ? `Use ${totalRemainingSessions === 1 ? "it" : "one"} to book your next session with ${firstName} — no payment needed.`
    : hasReferralCredit
    ? `It'll come off the price automatically when you book with ${firstName}.`
    : weeksSinceLastSession >= 1
    ? `It's been ${weeksSinceLastSession} week${
        weeksSinceLastSession === 1 ? "" : "s"
      } since your session with ${firstName}. Pick up where you left off.`
    : `Book your next session with ${firstName} and keep your momentum going.`;

  const openBooking = (withSameTherapist: boolean) => {
    setKeepTherapist(withSameTherapist);
    setBookingOpen(true);
  };

  return (
    <>
      <Card
        className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background animate-fade-in [overflow:clip] relative"
        style={{ animationDelay: "0.15s" }}
      >
        <div className="absolute top-0 right-0 w-24 h-24 sm:w-40 sm:h-40 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2" />

        <CardContent className="p-5 relative">
          <div className="flex items-start gap-4">
            <TherapistAvatar
              name={lastSession.calendar}
              calendarId={lastSession.calendarID}
              imageUrl={therapistImages.get(lastSession.calendarID)}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-heading font-semibold text-foreground text-base">
                  {headline}
                </h3>
                {hasSessionCredits && (
                  <Badge className="bg-success text-success-foreground border-0 shadow-sm">
                    <Sparkles className="h-3 w-3 mr-1" />
                    {totalRemainingSessions} left
                  </Badge>
                )}
                {!hasSessionCredits && hasReferralCredit && (
                  <Badge className="bg-success text-success-foreground border-0 shadow-sm">
                    <Gift className="h-3 w-3 mr-1" />
                    {formatEuros(referralCreditCents)}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{subline}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button
              className="flex-1 gap-2 shadow-soft"
              onClick={() => openBooking(true)}
            >
              <CalendarPlus className="h-4 w-4" />
              Book again with {firstName}
            </Button>
            <Button
              variant="outline"
              className="flex-1 bg-background/80"
              onClick={() => openBooking(false)}
            >
              Choose someone else
            </Button>
          </div>
        </CardContent>
      </Card>

      <BookingModal
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        preselectedCalendarId={keepTherapist ? lastSession.calendarID : undefined}
        preselectedCalendarName={keepTherapist ? lastSession.calendar : undefined}
      />
    </>
  );
}
