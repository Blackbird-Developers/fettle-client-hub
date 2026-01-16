import { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, CreditCard, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PaymentFormProps {
  paymentIntentId: string;
  amount: number;
  onSuccess: (result: { appointment: any; receiptUrl?: string }) => void;
  onBack: () => void;
}

export function PaymentForm({ paymentIntentId, amount, onSuccess, onBack }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSucceeded, setPaymentSucceeded] = useState(false);

  console.log('[PaymentForm Debug] Component rendered');
  console.log('[PaymentForm Debug] stripe loaded:', !!stripe);
  console.log('[PaymentForm Debug] elements loaded:', !!elements);
  console.log('[PaymentForm Debug] paymentIntentId:', paymentIntentId);
  console.log('[PaymentForm Debug] amount:', amount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      // First, submit the elements to validate the form
      // This must be called before confirmPayment()
      // submit() validates the form and returns an error if validation fails
      console.log('Submitting payment form...');
      const submitResult = await elements.submit();

      if (submitResult.error) {
        console.error('Form validation error:', submitResult.error);
        throw new Error(
          submitResult.error.message || 'Please check your payment details'
        );
      }

      console.log('Elements submitted successfully');
      console.log('Confirming payment with Stripe...');

      // Then confirm payment with Stripe
      const { error: paymentError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      console.log('[PaymentForm Debug] confirmPayment result:', {
        error: paymentError,
        paymentIntentStatus: paymentIntent?.status,
        paymentIntentId: paymentIntent?.id,
      });

      if (paymentError) {
        // Check if user just canceled the payment (e.g., closed Google Pay modal)
        if (paymentError.type === 'card_error' || paymentError.type === 'validation_error') {
          throw new Error(paymentError.message || 'Payment failed');
        }
        // For other errors, still throw but with more detail
        console.error('[PaymentForm Debug] Payment error:', paymentError);
        throw new Error(paymentError.message || 'Payment failed');
      }

      // With manual capture, status will be 'requires_capture' after card authorization
      // For Google Pay / Apple Pay, it might also return 'processing' briefly or 'succeeded'
      const validStatuses = ['requires_capture', 'succeeded', 'processing'];

      if (paymentIntent && validStatuses.includes(paymentIntent.status)) {
        setPaymentSucceeded(true);
        console.log('[PaymentForm Debug] Payment authorized, creating booking...');

        // Now create the booking in Acuity and capture the payment
        // If Acuity booking fails, the payment authorization will be canceled
        const { data, error } = await supabase.functions.invoke('confirm-payment-and-book', {
          body: { paymentIntentId },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        toast({
          title: 'Booking Confirmed!',
          description: 'Your session has been booked successfully.',
        });

        onSuccess(data);
      } else if (!paymentIntent) {
        // paymentIntent is null - this can happen with redirects or if the user canceled
        // Check if there's no error, meaning the payment might still be processing
        console.log('[PaymentForm Debug] No paymentIntent returned, checking status via API...');

        // Try to proceed anyway - the backend will verify the actual status
        setPaymentSucceeded(true);

        const { data, error } = await supabase.functions.invoke('confirm-payment-and-book', {
          body: { paymentIntentId },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        toast({
          title: 'Booking Confirmed!',
          description: 'Your session has been booked successfully.',
        });

        onSuccess(data);
      } else {
        console.error('[PaymentForm Debug] Unexpected status:', paymentIntent.status);
        throw new Error(`Payment was not completed. Status: ${paymentIntent.status}`);
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
          <p className="text-muted-foreground text-sm">Creating your booking...</p>
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
            <CreditCard className="h-4 w-4" />
            Amount to pay
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
