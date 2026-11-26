// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@/lib/adminActivity";
import { ActivityLog } from "./ActivityLog";

const state = vi.hoisted(() => ({
  rows: [] as ActivityRow[],
}));

const done = (data: unknown) => ({ data, isLoading: false, isFetching: false, error: null });

vi.mock("@/hooks/useAdminActivity", () => ({
  useActivityActors: () => done(["courtney@fettle.ie"]),
  useActivitySummary: () =>
    done([
      {
        actor_email: "courtney@fettle.ie",
        total: 3,
        tasks_completed: 2,
        outcomes_logged: 1,
        notes_edited: 0,
        last_active: "2026-11-11T10:00:00.000Z",
      },
    ]),
  useActivityPage: () => done({ rows: state.rows, total: state.rows.length }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

function activity(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: crypto.randomUUID(),
    created_at: "2026-11-11T10:00:00.000Z",
    actor_id: null,
    actor_email: "courtney@fettle.ie",
    action: "task.completed",
    customer_key: "email:jane@x.ie",
    customer_name: "Jane Doe",
    task_id: null,
    details: {},
    source_ref: null,
    tx_id: 1,
    ...overrides,
  };
}

describe("ActivityLog", () => {
  beforeEach(() => {
    state.rows = [
      activity({ details: { kind: "bundle", outcome: "no_answer", emailed: true } }),
      activity({ action: "customer.note_edited", customer_name: null, customer_key: "email:amy@x.ie", details: { to: "Call Friday" } }),
    ];
  });

  it("shows the per-staff summary and each action as a sentence", () => {
    render(<ActivityLog />);
    expect(screen.getByText("By staff member")).toBeTruthy();
    expect(screen.getByText("Completed a Bundle task: No answer (emailed)")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("Edited the customer note")).toBeTruthy();
    expect(screen.getByText("Call Friday")).toBeTruthy();
    expect(screen.getByText("amy@x.ie")).toBeTruthy();
    expect(screen.getByText("1–2 of 2")).toBeTruthy();
  });

  it("shows the comparison period's counts under each staff member's", async () => {
    const user = userEvent.setup();
    render(<ActivityLog />);
    expect(screen.queryByText("vs 3")).toBeNull();
    await user.click(screen.getByRole("button", { name: /last 7 days/i }));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    // The mock answers both periods with the same counts.
    // The By staff member table comes before the activity list.
    const row = screen.getAllByText("courtney@fettle.ie", { selector: "td" })[0].closest("tr")!;
    expect(within(row).getByText("vs 3")).toBeTruthy();
    expect(within(row).getByText("vs 2")).toBeTruthy();
    expect(screen.getByText(/The small numbers are the previous period/)).toBeTruthy();
  });
});
