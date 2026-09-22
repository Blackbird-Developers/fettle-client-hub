import { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, CalendarCheck, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { SETTLEMENT_RETURN_PARAM } from '@/hooks/useUnpaidSessions';

export interface SettlementResult {
  receiptUrl?: string | null;
  /** The card was charged but recording it didn't finish; the server reconciles it. */
  confirmPending?: boolean;
  /** The payment method is still clearing (e.g. bank debits). */
  processing?: boolean;
}

interface SettlePaymentFormProps {
  paymentIntentId: string;
  appointmentId: number;
  /** Amount in cents, exactly as returned by pay-session. */
  amount: number;
  sessionLabel: string;
  onSuccess: (result: SettlementResult) => void;
  onBack: () => void;
  onProcessingChange?: (processing: boolean) => void;
}

/**
 * Card payment for an existing unpaid session. Same shape as
 * PackagePaymentForm, but there is no booking step afterwards: once Stripe
 * succeeds, pay-session `confirm` records the settlement for the clinic.
 */
export function SettlePaymentForm({
  paymentIntentId,
  appointmentId,
  amount,
  sessionLabel,
  onSuccess,
  onBack,
  onProcessingChange,
}: SettlePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSucceeded, setPaymentSucceeded] = useState(false);

  const setProcessing = (processing: boolean) => {
    setIsProcessing(processing);
    onProcessingChange?.(processing);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);

    try {
      // submit() validates the form and must be called before confirmPayment()
      const submitResult = await elements.submit();
      if (submitResult.error) {
        throw new Error(
          submitResult.error.message || 'Please check your payment details'
        );
      }

      // Redirect-based wallets (Revolut, PayPal, …) leave the page and come
      // back to /sessions?settled={id}, where useSettlementRedirectReturn
      // confirms the settlement.
      const returnUrl = `${window.location.origin}/sessions?${SETTLEMENT_RETURN_PARAM}=${appointmentId}`;
      const { error: paymentError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl,
        },
        redirect: 'if_required',
      });

      if (paymentError) {
        throw new Error(paymentError.message || 'Payment failed');
      }

      if (paymentIntent?.status === 'succeeded') {
        setPaymentSucceeded(true);

        // The card has been charged from here on, so never report a failure.
        // confirm is idempotent; if it doesn't go through, the banner still
        // clears on the next refetch because the server finds the payment.
        try {
          const { data, error } = await supabase.functions.invoke('pay-session', {
            body: { action: 'confirm', paymentIntentId },
          });
          if (error || data?.error) throw new Error('Settlement confirm failed');
          onSuccess({ receiptUrl: data?.receiptUrl ?? null });
        } catch {
          onSuccess({ confirmPending: true });
        }
      } else if (paymentIntent?.status === 'processing') {
        setPaymentSucceeded(true);
        onSuccess({ processing: true });
      } else {
        throw new Error(`Payment was not completed (status: ${paymentIntent?.status})`);
      }
    } catch (error) {
      toast({
        title: 'Payment Failed',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
      setPaymentSucceeded(false);
    } finally {
      setProcessing(false);
    }
  };

  if (paymentSucceeded) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-lg">Payment Successful!</h3>
          <p className="text-muted-foreground text-sm">Recording your payment...</p>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-accent/50 rounded-lg p-3 border border-border">
        <div className="flex justify-between items-center gap-3">
          <span className="text-sm text-muted-foreground flex items-center gap-2 min-w-0">
            <CalendarCheck className="h-4 w-4 shrink-0" />
            <span className="truncate">{sessionLabel}</span>
          </span>
          <span className="text-lg font-bold text-primary shrink-0">
            €{(amount / 100).toFixed(2)}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        <span>Secure payment powered by Stripe</span>
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="flex-1"
          disabled={isProcessing}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="flex-1 gap-2"
          disabled={!stripe || !elements || isProcessing}
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              Pay €{(amount / 100).toFixed(2)}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
