import { useState } from 'react';
import { format, parseISO, isPast } from 'date-fns';
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BookingModal } from "@/components/booking/BookingModal";
import { useAcuityAppointments, AcuityAppointment } from "@/hooks/useAcuity";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Calendar, Clock, User, Video, MapPin, X, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

function AcuitySessionCard({ 
  appointment, 
  onCancel,
  clientEmail
}: { 
  appointment: AcuityAppointment; 
  onCancel?: () => void;
  clientEmail?: string;
}) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const { toast } = useToast();
  
  const dateTime = parseISO(appointment.datetime);
  const isUpcoming = !isPast(dateTime) && !appointment.canceled;
  const isVideo = appointment.location?.toLowerCase().includes('video') || 
                  appointment.location?.toLowerCase().includes('online') ||
                  appointment.location?.toLowerCase().includes('zoom');

  const handleCancelWithRefund = async () => {
    if (!clientEmail) {
      toast({
        title: 'Error',
        description: 'Unable to process cancellation - email not found',
        variant: 'destructive',
      });
      return;
    }
    
    setIsCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-session-with-refund', {
        body: { 
          appointmentId: appointment.id,
          clientEmail: clientEmail
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast({
        title: 'Session Cancelled',
        description: data.message || 'Your session has been cancelled successfully.',
      });
      
      setShowCancelDialog(false);
      onCancel?.();
    } catch (error) {
      toast({
        title: 'Cancellation Failed',
        description: error instanceof Error ? error.message : 'Failed to cancel session',
        variant: 'destructive',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const getStatusBadge = () => {
    if (appointment.canceled) {
      return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Cancelled</Badge>;
    }
    if (isPast(dateTime)) {
      return <Badge variant="outline" className="bg-success/10 text-success border-success/20">Completed</Badge>;
    }
    return <Badge variant="outline" className="bg-info/10 text-info border-info/20">Upcoming</Badge>;
  };

  return (
    <>
      <Card className="group transition-all duration-300 hover:shadow-elevated border-border/50">
        <CardContent className="p-6">
          <div className="flex gap-4 flex-col sm:flex-row sm:items-start">
            {/* Therapist Avatar */}
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User className="h-6 w-6 text-primary" />
            </div>

            {/* Session Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div>
                  <h3 className="font-heading font-semibold text-card-foreground text-lg">
                    {appointment.calendar}
                  </h3>
                  <p className="text-sm text-muted-foreground">{appointment.type}</p>
                </div>
                {getStatusBadge()}
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-3">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {format(dateTime, 'MMM d, yyyy')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {format(dateTime, 'h:mm a')} ({appointment.duration} min)
                </span>
                <span className="flex items-center gap-1.5">
                  {isVideo ? (
                    <>
                      <Video className="h-4 w-4" />
                      Video Call
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4" />
                      {appointment.location || 'In-Person'}
                    </>
                  )}
                </span>
              </div>

              {isUpcoming && appointment.canClientCancel && (
                <div className="flex gap-3 mt-4">
                  {isVideo && (
                    <Button size="sm" className="shadow-soft">
                      Join Session
                    </Button>
                  )}
                  {appointment.canClientReschedule && (
                    <Button size="sm" variant="outline">
                      Reschedule
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setShowCancelDialog(true)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cancel Session?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Are you sure you want to cancel your session with{' '}
                <span className="font-medium text-foreground">{appointment.calendar}</span> on{' '}
                <span className="font-medium text-foreground">{format(dateTime, 'MMMM d, yyyy')}</span> at{' '}
                <span className="font-medium text-foreground">{format(dateTime, 'h:mm a')}</span>?
              </p>
              <p className="text-sm bg-success/10 text-success p-3 rounded-lg">
                💰 If you paid for this session, you'll receive a full refund to your original payment method.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Keep Session</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelWithRefund}
              disabled={isCancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isCancelling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                'Cancel & Refund'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SessionSkeleton() {
  return (
    <Card className="border-border/50">
      <CardContent className="p-6">
        <div className="flex gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="flex justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
            <div className="flex gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Sessions() {
  const [bookingOpen, setBookingOpen] = useState(false);
  const { user } = useAuth();
  const { appointments, loading, error, refetch } = useAcuityAppointments(user?.email);

  const now = new Date();
  const upcomingSessions = appointments.filter(apt => 
    !apt.canceled && !isPast(parseISO(apt.datetime))
  );
  const pastSessions = appointments.filter(apt => 
    apt.canceled || isPast(parseISO(apt.datetime))
  );

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-8 animate-fade-in">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            My Sessions
          </h1>
          <p className="text-muted-foreground mt-1">
            View and manage your therapy sessions
          </p>
        </div>
        <Button className="gap-2 shadow-soft" onClick={() => setBookingOpen(true)}>
          <Plus className="h-4 w-4" />
          Book New Session
        </Button>
      </div>

      <Tabs defaultValue="upcoming" className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <TabsList className="mb-6">
          <TabsTrigger value="upcoming">
            Upcoming ({upcomingSessions.length})
          </TabsTrigger>
          <TabsTrigger value="past">
            Past ({pastSessions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-4">
          {loading ? (
            <>
              <SessionSkeleton />
              <SessionSkeleton />
            </>
          ) : error ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>Failed to load sessions</p>
              <Button className="mt-4" variant="outline" onClick={() => refetch()}>
                Try Again
              </Button>
            </div>
          ) : upcomingSessions.length > 0 ? (
            upcomingSessions.map((appointment) => (
              <AcuitySessionCard 
                key={appointment.id} 
                appointment={appointment} 
                onCancel={refetch}
                clientEmail={user?.email}
              />
            ))
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>No upcoming sessions</p>
              <Button className="mt-4 gap-2" onClick={() => setBookingOpen(true)}>
                <Plus className="h-4 w-4" />
                Book Your First Session
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="space-y-4">
          {loading ? (
            <>
              <SessionSkeleton />
              <SessionSkeleton />
            </>
          ) : pastSessions.length > 0 ? (
            pastSessions.map((appointment) => (
              <AcuitySessionCard 
                key={appointment.id} 
                appointment={appointment} 
                clientEmail={user?.email}
              />
            ))
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>No past sessions</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <BookingModal 
        open={bookingOpen} 
        onOpenChange={setBookingOpen}
        onBookingComplete={refetch}
      />
    </DashboardLayout>
  );
}
