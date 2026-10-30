// Discount-code messages for the booking wizard's Pay step
// (docs/QUIZ_BOOKING_FLOW.md §7.3, Q12). Maps the `couponRejected` reasons
// returned by the create-payment-intent edge function onto the same wording
// BookingModal shows, so both booking flows say the same thing.

const COUPON_REJECTIONS: Record<string, string> = {
  unknown_code: "That coupon code isn't recognised.",
  not_signed_in: "We couldn't verify your account to apply this coupon.",
  server_unavailable: "We couldn't verify your coupon right now — please try again.",
  validation_error: "We couldn't verify your coupon right now — please try again.",
  not_earned: "This reward hasn't been unlocked on your account yet.",
  coupon_invalid: 'This coupon is no longer valid.',
  coupon_not_found: 'This coupon is no longer valid.',
  coupon_no_discount: 'This coupon is no longer valid.',
  below_minimum: "This coupon can't be applied to this session.",
  promo_inactive: 'This discount code is no longer active.',
  promo_expired: 'This discount code has expired.',
  promo_restricted: "This discount code can't be used here.",
  promo_minimum: 'This discount code needs a higher order total.',
  promo_currency: "This discount code isn't valid for euro payments.",
  promo_no_discount: "This discount code doesn't reduce this payment.",
  acuity_expired: 'This coupon has expired.',
  acuity_not_applicable: "This coupon doesn't apply to this session type.",
  acuity_package_code:
    "This is a session-bundle code, but we couldn't link it to your account just now — please try again or email hello@fettle.ie.",
  acuity_unsupported: "This code can't be applied here. Email hello@fettle.ie and we'll apply it for you.",
};

export function couponRejectionMessage(reason: string | null | undefined): string {
  const message = COUPON_REJECTIONS[String(reason ?? '')] || 'This coupon could not be applied.';
  return `${message} Proceeding at full price.`;
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
