import { describe, expect, it } from "vitest";
import { serviceOfType, wizardLinkForCalendar } from "./links";
import type { TherapistRow } from "./therapists";

const elaine: TherapistRow = {
  id: 7,
  name: "Elaine O'Dwyer",
  calendarid: "4567890",
  appointmentidindividual: "111",
  appointmentidcouples: "222",
};

describe("wizardLinkForCalendar", () => {
  it("links therapists in the table, keeping the last session's service", () => {
    expect(wizardLinkForCalendar(4567890, [elaine])).toBe("/book?therapist=4567890");
    expect(wizardLinkForCalendar(4567890, [elaine], 222)).toBe("/book?therapist=4567890&service=couples");
  });

  it("returns null for calendars outside the table, or before it loads", () => {
    expect(wizardLinkForCalendar(1234, [elaine])).toBeNull();
    expect(wizardLinkForCalendar(4567890, [])).toBeNull();
    expect(wizardLinkForCalendar(undefined, [elaine])).toBeNull();
  });

  it("ignores appointment types that aren't the therapist's own", () => {
    expect(serviceOfType(elaine, 999)).toBeNull();
    expect(serviceOfType(elaine, "111")).toBe("individual");
  });
});
