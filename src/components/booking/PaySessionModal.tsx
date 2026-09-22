import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  UNPAID_SESSIONS_QUERY_KEY,
  formatSessionDate,
  type UnpaidSession,
} from '@/hooks/useUnpaidSessions';
import { SettlePaymentForm, type SettlementResult } from './SettlePaymentForm';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

type Step = 'creating' | 'payment' | 'success' | 'settled' | 'error';

const GENERIC_ERROR = 'Something went wrong. Please try again or contact hello@fettle.ie.';

/** Pull the function's own message out of a non-2xx invoke error. */
async function readFunctionError(error: unknown): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.json();
    if (body?.error) return body.error;
  } catch {
    /* keep the generic message */
  }
  return GENERIC_ERROR;
}

interface PaySessionModalProps {
  /** The session to settle; the modal is open while this is set. */
  session: UnpaidSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Pay now for an existing unpaid session: pay-session `create` → Stripe
 * Elements → pay-session `confirm`. The amount shown is always the one the
 * server returns, never a locally computed price.
 */
export function PaySessionModal({ session, open, onOpenChange }: PaySessionModalProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('creating');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Create one PaymentIntent per open, even if the parent re-renders.
  const startedForRef = useRef<number | null>(null);

  const refreshUnpaidSessions = () =>
    queryClient.invalidateQueries({ queryKey: UNPAID_SESSIONS_QUERY_KEY });

  const createPayment = async (appointmentId: number) => {
    setStep('creating');
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('pay-session', {
        body: { action: 'create', appointmentId },
      });
      if (error) throw new Error(await readFunctionError(error));

      if (data?.alreadyPaid) {
        setStep('settled');
        refreshUnpaidSessions();
        toast({
          title: 'Already settled',
          description: data.message || 'This session is already settled.',
        });
        return;
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.clientSecret || !data?.paymentIntentId || typeof data.amount !== 'number') {
        throw new Error(GENERIC_ERROR);
      }

      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId);
      setAmount(data.amount);
      setStep('payment');
    } catch (err) {
      const message = err instanceof Error ? err.message : GENERIC_ERROR;
      setErrorMessage(message);
      setStep('error');
      toast({
        title: "Couldn't start payment",
        description: message,
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (!open || !session) {
      startedForRef.current = null;
      return;
    }
    if (startedForRef.current === session.id) return;
    startedForRef.current = session.id;

    setClientSecret(null);
    setPaymentIntentId(null);
    setAmount(0);
    setSettlement(null);
    setIsProcessing(false);
    createPayment(session.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  const handlePaid = (result: SettlementResult) => {
    setSettlement(result);
    setStep('success');
    refreshUnpaidSessions();
    toast(
      result.confirmPending
        ? { title: 'Payment received', description: 'Your receipt will follow.' }
        : result.processing
        ? {
            title: 'Payment processing',
            description: "Your payment is being processed. We'll confirm once it clears.",
          }
        : { title: 'Session paid — thank you' }
    );
  };

  const handleOpenChange = (next: boolean) => {
    // Never close while a card is being charged or the payment is being set up.
    if (!next && (isProcessing || step === 'creating')) return;
    onOpenChange(next);
  };

  const sessionLabel = session
    ? `${session.therapist ? `Session with ${session.therapist}` : 'Your session'} · ${formatSessionDate(
        session.datetime,
        profile?.timezone
      )}`
    : '';

  const renderStep = () => {
    switch (step) {
      case 'creating':
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Preparing secure payment...</p>
          </div>
        );

      case 'payment':
        if (!clientSecret || !paymentIntentId || !stripePromise || !session) {
          return (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Payments aren't available right now. Please contact hello@fettle.ie.
            </p>
          );
        }
        return (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: 'hsl(var(--primary))',
                },
              },
            }}>
            <SettlePaymentForm
              paymentIntentId={paymentIntentId}
              appointmentId={session.id}
              amount={amount}
              sessionLabel={sessionLabel}
              onSuccess={handlePaid}
              onBack={() => onOpenChange(false)}
              onProcessingChange={setIsProcessing}
            />
          </Elements>
        );

      case 'success': {
        const pending = settlement?.confirmPending;
        const processing = settlement?.processing;
        return (
          <div className="flex flex-col items-center justify-center py-6 space-y-5 text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-lg">
                {pending || processing ? 'Payment received' : 'Session paid — thank you'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {pending
                  ? 'Your receipt will follow.'
                  : processing
                  ? "Your payment is being processed. We'll confirm once it clears."
                  : `€${(amount / 100).toFixed(2)} for ${sessionLabel}`}
              </p>
            </div>
            {settlement?.receiptUrl && (
              <Button variant="outline" size="sm" asChild className="gap-1.5">
                <a href={settlement.receiptUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  View receipt
                </a>
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Done
            </Button>
          </div>
        );
      }

      case 'settled':
        return (
          <div className="flex flex-col items-center justify-center py-6 space-y-5 text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-lg">Already settled</h3>
              <p className="text-sm text-muted-foreground">
                This session is already settled. There's nothing more to pay.
              </p>
            </div>
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Done
            </Button>
          </div>
        );

      case 'error':
        return (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{errorMessage || GENERIC_ERROR}</p>
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                className="flex-1"
                onClick={() => session && createPayment(session.id)}>
                Try again
              </Button>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay for your session</DialogTitle>
          <DialogDescription>{sessionLabel}</DialogDescription>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
