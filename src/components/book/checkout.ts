// Edge-function calls for the booking wizard's payment paths
// (docs/QUIZ_BOOKING_FLOW.md §7, §10.2, §10.4). Every call returns a plain
// result; the Pay step decides what to show.

import { supabase } from '@/integrations/supabase/client';
import type { IntakeField } from '@/lib/booking/intake';
import { type BookingFailure, describeBookingFailure, functionErrorMessage } from '@/lib/booking/payment';

/** Booking fields shared by every path (the functions read the same names). */
export interface BookingRequest {
  appointmentTypeID: number;
  appointmentTypeName: string;
  appointmentTypePrice: string;
  datetime: string;
  calendarID: number | null;
  calendarName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  intakeFormFields: IntakeField[];
  timezone: string;
}

export type BookingOutcome =
  | { status: 'booked'; appointmentId: string | number | null; remaining?: number; unverified?: boolean }
  | { status: 'failed'; network: boolean; failure: BookingFailure };

async function failedOutcome(error: unknown, data?: unknown): Promise<BookingOutcome> {
  const message = await functionErrorMessage(error, data);
  if (message === null) {
    return { status: 'failed', network: true, failure: describeBookingFailure('') };
  }
  return { status: 'failed', network: false, failure: describeBookingFailure(message) };
}

function hasError(data: unknown): boolean {
  return !!data && typeof data === 'object' && 'error' in data && !!(data as { error?: unknown }).error;
}

/** The fields create-payment-intent / book-with-credit expect (intake fields as a JSON string). */
function sessionBody(req: BookingRequest) {
  return {
    ...req,
    phone: req.phone || undefined,
    notes: req.notes || undefined,
    calendarName: req.calendarName || undefined,
    intakeFormFields: JSON.stringify(req.intakeFormFields),
  };
}

export interface SessionIntent {
  clientSecret?: string;
  paymentIntentId?: string;
  amount?: number;
  originalAmount?: number;
  discountApplied?: boolean;
  discountPercent?: number;
  discountAmount?: number;
  couponRejected?: string;
  referralCreditApplied?: number;
  fullyCovered?: boolean;
  packageCertificate?: { code: string };
}

/** Single session or psychologist consultation: one PaymentIntent (§7.1 step 2). */
export async function createSessionIntent(
  req: BookingRequest,
  options: { couponCode?: string; useReferralCredit?: boolean }
): Promise<{ ok: true; intent: SessionIntent } | { ok: false; message: string | null }> {
  const { data, error } = await supabase.functions.invoke('create-payment-intent', {
    body: {
      ...sessionBody(req),
      couponCode: options.couponCode || undefined,
      useReferralCredit: !!options.useReferralCredit,
    },
  });
  if (error || hasError(data)) return { ok: false, message: await functionErrorMessage(error, data) };
  return { ok: true, intent: data as SessionIntent };
}

/** After Stripe confirms: book in Acuity (the function captures/cancels/refunds itself). */
export async function completeSessionPayment(paymentIntentId: string): Promise<BookingOutcome> {
  const { data, error } = await supabase.functions.invoke('confirm-payment-and-book', { body: { paymentIntentId } });
  if (error || hasError(data) || data?.success === false) return failedOutcome(error, data);
  if (data?.pending) return { status: 'booked', appointmentId: null, unverified: true };
  return { status: 'booked', appointmentId: data?.appointment?.id ?? null };
}

/** Referral credit covers the whole price: no card (fullyCovered). */
export async function bookWithReferralCredit(req: BookingRequest): Promise<BookingOutcome> {
  const { data, error } = await supabase.functions.invoke('book-with-credit', { body: sessionBody(req) });
  if (error || hasError(data)) return failedOutcome(error, data);
  return { status: 'booked', appointmentId: data?.appointment?.id ?? null };
}

/** Uses one credit from a user_packages row (C2: book-with-package, not book-with-credit). */
export async function bookWithPackageCredit(packageId: string, req: BookingRequest): Promise<BookingOutcome> {
  const { data, error } = await supabase.functions.invoke('book-with-package', {
    body: {
      packageId,
      appointmentTypeID: req.appointmentTypeID,
      datetime: req.datetime,
      calendarID: req.calendarID,
      firstName: req.firstName,
      lastName: req.lastName,
      email: req.email,
      phone: req.phone || undefined,
      notes: req.notes || undefined,
      intakeFormFields: req.intakeFormFields,
      timezone: req.timezone,
    },
  });
  if (error || hasError(data)) return failedOutcome(error, data);
  return {
    status: 'booked',
    appointmentId: data?.appointment?.id ?? null,
    remaining: typeof data?.remainingSessions === 'number' ? data.remainingSessions : undefined,
  };
}

export interface BundleIntent {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  originalAmount: number;
  referralCreditApplied: number;
}

/**
 * New bundle: the PaymentIntent for the package (§10.4). Referral credit is
 * taken off by the function and redeemed by confirm-package-payment. A bundle
 * has no no-charge purchase path, so `creditCoversAll` means "set it up again
 * without the credit".
 */
export async function createBundleIntent(
  bundleId: number,
  contact: { firstName: string; lastName: string; email: string; phone: string },
  options: { useReferralCredit?: boolean } = {}
): Promise<
  { ok: true; creditCoversAll: true } | { ok: true; creditCoversAll: false; intent: BundleIntent } | { ok: false; message: string | null }
> {
  const { data, error } = await supabase.functions.invoke('create-package-payment-intent', {
    body: { packageId: bundleId, ...contact, phone: contact.phone || undefined, useReferralCredit: !!options.useReferralCredit },
  });
  if (!error && !hasError(data) && data?.fullyCovered) return { ok: true, creditCoversAll: true };
  if (error || hasError(data) || !data?.clientSecret) {
    return { ok: false, message: await functionErrorMessage(error, data) };
  }
  const amount = Number(data.amount);
  return {
    ok: true,
    creditCoversAll: false,
    intent: {
      clientSecret: data.clientSecret,
      paymentIntentId: data.paymentIntentId,
      amount,
      originalAmount: Number(data.originalAmount ?? amount),
      referralCreditApplied: Number(data.referralCreditApplied ?? 0),
    },
  };
}

/** After Stripe confirms a bundle: create the package; returns its user_packages id. */
export async function confirmBundlePayment(
  paymentIntentId: string
): Promise<{ ok: true; packageId: string; remaining: number } | { ok: false; message: string | null }> {
  const { data, error } = await supabase.functions.invoke('confirm-package-payment', { body: { paymentIntentId } });
  if (error || hasError(data) || data?.success === false || !data?.package?.id) {
    return { ok: false, message: await functionErrorMessage(error, data) };
  }
  return { ok: true, packageId: String(data.package.id), remaining: Number(data.package.remaining ?? 0) };
}

export interface LinkedBundle {
  ok: boolean;
  /** Why redeem-package-code refused it (wrong_email, used_up, discount_code…). */
  reason?: string;
  message?: string;
  applicable?: boolean;
  alreadyLinked?: boolean;
  remainingSessions?: number;
  categoryLabel?: string;
  package?: { id: string };
}

/** A bundle certificate typed in the discount field (BUNDLE_CODES.md). */
export async function redeemBundleCode(code: string, appointmentTypeID: number): Promise<LinkedBundle> {
  const { data, error } = await supabase.functions.invoke('redeem-package-code', { body: { code, appointmentTypeID } });
  if (error) {
    const message = await functionErrorMessage(error, data);
    return { ok: false, message: message ?? 'We couldn’t link this bundle code right now. Please try again.' };
  }
  return (data ?? { ok: false }) as LinkedBundle;
}
