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
import { CalendarPlus, Plus, ChevronDown, User, Gift, Users, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      <DropdownMenu>
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
          className="w-64 max-w-[calc(100vw-1rem)] bg-popover border border-border shadow-lg z-50"
        >
          <DropdownMenuItem 
            onClick={() => openBookingModal('individual')}
            className="cursor-pointer py-3 px-4"
          >
            <User className="h-4 w-4 mr-3 text-primary" />
            <div className="flex flex-col">
              <span className="font-medium">Individual Session</span>
              <span className="text-xs text-muted-foreground">One-on-one therapy</span>
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
