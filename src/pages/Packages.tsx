import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import {
  parseBundleFunnelParams,
  readBundleFunnelIntent,
  saveBundleFunnelIntent,
} from '@/lib/bundleFunnel';

// Session storage key for package modal intent
export const SHOW_PACKAGES_INTENT_KEY = 'show-packages-modal';

export function setPackagesIntent() {
  sessionStorage.setItem(SHOW_PACKAGES_INTENT_KEY, 'true');
}

export function getAndClearPackagesIntent(): boolean {
  const intent = sessionStorage.getItem(SHOW_PACKAGES_INTENT_KEY);
  if (intent) {
    sessionStorage.removeItem(SHOW_PACKAGES_INTENT_KEY);
    return true;
  }
  return false;
}

export default function Packages() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (loading) return;

    // fettle.ie therapy-page link (?bundle=6&therapy=anxiety): remember the
    // choice across sign-in / registration, then run the onboarding funnel.
    const funnel = parseBundleFunnelParams(searchParams);
    if (funnel) {
      saveBundleFunnelIntent(funnel);
      navigate(user ? '/get-started' : '/login', { replace: true });
      return;
    }

    // Back from a redirect-based wallet (PaymentRedirectHandler sends package
    // purchases here) in the middle of the funnel: continue to the first session.
    if (user && readBundleFunnelIntent()) {
      navigate('/get-started', { replace: true });
      return;
    }

    // Always set intent so modal opens after reaching dashboard
    setPackagesIntent();

    if (user) {
      // User is logged in - go straight to dashboard (intent will trigger modal)
      navigate('/dashboard', { replace: true });
    } else {
      // User not logged in - redirect to login, intent is stored for after login
      navigate('/login', { replace: true });
    }
  }, [user, loading, navigate, searchParams]);

  // Show loading while determining auth state
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
