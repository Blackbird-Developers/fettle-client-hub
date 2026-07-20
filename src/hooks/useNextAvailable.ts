import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addMonths } from 'date-fns';
import {
    useAcuityAppointmentTypes,
    type AcuityAppointmentType,
    type AcuityAvailableTime,
} from '@/hooks/useAcuity';

/**
 * Booking categories the hub can surface "next available" for. This is a
 * superset of BookingModal's SessionCategory so it can also cover the new
 * assessment booking category without creating an import cycle with the modal.
 */
export type BookingCategory = 'individual' | 'couples' | 'youth' | 'assessment';

export interface NextAvailableSlot {
    /** Acuity appointment type that owns the earliest slot. */
    appointmentTypeId: number;
    appointmentTypeName: string;
    /** Calendar (therapist) for the slot, when it can be determined. */
    calendarId?: number;
    /** ISO date of the day the slot falls on, e.g. "2026-07-17". */
    isoDate: string;
    /** Full ISO datetime of the slot (with timezone offset from Acuity). */
    time: string;
    slotsAvailable?: number;
    /**
     * All calendars the winning appointment type is offered on. The pooled
     * availability response doesn't say which therapist owns the earliest slot,
     * so this is used to resolve the exact calendar on demand (see
     * resolveSlotCalendar) before jumping the user straight to checkout.
     */
    candidateCalendarIds?: number[];
}

// A single Acuity availability call per type per month is cheap (dates only), so
// we cap how many appointment types we fan out over to keep the dashboard fast
// even for categories that have grown to many therapist-specific types. Sized to
// comfortably cover today's category sizes (~25 individual types) with headroom.
const MAX_TYPES = 40;
// Bounds on the get-times fan-out when finding the first day that has a future
// slot: how many distinct days to walk (earliest first) and how many types to
// try per day before moving on. Keeps the worst case (a fully booked-out today)
// from ballooning into many calls.
const MAX_DAYS_PROBED = 5;
const MAX_TYPES_PER_DAY = 3;
// When resolving which therapist owns a pooled slot, how many of the type's
// calendars to probe. Browsers cap concurrent requests per host (~6) so these
// run in waves; the number just bounds the worst case.
const MAX_CALENDARS = 60;

