import { describe, expect, it } from "vitest";
import { activityCustomer, activityRange, describeActivity } from "./adminActivity";

const row = (action: string, details: Record<string, unknown> = {}) => ({ action, details });

describe("describeActivity", () => {
  it("describes task completions, with No answer channels", () => {
    expect(describeActivity(row("task.completed", { kind: "bundle", outcome: "completed" })).summary).toBe(
      "Completed a Bundle task"
    );
    expect(
      describeActivity(row("task.completed", { kind: "progression", outcome: "no_answer", emailed: true, whatsapped: true }))
        .summary
    ).toBe("Completed a Progression task: No answer (emailed, WhatsApp sent)");
  });

  it("describes task edits", () => {
    expect(describeActivity(row("task.due_moved", { kind: "hot_lead", from: "2026-11-11", to: "2026-11-14" })).summary).toBe(
      "Moved a Hot lead task from 11 Nov to 14 Nov"
    );
    expect(describeActivity(row("task.note_edited", { kind: "bundle", from: null, to: "Ring Friday" }))).toEqual({
      summary: "Edited the note on a Bundle task",
      detail: "Ring Friday",
    });
    expect(describeActivity(row("task.note_edited", { kind: "bundle", from: "x", to: null })).summary).toBe(
      "Cleared the note on a Bundle task"
    );
    // History from before the log only has the length.
    expect(describeActivity(row("task.note_edited", { kind: "bundle", length: 21 }))).toEqual({
      summary: "Edited the note on a Bundle task",
      detail: null,
    });
    expect(describeActivity(row("task.reopened", { kind: "psychiatry" })).summary).toBe("Reopened a Psychiatry task");
  });

  it("describes contact outcomes with method, attempt and reasons", () => {
    expect(
      describeActivity(row("customer.outcome_logged", { outcome: "no_answer", method: "call", attempt_number: 2 })).summary
    ).toBe('Logged "No answer" (call, attempt 2)');
    expect(
      describeActivity(
        row("customer.outcome_logged", { outcome: "not_continuing", reasons: ["price", "other"], reason_other: "Moving", note: "Nice chat" })
      )
    ).toEqual({ summary: 'Logged "Not continuing"', detail: "Price, Other: Moving · Nice chat" });
    expect(describeActivity(row("customer.outcome_logged", { outcome: "cleared" })).summary).toBe(
      "Cleared the contact outcome"
    );
  });

  it("describes the other actions", () => {
    expect(describeActivity(row("customer.contacted_changed", { from: false, to: true })).summary).toBe("Marked as contacted");
    expect(describeActivity(row("customer.note_edited", { to: "Hello" })).detail).toBe("Hello");
    expect(describeActivity(row("sequence.closed", { reason: "Asked not to call" }))).toEqual({
      summary: "Closed the no-answer sequence",
      detail: "Asked not to call",
    });
    expect(describeActivity(row("feedback.status_changed", { from: "new", to: "actioned" })).summary).toBe(
      "Marked feedback as Actioned (was New)"
    );
    expect(describeActivity(row("team.admin_added", { email: "a@fettle.ie" })).summary).toBe("Gave admin access to a@fettle.ie");
    expect(describeActivity(row("tasks.list_prepared", { created: 1 })).detail).toBe("1 new task");
    expect(describeActivity(row("something.new")).summary).toBe("something.new");
  });
});

describe("activityCustomer", () => {
  it("prefers the name, then the email or phone in the key", () => {
    expect(activityCustomer({ customer_name: "Jane Doe", customer_key: "email:jane@x.ie" })).toBe("Jane Doe");
    expect(activityCustomer({ customer_name: null, customer_key: "email:jane@x.ie" })).toBe("jane@x.ie");
    expect(activityCustomer({ customer_name: " ", customer_key: "phone:+353861234567" })).toBe("+353861234567");
    expect(activityCustomer({ customer_name: null, customer_key: null })).toBeNull();
  });
});

describe("activityRange", () => {
  const now = new Date(2026, 10, 11, 15, 30); // 11 Nov 2026, local time

  it("covers whole local days for the presets", () => {
    const today = activityRange("today", "", "", now);
    expect(new Date(today.from)).toEqual(new Date(2026, 10, 11));
    expect(new Date(today.to)).toEqual(new Date(2026, 10, 12));
    expect(new Date(activityRange("7d", "", "", now).from)).toEqual(new Date(2026, 10, 5));
    expect(new Date(activityRange("30d", "", "", now).from)).toEqual(new Date(2026, 9, 13));
  });

  it("uses a custom range over the preset, including its last day", () => {
    const range = activityRange("today", "2026-11-01", "2026-11-03", now);
    expect(new Date(range.from)).toEqual(new Date(2026, 10, 1));
    expect(new Date(range.to)).toEqual(new Date(2026, 10, 4));
  });
});
