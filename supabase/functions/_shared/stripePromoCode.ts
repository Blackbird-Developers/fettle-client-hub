// Stripe promotion codes (marketing discount codes) for bundle purchases.
// The checks, their order and the reasons are the same as the promotion-code
// block in create-payment-intent (which mirrors the [Website] booking widget),
// so a code behaves the same on single sessions and bundles.

export type PromoCodeResult =
  | {
      ok: true;
      /** Cents off, never more than the original amount. */
      offCents: number;
      /** 0 for fixed-amount codes. */
      percentOff: number;
      promotionCodeId: string;
      couponId: string;
    }
  | { ok: false; reason: string };

// deno-lint-ignore no-explicit-any
export async function checkStripePromoCode(stripe: any, code: string, originalAmount: number): Promise<PromoCodeResult> {
  try {
    const listed = await stripe.promotionCodes.list({ code, active: true, limit: 20 });
    const matches = Array.isArray(listed?.data) ? listed.data : [];
    // deno-lint-ignore no-explicit-any
    const promo = matches.find((p: any) => (p?.code || "").trim().toLowerCase() === code.toLowerCase());
    if (!promo) return { ok: false, reason: "unknown_code" };

    const promoCoupon = promo.coupon;
    const restrictions = promo.restrictions || {};
    if (!promo.active || !promoCoupon || promoCoupon.valid === false) return { ok: false, reason: "promo_inactive" };
    // Customer-restricted codes can't be safely honoured here.
    if (promo.customer) return { ok: false, reason: "promo_restricted" };
    if (promo.expires_at && promo.expires_at * 1000 <= Date.now()) return { ok: false, reason: "promo_expired" };
    // Only Stripe-hosted checkout can enforce first-time-only.
    if (restrictions.first_time_transaction) return { ok: false, reason: "promo_restricted" };
    if (
      typeof restrictions.minimum_amount === "number" &&
      (String(restrictions.minimum_amount_currency || "eur").toLowerCase() !== "eur" ||
        originalAmount < restrictions.minimum_amount)
    ) {
      return { ok: false, reason: "promo_minimum" };
    }

    let off = 0;
    let percentOff = 0;
    if (typeof promoCoupon.percent_off === "number" && promoCoupon.percent_off > 0) {
      off = Math.round(originalAmount * promoCoupon.percent_off / 100);
      percentOff = promoCoupon.percent_off;
    } else if (typeof promoCoupon.amount_off === "number" && promoCoupon.amount_off > 0) {
      if (promoCoupon.currency && String(promoCoupon.currency).toLowerCase() !== "eur") {
        return { ok: false, reason: "promo_currency" };
      }
      off = promoCoupon.amount_off;
    } else {
      const eurOption = (promoCoupon.currency_options || {})["eur"];
      if (eurOption && typeof eurOption.amount_off === "number" && eurOption.amount_off > 0) {
        off = eurOption.amount_off;
      }
    }
    if (off <= 0) return { ok: false, reason: "promo_no_discount" };

    return {
      ok: true,
      offCents: Math.min(off, originalAmount),
      percentOff,
      promotionCodeId: promo.id,
      couponId: promoCoupon.id || "",
    };
  } catch (_e) {
    return { ok: false, reason: "validation_error" };
  }
}
