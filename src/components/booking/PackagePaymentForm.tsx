import { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, CreditCard, CheckCircle, Gift } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PackagePaymentFormProps {
  paymentIntentId: string;
  amount: number;
  packageName: string;
  onSuccess: (result: { package: any; receiptUrl?: string }) => void;
  onBack: () => void;
}

export function PackagePaymentForm({ 
  paymentIntentId, 
  amount, 
  packageName,
  onSuccess, 
  onBack 
}: PackagePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSucceeded, setPaymentSucceeded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      // Confirm the payment
      const { error: paymentError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      if (paymentError) {
        throw new Error(paymentError.message || 'Payment failed');
      }

      if (paymentIntent?.status === 'succeeded') {
        setPaymentSucceeded(true);

        // Confirm and save the package
        const { data, error } = await supabase.functions.invoke('confirm-package-payment', {
          body: { paymentIntentId },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        onSuccess(data);
      } else {
        throw new Error('Payment was not completed');
      }
    } catch (error) {
      toast({
        title: 'Payment Failed',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
      setPaymentSucceeded(false);
    } finally {
      setIsProcessing(false);
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
          <p className="text-muted-foreground text-sm">Activating your package...</p>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-accent/50 rounded-lg p-3 border border-border">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Gift className="h-4 w-4" />
            {packageName}
          </span>
          <span className="text-lg font-bold text-primary">€{(amount / 100).toFixed(2)}</span>
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
          Back
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
