import { useState, useMemo } from 'react';
import { format, addMonths } from 'date-fns';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  useAcuityAppointmentTypes,
  useAcuityCalendars,
  useAcuityAvailability,
  useAcuityTimes,
  useAcuityAppointments,
  AcuityCalendar,
} from '@/hooks/useAcuity';
import { useActivePackages } from '@/hooks/useUserPackages';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PaymentForm } from './PaymentForm';
import { Clock, User, Calendar as CalendarIcon, CreditCard, Users, RefreshCw, Loader2, CheckCircle, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';

// Initialize Stripe with debugging
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
console.log('[Stripe Debug] Publishable key exists:', !!stripePublishableKey);
console.log('[Stripe Debug] Publishable key prefix:', stripePublishableKey?.substring(0, 10) + '...');
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;
console.log('[Stripe Debug] stripePromise created:', !!stripePromise);
export type SessionCategory = 'individual' | 'couples' | 'youth';

interface BookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBookingComplete?: () => void;
  preselectedCalendarId?: number;
  preselectedCalendarName?: string;
  sessionCategory?: SessionCategory;
}

type Step = 'type' | 'therapist' | 'date' | 'time' | 'details' | 'confirm' | 'payment' | 'success';

export function BookingModal({ 
  open, 
  onOpenChange, 
  onBookingComplete,
  preselectedCalendarId,
  preselectedCalendarName,
  sessionCategory = 'individual'
}: BookingModalProps) {
  const [step, setStep] = useState<Step>(preselectedCalendarId ? 'type' : 'type');
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [selectedCalendar, setSelectedCalendar] = useState<number | null>(preselectedCalendarId || null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ignorePreselectedTherapist, setIgnorePreselectedTherapist] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
  });
  
  // Payment state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentLivemode, setPaymentLivemode] = useState<boolean | null>(null);
  const [bookingResult, setBookingResult] = useState<{ appointment: any; receiptUrl?: string } | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [usePackageCredits, setUsePackageCredits] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

  const { toast } = useToast();
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  
  // Fetch user's active packages
  const { packages: activePackages, totalRemainingSessions } = useActivePackages();
  
  const { types, loading: typesLoading } = useAcuityAppointmentTypes();
  const { calendars, loading: calendarsLoading } = useAcuityCalendars();
  const { appointments } = useAcuityAppointments(profile?.email);
  
  const currentMonth = format(new Date(), 'yyyy-MM');
  const { dates: availableDates, loading: datesLoading } = useAcuityAvailability(
    selectedType,
    selectedDate ? format(selectedDate, 'yyyy-MM') : currentMonth,
    selectedCalendar
  );
  
  const { times: availableTimes, loading: timesLoading } = useAcuityTimes(
    selectedType,
    selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null,
    selectedCalendar
  );

  // Filter appointment types based on session category and whether we're rebooking
  const filteredAppointmentTypes = useMemo(() => {
    if (preselectedCalendarName && !ignorePreselectedTherapist) {
      // When rebooking, show only session types for the specific therapist
      const therapistFirstName = preselectedCalendarName.split(' ')[0];
      return types.filter(type => {
        const nameLower = type.name.toLowerCase();
        const therapistNameLower = therapistFirstName.toLowerCase();
        const fullNameLower = preselectedCalendarName.toLowerCase();
        
        switch (sessionCategory) {
          case 'couples':
            return (nameLower.includes(`couple's therapy session with ${therapistNameLower}`) ||
                    nameLower.includes(`couple's therapy session with ${fullNameLower}`));
          case 'youth':
            return (nameLower.includes(`youth therapy - individual session with ${therapistNameLower}`) ||
                    nameLower.includes(`youth therapy - individual session with ${fullNameLower}`));
          default: // individual
            return (nameLower.includes(`individual session with ${therapistNameLower}`) ||
                    nameLower.includes(`individual session with ${fullNameLower}`)) &&
                   !nameLower.includes('youth therapy');
        }
      });
    }
    
    // Filter by session category
    switch (sessionCategory) {
      case 'couples':
        return types.filter(type => type.name.startsWith("Couple's Therapy Session"));
      case 'youth':
        return types.filter(type => type.name.startsWith('Youth Therapy - Individual Session'));
      default: // individual
        return types.filter(type => type.name.startsWith('Individual Therapy Session'));
    }
  }, [types, preselectedCalendarName, ignorePreselectedTherapist, sessionCategory]);

  // Get a human-readable label for the session category
  const getSessionCategoryLabel = () => {
    switch (sessionCategory) {
      case 'couples': return "Couple's Therapy";
      case 'youth': return 'Youth Therapy';
      default: return 'Individual Therapy';
    }
  };

  // Helper to format the display name for clearer customer understanding
  const formatSessionDisplayName = (name: string, isTherapistSpecific: boolean = false) => {
    if (isTherapistSpecific) {
      // For therapist-specific sessions, extract duration or session type info
      const durationMatch = name.match(/\((\d+)\s*min\)/i);
      if (durationMatch) {
        return `${durationMatch[1]} Minute Session`;
      }
      // Remove prefixes based on session category
      let cleaned = name;
      if (sessionCategory === 'couples') {
        cleaned = name.replace(/Couple's Therapy Session with [^(]+/i, '').trim();
      } else if (sessionCategory === 'youth') {
        cleaned = name.replace(/Youth Therapy - Individual Session with [^(]+/i, '').trim();
      } else {
        cleaned = name.replace(/Individual Session with [^(]+/i, '').trim();
      }
      return cleaned || 'Therapy Session';
    }
    
    // Extract the focus area from parentheses
    const match = name.match(/\(([^)]+)\)/);
    if (match) {
      return match[1];
    }
    
    // Remove common prefixes based on category
    if (sessionCategory === 'couples') {
      return name.replace("Couple's Therapy Session", '').trim() || 'General Session';
    } else if (sessionCategory === 'youth') {
      return name.replace('Youth Therapy - Individual Session', '').trim() || 'General Session';
    }
    return name.replace('Individual Therapy Session', '').trim() || 'General Session';
  };

  const selectedTypeData = types.find(t => t.id === selectedType);
  const selectedCalendarData = calendars.find(c => c.id === selectedCalendar);

  // Get therapists that offer the selected service
  const availableTherapists = useMemo(() => {
    if (!selectedTypeData || !calendars.length) return [];
    
    const calendarIds = selectedTypeData.calendarIDs || [];
    return calendars.filter(calendar => calendarIds.includes(calendar.id));
  }, [selectedTypeData, calendars]);

  // Get previous therapist from past appointments
  const previousTherapist = useMemo(() => {
    if (!appointments.length) return null;
    
    const sortedAppointments = [...appointments]
      .filter(a => !a.canceled)
      .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
    
    if (sortedAppointments.length === 0) return null;
    
    const lastAppointment = sortedAppointments[0];
    return calendars.find(c => c.id === lastAppointment.calendarID) || null;
  }, [appointments, calendars]);

  const availableDateStrings = availableDates.map(d => d.date);

  const isDateAvailable = (date: Date) => {
    const dateString = format(date, 'yyyy-MM-dd');
    return availableDateStrings.includes(dateString);
  };

  const handleBookWithPackage = async () => {
    if (!selectedType || !selectedTime || !selectedTypeData || !selectedPackageId) {
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('book-with-package', {
        body: {
          packageId: selectedPackageId,
          appointmentTypeID: selectedType,
          datetime: selectedTime,
          calendarID: selectedCalendar,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone || undefined,
          notes: formData.notes || undefined,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      // Invalidate packages query to refresh the counter
      queryClient.invalidateQueries({ queryKey: ['user-packages'] });

      setBookingResult({ appointment: data.appointment });
      setStep('success');
      
      toast({
        title: 'Session Booked!',
        description: `You have ${data.remainingSessions} session${data.remainingSessions === 1 ? '' : 's'} remaining in your package.`,
      });
    } catch (error) {
      console.error('Package booking error:', error);
      toast({
        title: 'Booking Failed',
        description: error instanceof Error ? error.message : 'Failed to book session',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProceedToPayment = async () => {
    // If using package credits, book with package instead
    if (usePackageCredits && selectedPackageId) {
      return handleBookWithPackage();
    }

    console.log('[Stripe Debug] handleProceedToPayment called');
    console.log('[Stripe Debug] selectedType:', selectedType);
    console.log('[Stripe Debug] selectedTime:', selectedTime);
    console.log('[Stripe Debug] selectedTypeData:', selectedTypeData);
    
    if (!selectedType || !selectedTime || !selectedTypeData) {
      console.log('[Stripe Debug] Missing required data, returning early');
      return;
    }

    setIsSubmitting(true);
    try {
      const requestBody = {
        appointmentTypeID: selectedType,
        appointmentTypeName: selectedTypeData.name,
        appointmentTypePrice: selectedTypeData.price,
        datetime: selectedTime,
        calendarID: selectedCalendar,
        calendarName: selectedCalendarData?.name,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone || undefined,
        notes: formData.notes || undefined,
        couponCode: couponCode.trim() || undefined,
      };
      
      console.log('[Stripe Debug] Calling create-session-payment with:', requestBody);
      
      // Create Checkout Session (supports coupons)
      const { data, error } = await supabase.functions.invoke('create-session-payment', {
        body: requestBody,
      });

      console.log('[Stripe Debug] Response data:', data);
      console.log('[Stripe Debug] Response error:', error);

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error) {
      console.error('[Stripe Debug] Error:', error);
      toast({
        title: 'Payment Setup Failed',
        description: error instanceof Error ? error.message : 'Failed to initialize payment',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentSuccess = (result: { appointment: any; receiptUrl?: string }) => {
    setBookingResult(result);
    setStep('success');
  };

  const handleClose = () => {
    setStep('type');
    setSelectedType(null);
    setSelectedCalendar(preselectedCalendarId || null);
    setSelectedDate(undefined);
    setSelectedTime(null);
    setFormData({ firstName: '', lastName: '', email: '', phone: '', notes: '' });
    setClientSecret(null);
    setPaymentIntentId(null);
    setPaymentAmount(0);
    setPaymentLivemode(null);
    setBookingResult(null);
    setCouponCode('');
    setUsePackageCredits(false);
    setSelectedPackageId(null);
    setIgnorePreselectedTherapist(false);
    onOpenChange(false);
    
    if (bookingResult) {
      onBookingComplete?.();
    }
  };

  const handleBookWithAnotherTherapist = () => {
    setIgnorePreselectedTherapist(true);
    setSelectedCalendar(null);
  };

  // When a preselected therapist is provided and a type is selected, skip to date
  const handleTypeSelection = (typeId: number) => {
    setSelectedType(typeId);
    setSelectedCalendar(preselectedCalendarId || null);
    if (preselectedCalendarId) {
      setStep('date');
    } else {
      setStep('therapist');
    }
  };

  const handleSelectTherapist = (calendarId: number) => {
    setSelectedCalendar(calendarId);
    setStep('date');
  };

  const renderTherapistCard = (therapist: AcuityCalendar, isPrevious: boolean = false) => (
    <button
      key={therapist.id}
      onClick={() => handleSelectTherapist(therapist.id)}
      className={cn(
        "w-full p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50 hover:bg-accent/50",
        selectedCalendar === therapist.id 
          ? "border-primary bg-primary/5" 
          : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-foreground">{therapist.name}</h4>
            {isPrevious && (
              <Badge variant="secondary" className="text-xs">
                <RefreshCw className="h-3 w-3 mr-1" />
                Previous
              </Badge>
            )}
          </div>
          {therapist.location && (
            <p className="text-xs text-muted-foreground mt-1">
              {therapist.location}
            </p>
          )}
        </div>
      </div>
    </button>
  );

  const renderStep = () => {
    switch (step) {
      case 'type':
        // Show enhanced loading state when checking therapist availability
        if (typesLoading && preselectedCalendarName && !ignorePreselectedTherapist) {
          return (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/10 animate-scale-in">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">{preselectedCalendarName}</p>
                  <p className="text-sm text-muted-foreground">Checking availability...</p>
                </div>
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton 
                    key={i} 
                    className="h-20 w-full rounded-xl animate-fade-in" 
                    style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'backwards' }}
                  />
                ))}
              </div>
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              {preselectedCalendarName && !ignorePreselectedTherapist
                ? `Select a session type to book with ${preselectedCalendarName}`
                : 'Select the type of session you\'d like to book'}
            </p>
            {typesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            ) : filteredAppointmentTypes.length === 0 && preselectedCalendarName && !ignorePreselectedTherapist ? (
              <div className="text-center py-8 space-y-4">
                <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                  <CalendarIcon className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-muted-foreground">
                    No available session types found for {preselectedCalendarName}.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    This therapist may not have open availability right now.
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  onClick={handleBookWithAnotherTherapist}
                  className="mt-2"
                >
                  Book with another therapist
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                  {filteredAppointmentTypes.map(type => (
                    <button
                      key={type.id}
                      onClick={() => handleTypeSelection(type.id)}
                      className={cn(
                        "w-full p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50 hover:bg-accent/50",
                        selectedType === type.id 
                          ? "border-primary bg-primary/5" 
                          : "border-border"
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-foreground">{formatSessionDisplayName(type.name, !!preselectedCalendarName)}</h4>
                          {type.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {type.description}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {type.duration} min
                          </div>
                          {type.price && type.price !== '0' && (
                            <p className="text-sm font-medium text-primary mt-1">€{type.price}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        );

      case 'therapist':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Choose your therapist for {selectedTypeData?.name}
            </p>
            {calendarsLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : availableTherapists.length > 0 ? (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                  {previousTherapist && availableTherapists.some(t => t.id === previousTherapist.id) && (
                    <>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span>Rebook with your previous therapist</span>
                      </div>
                      {renderTherapistCard(previousTherapist, true)}
                      <div className="relative py-2">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-background px-2 text-muted-foreground">
                            Or choose another
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                  
                  {availableTherapists
                    .filter(t => t.id !== previousTherapist?.id)
                    .map(therapist => renderTherapistCard(therapist))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No therapists available for this session type
              </p>
            )}
            <Button variant="ghost" onClick={() => setStep('type')} className="w-full">
              Back to session types
            </Button>
          </div>
        );

      case 'date':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Choose a date with {selectedCalendarData?.name}
            </p>
            <div className="flex justify-center">
              {datesLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading available dates...</p>
                </div>
              ) : (
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    setSelectedDate(date);
                    if (date) setStep('time');
                  }}
                  disabled={(date) => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return date < today || !isDateAvailable(date);
                  }}
                  fromDate={new Date()}
                  toDate={addMonths(new Date(), 3)}
                  className="rounded-xl border pointer-events-auto"
                />
              )}
            </div>
            <Button variant="ghost" onClick={() => setStep('therapist')} className="w-full">
              Back to therapist selection
            </Button>
          </div>
        );

      case 'time':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Available times for {selectedDate && format(selectedDate, 'EEEE, MMMM d')}
            </p>
            {timesLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : availableTimes.length > 0 ? (
              <ScrollArea className="h-[250px]">
                <div className="grid grid-cols-3 gap-2 pr-4">
                  {availableTimes.map(slot => (
                    <Button
                      key={slot.time}
                      variant={selectedTime === slot.time ? "default" : "outline"}
                      onClick={() => {
                        setSelectedTime(slot.time);
                        setStep('details');
                      }}
                      className="h-10"
                    >
                      {format(new Date(slot.time), 'h:mm a')}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No available times for this date
              </p>
            )}
            <Button variant="ghost" onClick={() => setStep('date')} className="w-full">
              Back to calendar
            </Button>
          </div>
        );

      case 'details':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">Enter your details to complete the booking</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={e => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={e => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="+353 87 123 4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Any information you'd like your therapist to know..."
                rows={3}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setStep('time')} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={() => setStep('confirm')} 
                className="flex-1"
                disabled={!formData.firstName || !formData.lastName || !formData.email}
              >
                Review Booking
              </Button>
            </div>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-6">
            <div className="bg-accent/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <CalendarIcon className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">{selectedTypeData?.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedTypeData?.duration} minutes</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">{selectedCalendarData?.name}</p>
                  <p className="text-sm text-muted-foreground">Your therapist</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">
                    {selectedTime && format(new Date(selectedTime), 'EEEE, MMMM d, yyyy')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedTime && format(new Date(selectedTime), 'h:mm a')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <User className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">{formData.firstName} {formData.lastName}</p>
                  <p className="text-sm text-muted-foreground">{formData.email}</p>
                </div>
              </div>
            </div>
            
            {/* Package Credits Option */}
            {totalRemainingSessions > 0 && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setUsePackageCredits(true);
                    // Auto-select first available package
                    const firstPackage = activePackages[0];
                    if (firstPackage) {
                      setSelectedPackageId(firstPackage.id);
                    }
                  }}
                  className={cn(
                    "w-full p-4 rounded-xl border-2 text-left transition-all",
                    usePackageCredits 
                      ? "border-success bg-success/5" 
                      : "border-border hover:border-success/50 hover:bg-success/5"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-success/10">
                      <Gift className="h-5 w-5 text-success" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">Use Package Credit</p>
                        <Badge className="bg-success/10 text-success border-success/20 text-xs">
                          {totalRemainingSessions} available
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Book using your pre-purchased session credits
                      </p>
                    </div>
                    {usePackageCredits && (
                      <CheckCircle className="h-5 w-5 text-success" />
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUsePackageCredits(false);
                    setSelectedPackageId(null);
                  }}
                  className={cn(
                    "w-full p-4 rounded-xl border-2 text-left transition-all",
                    !usePackageCredits 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-primary/50 hover:bg-primary/5"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <CreditCard className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">Pay €{selectedTypeData?.price}</p>
                      <p className="text-sm text-muted-foreground">
                        Pay for this individual session
                      </p>
                    </div>
                    {!usePackageCredits && (
                      <CheckCircle className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </button>
              </div>
            )}

            {/* Standard payment option when no packages */}
            {totalRemainingSessions === 0 && selectedTypeData?.price && parseFloat(selectedTypeData.price) > 0 && (
              <div className="space-y-3">
                <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Session fee</span>
                    <span className="text-lg font-bold text-primary">€{selectedTypeData.price}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Coupon code - only show when paying */}
            {!usePackageCredits && selectedTypeData?.price && parseFloat(selectedTypeData.price) > 0 && (
              <div className="space-y-2">
                <Label htmlFor="couponCode">Coupon Code (optional)</Label>
                <Input
                  id="couponCode"
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Enter coupon code"
                  className="uppercase"
                />
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setStep('details')} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={handleProceedToPayment} 
                className="flex-1 gap-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {usePackageCredits ? 'Booking...' : 'Processing...'}
                  </>
                ) : usePackageCredits ? (
                  <>
                    <Gift className="h-4 w-4" />
                    Book Session
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Continue to Payment
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 'payment': {
        console.log('[Stripe Debug] Rendering payment step');
        console.log('[Stripe Debug] clientSecret exists:', !!clientSecret);
        console.log('[Stripe Debug] paymentIntentId:', paymentIntentId);
        console.log('[Stripe Debug] stripePromise exists:', !!stripePromise);
        console.log('[Stripe Debug] paymentAmount:', paymentAmount);
        console.log('[Stripe Debug] paymentLivemode:', paymentLivemode);
        
        if (!clientSecret || !paymentIntentId) {
          console.log('[Stripe Debug] Missing clientSecret or paymentIntentId, returning null');
          return null;
        }

        if (!stripePromise) {
          console.log('[Stripe Debug] No stripePromise - missing publishable key');
          return (
            <div className="space-y-4">
              <p className="text-sm text-destructive">
                Payments are not configured: missing Stripe publishable key.
              </p>
              <Button variant="ghost" onClick={() => setStep('confirm')} className="w-full">
                Back
              </Button>
            </div>
          );
        }

        const publishableMode = stripePublishableKey?.startsWith('pk_live_')
          ? 'live'
          : stripePublishableKey?.startsWith('pk_test_')
            ? 'test'
            : 'unknown';

        const intentMode = paymentLivemode === null ? 'unknown' : paymentLivemode ? 'live' : 'test';
        const modeMismatch =
          publishableMode !== 'unknown' &&
          intentMode !== 'unknown' &&
          publishableMode !== intentMode;

        console.log('[Stripe Debug] publishableMode:', publishableMode);
        console.log('[Stripe Debug] intentMode:', intentMode);
        console.log('[Stripe Debug] modeMismatch:', modeMismatch);

        if (modeMismatch) {
          console.log('[Stripe Debug] Mode mismatch detected!');
          return (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="font-medium text-destructive">Stripe keys mismatch</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your frontend is using <span className="font-medium">{publishableMode}</span> publishable key, but the payment was created in <span className="font-medium">{intentMode}</span> mode.
                  Update your backend Stripe secret key to the same mode (test vs live).
                </p>
              </div>
              <Button variant="ghost" onClick={() => setStep('confirm')} className="w-full">
                Back
              </Button>
            </div>
          );
        }

        console.log('[Stripe Debug] Rendering Elements with clientSecret');
        return (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: '#7c3aed',
                  borderRadius: '8px',
                },
              },
            }}
          >
            <PaymentForm
              paymentIntentId={paymentIntentId}
              amount={paymentAmount}
              onSuccess={handlePaymentSuccess}
              onBack={() => setStep('confirm')}
            />
          </Elements>
        );
      }

      case 'success':
        return (
          <div className="flex flex-col items-center justify-center py-6 space-y-6">
            <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-xl">Booking Confirmed!</h3>
              <p className="text-muted-foreground">
                Your session has been booked successfully.
              </p>
            </div>
            
            {bookingResult?.appointment && (
              <div className="bg-accent/50 rounded-xl p-4 w-full space-y-2">
                <p className="font-medium">{bookingResult.appointment.type}</p>
                <p className="text-sm text-muted-foreground">
                  with {bookingResult.appointment.therapist}
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(bookingResult.appointment.datetime).toLocaleString('en-IE', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            )}
            
            <p className="text-sm text-muted-foreground text-center">
              A confirmation email has been sent to {formData.email}
            </p>
            
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        );
    }
  };

  const getStepTitle = () => {
    const categoryLabel = getSessionCategoryLabel();
    switch (step) {
      case 'type': return `${categoryLabel} - Choose Session`;
      case 'therapist': return 'Choose Your Therapist';
      case 'date': return 'Select Date';
      case 'time': return 'Select Time';
      case 'details': return 'Your Details';
      case 'confirm': return 'Confirm Booking';
      case 'payment': return 'Payment';
      case 'success': return 'Booking Complete';
    }
  };

  // Progress indicator steps (excluding success which is the final state)
  const progressSteps = [
    { key: 'type', label: 'Type' },
    { key: 'therapist', label: 'Therapist' },
    { key: 'date', label: 'Date' },
    { key: 'time', label: 'Time' },
    { key: 'details', label: 'Details' },
    { key: 'confirm', label: 'Confirm' },
    { key: 'payment', label: 'Payment' },
  ] as const;

  const currentStepIndex = progressSteps.findIndex(s => s.key === step);
  const isSuccessStep = step === 'success';

  return (
    <Dialog open={open} onOpenChange={step === 'success' ? handleClose : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getStepTitle()}</DialogTitle>
        </DialogHeader>
        
        {/* Progress Indicator */}
        {!isSuccessStep && (
          <div className="flex items-center justify-center gap-1.5 pb-2">
            {progressSteps.map((s, index) => (
              <div
                key={s.key}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  index <= currentStepIndex 
                    ? "bg-primary w-6" 
                    : "bg-muted w-4"
                )}
                title={s.label}
              />
            ))}
          </div>
        )}
        
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
