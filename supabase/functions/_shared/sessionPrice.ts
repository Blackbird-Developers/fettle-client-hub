// Session prices, looked up on the server. The price always comes from Acuity
// (plus the overrides below), never from the request, so a client cannot pay
// less (or spend less credit) by editing it. Used by create-payment-intent and
// book-with-credit.

const logStep = (step: string, details?: unknown) =>
  console.log(`[SESSION-PRICE] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

// Session types sold at a different price than their Acuity record lists.
// Must match priceOverride in src/lib/assessments.ts.
export const PRICE_OVERRIDES: Record<string, string> = {
  "94856237": "140.00", // Addiction Assessment
};

// The price always comes from Acuity (plus the overrides above), never from
// the request, so a client can't change it in the browser and pay less.
export async function lookUpSessionPrice(
  appointmentTypeID: string,
): Promise<{ price: number; name: string } | null> {
  const acuityUserId = Deno.env.get("ACUITY_USER_ID");
  const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
  if (!acuityUserId || !acuityApiKey) {
    throw new Error("Our booking system is temporarily unavailable. Please contact hello@fettle.ie for support.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let types: any[];
  try {
    const resp = await fetch("https://acuityscheduling.com/api/v1/appointment-types", {
      headers: {
        Authorization: `Basic ${btoa(`${acuityUserId}:${acuityApiKey}`)}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Acuity responded ${resp.status}`);
    types = await resp.json();
  } catch (e) {
    logStep("Appointment type lookup failed", { error: String(e) });
    throw new Error("We couldn't check the session price just now. Please try again in a moment.");
  } finally {
    clearTimeout(timeoutId);
  }

  const type = Array.isArray(types)
    ? types.find((t) => String(t?.id) === appointmentTypeID)
    : undefined;
  if (!type) return null;

  const price = parseFloat(PRICE_OVERRIDES[appointmentTypeID] ?? String(type.price ?? "0"));
  return { price, name: String(type.name ?? "") };
}

