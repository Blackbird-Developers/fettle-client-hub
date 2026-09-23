import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { AcuityAvailableTime } from '@/hooks/useAcuity';
import { fetchDates, fetchTimes } from '@/hooks/useNextAvailable';

/**
 * Availability pooled across therapists, for booking without choosing a
 * therapist first: the client picks a date and time and is booked with a
 * therapist who is free then (like fettle.ie's "next available" booking).
 */

/** An appointment type on one therapist's calendar. */
export interface PoolOwner {
    typeId: number;
    calendarId: number;
}

const POOL_STALE_MS = 60 * 1000;

const ownerKey = (owner: PoolOwner) => `${owner.typeId}:${owner.calendarId}`;
const toEpoch = (time: string) => new Date(time).getTime();

function pickRandom<T>(items: T[]): T | undefined {
    return items[Math.floor(Math.random() * items.length)];
}

/**
 * Days in `month` (yyyy-MM) on which any owner has availability. Used for
 * youth and couples sessions, whose Acuity types are one per therapist.
 */
export function usePooledDates(owners: PoolOwner[], month: string, enabled: boolean) {
    const query = useQuery({
        queryKey: ['pooled-dates', month, owners.map(ownerKey)],
        queryFn: async () => {
            const perOwner = await Promise.all(
                owners.map(async (owner) => ({
                    owner,
                    dates: await fetchDates(owner.typeId, month, owner.calendarId),
                }))
            );
            const ownersByDate: Record<string, PoolOwner[]> = {};
            for (const { owner, dates } of perOwner) {
                for (const date of dates) {
                    (ownersByDate[date] ??= []).push(owner);
                }
            }
            return ownersByDate;
        },
        enabled: enabled && owners.length > 0,
        staleTime: POOL_STALE_MS,
    });

    return {
        ownersByDate: query.data ?? {},
        loading: enabled && owners.length > 0 && query.data === undefined,
    };
}

/**
 * Bookable times on `date` (yyyy-MM-dd) across `owners`, each with the owners
 * free at that time.
 */
export function usePooledTimes(owners: PoolOwner[], date: string | null, enabled: boolean) {
    const query = useQuery({
        queryKey: ['pooled-times', date, owners.map(ownerKey)],
        queryFn: async () => {
            const perOwner = await Promise.all(
                owners.map(async (owner) => ({
                    owner,
                    slots: await fetchTimes(owner.typeId, date!, owner.calendarId),
                }))
            );
            const byEpoch = new Map<number, { time: string; owners: PoolOwner[] }>();
            for (const { owner, slots } of perOwner) {
                for (const slot of slots) {
                    const epoch = toEpoch(slot.time);
                    if (Number.isNaN(epoch)) continue;
                    const entry = byEpoch.get(epoch);
                    if (entry) entry.owners.push(owner);
                    else byEpoch.set(epoch, { time: slot.time, owners: [owner] });
                }
            }
            return [...byEpoch.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, entry]) => entry);
        },
        enabled: enabled && !!date && owners.length > 0,
        staleTime: POOL_STALE_MS,
    });

    const entries = useMemo(() => query.data ?? [], [query.data]);
    const times: AcuityAvailableTime[] = useMemo(
        () => entries.map((e) => ({ time: e.time, slotsAvailable: e.owners.length })),
        [entries]
    );
    const ownersByTime = useMemo(
        () => Object.fromEntries(entries.map((e) => [e.time, e.owners])),
        [entries]
    ) as Record<string, PoolOwner[]>;

    return {
        times,
        ownersByTime,
        loading: enabled && !!date && owners.length > 0 && query.data === undefined,
        refetch: query.refetch,
    };
}

/** One of the owners free at a pooled slot, chosen at random to share bookings out. */
export function pickPoolOwner(owners: PoolOwner[] | undefined): PoolOwner | null {
    return (owners && pickRandom(owners)) ?? null;
}

/**
 * Which of a type's calendars are free at each time on `date`, as
 * [epoch, calendarIds] pairs. Acuity's pooled availability for a type doesn't
 * say whose slot it is, so every calendar is asked in parallel (about as fast
 * as a single call).
 */
function calendarDayQuery(typeId: number, calendarIds: number[], date: string) {
    return {
        queryKey: ['calendar-day-times', typeId, date, calendarIds],
        queryFn: async (): Promise<[number, number[]][]> => {
            const perCalendar = await Promise.all(
                calendarIds.map(async (calendarId) => ({
                    calendarId,
                    slots: await fetchTimes(typeId, date, calendarId),
                }))
            );
            const byEpoch = new Map<number, number[]>();
            for (const { calendarId, slots } of perCalendar) {
                for (const slot of slots) {
                    const epoch = toEpoch(slot.time);
                    if (Number.isNaN(epoch)) continue;
                    const list = byEpoch.get(epoch);
                    if (list) list.push(calendarId);
                    else byEpoch.set(epoch, [calendarId]);
                }
            }
            return [...byEpoch.entries()];
        },
        staleTime: POOL_STALE_MS,
    };
}

/**
 * Loads who is free on `date` while the client looks at the times, so the
 * therapist can be assigned the moment they pick one.
 */
export function usePrefetchCalendarDay(
    typeId: number | null,
    calendarIds: number[],
    date: string | null,
    enabled: boolean
) {
    useQuery({
        ...calendarDayQuery(typeId ?? 0, calendarIds, date ?? ''),
        enabled: enabled && !!typeId && !!date && calendarIds.length > 0,
    });
}

/**
 * A therapist (calendar) offering `typeId` at exactly `time` on `date`, chosen
 * at random among those free to share bookings out. Null when nobody is free
 * any more.
 */
export async function findFreeCalendar(
    queryClient: QueryClient,
    typeId: number,
    calendarIds: number[],
    date: string,
    time: string
): Promise<number | null> {
    if (calendarIds.length === 0) return null;
    const freeByEpoch = await queryClient.fetchQuery(
        calendarDayQuery(typeId, calendarIds, date)
    );
    const target = toEpoch(time);
    const free = freeByEpoch.find(([epoch]) => epoch === target)?.[1] ?? [];
    return pickRandom(free) ?? null;
}
