import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type SlotSource, fetchMonthDays, findFirstOpenMonth } from '@/lib/booking/availability';

// Availability changes as people book, so keep it fresh for a couple of minutes only.
const STALE_MS = 2 * 60_000;

function sourceKey(source: SlotSource | null) {
  return source ? [String(source.typeId), source.calendarId ?? null, !!source.psychologist] : [null];
}

/**
 * The first month with open times for one therapist's type (walking up to 12
 * months ahead). `data` is null when nothing is open in that range. Errors
 * surface so the wizard can show "We couldn't load {First}'s calendar".
 */
export function useFirstOpenMonth(source: SlotSource | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['book-first-month', ...sourceKey(source)],
    queryFn: async () => {
      const first = await findFirstOpenMonth(source!);
      // Seed the month cache so the calendar doesn't fetch the month again.
      if (first) queryClient.setQueryData(['book-month', ...sourceKey(source), first.month], first.days);
      return first;
    },
    enabled: !!source,
    staleTime: STALE_MS,
    retry: 1,
  });
}

/** Open days (with times) of one month ("yyyy-MM"), fetched when the calendar shows it. */
export function useMonthSlots(source: SlotSource | null, month: string | null) {
  return useQuery({
    queryKey: ['book-month', ...sourceKey(source), month],
    queryFn: () => fetchMonthDays(source!, month!),
    enabled: !!source && !!month,
    staleTime: STALE_MS,
    retry: 1,
  });
}

/** Drops cached availability for a source, e.g. after "That time was just taken". */
export function useInvalidateSlots() {
  const queryClient = useQueryClient();
  return (source: SlotSource | null) => {
    void queryClient.invalidateQueries({ queryKey: ['book-first-month', ...sourceKey(source)] });
    void queryClient.invalidateQueries({ queryKey: ['book-month', ...sourceKey(source)] });
  };
}
