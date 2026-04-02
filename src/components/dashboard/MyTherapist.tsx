import { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, CalendarPlus } from "lucide-react";
import { useAcuityAppointments } from "@/hooks/useAcuity";
import { useAuth } from "@/contexts/AuthContext";
import { useTherapistImages } from "@/hooks/useTherapistImages";
import { BookingModal } from "@/components/booking/BookingModal";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

// Convert therapist name to a URL slug for fettle.ie profile pages
// e.g. "Brendan Slattery" → "brendan-slattery"
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

// Get initials from a therapist name
function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

interface TherapistInfo {
  name: string;
  id: number;
  count: number;
}

/** Reusable therapist avatar with image from fettle.ie API, falls back to initials */
export function TherapistAvatar({
  name,
  calendarId,
  imageUrl,
  size = "md",
}: {
  name: string;
  calendarId?: number;
  imageUrl?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [imgError, setImgError] = useState(false);

  // Reset error state when imageUrl changes
  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  const sizeClasses = {
    sm: "h-10 w-10",
    md: "h-14 w-14",
    lg: "h-16 w-16",
  };
  const textClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  const showImage = imageUrl && !imgError;

  return (
    <div
      className={cn(
        sizeClasses[size],
        "rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center",
        !showImage && "bg-primary/10"
      )}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className={cn(textClasses[size], "text-primary font-semibold")}>
          {getInitials(name)}
        </span>
      )}
    </div>
  );
}

export function MyTherapist() {
  const { user } = useAuth();
  const { appointments, loading } = useAcuityAppointments(user?.email);
  const { images: therapistImages } = useTherapistImages();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedTherapist, setSelectedTherapist] = useState<TherapistInfo | null>(null);
  const [api, setApi] = useState<CarouselApi>();
  const [activeIndex, setActiveIndex] = useState(0);

  // Track active slide
  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setActiveIndex(api.selectedScrollSnap());
    };

    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  // Get all unique therapists from appointments, sorted by most sessions
  const therapists = useMemo(() => {
    if (appointments.length === 0) return [];

    const counts = new Map<number, TherapistInfo>();
    for (const apt of appointments) {
      const existing = counts.get(apt.calendarID);
      if (existing) {
        existing.count++;
      } else {
        counts.set(apt.calendarID, {
          name: apt.calendar,
          id: apt.calendarID,
          count: 1,
        });
      }
    }

    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [appointments]);

  const handleBookSession = (therapist: TherapistInfo) => {
    setSelectedTherapist(therapist);
    setBookingOpen(true);
  };

  if (loading) {
    return (
      <Card className="border-border/50 animate-fade-in">
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-36" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (therapists.length === 0) return null;

  // Render a single therapist card (used for both single and carousel)
  const renderTherapistCard = (therapist: TherapistInfo) => {
    const profileUrl = `https://fettle.ie/our-therapists/${toSlug(therapist.name)}`;
    const imageUrl = therapistImages.get(therapist.id);

    return (
      <div>
        <div className="flex items-center gap-4 mb-4">
          <TherapistAvatar
            name={therapist.name}
            calendarId={therapist.id}
            imageUrl={imageUrl}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <h3 className="font-heading font-semibold text-foreground text-base truncate">
              {therapist.name}
            </h3>
            <Badge variant="secondary" className="mt-1 text-xs">
              {therapist.count} session{therapist.count !== 1 ? "s" : ""} together
            </Badge>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => handleBookSession(therapist)}
          >
            <CalendarPlus className="h-4 w-4" />
            Book Session
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5"
            asChild
          >
            <a href={profileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              View Profile
            </a>
          </Button>
        </div>
      </div>
    );
  };

  // Single therapist — no carousel needed
  if (therapists.length === 1) {
    return (
      <>
        <Card className="border-border/50 animate-fade-in overflow-hidden">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Your Therapist
            </p>
            {renderTherapistCard(therapists[0])}
          </CardContent>
        </Card>

        <BookingModal
          open={bookingOpen}
          onOpenChange={setBookingOpen}
          preselectedCalendarId={selectedTherapist?.id}
          preselectedCalendarName={selectedTherapist?.name}
        />
      </>
    );
  }

  // Multiple therapists — show carousel with active dots
  return (
    <>
      <Card className="border-border/50 animate-fade-in overflow-hidden">
        <CardContent className="p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Your Therapists
          </p>

          <Carousel
            opts={{ align: "start", loop: true }}
            setApi={setApi}
            className="w-full"
          >
            <CarouselContent className="-ml-2">
              {therapists.map((therapist) => (
                <CarouselItem key={therapist.id} className="pl-2 basis-full">
                  {renderTherapistCard(therapist)}
                </CarouselItem>
              ))}
            </CarouselContent>

            {/* Active dot indicators */}
            <div className="flex justify-center gap-2 mt-4">
              {therapists.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => api?.scrollTo(idx)}
                  className={cn(
                    "h-2 rounded-full transition-all duration-300",
                    activeIndex === idx
                      ? "w-6 bg-primary"
                      : "w-2 bg-primary/25 hover:bg-primary/40"
                  )}
                  aria-label={`Go to therapist ${idx + 1}`}
                />
              ))}
            </div>
          </Carousel>

          <p className="text-xs text-muted-foreground text-center mt-2">
            Swipe to see all {therapists.length} therapists
          </p>
        </CardContent>
      </Card>

      <BookingModal
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        preselectedCalendarId={selectedTherapist?.id}
        preselectedCalendarName={selectedTherapist?.name}
      />
    </>
  );
}
