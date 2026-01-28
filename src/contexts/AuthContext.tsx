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
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ error: Error | null }>;
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
            fetchProfile(session.user.id);
          }, 0);
        } else {
          setProfile(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        fetchProfile(session.user.id);
        // Trigger Acuity sync once per browser session
        syncAcuityPackages(session.access_token, session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!error && data) {
      setProfile(data);
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

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          first_name: firstName,
          last_name: lastName,
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
