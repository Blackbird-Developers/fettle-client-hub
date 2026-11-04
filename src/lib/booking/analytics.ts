// GTM events for the booking wizard (docs/QUIZ_BOOKING_FLOW.md §9,
// docs/GTM_BOOKING_WIZARD.md). GTM loads from src/lib/gtm.ts once VITE_GTM_ID
// is set; until then this only fills window.dataLayer, which nothing reads.
// Analytics must never block or break a booking, so track() never throws.

import { sendFunnelEvent } from './funnel';

export const BOOKING_FLOW = 'hub_quiz';

type DataLayerWindow = Window & { dataLayer?: Record<string, unknown>[] };

export function track(event: string, therapistName: string | null, data: Record<string, unknown> = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer || [];
    const payload = { event, booking_flow: BOOKING_FLOW, therapist: therapistName, ...data };
    w.dataLayer.push(payload);
    // Copy for the admin Booking funnel (src/lib/booking/funnel.ts).
    sendFunnelEvent(event, payload);
  } catch {
    // Analytics never blocks booking.
  }
}
