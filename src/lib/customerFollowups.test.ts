import { describe, expect, it } from "vitest";
import {
  type CustomerFollowup,
  NOTE_MAX_LENGTH,
  applyFollowupPatch,
  indexFollowups,
  isMissingTableError,
  normalizeNote,
  noteChanged,
  replaceFollowup,
  validateNote,
} from "./customerFollowups";

function followup(customerKey: string, overrides: Partial<CustomerFollowup> = {}): CustomerFollowup {
  return {
    customer_key: customerKey,
    contacted: false,
    contacted_at: null,
    contacted_by: null,
    contacted_by_email: null,
    note: null,
    note_updated_at: null,
    note_updated_by: null,
    note_updated_by_email: null,
    updated_at: "2026-10-07T09:00:00Z",
    ...overrides,
  };
}

describe("note validation", () => {
  it("trims notes and treats blank ones as empty", () => {
    expect(normalizeNote("  Called, left voicemail \n")).toBe("Called, left voicemail");
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(null)).toBeNull();
  });

  it("allows notes up to the limit and rejects longer ones", () => {
    expect(validateNote("a".repeat(NOTE_MAX_LENGTH))).toBeNull();
    expect(validateNote(`  ${"a".repeat(NOTE_MAX_LENGTH)}  `)).toBeNull();
    expect(validateNote("a".repeat(NOTE_MAX_LENGTH + 1))).toMatch(/up to 2000 characters/);
  });

  it("only counts a draft as changed when the saved text would differ", () => {
    expect(noteChanged(null, "")).toBe(false);
    expect(noteChanged(null, "   ")).toBe(false);
    expect(noteChanged("Called", " Called ")).toBe(false);
    expect(noteChanged("Called", "Called twice")).toBe(true);
    expect(noteChanged("Called", "")).toBe(true);
    expect(noteChanged(undefined, "New")).toBe(true);
  });
});

describe("follow-up cache updates", () => {
  const rows = [
    followup("email:a@example.com", { note: "Keep" }),
    followup("phone:353871234567", { contacted: true }),
  ];

  it("indexes rows by customer key", () => {
    const index = indexFollowups(rows);
    expect(index.get("email:a@example.com")?.note).toBe("Keep");
    expect(index.get("email:missing@example.com")).toBeUndefined();
  });

  it("changes only the targeted customer", () => {
    const next = applyFollowupPatch(rows, "email:a@example.com", { contacted: true });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ contacted: true, note: "Keep" });
    expect(next[1]).toBe(rows[1]);
    expect(rows[0].contacted).toBe(false);
  });

  it("adds a row for a customer with no follow-up yet", () => {
    const next = applyFollowupPatch(rows, "email:new@example.com", { note: "  First call " });
    expect(next).toHaveLength(3);
    expect(next[2]).toMatchObject({ customer_key: "email:new@example.com", note: "First call", contacted: false });
  });

  it("keeps the contacted status when a note is saved", () => {
    const next = applyFollowupPatch(rows, "phone:353871234567", { note: "Booked" });
    expect(next[1]).toMatchObject({ contacted: true, note: "Booked" });
  });

  it("replaces the optimistic row with the saved one", () => {
    const saved = followup("email:a@example.com", {
      contacted: true,
      contacted_by_email: "alex@fettle.ie",
      contacted_at: "2026-10-07T10:00:00Z",
    });
    const next = replaceFollowup(rows, saved);
    expect(next[0]).toBe(saved);
    expect(next[1]).toBe(rows[1]);
    expect(replaceFollowup([], saved)).toEqual([saved]);
  });
});

describe("isMissingTableError", () => {
  it("recognises a table that hasn't been created yet", () => {
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "42501" })).toBe(false);
    expect(isMissingTableError(new Error("network"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
