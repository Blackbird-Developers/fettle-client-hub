import { describe, expect, it } from "vitest";
import {
  API_BOOKED_BY,
  HISTORY_START_DATE,
  RANGE_DAYS,
  backfillRanges,
  idsToPrune,
  isBookedByClient,
  nextBackfilledFrom,
  refreshWindow,
  toMirrorRow,
} from "./logic.ts";

const SYNCED_AT = Date.parse("2026-10-28T03:00:00Z");
const TODAY = "2026-10-28";

describe("toMirrorRow", () => {
  it("maps an Acuity appointment, classified and keyed like the rest of the admin area", () => {
    const row = toMirrorRow(
      {
        id: 101,
        firstName: " Aoife ",
        lastName: "Byrne",
        email: "Aoife@Example.com ",
        phone: "087 123 4567",
        datetime: "2026-10-20T10:00:00+0100",
        datetimeCreated: "2026-10-01T09:15:00+0100",
        type: "Individual Session with Jane Topkin",
        appointmentTypeID: 7,
        calendar: "Jane Topkin",
        calendarID: 3,
        canceled: false,
        certificate: "",
        labels: [{ id: 1, name: "Quoted " }],
      },
      SYNCED_AT
    );
    expect(row).toEqual({
      id: 101,
      customer_key: "email:aoife@example.com",
      email: "Aoife@Example.com",
      phone: "087 123 4567",
      first_name: "Aoife",
      last_name: "Byrne",
      appointment_type_id: 7,
      type: "Individual Session with Jane Topkin",
      kind: "therapy",
      category: "individual",
      calendar_id: 3,
      calendar: "Jane Topkin",
      datetime: "2026-10-20T09:00:00.000Z",
      datetime_created: "2026-10-01T08:15:00.000Z",
      canceled: false,
      certificate: null,
      labels: [{ id: 1, name: "Quoted " }],
      synced_at: "2026-10-28T03:00:00.000Z",
    });
  });

  it("never touches the who-booked-it fields, so a re-copy keeps the lookup", () => {
    const row = toMirrorRow({ id: 1, datetime: "2026-10-20T10:00:00Z", type: "Let's Talk" }, SYNCED_AT);
    expect(row).not.toHaveProperty("scheduled_by");
    expect(row).not.toHaveProperty("booked_by_client");
    expect(row).not.toHaveProperty("details_fetched_at");
    expect(row?.kind).toBe("excluded");
  });

  it("falls back to phone, then the appointment id, for the customer key", () => {
    expect(toMirrorRow({ id: 2, datetime: "2026-10-20T10:00:00Z", phone: "087 123 4567" }, SYNCED_AT)?.customer_key)
      .toBe("phone:353871234567");
    expect(toMirrorRow({ id: 3, datetime: "2026-10-20T10:00:00Z" }, SYNCED_AT)?.customer_key).toBe("appointment:3");
  });

  it("skips an appointment without a usable date", () => {
    expect(toMirrorRow({ id: 4, datetime: "" }, SYNCED_AT)).toBeNull();
  });
});

describe("isBookedByClient", () => {
  it("treats an empty scheduledBy (Acuity's own page) and the API account as the client", () => {
    expect(isBookedByClient("")).toBe(true);
    expect(isBookedByClient(null)).toBe(true);
    expect(isBookedByClient(API_BOOKED_BY)).toBe(true);
    expect(isBookedByClient(` ${API_BOOKED_BY.toUpperCase()} `)).toBe(true);
  });

  it("treats any other email as a team member", () => {
    expect(isBookedByClient("courtney@fettle.ie")).toBe(false);
  });
});

describe("history copy planning", () => {
  it("starts just before the refresh window and works backwards in whole ranges", () => {
    const ranges = backfillRanges(null, TODAY, 3);
    const start = refreshWindow(TODAY).minDate; // 2026-08-29
    expect(start).toBe("2026-08-29");
    expect(ranges).toEqual([
      ["2026-08-15", "2026-08-28"],
      ["2026-08-01", "2026-08-14"],
      ["2026-07-18", "2026-07-31"],
    ]);
    expect(RANGE_DAYS).toBe(14);
  });

  it("carries on from where the last run stopped, and stops at the start of history", () => {
    expect(backfillRanges("2010-01-10", TODAY)).toEqual([[HISTORY_START_DATE, "2010-01-09"]]);
    expect(backfillRanges(HISTORY_START_DATE, TODAY)).toEqual([]);
  });

  it("only moves the copied-from date when a range joins onto what's copied", () => {
    expect(nextBackfilledFrom(null, TODAY, "2026-08-15", "2026-08-28")).toBe("2026-08-15");
    expect(nextBackfilledFrom("2026-08-15", TODAY, "2026-08-01", "2026-08-14")).toBe("2026-08-01");
    // A gap: keep the old date.
    expect(nextBackfilledFrom("2026-08-15", TODAY, "2026-07-01", "2026-07-14")).toBe("2026-08-15");
    // Already covered: no change.
    expect(nextBackfilledFrom("2026-08-01", TODAY, "2026-08-15", "2026-08-28")).toBe("2026-08-01");
  });
});

describe("idsToPrune", () => {
  const window = { minDate: "2026-09-01", maxDate: "2026-12-31" };

  it("removes rows Acuity no longer returns", () => {
    const stored = [
      { id: 1, datetime: "2026-10-01T10:00:00Z" },
      { id: 2, datetime: "2026-10-02T10:00:00Z" },
    ];
    expect(idsToPrune(stored, new Set([1]), window)).toEqual([2]);
  });

  it("leaves rows on the window's edge days alone", () => {
    const stored = [
      { id: 1, datetime: "2026-09-01T09:00:00Z" },
      { id: 2, datetime: "2026-12-31T09:00:00Z" },
    ];
    expect(idsToPrune(stored, new Set(), window)).toEqual([]);
  });
});
