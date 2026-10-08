import { CalendarCheck, CalendarClock, PhoneMissed, UserX, type LucideIcon } from "lucide-react";
import type { ContactOutcome } from "@/lib/contactOutcomes";

// One icon per contact outcome, shared by the row buttons, bulk bar, badges
// and history.
export const OUTCOME_ICONS: Record<ContactOutcome, LucideIcon> = {
  no_answer: PhoneMissed,
  not_continuing: UserX,
  follow_up_later: CalendarClock,
  booked: CalendarCheck,
};
