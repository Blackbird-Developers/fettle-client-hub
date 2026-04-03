import { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

interface RedirectState {
  isHandling: boolean;
  status: 'idle' | 'processing' | 'success' | 'error';
  message?: string;
  type?: 'session' | 'package';
}

/**
 * Handles the return from redirect-based payment methods (Revolut, PayPal, etc.).
 * When Stripe redirects the user back, the URL contains payment_intent params.
 * This hook detects those params, verifies the payment, and completes the booking.
 *
 * IMPORTANT: sessionStorage may be cleared by the browser during cross-origin
 * redirects (Revolut, PayPal). When that happens, we try BOTH backend endpoints
 * since the backend can determine the payment type from Stripe metadata.
 */
export function usePaymentRedirectReturn() {
  const { toast } = useToast();
  const [state, setState] = useState<RedirectState>({
    isHandling: false,
    status: 'idle',
  });

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const clientSecret = urlParams.get('payment_intent_client_secret');
    const paymentIntentIdFromUrl = urlParams.get('payment_intent');

    if (!clientSecret || !paymentIntentIdFromUrl) return;

    handleRedirectReturn(clientSecret, paymentIntentIdFromUrl);
  }, []);

  async function handleRedirectReturn(clientSecret: string, paymentIntentIdFromUrl: string) {
    setState({ isHandling: true, status: 'processing' });

    // Clean URL immediately so a refresh won't re-trigger
    const cleanUrl = window.location.origin + window.location.pathname + (window.location.hash || '');
    window.history.replaceState({}, document.title, cleanUrl);

    // Try to restore persisted booking data from sessionStorage
    let savedType: 'session' | 'package' | null = null;
    let savedPaymentIntentId: string | null = null;
    try {
      const raw = sessionStorage.getItem('fettleRedirectPayment');
      if (raw) {
        const savedData = JSON.parse(raw);
        // Check if not too old (30 min max)
        if (Date.now() - savedData.savedAt <= 30 * 60 * 1000) {
          savedType = savedData.type as 'session' | 'package';
          savedPaymentIntentId = savedData.paymentIntentId;
          console.log('Restored payment redirect data from sessionStorage:', savedType);
        } else {
          console.log('sessionStorage data expired, will try both endpoints');
        }
      } else {
        console.log('No sessionStorage data (cleared during redirect), will try both endpoints');
      }
    } catch (e) {
      console.error('Failed to parse saved payment data:', e);
    }

    const paymentIntentId = savedPaymentIntentId || paymentIntentIdFromUrl;

    try {
      if (!stripePublishableKey) {
        throw new Error('Stripe is not configured');
      }

      const stripe = await loadStripe(stripePublishableKey);
      if (!stripe) {
        throw new Error('Failed to load Stripe');
      }

      // Retrieve the payment intent to check its status
      const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);

      if (error) {
        console.error('Error retrieving payment intent:', error);
        throw new Error('Could not verify your payment. Please contact support.');
      }

      console.log('Retrieved PaymentIntent after redirect:', paymentIntent.id, 'status:', paymentIntent.status);

      if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'requires_capture') {
        if (savedType) {
          // We know the type from sessionStorage — call the right endpoint
          await completePayment(savedType, paymentIntentId);
        } else {
          // sessionStorage was lost — try package first, then session
          // (confirm-package-payment will fail fast with "Missing package information"
          //  if the payment intent doesn't have packageId in metadata)
          console.log('No saved type, trying confirm-package-payment first...');
          const packageResult = await supabase.functions.invoke('confirm-package-payment', {
            body: { paymentIntentId },
          });

          if (!packageResult.error && packageResult.data && !packageResult.data.error) {
            console.log('confirm-package-payment succeeded');
            toast({
              title: 'Package Confirmed!',
              description: 'Your package has been activated successfully.',
            });
            setState({ isHandling: false, status: 'success', type: 'package' });
            return;
          }

          // Package endpoint failed — try session booking
          console.log('Package endpoint failed, trying confirm-payment-and-book...', packageResult.data?.error || packageResult.error);
          const sessionResult = await supabase.functions.invoke('confirm-payment-and-book', {
            body: { paymentIntentId },
          });

          if (sessionResult.error) throw sessionResult.error;
          if (sessionResult.data?.error) throw new Error(sessionResult.data.error);

          toast({
            title: 'Booking Confirmed!',
            description: 'Your session has been booked successfully.',
          });
          setState({ isHandling: false, status: 'success', type: 'session' });
          return;
        }
      } else if (paymentIntent.status === 'processing') {
        toast({
          title: 'Payment Processing',
          description: 'Your payment is being processed. You will receive confirmation once it clears.',
        });
        setState({ isHandling: false, status: 'processing', message: 'Payment is being processed.' });
      } else {
        throw new Error(`Payment was not completed (status: ${paymentIntent.status}). Please try again.`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong verifying your payment.';
      console.error('Error handling payment redirect return:', err);
      toast({
        title: 'Payment Error',
        description: errorMessage,
        variant: 'destructive',
      });
      setState({ isHandling: false, status: 'error', message: errorMessage });
    } finally {
      sessionStorage.removeItem('fettleRedirectPayment');
    }
  }

  async function completePayment(type: 'session' | 'package', paymentIntentId: string) {
    if (type === 'session') {
      const { data, error: fnError } = await supabase.functions.invoke('confirm-payment-and-book', {
        body: { paymentIntentId },
      });
      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      toast({
        title: 'Booking Confirmed!',
        description: 'Your session has been booked successfully.',
      });
      setState({ isHandling: false, status: 'success', type: 'session' });
    } else {
      const { data, error: fnError } = await supabase.functions.invoke('confirm-package-payment', {
        body: { paymentIntentId },
      });
      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      toast({
        title: 'Package Confirmed!',
        description: 'Your package has been activated successfully.',
      });
      setState({ isHandling: false, status: 'success', type: 'package' });
    }
  }

  return state;
}
