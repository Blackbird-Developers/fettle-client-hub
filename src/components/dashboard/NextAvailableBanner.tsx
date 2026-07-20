import { useState } from 'react';
import { Zap, ArrowRight, CalendarX, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BookingModal } from '@/components/booking/BookingModal';
import {
    useNextAvailable,
    resolveSlotCalendar,
    formatNextAvailable,
} from '@/hooks/useNextAvailable';
import { cn } from '@/lib/utils';

interface Preselect {
    type?: number;
    calendarId?: number;
    timeISO?: string;
}

/**
 * Prominent dashboard banner surfacing the earliest bookable individual therapy
 * slot. Clicking it resolves which therapist owns that slot and opens the
 * booking flow straight at the details/checkout step, with the therapist, date
 * and time preselected.
 */
export function NextAvailableBanner() {
    const [bookingOpen, setBookingOpen] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [preselect, setPreselect] = useState<Preselect>({});
    const { slot, loading, error, noAvailability } = useNextAvailable('individual');

    // Clickable only when we actually have a slot to jump into.
    const isActionable = !!slot;

    const openBooking = (next: Preselect) => {
        setPreselect(next);
        setBookingOpen(true);
    };

    const handleActivate = async () => {
        if (!slot || resolving) return;
        setResolving(true);
        try {
            // Find the exact therapist that owns the earliest slot so we can
            // drop the user straight onto checkout. If resolution fails we still
            // open the flow with the type preselected (therapist step).
            const resolved = await resolveSlotCalendar(
                slot.appointmentTypeId,
                slot.candidateCalendarIds ?? [],
                slot.isoDate
            );
            openBooking({
                type: slot.appointmentTypeId,
                calendarId: resolved?.calendarId,
                timeISO: resolved?.time,
            });
        } finally {
            setResolving(false);
        }
    };

    return (
        <>
            <Card
                role={isActionable ? 'button' : undefined}
                tabIndex={isActionable ? 0 : undefined}
                onClick={isActionable ? handleActivate : undefined}
                onKeyDown={
                    isActionable
                        ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleActivate();
                              }
                          }
                        : undefined
                }
                className={cn(
                    'border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent overflow-hidden animate-fade-in',
                    isActionable &&
                        'cursor-pointer transition-shadow hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
                )}
            >
                <div className="flex items-center gap-3 p-3 sm:p-4 min-w-0">
                    <div className="p-2 sm:p-2.5 rounded-xl bg-primary/10 shrink-0">
                        {noAvailability ? (
                            <CalendarX className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                        ) : (
                            <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                        )}
                    </div>

                    <div className="min-w-0 flex-1">
                        {loading ? (
                            <>
                                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    Next available appointment
                                </p>
                                <Skeleton className="h-5 w-40 sm:w-56 mt-1" />
                            </>
                        ) : slot ? (
                            <>
                                <p className="text-[10px] sm:text-xs font-medium text-primary uppercase tracking-wide">
                                    Next available appointment
                                </p>
                                <p className="text-sm sm:text-base font-heading font-semibold text-card-foreground truncate">
                                    {formatNextAvailable(slot.time)}
                                </p>
                            </>
                        ) : error ? (
                            <>
                                <p className="text-sm font-medium text-card-foreground">
                                    Availability unavailable right now
                                </p>
                                <p className="text-[11px] sm:text-xs text-muted-foreground">
                                    Open the calendar to find a time
                                </p>
                            </>
                        ) : (
                            // noAvailability
                            <>
                                <p className="text-sm font-medium text-card-foreground">
                                    No immediate availability
                                </p>
                                <p className="text-[11px] sm:text-xs text-muted-foreground">
                                    Check the calendar for later dates
                                </p>
                            </>
                        )}
                    </div>

                    {isActionable ? (
                        <div className="flex items-center gap-1 text-sm font-medium text-primary shrink-0">
                            {resolving ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="hidden sm:inline">
                                        Finding therapist…
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="hidden sm:inline">
                                        Book now
                                    </span>
                                    <ArrowRight className="h-4 w-4" />
                                </>
                            )}
                        </div>
                    ) : (
                        !loading && (
                            <button
                                type="button"
                                onClick={() => openBooking({})}
                                className="flex items-center gap-1 text-xs sm:text-sm font-medium text-primary hover:underline shrink-0"
                            >
                                Open calendar
                                <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                        )
                    )}
                </div>
            </Card>

            <BookingModal
                open={bookingOpen}
                onOpenChange={setBookingOpen}
                sessionCategory="individual"
                preselectedType={preselect.type}
                preselectedCalendarId={preselect.calendarId}
                preselectedTimeISO={preselect.timeISO}
            />
        </>
    );
}
