import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BookingModal, SessionCategory } from '@/components/booking/BookingModal';
import { PackageBookingModal } from '@/components/booking/PackageBookingModal';
import { CalendarPlus, Plus, ChevronDown, User, Gift, Users, Heart, Zap, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNextAvailable, formatNextAvailableShort } from '@/hooks/useNextAvailable';

/** Compact "Next available: ..." line shown under a session category item. */
function NextAvailableHint({
    category,
    enabled,
}: {
    category: SessionCategory;
    enabled: boolean;
}) {
    const { slot, loading, noAvailability } = useNextAvailable(category, { enabled });

    if (!enabled) return null;

    let text: string;
    if (loading) text = 'Checking availability…';
    else if (slot) text = `Next available: ${formatNextAvailableShort(slot.time)}`;
    else if (noAvailability) text = 'No immediate availability';
    else return null; // error — stay quiet rather than show a broken hint

    return (
        <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-primary/80">
            <Zap className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{text}</span>
        </span>
    );
}

interface BookSessionDropdownProps {
  variant?: 'default' | 'compact';
  onBookingComplete?: () => void;
  className?: string;
}

export function BookSessionDropdown({ 
  variant = 'default', 
  onBookingComplete,
  className 
}: BookSessionDropdownProps) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionCategory, setSessionCategory] = useState<SessionCategory>('individual');

  const handleBookingComplete = () => {
    onBookingComplete?.();
  };

  const openBookingModal = (category: SessionCategory) => {
    setSessionCategory(category);
    setBookingOpen(true);
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          {variant === 'compact' ? (
            <Button size="sm" className={cn("w-full gap-2", className)}>
              <CalendarPlus className="h-4 w-4" />
              Book a Session
              <ChevronDown className="h-3 w-3 ml-auto" />
            </Button>
          ) : (
            <Button className={cn("gap-2 shadow-soft", className)}>
              <Plus className="h-4 w-4" />
              Book New Session
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="end" 
          className="w-72 max-w-[calc(100vw-1rem)] bg-popover border border-border shadow-lg z-50"
        >
          <DropdownMenuItem 
            onClick={() => openBookingModal('individual')}
            className="cursor-pointer py-3 px-4"
          >
            <User className="h-4 w-4 mr-3 text-primary" />
            <div className="flex flex-col">
              <span className="font-medium">Individual Session</span>
              <span className="text-xs text-muted-foreground">One-on-one therapy</span>
              <NextAvailableHint category="individual" enabled={menuOpen} />
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => openBookingModal('couples')}
            className="cursor-pointer py-3 px-4"
          >
            <Heart className="h-4 w-4 mr-3 text-pink-500" />
            <div className="flex flex-col">
              <span className="font-medium">Couple's Therapy</span>
              <span className="text-xs text-muted-foreground">Sessions for partners</span>
              <NextAvailableHint category="couples" enabled={menuOpen} />
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => openBookingModal('youth')}
            className="cursor-pointer py-3 px-4"
          >
            <Users className="h-4 w-4 mr-3 text-blue-500" />
            <div className="flex flex-col">
              <span className="font-medium">Youth Therapy</span>
              <span className="text-xs text-muted-foreground">For young people</span>
              <NextAvailableHint category="youth" enabled={menuOpen} />
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => openBookingModal('assessment')}
            className="cursor-pointer py-3 px-4"
          >
            <ClipboardCheck className="h-4 w-4 mr-3 text-teal-600" />
            <div className="flex flex-col">
              <span className="font-medium">Assessments</span>
              <span className="text-xs text-muted-foreground">Screenings & clinical assessments</span>
              <NextAvailableHint category="assessment" enabled={menuOpen} />
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={() => setPackageOpen(true)}
            className="cursor-pointer py-3 px-4"
          >
            <Gift className="h-4 w-4 mr-3 text-success" />
            <div className="flex flex-col">
              <span className="font-medium">Session Bundles</span>
              <span className="text-xs text-muted-foreground">Save up to 25%</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BookingModal 
        open={bookingOpen} 
        onOpenChange={setBookingOpen}
        onBookingComplete={handleBookingComplete}
        sessionCategory={sessionCategory}
      />
      
      <PackageBookingModal 
        open={packageOpen} 
        onOpenChange={setPackageOpen}
      />
    </>
  );
}
