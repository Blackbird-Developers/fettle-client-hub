// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { BOOKING_FLOW, track } from "./analytics";
import { couponAppliedMessage, couponRejectionMessage, euroWithCents, normaliseCouponCode } from "./coupon";
import { type BookingDetails, hasCompleteContact, validateDetails } from "./details";
import { intakeFieldsFor } from "./intake";
import { NOTES_MAX_LENGTH, buildBookingNotes } from "./notes";

describe("buildBookingNotes", () => {
  it("builds the notes in order, skipping empty parts", () => {
    expect(
      buildBookingNotes({
        service: "individual",
        topicIds: ["anxiety", "stress"],
        history: "first",
        clientNote: "Evenings suit me best.",
      })
    ).toBe(
      "Booked via My Fettle (quiz flow). For: individual therapy. Focus: anxiety and worry, stress and burnout. Therapy before: This is my first time. Client note: Evenings suit me best."
    );
    expect(buildBookingNotes({ service: "psychologist" })).toBe(
      "Booked via My Fettle (quiz flow). For: psychology consultation."
    );
  });

  it("uses youth wording and the young person's name", () => {
    expect(buildBookingNotes({ service: "youth", history: "past", youngPersonName: " Jamie " })).toBe(
      "Booked via My Fettle (quiz flow). For: youth therapy. Therapy before: They’ve had therapy before. Young person: Jamie."
    );
  });

  it("adds the partner for couples", () => {
    expect(buildBookingNotes({ service: "couples", partnerName: "Alex Byrne (he/him)" })).toBe(
      "Booked via My Fettle (quiz flow). For: couples therapy. Partner: Alex Byrne (he/him)."
    );
  });

  it("caps the notes at 500 characters by trimming the client note", () => {
    const notes = buildBookingNotes({ service: "individual", history: "past", clientNote: "x".repeat(900) });
    expect(notes).toHaveLength(NOTES_MAX_LENGTH);
    expect(notes).toMatch(/Therapy before: I’ve had therapy before\. Client note: x+…$/);
  });
});

describe("intakeFieldsFor", () => {
  it("sends the right Acuity fields per service", () => {
    expect(intakeFieldsFor("individual").map((f) => f.id)).toEqual([10466116, 9292394, 9292405]);
    expect(intakeFieldsFor("couples", " Alex ")).toEqual([
      { id: 10466116, value: "yes" },
      { id: 9292394, value: "yes" },
      { id: 9292405, value: "yes" },
      { id: 10104284, value: "Alex" },
    ]);
    expect(intakeFieldsFor("youth").map((f) => f.id)).toEqual([13686405, 9292405]);
    expect(intakeFieldsFor("psychologist")).toEqual([{ id: 9291898, value: "yes" }]);
  });

  it("never sends an empty value", () => {
    expect(intakeFieldsFor("couples", "  ").every((f) => f.value)).toBe(true);
  });
});

describe("coupon messages", () => {
  it("maps rejection reasons onto the website copy", () => {
    expect(couponRejectionMessage("promo_expired")).toBe("That code has expired, so the full price applies.");
    expect(couponRejectionMessage("acuity_expired")).toBe("That code has expired, so the full price applies.");
    expect(couponRejectionMessage("promo_restricted")).toBe(
      "This code is for new clients only, so the full price applies."
    );
    expect(couponRejectionMessage("below_minimum")).toBe(
      "This code can’t be used for this session, so the full price applies."
    );
    expect(couponRejectionMessage("unknown_code")).toBe("That code couldn’t be applied, so the full price applies.");
    expect(couponRejectionMessage(undefined)).toBe("That code couldn’t be applied, so the full price applies.");
  });

  it("formats the applied message and codes", () => {
    expect(couponAppliedMessage(85, 95)).toBe("Code applied: you pay €85.00 (was €95.00).");
    expect(euroWithCents(271.5)).toBe("€271.50");
    expect(normaliseCouponCode("  fettleloyalty4 ")).toBe("FETTLELOYALTY4");
  });
});

describe("validateDetails", () => {
  const valid: BookingDetails = {
    firstName: "Sarah",
    lastName: "Byrne",
    email: "sarah@example.com",
    phone: "+353 87 123 4567",
    partnerName: "",
    youngPersonName: "",
    note: "",
  };

  it("accepts valid details", () => {
    expect(validateDetails(valid, "individual")).toEqual({});
    expect(hasCompleteContact(valid)).toBe(true);
  });

  it("gives the website's messages", () => {
    expect(validateDetails({ ...valid, firstName: "", lastName: "B" }, "individual")).toEqual({
      firstName: "Please enter your first name",
      lastName: "Last name must be at least 2 characters",
    });
    expect(validateDetails({ ...valid, firstName: "a".repeat(51) }, "individual").firstName).toBe(
      "First name must be under 50 characters"
    );
    expect(validateDetails({ ...valid, email: "" }, "individual").email).toBe("Please enter your email");
    expect(validateDetails({ ...valid, email: "sarah@example" }, "individual").email).toBe(
      "Please enter a valid email address"
    );
    expect(validateDetails({ ...valid, phone: "" }, "individual").phone).toBe("Please enter your mobile number");
    expect(validateDetails({ ...valid, phone: "087 12" }, "individual").phone).toBe("Please enter a valid phone number");
    expect(validateDetails({ ...valid, phone: "087 123 456x" }, "individual").phone).toBe(
      "Please enter a valid phone number"
    );
  });

  it("requires the partner's name for couples only", () => {
    expect(validateDetails(valid, "couples").partnerName).toBe("Please add your partner’s name");
    expect(validateDetails(valid, "youth").partnerName).toBeUndefined();
    expect(hasCompleteContact({ ...valid, phone: "" })).toBe(false);
  });
});

describe("track", () => {
  afterEach(() => {
    delete (window as Window & { dataLayer?: unknown }).dataLayer;
  });

  it("pushes the event with the flow name and therapist", () => {
    track("booking_step_view", "Lisa Kelly", { step_name: "slot", step: 2 });
    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toEqual([
      { event: "booking_step_view", booking_flow: BOOKING_FLOW, therapist: "Lisa Kelly", step_name: "slot", step: 2 },
    ]);
  });

  it("never throws", () => {
    Object.defineProperty(window, "dataLayer", {
      configurable: true,
      get: () => ({
        push: () => {
          throw new Error("broken");
        },
      }),
    });
    expect(() => track("booking_page_view", null)).not.toThrow();
  });
});
