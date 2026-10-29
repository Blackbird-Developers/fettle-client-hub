// GTM events for the booking wizard (docs/QUIZ_BOOKING_FLOW.md §9). The hub
// has no GTM container yet (Q11): until one is added to index.html this only
// fills window.dataLayer, which nothing reads. Analytics must never block or
// break a booking, so track() never throws.

export const BOOKING_FLOW = 'hub_quiz';

type DataLayerWindow = Window & { dataLayer?: Record<string, unknown>[] };

export function track(event: string, therapistName: string | null, data: Record<string, unknown> = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event, booking_flow: BOOKING_FLOW, therapist: therapistName, ...data });
  } catch {
    // Analytics never blocks booking.
  }
}
