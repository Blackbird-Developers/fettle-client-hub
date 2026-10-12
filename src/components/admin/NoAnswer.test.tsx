// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { format, subDays } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NoAnswerSequence } from "@/lib/noAnswer";
import { NoAnswer } from "./NoAnswer";

const state = vi.hoisted(() => ({
  sequences: [] as NoAnswerSequence[],
  error: null as unknown,
  record: vi.fn(),
  close: vi.fn(),
  restart: vi.fn(),
}));

const mutation = (fn: typeof state.record) => ({
  mutate: (vars: unknown, options?: { onSuccess?: (v: unknown) => void }) => {
    fn(vars);
    options?.onSuccess?.({});
  },
  isPending: false,
  isError: false,
  error: null,
  reset: vi.fn(),
});

vi.mock("@/hooks/useAdmin", () => ({
  useNoAnswerSequences: () => ({
    data: state.error ? undefined : state.sequences,
    error: state.error,
    isPending: false,
    isError: Boolean(state.error),
  }),
  useCustomerFollowups: () => ({ data: [] }),
  useCustomerInsights: () => ({ data: undefined }),
  useRecordOutcome: () => mutation(state.record),
  useCloseSequence: () => mutation(state.close),
  useRestartSequence: () => mutation(state.restart),
  useContactHistory: () => ({ isPending: false, isError: false, data: [] }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const today = new Date();
const iso = (d: Date) => format(d, "yyyy-MM-dd");

let nextId = 1;
function sequence(name: string, overrides: Partial<NoAnswerSequence> = {}): NoAnswerSequence {
  return {
    id: String(nextId++),
    customer_key: `email:${name.split(" ")[0].toLowerCase()}@example.com`,
    customer_name: name,
    customer_phone: "087 123 4567",
    source: "progression",
    status: "active",
    attempts_done: 1,
    started_at: subDays(today, 2).toISOString(),
    started_by_email: "alex@fettle.ie",
    last_attempt_at: subDays(today, 2).toISOString(),
    last_attempt_by_email: "alex@fettle.ie",
    last_method: "call",
    next_due_on: iso(today),
    closed_at: null,
    closed_by: null,
    closed_by_email: null,
    closed_reason: null,
    ...overrides,
  };
}

function renderPage() {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <NoAnswer />
    </TooltipProvider>
  );
  return { user };
}

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

beforeEach(() => {
  state.sequences = [];
  state.error = null;
  state.record.mockReset();
  state.close.mockReset();
  state.restart.mockReset();
});

describe("No answer page", () => {
  it("explains when the database update hasn't been applied", () => {
    state.error = { code: "PGRST205", message: "missing" };
    renderPage();
    expect(screen.getByText(/once the No answer database update is deployed/)).toBeInTheDocument();
  });

  it("shows who's due today, with the attempt plan, and who's coming up", () => {
    state.sequences = [
      sequence("Ann Archer", { attempts_done: 1, next_due_on: iso(subDays(today, 1)) }),
      sequence("Bo Byrne", { attempts_done: 3, next_due_on: iso(new Date(today.getTime() + 3 * 86_400_000)) }),
      sequence("Cy Cole", { status: "exhausted", attempts_done: 6, next_due_on: null, closed_at: today.toISOString() }),
    ];
    renderPage();

    expect(screen.getByRole("tab", { name: "Due today (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Coming up (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Finished (1)" })).toBeInTheDocument();

    const ann = within(rowOf("Ann Archer"));
    expect(ann.getByText("1 of 6")).toBeInTheDocument();
    expect(ann.getByText("1 day overdue")).toBeInTheDocument();
    expect(ann.getByText("Attempt 2: Call + email")).toBeInTheDocument();
    expect(ann.getByText("Phone: 087 123 4567")).toBeInTheDocument();
    expect(screen.queryByText("Bo Byrne")).toBeNull();
  });

  it("logs a No answer with the method, a note and the draft email for attempt 2", async () => {
    state.sequences = [sequence("Ann Archer")];
    const { user } = renderPage();

    await user.click(within(rowOf("Ann Archer")).getByRole("button", { name: "Log attempt" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Attempt 2 of 6 · Ann Archer")).toBeInTheDocument();
    expect(within(dialog).getByText(/Subject:/).parentElement).toHaveTextContent("Sorry we missed you");
    expect(within(dialog).getByRole("radio", { name: "No answer" })).toBeChecked();

    await user.type(within(dialog).getByLabelText("Note (optional)"), "Left a voicemail");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(state.record).toHaveBeenCalledWith({
      customerKey: "email:ann@example.com",
      customerName: "Ann Archer",
      input: { outcome: "no_answer" },
      meta: { method: "call", note: "Left a voicemail", source: "no_answer", customerPhone: "087 123 4567" },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for reasons before ending the sequence as Not continuing", async () => {
    state.sequences = [sequence("Ann Archer")];
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "Log attempt" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Doesn't want to continue" }));
    expect(within(dialog).getByText("This ends the No answer sequence.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Choose at least one reason.")).toBeInTheDocument();
    expect(state.record).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("checkbox", { name: "Price" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(state.record).toHaveBeenCalledWith(
      expect.objectContaining({ input: { outcome: "not_continuing", reasons: ["price"], reasonOther: null } })
    );
  });

  it("warns when someone already tried today", async () => {
    state.sequences = [sequence("Ann Archer", { last_attempt_at: new Date().toISOString(), last_attempt_by_email: "courtney@fettle.ie" })];
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "Log attempt" }));
    expect(screen.getByText(/Already tried today by courtney@fettle.ie/)).toBeInTheDocument();
  });

  it("closes a sequence only with a reason", async () => {
    state.sequences = [sequence("Ann Archer")];
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "More actions for Ann Archer" }));
    await user.click(screen.getByRole("menuitem", { name: "Close sequence" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Close sequence" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Reason for closing"), "Welfare concern, passed to the clinical lead");
    await user.click(confirm);
    expect(state.close).toHaveBeenCalledWith({
      sequenceId: state.sequences[0].id,
      reason: "Welfare concern, passed to the clinical lead",
    });
  });

  it("starts a finished sequence again from the menu", async () => {
    state.sequences = [
      sequence("Cy Cole", { status: "exhausted", attempts_done: 6, next_due_on: null, closed_at: today.toISOString() }),
    ];
    const { user } = renderPage();

    await user.click(screen.getByRole("tab", { name: "Finished (1)" }));
    expect(within(rowOf("Cy Cole")).getByText("No answer after 6 attempts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More actions for Cy Cole" }));
    await user.click(screen.getByRole("menuitem", { name: "Start again" }));
    expect(state.restart).toHaveBeenCalledWith({
      customerKey: "email:cy@example.com",
      customerName: "Cy Cole",
      customerPhone: "087 123 4567",
    });
  });
});
