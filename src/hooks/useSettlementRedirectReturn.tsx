import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import {
  SETTLEMENT_RETURN_PARAM,
  UNPAID_SESSIONS_QUERY_KEY,
} from '@/hooks/useUnpaidSessions';

/**
 * Completes a session settlement when a redirect-based wallet (Revolut,
 * PayPal, …) sends the client back to /sessions?settled={appointmentId}.
 * usePaymentRedirectReturn deliberately ignores these returns so a settlement
 * is never routed into the booking or package confirm endpoints.
 */
export function useSettlementRedirectReturn() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentIntentId = params.get('payment_intent');
    if (!params.has(SETTLEMENT_RETURN_PARAM) || !paymentIntentId) return;

    const redirectStatus = params.get('redirect_status');

    // Clean the URL immediately so a refresh won't re-run this.
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + (window.location.hash || '')
    );

    if (redirectStatus !== 'succeeded') {
      toast(
        redirectStatus === 'processing'
          ? {
              title: 'Payment processing',
              description: 'Your payment is being processed. This page will update once it clears.',
            }
          : {
              title: "Payment wasn't completed",
              description: 'No payment was taken. You can try again from My Sessions.',
            }
      );
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('pay-session', {
          body: { action: 'confirm', paymentIntentId },
        });
        if (error || data?.error) throw new Error('Settlement confirm failed');

        const receiptUrl: string | null = data?.receiptUrl ?? null;
        toast({
          title: 'Session paid — thank you',
          action: receiptUrl ? (
            <ToastAction
              altText="View receipt"
              onClick={() => window.open(receiptUrl, '_blank', 'noopener,noreferrer')}>
              View receipt
            </ToastAction>
          ) : undefined,
        });
      } catch {
        // The card was charged; the server finds the succeeded payment on the
        // next refetch regardless, so don't alarm the client.
        toast({
          title: 'Payment received',
          description: 'Your receipt will follow.',
        });
      } finally {
        queryClient.invalidateQueries({ queryKey: UNPAID_SESSIONS_QUERY_KEY });
      }
    })();
  }, [toast, queryClient]);
}
