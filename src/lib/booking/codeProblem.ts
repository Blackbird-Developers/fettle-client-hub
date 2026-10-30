// What to tell a client when the code they typed on the booking confirm step
// can't be used. Rejected codes must never push the client into card payment
// silently: the confirm step shows the reason and lets them choose to try
// another code, pay for the session, or contact the clinic.

export const SUPPORT_EMAIL = 'hello@fettle.ie';

export interface CodeProblem {
    code: string;
    reason: string;
    title: string;
    message: string;
}

// couponRejected reasons from create-payment-intent where Stripe and the
// loyalty rewards didn't recognise the code, so it may be an Acuity session
// bundle. These are re-checked with redeem-package-code, which knows why
// Acuity refused a bundle (other email, used up, wrong session type…).
const MAYBE_BUNDLE = new Set([
    'unknown_code',
    'acuity_expired',
    'acuity_not_applicable',
    'acuity_package_code',
]);

export function shouldCheckAsBundle(couponRejected: string | null | undefined): boolean {
    return MAYBE_BUNDLE.has(String(couponRejected ?? ''));
}

// Copy for codes the hub did recognise as a discount code.
const COUPON_MESSAGES: Record<string, string> = {
    unknown_code: "That code isn't recognised.",
    not_signed_in: "We couldn't verify your account to apply this code.",
    server_unavailable: "We couldn't check your code right now. Please try again.",
    validation_error: "We couldn't check your code right now. Please try again.",
    not_earned: "This reward hasn't been unlocked on your account yet.",
    coupon_invalid: 'This code is no longer valid.',
    coupon_not_found: 'This code is no longer valid.',
    coupon_no_discount: 'This code is no longer valid.',
    below_minimum: "This code can't be applied to this session.",
    promo_inactive: 'This discount code is no longer active.',
    promo_expired: 'This discount code has expired.',
    promo_restricted: "This discount code can't be used here.",
    promo_minimum: 'This discount code needs a higher order total.',
    promo_currency: "This discount code isn't valid for euro payments.",
    promo_no_discount: "This discount code doesn't reduce this payment.",
    acuity_expired: 'This code has expired.',
    acuity_not_applicable: "This code doesn't apply to this session type.",
    acuity_package_code: `This is a session-bundle code, but we couldn't link it to your account just now. Please try again or email ${SUPPORT_EMAIL}.`,
    acuity_unsupported: `This code can't be applied here. Email ${SUPPORT_EMAIL} and we'll apply it for you.`,
};

export function couponProblem(code: string, couponRejected: string): CodeProblem {
    return {
        code,
        reason: couponRejected,
        title: "This code can't be used",
        message: COUPON_MESSAGES[couponRejected] || "This code couldn't be applied.",
    };
}

// Titles for the reasons redeem-package-code returns. Its own `message`
// (which already names the support email where useful) is the body.
const BUNDLE_TITLES: Record<string, string> = {
    wrong_email: 'This bundle is registered to a different email',
    used_up: 'All sessions on this bundle are used',
    not_applicable: 'This bundle is for a different session type',
    expired: 'This bundle has expired',
    invalid_code: "We couldn't find that code",
    server_unavailable: "We couldn't check that code right now",
    server_error: "We couldn't check that code right now",
    not_signed_in: 'Please sign in again',
    unsupported: "This code can't be used here",
};

export function bundleProblem(
    code: string,
    redeem: { reason?: string | null; message?: string | null } | null | undefined,
    couponRejected?: string | null,
): CodeProblem {
    const reason = String(redeem?.reason ?? '');
    // Acuity says it's a discount code, not a bundle: the discount itself was
    // refused, so explain that with the coupon wording.
    if (reason === 'discount_code' && couponRejected) {
        return couponProblem(code, couponRejected);
    }
    return {
        code,
        reason: reason || 'unknown',
        title: BUNDLE_TITLES[reason] || "This code can't be used",
        message:
            redeem?.message ||
            `We couldn't use this code. Please try again or email ${SUPPORT_EMAIL}.`,
    };
}

/** mailto: link with the code and reason filled in, for the "Contact us" choice. */
export function supportMailto(problem: CodeProblem): string {
    const subject = `Problem using my code ${problem.code}`;
    const body = `Hi Fettle,\n\nI tried to use the code ${problem.code} to book a session in the hub, but it said: "${problem.title}".\n\nCould you help?\n`;
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
