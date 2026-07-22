import { useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import {
    useNextAvailable,
    formatNextAvailableShort,
    type BookingCategory,
    type NextAvailableSlot,
} from '@/hooks/useNextAvailable';

/**
 * Compact "Next available: …" line for a single appointment type, shown under
 * the option's name in the booking modal's selection cards. Results are cached
 * per type (react-query), so revisiting the step doesn't re-hit Acuity.
 *
 * When `onPick` is provided the hint becomes clickable and hands the slot to
 * the parent, which jumps the wizard straight to that slot. Rendered as a span
 * (not a button) because it usually sits inside the card's own <button>.
 */
export function NextAvailableTypeHint({
    category,
    typeId,
    calendarId,
    enabled = true,
    onPick,
}: {
    category: BookingCategory;
    typeId: number;
    /** Restrict to a single therapist's calendar (e.g. rebooking). */
    calendarId?: number | null;
    enabled?: boolean;
    /** Jump straight to this slot (may resolve the owning therapist first). */
    onPick?: (slot: NextAvailableSlot) => void | Promise<void>;
}) {
    const { slot, loading, noAvailability } = useNextAvailable(category, {
        enabled,
        calendarId,
        typeFilter: (t) => t.id === typeId,
    });
    const [picking, setPicking] = useState(false);

    if (!enabled) return null;

    let text: string;
    if (picking) text = 'Opening…';
    else if (loading) text = 'Checking availability…';
    else if (slot) text = `Next available: ${formatNextAvailableShort(slot.time)}`;
    else if (noAvailability) text = 'No immediate availability';
    else return null; // error — stay quiet rather than show a broken hint

    const clickable = !!onPick && !!slot && !picking;

    const handleClick = async (e: React.MouseEvent) => {
        // The hint sits inside the card's own click target — don't let a slot
        // pick also trigger the card's normal selection path.
        e.stopPropagation();
        e.preventDefault();
        if (!onPick || !slot) return;
        setPicking(true);
        try {
            await onPick(slot);
        } finally {
            setPicking(false);
        }
    };

    return (
        <span
            onClick={clickable ? handleClick : undefined}
            className={
                'mt-1 flex items-start gap-1 text-[11px] leading-snug text-primary/80' +
                (clickable
                    ? ' cursor-pointer hover:text-primary hover:underline'
                    : '')
            }>
            {picking ? (
                <Loader2 className="h-3 w-3 shrink-0 mt-0.5 animate-spin" />
            ) : (
                <Zap className="h-3 w-3 shrink-0 mt-0.5" />
            )}
            <span>{text}</span>
        </span>
    );
}
