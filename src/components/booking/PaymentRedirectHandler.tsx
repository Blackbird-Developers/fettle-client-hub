import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaymentRedirectReturn } from '@/hooks/usePaymentRedirectReturn';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

/**
 * Renders a full-screen overlay when handling a redirect return from
 * Revolut Pay, PayPal, or other redirect-based payment methods.
 * Mount this inside <BrowserRouter> so it runs on every page load.
 */
export function PaymentRedirectHandler() {
  const { isHandling, status, message, type } = usePaymentRedirectReturn();
  const navigate = useNavigate();

  // Auto-navigate after success/error
  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => {
        if (type === 'package') {
          navigate('/packages', { replace: true });
        } else {
          navigate('/sessions', { replace: true });
        }
      }, 2500);
      return () => clearTimeout(timer);
    }
    if (status === 'error') {
      const timer = setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [status, type, navigate]);

  if (!isHandling && status === 'idle') return null;

  if (isHandling) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <h2 className="text-xl font-heading font-semibold">Completing your booking...</h2>
          <p className="text-muted-foreground">Please wait while we confirm your payment.</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-heading font-semibold">
            {type === 'package' ? 'Package Activated!' : 'Booking Confirmed!'}
          </h2>
          <p className="text-muted-foreground">
            {type === 'package'
              ? 'Your package has been activated. Redirecting...'
              : 'Your session has been booked successfully. Redirecting...'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <XCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-xl font-heading font-semibold">Payment Issue</h2>
          <p className="text-muted-foreground">{message || 'Something went wrong. Please contact support.'}</p>
        </div>
      </div>
    );
  }

  return null;
}
