// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingPayment,
  describeBookingFailure,
  functionErrorMessage,
  loadPendingPayment,
  savePendingPayment,
  wizardReturnUrl,
} from "./payment";
import { initialState } from "./wizard";

describe("describeBookingFailure", () => {
  it("spots a taken slot after a refund", () => {
    expect(
      describeBookingFailure(
        "This time slot is no longer available. Please select a different time. A full refund has been issued to your payment method. Please contact hello@fettle.ie for support."
      )
    ).toEqual({
      slotTaken: true,
      moneyReturned: "refunded",
      reason: "This time slot is no longer available. Please select a different time.",
    });
  });

  it("spots a cancelled authorisation and other failures", () => {
    const f = describeBookingFailure(
      "We couldn't complete your booking at this time. Your card has not been charged. Please contact hello@fettle.ie for support."
    );
    expect(f).toEqual({ slotTaken: false, moneyReturned: "not_charged", reason: "We couldn't complete your booking at this time." });
    expect(describeBookingFailure("This time slot has already been booked. Please select a different time.").slotTaken).toBe(true);
    expect(describeBookingFailure("Acuity down").moneyReturned).toBeNull();
  });
});

describe("functionErrorMessage", () => {
  it("prefers the function's own body", async () => {
    expect(await functionErrorMessage(null, { error: "Invalid package ID" })).toBe("Invalid package ID");
    const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify({ error: "This time slot is no longer available." }), { status: 500 }),
    });
    expect(await functionErrorMessage(httpError)).toBe("This time slot is no longer available.");
  });

  it("returns null for network failures", async () => {
    const fetchError = Object.assign(new Error("Failed to send a request"), { name: "FunctionsFetchError" });
    expect(await functionErrorMessage(fetchError)).toBeNull();
  });
});

describe("pending payment", () => {
  afterEach(() => clearPendingPayment());

  it("restores the saved flow for the same intent only", () => {
    savePendingPayment({ kind: "bundle", paymentIntentId: "pi_1", entry: "therapist=7", state: initialState({ planId: "996385" }) }, 1000);
    expect(loadPendingPayment("pi_1", 2000)?.state.planId).toBe("996385");
    expect(loadPendingPayment("pi_2", 2000)).toBeNull();
    expect(loadPendingPayment("pi_1", 1000 + 61 * 60_000)).toBeNull();
  });
});

describe("wizardReturnUrl", () => {
  it("returns to the Pay step with the wizard marker", () => {
    expect(wizardReturnUrl("https://my.fettle.ie", "therapist=7&service=individual")).toBe(
      "https://my.fettle.ie/book?therapist=7&service=individual&step=pay&wizard_return=1"
    );
  });
});
