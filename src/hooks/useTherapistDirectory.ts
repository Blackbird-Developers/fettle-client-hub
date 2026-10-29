import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AcuityAppointmentType } from '@/hooks/useAcuity';
import type { TherapistRow } from '@/lib/booking/therapists';

const ACUITY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity`;
const ACUITY_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function fetchTherapistRows(): Promise<TherapistRow[]> {
  // therapists_duplicate lives in the fettleschema schema, which isn't in the
  // generated Supabase types (same as useTherapistImages).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .schema('fettleschema')
    .from('therapists_duplicate')
    .select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as TherapistRow[];
}

async function fetchAppointmentTypes(): Promise<AcuityAppointmentType[]> {
  const res = await fetch(`${ACUITY_BASE}?action=get-appointment-types`, {
    headers: { Authorization: `Bearer ${ACUITY_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to fetch appointment types');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Everything the booking wizard needs to know about therapists: the full
 * therapists_duplicate rows, and the Acuity appointment types (for prices,
 * durations and which types are public). Cached for the session.
 */
export function useTherapistDirectory() {
  const therapists = useQuery({
    queryKey: ['therapist-directory'],
    queryFn: fetchTherapistRows,
    staleTime: 30 * 60_000,
  });
  const types = useQuery({
    queryKey: ['acuity-appointment-types'],
    queryFn: fetchAppointmentTypes,
    staleTime: 30 * 60_000,
  });

  const { publicTypeIds, typeById } = useMemo(() => {
    const list = types.data ?? [];
    const byId = new Map<string, AcuityAppointmentType>();
    const publicIds = new Set<string>();
    for (const t of list) {
      byId.set(String(t.id), t);
      if (!t.private && t.active !== false) publicIds.add(String(t.id));
    }
    return { publicTypeIds: publicIds as ReadonlySet<string>, typeById: byId as ReadonlyMap<string, AcuityAppointmentType> };
  }, [types.data]);

  return {
    therapists: therapists.data ?? [],
    publicTypeIds,
    typeById,
    loading: therapists.isLoading || types.isLoading,
    error: therapists.error || types.error ? 'Could not load therapists' : null,
    refetch: () => {
      void therapists.refetch();
      void types.refetch();
    },
  };
}
