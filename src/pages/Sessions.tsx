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
import { BookSessionDropdown } from "@/components/booking/BookSessionDropdown";
import { BookingModal } from "@/components/booking/BookingModal";
import { useAcuityAppointments, AcuityAppointment } from "@/hooks/useAcuity";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Calendar, Clock, User, Video, MapPin, X, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

function AcuitySessionCard({ 
  appointment, 
  onCancel,
  onRebook,
  clientEmail
}: { 
  appointment: AcuityAppointment; 
  onCancel?: () => void;
  onRebook?: (calendarId: number, calendarName: string) => void;
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
        <CardContent className="p-4 sm:p-6">
          <div className="flex gap-3 sm:gap-4 flex-col sm:flex-row sm:items-start">
            {/* Therapist Avatar */}
            <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>

            {/* Session Details */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-heading font-semibold text-card-foreground text-base sm:text-lg truncate">
                    {appointment.calendar}
                  </h3>
                  <p className="text-sm text-muted-foreground truncate">{appointment.type}</p>
                </div>
                <div className="shrink-0">
                  {getStatusBadge()}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground mt-3">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                  {format(dateTime, 'MMM d, yyyy')}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                  {format(dateTime, 'h:mm a')}
                </span>
                <span className="flex items-center gap-1">
                  {isVideo ? (
                    <>
                      <Video className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                      Video
                    </>
                  ) : (
                    <>
                      <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                      In-Person
                    </>
                  )}
                </span>
              </div>

              {isUpcoming && (
                <div className="flex flex-wrap gap-2 sm:gap-3 mt-4">
                  {isVideo && (
                    <Button 
                      size="sm" 
                      className="shadow-soft text-xs sm:text-sm"
                      onClick={() => {
                        // Try to find video link in location or formsText
                        const videoLink = appointment.location?.match(/https?:\/\/[^\s]+/)?.[0] ||
                                         appointment.formsText?.match(/https?:\/\/[^\s]+/)?.[0];
                        if (videoLink) {
                          window.open(videoLink, '_blank');
                        } else if (appointment.confirmationPage) {
                          window.open(appointment.confirmationPage, '_blank');
                        } else {
                          toast({
                            title: 'Video Link Unavailable',
                            description: 'The video link for this session is not yet available.',
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      <Video className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
                      Join Session
                    </Button>
                  )}
                  {appointment.confirmationPage && (
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="text-xs sm:text-sm"
                      onClick={() => window.open(appointment.confirmationPage, '_blank')}
                    >
                      <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
                      Reschedule
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs sm:text-sm"
                    onClick={() => setShowCancelDialog(true)}
                  >
                    <X className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              )}

              {/* Rebook button for past sessions (completed or cancelled) */}
              {!isUpcoming && onRebook && (
                <div className="flex flex-wrap gap-2 sm:gap-3 mt-4">
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="gap-1.5 text-xs sm:text-sm"
                    onClick={() => onRebook(appointment.calendarID, appointment.calendar)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Rebook with {appointment.calendar.split(' ')[0]}
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
  const { user } = useAuth();
  const { appointments, loading, error, refetch } = useAcuityAppointments(user?.email);
  
  // State for rebook modal
  const [rebookOpen, setRebookOpen] = useState(false);
  const [rebookCalendarId, setRebookCalendarId] = useState<number | undefined>();
  const [rebookCalendarName, setRebookCalendarName] = useState<string | undefined>();

  const handleRebook = (calendarId: number, calendarName: string) => {
    setRebookCalendarId(calendarId);
    setRebookCalendarName(calendarName);
    setRebookOpen(true);
  };

  const handleRebookClose = (open: boolean) => {
    setRebookOpen(open);
    if (!open) {
      setRebookCalendarId(undefined);
      setRebookCalendarName(undefined);
    }
  };

  const now = new Date();
  const upcomingSessions = appointments.filter(apt => 
    !apt.canceled && !isPast(parseISO(apt.datetime))
  );
  const pastSessions = appointments.filter(apt => 
    apt.canceled || isPast(parseISO(apt.datetime))
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8 animate-fade-in">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground">
            My Sessions
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            View and manage your therapy sessions
          </p>
        </div>
        <BookSessionDropdown 
          onBookingComplete={refetch}
          className="shrink-0 w-full sm:w-auto"
        />
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
              <div className="mt-4">
                <BookSessionDropdown onBookingComplete={refetch} />
              </div>
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
                onRebook={handleRebook}
              />
            ))
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>No past sessions</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Rebook Modal */}
      <BookingModal 
        open={rebookOpen} 
        onOpenChange={handleRebookClose}
        onBookingComplete={refetch}
        preselectedCalendarId={rebookCalendarId}
        preselectedCalendarName={rebookCalendarName}
      />
    </DashboardLayout>
  );
}
