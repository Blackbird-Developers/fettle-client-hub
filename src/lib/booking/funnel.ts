// Booking-funnel beacons (docs/BOOKING_FUNNEL_TRACKING.md): the hub's copy of
// the website forwarder. track() hands every wizard event here, and bundle
// purchases are reported with trackBundlePurchased(). Events go to the
// track-booking-funnel edge function, which feeds the admin "Booking funnel"
// tab. Nothing personal is sent: only the fields in KEEP.
//
// The session id lives in sessionStorage for 45 idle minutes. When a client
// arrives from the website's bundle hand-off (my.fettle.ie/packages?fs=…),
// captureFunnelSessionFromUrl() adopts the website's id, so the purchase is
// counted on the same funnel session as the website steps.
//
// Never throws: analytics must not block booking.

const ENDPOINT_PATH = '/functions/v1/track-booking-funnel';
const STORAGE_KEY = 'fettle_funnel';
export const FUNNEL_IDLE_MS = 45 * 60 * 1000;
const MAX_BATCH = 25;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Wizard events the funnel keeps. stripe-success-conversion and consultation_reserved carry personal data and duplicate booking_completed. */
const FUNNEL_EVENTS = new Set([
  'booking_page_view',
  'booking_step_view',
  'booking_time_selected',
  'booking_plan_selected',
  'booking_plan_confirmed',
  'booking_details_submitted',
  'booking_payment_initiated',
  'booking_payment_submitted',
  'booking_payment_failed',
  'booking_completed',
  'booking_referral_source',
  'booking_bundle_purchased',
]);

const KEEP = [
  'booking_flow', 'step_name', 'step', 'therapist', 'therapist_id', 'entry_therapist', 'who',
  'package_id', 'booking_id', 'amount', 'reason', 'referral_source',
] as const;

/** Events that send straight away, because the page may change next. */
const FLUSH_NOW = new Set(['booking_completed', 'booking_bundle_purchased']);

interface StoredSession { id: string; last: number; fromWebsite?: boolean }

type FunnelEvent = Record<string, unknown> & { event_id: string; event: string; ts: number };

let queue: FunnelEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function randomId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

function readSession(): StoredSession | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return s && typeof s.id === 'string' && ID_RE.test(s.id) && typeof s.last === 'number' ? s : null;
  } catch {
    return null;
  }
}

function writeSession(s: StoredSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // private mode etc.: the id just won't survive a reload
  }
}

/** The current funnel session id; a new one after 45 idle minutes. */
export function funnelSessionId(now = Date.now()): string {
  let s = readSession();
  if (!s || now - s.last > FUNNEL_IDLE_MS) s = { id: randomId('fs_'), last: now };
  s.last = now;
  writeSession(s);
  return s.id;
}

/**
 * Adopts the website's session id from ?fs= (bundle hand-off). Call once at
 * start-up, before routing can drop the query string (e.g. a redirect to /login).
 */
export function captureFunnelSessionFromUrl(search: string = typeof location === 'undefined' ? '' : location.search, now = Date.now()): void {
  try {
    const fs = new URLSearchParams(search).get('fs')?.trim();
    if (fs && ID_RE.test(fs)) writeSession({ id: fs, last: now, fromWebsite: true });
  } catch {
    // ignore
  }
}

function endpoint(): string | null {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
  return base ? base + ENDPOINT_PATH : null;
}

function device(): 'mobile' | 'tablet' | 'desktop' {
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth || 1024;
  return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
}

function send(body: string): void {
  const url = endpoint();
  if (!url) return;
  try {
    const blob = new Blob([body], { type: 'text/plain' });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon?.(url, blob)) return;
    void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch {
    // ignore
  }
}

/** Sends everything queued. Exported for tests and page-hide. */
export function flushFunnel(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    const params = new URLSearchParams(location.search);
    while (queue.length) {
      const events = queue.splice(0, MAX_BATCH);
      send(JSON.stringify({
        session_id: funnelSessionId(),
        flow: 'hub',
        // Local dev runs are test data. (Vercel previews aren't an allowed origin, so they never arrive.)
        is_test: import.meta.env.DEV === true,
        context: {
          device: device(),
          page: location.pathname,
          utm_source: params.get('utm_source'),
          utm_medium: params.get('utm_medium'),
          utm_campaign: params.get('utm_campaign'),
        },
        events,
      }));
    }
  } catch {
    queue = [];
  }
}

function listenForPageHide(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushFunnel();
  });
  window.addEventListener('pagehide', flushFunnel);
}

/** Queues one event for the funnel. Unknown events are ignored. */
export function sendFunnelEvent(event: string, data: Record<string, unknown> = {}, eventId?: string): void {
  try {
    if (typeof window === 'undefined' || !FUNNEL_EVENTS.has(event)) return;
    const out: FunnelEvent = { event_id: eventId && ID_RE.test(eventId) ? eventId : randomId('ev_'), event, ts: Date.now() };
    for (const key of KEEP) {
      const v = data[key];
      if (v !== undefined && v !== null) out[key] = v;
    }
    queue.push(out);
    listenForPageHide();
    if (FLUSH_NOW.has(event)) flushFunnel();
    else if (!timer) timer = setTimeout(flushFunnel, 1000);
  } catch {
    // Analytics never blocks booking.
  }
}

/**
 * A bundle was bought. The event id comes from the PaymentIntent, so the
 * several places that confirm a purchase (form, wallet redirect, wizard)
 * can all call this and it is still counted once.
 */
export function trackBundlePurchased(paymentIntentId: string | null | undefined, data: { package_id?: string | number | null; amount?: number | null } = {}): void {
  const id = paymentIntentId ? `bp_${paymentIntentId}`.slice(0, 64) : undefined;
  sendFunnelEvent('booking_bundle_purchased', {
    booking_flow: readSession()?.fromWebsite ? 'website_bundle_handoff' : 'hub_packages',
    package_id: data.package_id != null ? String(data.package_id) : null,
    amount: data.amount ?? null,
  }, id);
}

/** Test helper: clears the queue and timer. */
export function resetFunnelForTests(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}
