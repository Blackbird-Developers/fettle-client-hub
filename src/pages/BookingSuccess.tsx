import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLogActivity } from '@/hooks/useActivities';
import { CheckCircle2, Loader2, XCircle, CalendarPlus, Home, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

export default function BookingSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const logActivity = useLogActivity();
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPackage, setIsPackage] = useState(false);
  const [packageDetails, setPackageDetails] = useState<{
    packageName: string;
    sessions: number;
    amountPaid: number;
  } | null>(null);
  const [appointmentDetails, setAppointmentDetails] = useState<{
    datetime: string;
    typeName?: string;
    therapistName?: string;
  } | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const type = searchParams.get('type');
    
    if (!sessionId) {
      setStatus('error');
      setErrorMessage('No payment session found');
      return;
    }

    // Handle package purchase
    if (type === 'package') {
      setIsPackage(true);
      verifyPackagePurchase(sessionId);
    } else {
      // Handle regular session booking
      verifyAndBook(sessionId);
    }
  }, [searchParams]);

  const verifyPackagePurchase = async (sessionId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-package-payment', {
        body: { sessionId },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setPackageDetails({
        packageName: data.packageName,
        sessions: data.sessions,
        amountPaid: data.amountPaid,
      });

      // Log activity
      logActivity.mutate({
        activity_type: 'session_booked',
        title: 'Package purchased',
        description: `${data.packageName} - ${data.sessions} sessions`,
        metadata: {
          package_id: data.packageId,
          sessions: data.sessions,
          amount: data.amountPaid,
        },
      });

      setStatus('success');
    } catch (err) {
      console.error('Package verification error:', err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to verify package purchase');
    }
  };

  const verifyAndBook = async (sessionId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-payment-and-book', {
        body: { sessionId },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      // Log activity
      const appointment = data.appointment;
      if (appointment) {
        logActivity.mutate({
          activity_type: 'session_booked',
          title: 'Session booked',
          description: `${appointment.type || 'Session'} on ${format(new Date(appointment.datetime), 'MMM d, yyyy')}`,
          metadata: {
            appointment_id: appointment.id,
            datetime: appointment.datetime,
          },
        });

        setAppointmentDetails({
          datetime: appointment.datetime,
          typeName: appointment.type,
          therapistName: appointment.calendar,
        });
      }

      setStatus('success');
    } catch (err) {
      console.error('Booking verification error:', err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to complete booking');
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <h2 className="text-xl font-heading font-semibold">
            {isPackage ? 'Confirming your package...' : 'Confirming your booking...'}
          </h2>
          <p className="text-muted-foreground">Please wait while we finalize your purchase.</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-6 max-w-md">
          <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto">
            <XCircle className="h-12 w-12 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-heading font-semibold mb-2">
              {isPackage ? 'Package Purchase Failed' : 'Booking Failed'}
            </h2>
            <p className="text-muted-foreground">{errorMessage}</p>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => navigate('/dashboard')} className="w-full">
              <Home className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Package success view
  if (isPackage && packageDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-6 max-w-md">
          <div className="p-4 rounded-full bg-success/10 w-fit mx-auto animate-scale-in">
            <Gift className="h-12 w-12 text-success" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold mb-2">Package Confirmed! 🎉</h2>
            <p className="text-muted-foreground">
              Your <span className="font-medium text-foreground">{packageDetails.packageName}</span> has been activated.
            </p>
          </div>
          
          <div className="bg-accent/50 rounded-xl p-5 border border-border space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Sessions Available</span>
              <span className="text-2xl font-bold text-primary">{packageDetails.sessions}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Amount Paid</span>
              <span className="font-semibold text-foreground">€{packageDetails.amountPaid}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Cost Per Session</span>
              <span className="font-semibold text-success">€{Math.round(packageDetails.amountPaid / packageDetails.sessions)}</span>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-5 border border-primary/20">
            <p className="font-heading font-semibold text-foreground mb-2">
              ✨ Ready to start?
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Book your first session now using your package credits.
            </p>
            <Button onClick={() => navigate('/sessions')} className="w-full gap-2">
              <CalendarPlus className="h-4 w-4" />
              Book Your First Session
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            A confirmation email has been sent with your package details.
          </p>

          <Button variant="ghost" onClick={() => navigate('/dashboard')} className="w-full">
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // Regular session success view
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="p-4 rounded-full bg-success/10 w-fit mx-auto animate-scale-in">
          <CheckCircle2 className="h-12 w-12 text-success" />
        </div>
        <div>
          <h2 className="text-2xl font-heading font-bold mb-2">You're all set!</h2>
          {appointmentDetails && (
            <p className="text-muted-foreground">
              Your {appointmentDetails.typeName || 'session'} 
              {appointmentDetails.therapistName && ` with ${appointmentDetails.therapistName}`} is scheduled for{' '}
              <span className="font-medium text-foreground">
                {format(new Date(appointmentDetails.datetime), 'EEEE, MMMM d, yyyy')} at{' '}
                {format(new Date(appointmentDetails.datetime), 'h:mm a')}
              </span>
            </p>
          )}
        </div>
        
        <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-5 border border-primary/20">
          <p className="font-heading font-semibold text-foreground mb-2">
            ✨ Consistency is key
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Regular sessions lead to better outcomes. Book your next session now.
          </p>
          <Button onClick={() => navigate('/sessions')} className="w-full gap-2">
            <CalendarPlus className="h-4 w-4" />
            Book Next Session
          </Button>
        </div>

        <Button variant="ghost" onClick={() => navigate('/dashboard')} className="w-full">
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
