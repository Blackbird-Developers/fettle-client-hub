import { useState } from 'react';
import { format, addMonths } from 'date-fns';
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
import {
  useAcuityAppointmentTypes,
  useAcuityAvailability,
  useAcuityTimes,
  bookAppointment,
} from '@/hooks/useAcuity';
import { useToast } from '@/hooks/use-toast';
import { Clock, User, Calendar as CalendarIcon, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBookingComplete?: () => void;
}

type Step = 'type' | 'date' | 'time' | 'details' | 'confirm';

export function BookingModal({ open, onOpenChange, onBookingComplete }: BookingModalProps) {
  const [step, setStep] = useState<Step>('type');
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
  });

  const { toast } = useToast();
  const { types, loading: typesLoading } = useAcuityAppointmentTypes();
  
  const currentMonth = format(new Date(), 'yyyy-MM');
  const { dates: availableDates, loading: datesLoading } = useAcuityAvailability(
    selectedType,
    selectedDate ? format(selectedDate, 'yyyy-MM') : currentMonth
  );
  
  const { times: availableTimes, loading: timesLoading } = useAcuityTimes(
    selectedType,
    selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null
  );

  const selectedTypeData = types.find(t => t.id === selectedType);

  const availableDateStrings = availableDates.map(d => d.date);

  const isDateAvailable = (date: Date) => {
    const dateString = format(date, 'yyyy-MM-dd');
    return availableDateStrings.includes(dateString);
  };

  const handleSubmit = async () => {
    if (!selectedType || !selectedTime) return;

    setIsSubmitting(true);
    try {
      await bookAppointment({
        appointmentTypeID: selectedType,
        datetime: selectedTime,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone || undefined,
        notes: formData.notes || undefined,
      });

      toast({
        title: 'Session Booked!',
        description: 'Your therapy session has been scheduled successfully.',
      });

      // Reset and close
      setStep('type');
      setSelectedType(null);
      setSelectedDate(undefined);
      setSelectedTime(null);
      setFormData({ firstName: '', lastName: '', email: '', phone: '', notes: '' });
      onOpenChange(false);
      onBookingComplete?.();
    } catch (error) {
      toast({
        title: 'Booking Failed',
        description: error instanceof Error ? error.message : 'Failed to book session',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'type':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">Select the type of session you'd like to book</p>
            {typesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                  {types.map(type => (
                    <button
                      key={type.id}
                      onClick={() => {
                        setSelectedType(type.id);
                        setStep('date');
                      }}
                      className={cn(
                        "w-full p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50 hover:bg-accent/50",
                        selectedType === type.id 
                          ? "border-primary bg-primary/5" 
                          : "border-border"
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-foreground">{type.name}</h4>
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

      case 'date':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">Choose a date for your {selectedTypeData?.name}</p>
            <div className="flex justify-center">
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
                className="rounded-xl border"
              />
            </div>
            <Button variant="ghost" onClick={() => setStep('type')} className="w-full">
              Back to session types
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
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setStep('details')} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={handleSubmit} 
                className="flex-1 gap-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  'Booking...'
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm Booking
                  </>
                )}
              </Button>
            </div>
          </div>
        );
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 'type': return 'Choose Session Type';
      case 'date': return 'Select Date';
      case 'time': return 'Select Time';
      case 'details': return 'Your Details';
      case 'confirm': return 'Confirm Booking';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getStepTitle()}</DialogTitle>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
