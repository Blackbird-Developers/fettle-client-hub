import { Zap } from 'lucide-react';
import {
    useNextAvailable,
    formatNextAvailableShort,
    type BookingCategory,
} from '@/hooks/useNextAvailable';

/**
 * Compact "Next available: …" line for a single appointment type, shown under
 * the option's name in the booking modal's selection cards. Results are cached
 * per type (react-query), so revisiting the step doesn't re-hit Acuity.
 */
export function NextAvailableTypeHint({
    category,
    typeId,
    calendarId,
    enabled = true,
}: {
    category: BookingCategory;
    typeId: number;
    /** Restrict to a single therapist's calendar (e.g. rebooking). */
    calendarId?: number | null;
    enabled?: boolean;
}) {
    const { slot, loading, noAvailability } = useNextAvailable(category, {
        enabled,
        calendarId,
        typeFilter: (t) => t.id === typeId,
    });

    if (!enabled) return null;

    let text: string;
    if (loading) text = 'Checking availability…';
    else if (slot) text = `Next available: ${formatNextAvailableShort(slot.time)}`;
    else if (noAvailability) text = 'No immediate availability';
    else return null; // error — stay quiet rather than show a broken hint

    return (
        <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-primary/80">
            <Zap className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{text}</span>
        </span>
    );
}
