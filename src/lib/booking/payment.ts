// Payment helpers for the booking wizard (docs/QUIZ_BOOKING_FLOW.md §7,
// §10.4). The edge functions do the money work: confirm-payment-and-book
// captures, cancels or refunds by itself, so the wizard only reads results.

import type { WizardState } from './wizard';

/** Added to Stripe's return_url so the global redirect handler leaves wizard returns alone (C16). */
export const WIZARD_RETURN_PARAM = 'wizard_return';

/** Plan id for "Use 1 of your N remaining sessions". */
export const CREDIT_PLAN_ID = 'credit';

export type PaymentKind = 'session' | 'bundle';

/** What a redirect payment method needs to finish the booking on return (§7.4). */
export interface PendingPayment {
  kind: PaymentKind;
  paymentIntentId: string;
  savedAt: number;
  entry: string;
  state: WizardState;
}

const PENDING_KEY = 'fettle:book-wizard-payment';
const PENDING_MAX_AGE_MS = 60 * 60_000;

export function savePendingPayment(pending: Omit<PendingPayment, 'savedAt'>, now = Date.now()): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, savedAt: now }));
  } catch {
    // If storage is blocked the return still books via the URL's intent id.
  }
}

export function loadPendingPayment(paymentIntentId: string, now = Date.now()): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as PendingPayment;
    if (saved.paymentIntentId !== paymentIntentId || now - saved.savedAt > PENDING_MAX_AGE_MS) return null;
    return saved;
  } catch {
    return null;
  }
}

export function clearPendingPayment(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * The message from a supabase.functions.invoke failure: the function's own
 * `{ error }` / `{ message }` body when there is one (non-2xx responses hide
 * it in error.context), else the error's message. `null` means no response at
 * all (network failure).
 */
export async function functionErrorMessage(error: unknown, data?: unknown): Promise<string | null> {
  const fromBody = (body: unknown): string | undefined => {
    if (!body || typeof body !== 'object') return undefined;
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string' && b.error) return b.error;
    if (typeof b.message === 'string' && b.message) return b.message;
    return undefined;
  };
  const direct = fromBody(data);
  if (direct) return direct;
  if (!error) return 'Something went wrong.';
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).clone().json();
      const msg = fromBody(body);
      if (msg) return msg;
    } catch {
      // Not JSON.
    }
  }
  const name = (error as { name?: string }).name;
  if (name === 'FunctionsFetchError' || name === 'TypeError') return null;
  return error instanceof Error ? error.message : String(error);
}

export interface BookingFailure {
  /** Someone else booked the time first. */
  slotTaken: boolean;
  /** The backend says the money was returned (refund or cancelled authorisation). */
  moneyReturned: 'refunded' | 'not_charged' | null;
  /** The backend's reason without its contact/charge sentences. */
  reason: string;
}

/** Reads a booking function's error text (confirm-payment-and-book, book-with-package). */
export function describeBookingFailure(message: string): BookingFailure {
  const lower = message.toLowerCase();
  const slotTaken =
    lower.includes('no longer available') || lower.includes('already been booked') || lower.includes('already booked');
  const moneyReturned = lower.includes('refund')
    ? 'refunded'
    : lower.includes('not been charged') || lower.includes('payment was already reversed')
      ? 'not_charged'
      : null;
  const reason = message
    .replace(/\s*Your card has not been charged\.?/i, '')
    .replace(/\s*A full refund has been issued to your payment method\.?/i, '')
    .replace(/\s*Please contact hello@fettle\.ie for support\.?/i, '')
    .trim();
  return { slotTaken, moneyReturned, reason: reason || 'We couldn’t complete your booking.' };
}

/** Return URL for redirect payment methods: back to the Pay step with the wizard marker. */
export function wizardReturnUrl(origin: string, entry: string): string {
  const p = new URLSearchParams(entry);
  p.set('step', 'pay');
  p.set(WIZARD_RETURN_PARAM, '1');
  return `${origin}/book?${p.toString()}`;
}
