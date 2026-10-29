// Discount-code messages for the booking wizard's Pay step
// (docs/QUIZ_BOOKING_FLOW.md §7.3). Maps the `couponRejected` reasons
// returned by the create-payment-intent edge function onto the website copy.

const EXPIRED = new Set(['promo_expired', 'acuity_expired']);
// promo_restricted is also returned for other customer restrictions; the
// wording is pending Fettle (Q12).
const NEW_CLIENTS_ONLY = new Set(['promo_restricted']);
const NOT_FOR_THIS_SESSION = new Set(['acuity_not_applicable', 'promo_minimum', 'below_minimum', 'promo_currency']);

export function couponRejectionMessage(reason: string | null | undefined): string {
  const r = String(reason ?? '');
  if (EXPIRED.has(r)) return 'That code has expired, so the full price applies.';
  if (NEW_CLIENTS_ONLY.has(r)) return 'This code is for new clients only, so the full price applies.';
  if (NOT_FOR_THIS_SESSION.has(r)) return 'This code can’t be used for this session, so the full price applies.';
  return 'That code couldn’t be applied, so the full price applies.';
}

/** "Code applied: you pay €85.00 (was €95.00)." Amounts in euro. */
export function couponAppliedMessage(pay: number, was: number): string {
  return `Code applied: you pay ${euroWithCents(pay)} (was ${euroWithCents(was)}).`;
}

/** "€95.00": the Pay step always shows cents. */
export function euroWithCents(amount: number): string {
  return `€${(Math.round(amount * 100) / 100).toFixed(2)}`;
}

/** Codes are saved uppercased and trimmed. */
export function normaliseCouponCode(code: string): string {
  return code.trim().toUpperCase();
}
