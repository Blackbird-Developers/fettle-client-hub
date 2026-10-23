// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SalesTask } from "@/lib/salesTasks";
import { todayInIreland } from "@/lib/salesTasks";
import { salesTask } from "@/test/salesTaskFixture";
import { SalesTasks } from "./SalesTasks";

const state = vi.hoisted(() => ({
  open: [] as SalesTask[],
  history: [] as SalesTask[],
  error: null as unknown,
  complete: vi.fn(),
  reopen: vi.fn(),
  setDue: vi.fn(),
  saveNote: vi.fn(),
  prepare: vi.fn(),
}));

const mutation = (fn: (vars: unknown) => unknown) => ({
  mutateAsync: async (vars: unknown) => fn(vars),
  isPending: false,
});

vi.mock("@/hooks/useSalesTasks", () => ({
  useSalesTasks: () => ({
    data: state.error ? undefined : state.open,
    error: state.error,
    isPending: false,
    isError: Boolean(state.error),
  }),
  useSalesTaskHistory: () => ({ data: state.history, isPending: false, isError: false }),
  useSalesTaskRun: () => ({ data: null }),
  useCompleteSalesTask: () => mutation(state.complete),
  useReopenSalesTask: () => mutation(state.reopen),
  useSetSalesTaskDue: () => mutation(state.setDue),
  useUpdateSalesTaskNote: () => mutation(state.saveNote),
  usePrepareSalesTasks: () => mutation(state.prepare),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useCustomerFollowups: () => ({
    data: [{ customer_key: "email:carried@x.ie", note: "Prefers calls after 5pm" }],
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const TODAY = todayInIreland();
const daysFromToday = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <SalesTasks />
    </MemoryRouter>
  );
  return user;
}

beforeEach(() => {
  state.open = [];
  state.history = [];
  state.error = null;
  vi.clearAllMocks();
});

describe("SalesTasks", () => {
  it("lists today's tasks by section, with why, next action and priority reasons", () => {
    state.open = [
      salesTask({ customer_name: "Low Lead", priority: "low", score: 30 }),
      salesTask({
        customer_name: "Carried Client",
        customer_key: "email:carried@x.ie",
        kind: "assessment",
        priority: "high",
        score: 85,
        due_on: daysFromToday(-2),
        original_due_on: daysFromToday(-2),
        carried_over_count: 2,
        reason: "OCD Consultation + screening 5 days ago; full clinical assessment not booked",
        next_action: "Call to book the full clinical assessment",
        priority_reasons: [
          { label: "Screening done, full assessment not booked", points: 35 },
          { label: "Overdue by 2 days", points: 20 },
        ],
      }),
      salesTask({ customer_name: "Later Lead", due_on: daysFromToday(3) }),
    ];
    renderPage();

    // Hot leads (section 5) come before Assessments (section 7).
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Low Lead")).toBeInTheDocument();
    expect(within(items[1]).getByText("Carried Client")).toBeInTheDocument();

    const assessment = within(items[1]);
    expect(assessment.getByText("High priority")).toBeInTheDocument();
    expect(assessment.getByText("Overdue")).toBeInTheDocument();
    expect(assessment.getByText("Carried over 2 days")).toBeInTheDocument();
    expect(assessment.getByText(/full clinical assessment not booked$/)).toBeInTheDocument();
    expect(assessment.getByText("Call to book the full clinical assessment")).toBeInTheDocument();
    expect(assessment.getByText(/Screening done, full assessment not booked \(\+35\)/)).toBeInTheDocument();
    expect(assessment.getByText("Prefers calls after 5pm")).toBeInTheDocument();
    expect(assessment.getByRole("link", { name: /Open in Assessments/ })).toHaveAttribute(
      "href",
      "/admin/assessments?q=aoife%40example.com"
    );
    expect(screen.getByRole("tab", { name: "Scheduled (1)" })).toBeInTheDocument();
  });

  it("works through the seven sections in order, with progressions split by stage", () => {
    state.open = [
      salesTask({ customer_name: "Psych Person", kind: "psychiatry" }),
      salesTask({ customer_name: "Second Stage", kind: "progression", lead_status: "session_2" }),
      salesTask({ customer_name: "Bundle Person", kind: "bundle", lead_status: "stalled" }),
      salesTask({ customer_name: "First Stage", kind: "progression", lead_status: "session_1" }),
      salesTask({ customer_name: "Missed Call", kind: "no_answer" }),
      // Moved to today with "Follow up on…": listed under Follow-ups.
      salesTask({ customer_name: "Moved Lead", due_on: TODAY, original_due_on: daysFromToday(-3) }),
    ];
    renderPage();

    const expected = ["First Stage", "Second Stage", "Bundle Person", "Moved Lead", "Missed Call", "Psych Person"];
    const order = screen
      .getAllByRole("listitem")
      .map((item) => expected.find((name) => within(item).queryByText(name)));
    expect(order).toEqual(expected);

    expect(screen.getByText("1. Progressions (2)")).toBeInTheDocument();
    expect(screen.getByText("Session 1 → 2 (1)")).toBeInTheDocument();
    expect(screen.getByText("Session 2 → 3 (1)")).toBeInTheDocument();
    expect(screen.getByText("Stalled")).toBeInTheDocument();
    expect(screen.getByText("Follow-up set by staff")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open in Progressions/ })[0]).toHaveAttribute(
      "href",
      "/admin/progression/1-2?q=aoife%40example.com"
    );
  });

  it("shows each section ten tasks at a time, keeping stage headings across pages", async () => {
    state.open = [
      ...Array.from({ length: 8 }, (_, i) =>
        salesTask({ customer_name: `Stage One ${i + 1}`, kind: "progression", lead_status: "session_1" })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        salesTask({ customer_name: `Stage Two ${i + 1}`, kind: "progression", lead_status: "session_2" })
      ),
      salesTask({ customer_name: "Lead Person" }),
    ];
    const user = renderPage();

    // Progressions: 12 tasks, 10 on page 1 (8 at stage 1, 2 at stage 2).
    expect(screen.getAllByRole("button", { name: /^Complete$/ })).toHaveLength(11);
    expect(screen.getByText("Showing 1–10 of 12 tasks")).toBeInTheDocument();
    expect(screen.getByText("Session 1 → 2 (8)")).toBeInTheDocument();
    expect(screen.getByText("Session 2 → 3 (4)")).toBeInTheDocument();
    expect(screen.queryByText("Stage Two 3")).not.toBeInTheDocument();
    // Hot leads has one task, so no page controls of its own.
    expect(screen.getAllByRole("navigation", { name: "pagination" })).toHaveLength(1);

    await user.click(screen.getByRole("link", { name: "Page 2" }));
    expect(screen.getByText("Showing 11–12 of 12 tasks")).toBeInTheDocument();
    expect(screen.getByText("Stage Two 3")).toBeInTheDocument();
    expect(screen.queryByText("Session 1 → 2 (8)")).not.toBeInTheDocument();
    expect(screen.getByText("Session 2 → 3 (4)")).toBeInTheDocument();

    // A new search starts again from page 1.
    await user.type(screen.getByRole("textbox", { name: "Search tasks" }), "Stage");
    expect(screen.getByText("Showing 1–10 of 12 tasks")).toBeInTheDocument();
  });

  it("points an empty section at the next one with tasks", () => {
    state.open = [salesTask({ customer_name: "Missed Call", kind: "no_answer" })];
    renderPage();
    expect(screen.getByText("3. No follow-ups today")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Start with No answers/ });
    expect(links[0]).toHaveAttribute("href", "#sales-section-no_answer");
  });

  it("completes a task from the Complete pop-up", async () => {
    state.open = [salesTask({ id: "t1", customer_name: "Aoife Byrne" })];
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("How did it go with Aoife Byrne?")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: /^Completed/ }));
    expect(state.complete).toHaveBeenCalledWith({ taskId: "t1", outcome: "completed", emailed: false, whatsapped: false });
  });

  it("opens the follow-up date picker from the pop-up", async () => {
    state.open = [salesTask({ id: "t1" })];
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Follow-up/ }));
    expect(screen.getByRole("dialog", { name: "Follow up on…" })).toBeInTheDocument();
    expect(state.complete).not.toHaveBeenCalled();
  });

  it("records a No answer only once Email, WhatsApp or both is chosen", async () => {
    state.open = [salesTask({ id: "t1" })];
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^No answer/ }));

    const dialog = within(screen.getByRole("dialog", { name: "No answer" }));
    const save = dialog.getByRole("button", { name: "Complete task" });
    expect(save).toBeDisabled();
    await user.click(dialog.getByRole("checkbox", { name: "Email" }));
    await user.click(dialog.getByRole("checkbox", { name: "WhatsApp" }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(state.complete).toHaveBeenCalledWith({ taskId: "t1", outcome: "no_answer", emailed: true, whatsapped: true });
  });

  it("saves a note and a follow-up date", async () => {
    state.open = [salesTask({ id: "t1" })];
    const user = renderPage();

    await user.click(screen.getByRole("button", { name: /Add note/ }));
    await user.type(screen.getByRole("textbox", { name: "Note" }), "Call back Friday");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(state.saveNote).toHaveBeenCalledWith({ taskId: "t1", note: "Call back Friday" });

    await user.click(screen.getByRole("button", { name: /Follow up on/ }));
    const date = daysFromToday(4);
    const input = screen.getByLabelText("Date");
    await user.clear(input);
    await user.type(input, date);
    await user.click(screen.getByRole("button", { name: "Save date" }));
    expect(state.setDue).toHaveBeenCalledWith({ taskId: "t1", dueOn: date });
  });

  it("filters by task type", async () => {
    state.open = [
      salesTask({ customer_name: "Lead Person" }),
      salesTask({ customer_name: "Psych Person", kind: "psychiatry" }),
    ];
    const user = renderPage();
    await user.click(screen.getByRole("combobox", { name: "Task type" }));
    await user.click(screen.getByRole("option", { name: "Psychiatry" }));
    expect(screen.getByText("Psych Person")).toBeInTheDocument();
    expect(screen.queryByText("Lead Person")).not.toBeInTheDocument();
  });

  it("shows finished tasks only in the Completed tab, and lets staff reopen their own", async () => {
    state.open = [salesTask({ customer_name: "Still Open" })];
    state.history = [
      salesTask({
        id: "done",
        customer_name: "Done Person",
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by_email: "courtney@fettle.ie",
        seconds_to_complete: 5400,
      }),
      salesTask({
        id: "missed",
        customer_name: "Missed Person",
        status: "completed",
        completed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        completion_outcome: "no_answer",
        contacted_by_whatsapp: true,
      }),
      salesTask({
        id: "auto",
        customer_name: "Booked Person",
        status: "auto_closed",
        completed_at: new Date().toISOString(),
        closed_reason: "Booked: Individual Therapy",
      }),
    ];
    const user = renderPage();
    expect(screen.queryByText("Done Person")).not.toBeInTheDocument();
    expect(screen.getByText("Completed today").previousSibling).toHaveTextContent("1");

    await user.click(screen.getByRole("tab", { name: "Completed" }));
    expect(screen.getByText("Done Person")).toBeInTheDocument();
    expect(screen.getByText("Booked: Individual Therapy")).toBeInTheDocument();
    expect(screen.getByText("2 h")).toBeInTheDocument();
    expect(screen.getByText("No answer · WhatsApped")).toBeInTheDocument();
    const reopenButtons = screen.getAllByRole("button", { name: /Reopen/ });
    expect(reopenButtons).toHaveLength(2);
    await user.click(reopenButtons[0]);
    expect(state.reopen).toHaveBeenCalledWith("done");
  });

  it("explains when the database update isn't deployed yet", () => {
    state.error = { code: "PGRST205", message: "missing" };
    renderPage();
    expect(screen.getByText(/once the Sales Tasks database update is deployed/)).toBeInTheDocument();
  });
});