const ACUITY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity`;
const ACUITY_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const authHeaders = {
    Authorization: `Bearer ${ACUITY_KEY}`,
    'Content-Type': 'application/json',
};

/**
 * Decide whether an appointment type belongs to a booking category. Mirrors the
 * category → name-prefix mapping used in BookingModal so the "next available"
 * hint always reflects the same set of types the booking flow will offer.
 */
export function matchesCategory(
    type: AcuityAppointmentType,
    category: BookingCategory
): boolean {
    const name = type.name ?? '';
    switch (category) {
        case 'couples':
            return name.startsWith("Couple's Therapy Session");
        case 'youth':
            return name.startsWith('Youth Therapy - Individual Session');
        case 'assessment':
            // Assessment types come from a sibling task; match defensively by
            // name until a firmer convention exists. Callers can override via
            // the `typeFilter` option below.
            return name.toLowerCase().includes('assessment');
        default: // individual
            return name.startsWith('Individual Therapy Session');
    }
}

async function fetchDates(
    appointmentTypeId: number,
    month: string,
    calendarId?: number | null
): Promise<string[]> {
    try {
        let url = `${ACUITY_BASE}?action=get-availability&appointmentTypeId=${appointmentTypeId}&month=${month}`;
        if (calendarId) url += `&calendarId=${calendarId}`;
        const res = await fetch(url, { headers: authHeaders });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data
            .map((d: { date?: string }) => d?.date)
            .filter((d): d is string => typeof d === 'string');
    } catch {
        // A single type failing to load should never break the whole hint.
        return [];
    }
}

interface AcuityTimeSlot extends AcuityAvailableTime {
    calendarID?: number;
}

async function fetchTimes(
    appointmentTypeId: number,
    date: string,
    calendarId?: number | null
): Promise<AcuityTimeSlot[]> {
    try {
        let url = `${ACUITY_BASE}?action=get-times&appointmentTypeId=${appointmentTypeId}&date=${date}`;
        if (calendarId) url += `&calendarId=${calendarId}`;
        const res = await fetch(url, { headers: authHeaders });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

/** Drop any slot that is in the past (handles "today" with all past times). */
function futureTimes(times: AcuityTimeSlot[]): AcuityTimeSlot[] {
    const now = Date.now();
    return times.filter((t) => {
        const ts = new Date(t.time).getTime();
        return !Number.isNaN(ts) && ts > now;
    });
}

/**
 * Core availability search: find the earliest bookable slot across a set of
 * appointment types. Checks the current month first, then next month, and
 * probes candidate days (earliest first) until one yields a future time.
 */
async function findEarliestSlot(
    types: AcuityAppointmentType[],
    calendarId?: number | null
): Promise<NextAvailableSlot | null> {
    if (types.length === 0) return null;

    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const months = [
        format(now, 'yyyy-MM'),
        format(addMonths(now, 1), 'yyyy-MM'),
    ];

    for (const month of months) {
        // Dates-only calls for every type in the category, in parallel.
        const perType = await Promise.all(
            types.map(async (type) => ({
                type,
                dates: await fetchDates(type.id, month, calendarId),
            }))
        );

        // Group types by day so we can walk distinct days earliest-first. This
        // matters at the end of a day: "today" may be offered by many types but
        // fully in the past, and we must fall through to the next day rather
        // than exhaust our probes re-checking today across every type.
        const typesByDay = new Map<string, AcuityAppointmentType[]>();
        for (const { type, dates } of perType) {
            for (const date of dates) {
                if (date < todayStr) continue;
                const list = typesByDay.get(date);
                if (list) list.push(type);
                else typesByDay.set(date, [type]);
            }
        }
        const sortedDays = [...typesByDay.keys()].sort();

        for (let d = 0; d < sortedDays.length && d < MAX_DAYS_PROBED; d++) {
            const date = sortedDays[d];
            const dayTypes = typesByDay.get(date)!.slice(0, MAX_TYPES_PER_DAY);

            // Fetch times for each candidate type on this day in parallel, then
            // pick the single earliest future slot across them.
            const perTypeSlots = await Promise.all(
                dayTypes.map(async (type) => ({
                    type,
                    slots: futureTimes(await fetchTimes(type.id, date, calendarId)),
                }))
            );

            let best: { type: AcuityAppointmentType; slot: AcuityTimeSlot } | null =
                null;
            for (const { type, slots } of perTypeSlots) {
                for (const slot of slots) {
                    if (!best || slot.time < best.slot.time) {
                        best = { type, slot };
                    }
                }
            }

            if (best) {
                return {
                    appointmentTypeId: best.type.id,
                    appointmentTypeName: best.type.name,
                    calendarId:
                        best.slot.calendarID ??
                        calendarId ??
                        best.type.calendarIDs?.[0],
                    isoDate: date,
                    time: best.slot.time,
                    slotsAvailable: best.slot.slotsAvailable,
                    candidateCalendarIds: best.type.calendarIDs ?? [],
                };
            }
        }
    }

    return null;
}

/**
 * Resolve which therapist (calendar) actually owns a pooled slot. Pooled
 * availability gives us the earliest time for an appointment type but not the
 * calendar, so we probe the type's calendars for that day and return the one
 * with the earliest bookable time. Run on demand (e.g. on click) rather than
 * up front, since a popular type can span many calendars.
 */
export async function resolveSlotCalendar(
    appointmentTypeId: number,
    calendarIds: number[],
    isoDate: string
): Promise<{ calendarId: number; time: string } | null> {
    if (!calendarIds.length) return null;

    const results = await Promise.all(
        calendarIds.slice(0, MAX_CALENDARS).map(async (calendarId) => {
            const slots = futureTimes(
                await fetchTimes(appointmentTypeId, isoDate, calendarId)
            );
            return slots.length > 0
                ? { calendarId, time: slots[0].time }
                : null;
        })
    );

    const valid = results.filter(
        (r): r is { calendarId: number; time: string } => r !== null
    );
    if (valid.length === 0) return null;

    valid.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return valid[0];
}

export interface UseNextAvailableOptions {
    /** Pause the query (e.g. until a dropdown/menu is opened). Defaults to true. */
    enabled?: boolean;
    /** Restrict to a single therapist's calendar. */
    calendarId?: number | null;
    /** Override the default category → type matcher. */
    typeFilter?: (type: AcuityAppointmentType) => boolean;
}

export interface UseNextAvailableResult {
    slot: NextAvailableSlot | null;
    loading: boolean;
    error: string | null;
    /** True once loaded successfully with no bookable slot in range. */
    noAvailability: boolean;
    refetch: () => void;
}

/**
 * Reusable hook returning the earliest bookable Acuity slot for a booking
 * category. Results are cached (react-query) so repeated renders and multiple
 * placements don't re-hit Acuity, keeping the dashboard responsive.
 */
export function useNextAvailable(
    category: BookingCategory,
    options: UseNextAvailableOptions = {}
): UseNextAvailableResult {
    const { enabled = true, calendarId, typeFilter } = options;
    const { types, loading: typesLoading, error: typesError } =
        useAcuityAppointmentTypes();

    const matchedTypes = useMemo(() => {
        const predicate =
            typeFilter ?? ((t: AcuityAppointmentType) => matchesCategory(t, category));
        return types.filter(predicate).slice(0, MAX_TYPES);
    }, [types, category, typeFilter]);

    const typeIds = matchedTypes.map((t) => t.id);

    const query = useQuery({
        queryKey: ['next-available', category, calendarId ?? null, typeIds],
        queryFn: () => findEarliestSlot(matchedTypes, calendarId),
        enabled: enabled && !typesLoading && matchedTypes.length > 0,
        staleTime: 5 * 60 * 1000, // 5 min — availability changes slowly
        gcTime: 10 * 60 * 1000,
        retry: 1,
    });

    const loading =
        enabled &&
        (typesLoading || (query.isFetching && query.data === undefined));
    const error = typesError
        ? typesError
        : query.isError
        ? 'Unable to load availability'
        : null;

    return {
        slot: query.data ?? null,
        loading,
        error,
        noAvailability:
            !loading &&
            !error &&
            matchedTypes.length >= 0 &&
            query.isSuccess &&
            !query.data,
        refetch: query.refetch,
    };
}

/**
 * Format a slot's ISO datetime for Irish users, e.g. "1:00pm, Friday 17 July".
 */
export function formatNextAvailable(isoTime: string): string {
    const d = new Date(isoTime);
    if (Number.isNaN(d.getTime())) return '';
    return format(d, "h:mmaaa',' EEEE d MMMM");
}

/**
 * Compact variant for tight spaces (e.g. dropdown hints), e.g.
 * "6:00pm, Mon 20 Jul".
 */
export function formatNextAvailableShort(isoTime: string): string {
    const d = new Date(isoTime);
    if (Number.isNaN(d.getTime())) return '';
    return format(d, "h:mmaaa',' EEE d MMM");
}
