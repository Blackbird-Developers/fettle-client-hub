// Retry safety for the bookings that have no PaymentIntent to hang
// idempotency on (book-with-package, book-with-credit). The app retries a
// request when the network drops, so the same booking can arrive twice, or
// twice at once.
//
//   claimOnce            one live invocation per key (booking_claims table,
//                        the same lock confirm-payment-and-book uses).
//   findOwnAppointmentAt the caller's existing appointment at that start time,
//                        so a retry returns the first booking instead of
//                        failing with "slot no longer available".

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = { rpc: (fn: string, args: Record<string, unknown>) => any };

// True when this invocation holds the claim. Fail-open (true) if the lock
// can't be reached, as the confirm functions do.
export async function claimOnce(admin: SupabaseAdmin, key: string, ttlSeconds = 90): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("claim_booking", {
      p_payment_intent_id: key,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) return true;
    return data === true;
  } catch (_e) {
    return true;
  }
}

// The caller's non-cancelled appointment starting within a minute of
// `datetime`, or null. `inconclusive` when Acuity couldn't be asked.
export async function findOwnAppointmentAt(
  acuityAuth: string,
  email: string,
  datetime: string,
  // deno-lint-ignore no-explicit-any
): Promise<{ appointment: any | null; inconclusive: boolean }> {
  const wantMs = Date.parse(datetime);
  if (!email || Number.isNaN(wantMs)) return { appointment: null, inconclusive: false };
  const dayMs = 24 * 60 * 60 * 1000;
  const minDate = new Date(wantMs - dayMs).toISOString().slice(0, 10);
  const maxDate = new Date(wantMs + dayMs).toISOString().slice(0, 10);
  try {
    const resp = await fetch(
      `https://acuityscheduling.com/api/v1/appointments?email=${encodeURIComponent(email)}` +
        `&minDate=${minDate}&maxDate=${maxDate}&max=100`,
      { headers: { Authorization: `Basic ${acuityAuth}`, "Content-Type": "application/json" } },
    );
    if (!resp.ok) return { appointment: null, inconclusive: true };
    const appts = await resp.json();
    if (!Array.isArray(appts)) return { appointment: null, inconclusive: true };
    const match = appts.find((a) =>
      a?.canceled !== true && a?.datetime && Math.abs(Date.parse(a.datetime) - wantMs) < 60 * 1000
    );
    return { appointment: match ?? null, inconclusive: false };
  } catch (_e) {
    return { appointment: null, inconclusive: true };
  }
}
