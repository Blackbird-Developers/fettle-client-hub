import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

interface Profile {
  id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  timezone: string | null;
  created_at: string;
}

// Detect user's browser timezone
function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, firstName: string, lastName: string, referralCode?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Session-based sync: clears when browser closes, persists across page navigations
const SYNC_SESSION_KEY = 'acuity-sync-done';

function hasAlreadySyncedThisSession(): boolean {
  return sessionStorage.getItem(SYNC_SESSION_KEY) === 'true';
}

function markSyncedThisSession(): void {
  sessionStorage.setItem(SYNC_SESSION_KEY, 'true');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const syncTriggeredRef = useRef(false);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        // Defer profile fetch with setTimeout to avoid deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user);
          }, 0);
        } else {
          setProfile(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // Ensure profile exists BEFORE Acuity sync — the PUSH phase
        // needs first_name/last_name to create the cert
        await fetchProfile(session.user);
        syncAcuityPackages(session.access_token, session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Extract first/last name from whatever shape auth metadata provides
  // (matches the handle_new_user DB trigger logic):
  //   - email/password signup → first_name / last_name
  //   - Google OAuth          → given_name / family_name
  //   - anything else         → split `name` / `full_name` on first space
  const extractNames = (user: User): { first_name: string | null; last_name: string | null } => {
    const meta = (user.user_metadata || {}) as Record<string, string | undefined>;
    let first = meta.first_name || meta.given_name || null;
    let last = meta.last_name || meta.family_name || null;

    if (!first || !last) {
      const full = (meta.name || meta.full_name || '').trim();
      if (full) {
        const spaceIdx = full.indexOf(' ');
        if (!first) first = spaceIdx > 0 ? full.slice(0, spaceIdx) : full;
        if (!last && spaceIdx > 0) last = full.slice(spaceIdx + 1).trim() || null;
      }
    }
    return { first_name: first, last_name: last };
  };

  const fetchProfile = async (user: User) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[Profile] Fetch failed:', error);
      return;
    }

    let profileRow = data;

    // Orphaned auth user (pre-trigger signup, or trigger failed). Self-heal
    // by creating the profile from auth metadata so downstream features
    // (Acuity sync, bookings, package balance) work.
    if (!profileRow) {
      const { first_name, last_name } = extractNames(user);
      console.log('[Profile] Missing profile — creating from auth metadata', { user_id: user.id, email: user.email });

      const { data: created, error: insertErr } = await supabase
        .from('profiles')
        .insert({
          user_id: user.id,
          email: user.email ?? '',
          first_name,
          last_name,
        })
        .select()
        .single();

      if (insertErr) {
        // 23505 = unique_violation — another tab/request beat us. Re-read.
        if (insertErr.code === '23505') {
          const { data: retry } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          profileRow = retry ?? null;
        } else {
          console.error('[Profile] Insert failed:', insertErr);
          return;
        }
      } else {
        profileRow = created;
      }
    }

    if (!profileRow) return;
    setProfile(profileRow);

    const browserTimezone = getBrowserTimezone();
    if (profileRow.timezone !== browserTimezone) {
      updateTimezone(user.id, browserTimezone);
    }
  };

  // Update user's timezone in the database
  const updateTimezone = async (userId: string, timezone: string) => {
    const { error } = await supabase
      .from('profiles')
      .update({ timezone })
      .eq('user_id', userId);

    if (!error) {
      setProfile(prev => prev ? { ...prev, timezone } : null);
    }
  };

  // Sync Acuity packages once per browser session
  const syncAcuityPackages = async (accessToken: string, userId: string) => {
    // Prevent multiple sync attempts in the same render cycle
    if (syncTriggeredRef.current || hasAlreadySyncedThisSession()) return;

    syncTriggeredRef.current = true;
    markSyncedThisSession();

    try {
      console.log('[Acuity Sync] Starting session sync...');

      const result = await supabase.functions.invoke('sync-acuity-packages', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (result.error) {
        console.log('[Acuity Sync] Sync skipped:', result.error.message);
      } else if (result.data?.synced > 0) {
        console.log(`[Acuity Sync] Synced ${result.data.synced} packages from Acuity`);
        // Invalidate packages query to refresh data across the app
        queryClient.invalidateQueries({ queryKey: ['user-packages', userId] });
      } else if (result.data?.skipped) {
        console.log('[Acuity Sync] Sync skipped due to API timeout');
      } else {
        console.log('[Acuity Sync] No new packages to sync');
      }
    } catch (err) {
      console.log('[Acuity Sync] Sync failed silently:', err);
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string, referralCode?: string) => {
    const redirectUrl = `${window.location.origin}/`;

    const normalizedCode = referralCode?.trim().toUpperCase();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          first_name: firstName,
          last_name: lastName,
          // Picked up by the handle_new_user() trigger to attribute the referral.
          ...(normalizedCode ? { referral_code: normalizedCode } : {}),
        },
      },
    });

    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error: error as Error | null };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signUp, signIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
