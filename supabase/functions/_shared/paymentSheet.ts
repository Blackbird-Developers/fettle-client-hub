// Extra fields for the app's native Stripe PaymentSheet: the Stripe customer
// and an ephemeral key for it, so PaymentSheet can show saved cards and
// Apple Pay / Google Pay. The website's Payment Element ignores them.
//
// An ephemeral key lets the holder read and use that customer's saved cards,
// so it is only issued when the Stripe customer is the signed-in caller's own
// (the customer's email is the JWT email). Otherwise both fields are null and
// PaymentSheet still works, just without saved cards.
import Stripe from "https://esm.sh/stripe@18.5.0";

// Must match the apiVersion the functions construct Stripe with; the app's
// @stripe/stripe-react-native accepts ephemeral keys of any API version.
const STRIPE_API_VERSION = "2025-08-27.basil";

export interface PaymentSheetFields {
  customerId: string | null;
  ephemeralKey: string | null;
}

export async function paymentSheetFields(
  stripe: Stripe,
  customerId: string | null | undefined,
  customerEmail: string | null | undefined,
  callerEmail: string | null | undefined,
): Promise<PaymentSheetFields> {
  const none = { customerId: null, ephemeralKey: null };
  if (!customerId) return none;
  const a = (customerEmail ?? "").trim().toLowerCase();
  const b = (callerEmail ?? "").trim().toLowerCase();
  if (!a || a !== b) return none;
  try {
    const key = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: STRIPE_API_VERSION },
    );
    return { customerId, ephemeralKey: key.secret ?? null };
  } catch (e) {
    // The restricted key may lack the ephemeral-key permission. Never block
    // the payment over it: PaymentSheet works without saved cards.
    console.log(`[PAYMENT-SHEET] ephemeral key not created: ${String(e).slice(0, 200)}`);
    return { customerId, ephemeralKey: null };
  }
}
