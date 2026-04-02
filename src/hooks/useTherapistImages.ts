import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TherapistProfile {
  imageurl: string | null;
  tags: string[];
  accreditation: string | null;
}

// Singleton cache so we only fetch once across the entire app
let therapistCache: Map<number, TherapistProfile> | null = null;
let fetchPromise: Promise<Map<number, TherapistProfile>> | null = null;

async function fetchTherapistData(): Promise<Map<number, TherapistProfile>> {
  if (therapistCache) return therapistCache;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      // Query the therapists_duplicate table from the fettleschema schema in Supabase
      const { data, error } = await (supabase as any)
        .schema('fettleschema')
        .from('therapists_duplicate')
        .select('calendarid, imageurl, tags, tags2, Accreditation');

      if (error) {
        console.error('[TherapistImages] Supabase error:', error.message);
        return new Map<number, TherapistProfile>();
      }

      const map = new Map<number, TherapistProfile>();
      for (const t of data || []) {
        const row = t as any;
        if (row.calendarid) {
          // Combine tags from both array and comma-separated fields
          const allTags: string[] = [];
          if (Array.isArray(row.tags)) {
            allTags.push(...row.tags.filter(Boolean));
          }
          if (row.tags2 && typeof row.tags2 === 'string') {
            allTags.push(
              ...row.tags2
                .split(',')
                .map((t: string) => t.trim())
                .filter(Boolean)
            );
          }
          const uniqueTags = [...new Set(allTags)];

          map.set(Number(row.calendarid), {
            imageurl: row.imageurl || null,
            tags: uniqueTags,
            accreditation: row.Accreditation || null,
          });
        }
      }

      console.log('[TherapistImages] Loaded', map.size, 'therapist profiles');
      therapistCache = map;
      return map;
    } catch (err) {
      console.error('[TherapistImages] Failed to fetch:', err);
      fetchPromise = null; // allow retry on error
      return new Map<number, TherapistProfile>();
    }
  })();

  return fetchPromise;
}

/**
 * Hook that returns a map of calendarID → TherapistProfile for all therapists.
 * Fetches directly from the therapists_duplicate table in Supabase (fettleschema).
 * Cached globally so it only fetches once per page load.
 */
export function useTherapistImages() {
  const [profiles, setProfiles] = useState<Map<number, TherapistProfile>>(
    () => therapistCache || new Map()
  );
  const [loading, setLoading] = useState(!therapistCache);

  useEffect(() => {
    let cancelled = false;

    fetchTherapistData().then((map) => {
      if (!cancelled) {
        setProfiles(map);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Convenience: get just the image URL map (backwards-compatible) */
  const images = new Map<number, string>();
  for (const [id, profile] of profiles) {
    if (profile.imageurl) {
      images.set(id, profile.imageurl);
    }
  }

  return { images, profiles, loading };
}
