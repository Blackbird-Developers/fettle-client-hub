import { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

interface RedirectState {
  isHandling: boolean;
  status: 'idle' | 'processing' | 'success' | 'error';
  message?: string;
}

/**
 * Handles the return from redirect-based payment methods (Revolut, PayPal, etc.).
 * When Stripe redirects the user back, the URL contains payment_intent params.
 * This hook detects those params, verifies the payment, and completes the booking.
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

    // Restore persisted booking data from sessionStorage
    let savedData: { type: string; paymentIntentId: string; savedAt: number } | null = null;
    try {
      const raw = sessionStorage.getItem('fettleRedirectPayment');
      if (raw) {
        savedData = JSON.parse(raw);
        console.log('Restored payment redirect data from sessionStorage');
      }
    } catch (e) {
      console.error('Failed to parse saved payment data:', e);
    }

    if (!savedData) {
      setState({ isHandling: false, status: 'error', message: 'Payment session expired. Please try booking again.' });
      toast({
        title: 'Payment Error',
        description: 'Your payment session expired. Please try booking again.',
        variant: 'destructive',
      });
      return;
    }

    // Check saved data is not too old (30 min max)
    if (Date.now() - savedData.savedAt > 30 * 60 * 1000) {
      sessionStorage.removeItem('fettleRedirectPayment');
      setState({ isHandling: false, status: 'error', message: 'Payment session expired. Please try booking again.' });
      toast({
        title: 'Payment Expired',
        description: 'Your payment session expired. Please try booking again.',
        variant: 'destructive',
      });
      return;
    }

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

      const paymentIntentId = savedData.paymentIntentId || paymentIntentIdFromUrl;

      if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'requires_capture') {
        // Payment confirmed — complete the booking via backend
        if (savedData.type === 'session') {
          const { data, error: fnError } = await supabase.functions.invoke('confirm-payment-and-book', {
            body: { paymentIntentId },
          });

          if (fnError) throw fnError;
          if (data.error) throw new Error(data.error);

          toast({
            title: 'Booking Confirmed!',
            description: 'Your session has been booked successfully.',
          });

          setState({ isHandling: false, status: 'success' });
        } else if (savedData.type === 'package') {
          const { data, error: fnError } = await supabase.functions.invoke('confirm-package-payment', {
            body: { paymentIntentId },
          });

          if (fnError) throw fnError;
          if (data.error) throw new Error(data.error);

          toast({
            title: 'Package Confirmed!',
            description: 'Your package has been activated successfully.',
          });

          setState({ isHandling: false, status: 'success' });
        }
      } else if (paymentIntent.status === 'processing') {
        toast({
          title: 'Payment Processing',
          description: 'Your payment is being processed. You will receive confirmation once it clears.',
        });
        setState({ isHandling: false, status: 'processing', message: 'Payment is being processed.' });
      } else {
        // canceled, requires_payment_method, etc.
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

  return state;
}
