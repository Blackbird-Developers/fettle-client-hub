import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BookingWizard } from "@/components/book/BookingWizard";

/**
 * /book: the time-first booking wizard (docs/QUIZ_BOOKING_FLOW.md).
 * Query params: therapist (table id, calendar id, profile slug or name),
 * service (individual | couples | youth), type (depression | anxiety | ocd),
 * slot (ISO datetime) and step (kept in the URL so Back works).
 */
export default function Book() {
  return (
    <DashboardLayout>
      <BookingWizard />
    </DashboardLayout>
  );
}
