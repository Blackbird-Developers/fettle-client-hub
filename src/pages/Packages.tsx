import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

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

  useEffect(() => {
    if (loading) return;

    // Always set intent so modal opens after reaching dashboard
    setPackagesIntent();

    if (user) {
      // User is logged in - go straight to dashboard (intent will trigger modal)
      navigate('/dashboard', { replace: true });
    } else {
      // User not logged in - redirect to login, intent is stored for after login
      navigate('/login', { replace: true });
    }
  }, [user, loading, navigate]);

  // Show loading while determining auth state
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
