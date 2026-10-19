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
  it("lists today's tasks most important first, with why, next action and priority reasons", () => {
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

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Carried Client")).toBeInTheDocument();
    expect(within(items[1]).getByText("Low Lead")).toBeInTheDocument();

    const first = within(items[0]);
    expect(first.getByText("High priority")).toBeInTheDocument();
    expect(first.getByText("Overdue")).toBeInTheDocument();
    expect(first.getByText("Carried over 2 days")).toBeInTheDocument();
    expect(first.getByText(/full clinical assessment not booked$/)).toBeInTheDocument();
    expect(first.getByText("Call to book the full clinical assessment")).toBeInTheDocument();
    expect(first.getByText(/Screening done, full assessment not booked \(\+35\)/)).toBeInTheDocument();
    expect(first.getByText("Prefers calls after 5pm")).toBeInTheDocument();
    expect(first.getByRole("link", { name: /Open lead/ })).toHaveAttribute(
      "href",
      "/admin/assessments?q=aoife%40example.com"
    );
    expect(screen.getByRole("tab", { name: "Scheduled (1)" })).toBeInTheDocument();
  });

  it("completes a task", async () => {
    state.open = [salesTask({ id: "t1", customer_name: "Aoife Byrne" })];
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: /Complete/ }));
    expect(state.complete).toHaveBeenCalledWith("t1");
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
    const reopenButtons = screen.getAllByRole("button", { name: /Reopen/ });
    expect(reopenButtons).toHaveLength(1);
    await user.click(reopenButtons[0]);
    expect(state.reopen).toHaveBeenCalledWith("done");
  });

  it("explains when the database update isn't deployed yet", () => {
    state.error = { code: "PGRST205", message: "missing" };
    renderPage();
    expect(screen.getByText(/once the Sales Tasks database update is deployed/)).toBeInTheDocument();
  });
});
