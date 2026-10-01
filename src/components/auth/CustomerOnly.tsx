import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useIsAdmin } from '@/hooks/useAdmin';
import { Loader2 } from 'lucide-react';

interface CustomerOnlyProps {
  children: React.ReactNode;
}

// Admins only use the admin area, so customer pages send them to /admin.
// Logged-out visitors and customers see the page as normal.
export function CustomerOnly({ children }: CustomerOnlyProps) {
  const { user, loading } = useAuth();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin();

  if (loading || (user && roleLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user && isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
