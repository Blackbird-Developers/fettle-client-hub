// @vitest-environment jsdom
import "@/test/setupDom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import type { CustomerInsightsResponse } from "@/hooks/useAdmin";
import { type CustomerFollowup, blankFollowup } from "@/lib/customerFollowups";
import type { ProgressionRow } from "../../../supabase/functions/admin-customer-insights/logic.ts";
import { SessionProgression } from "./SessionProgression";

// ---------------------------------------------------------------------------
// In-memory stand-in for the customer_followups table. Supports exactly the
// calls the follow-up hooks make, so the real save code runs in these tests.
// ---------------------------------------------------------------------------
const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  /** Writes for these keys fail with a permission error. */
  failKeys: new Set<string>(),
  /** When set, every write waits for it (to see the saving state). */
  gate: null as Promise<void> | null,
  /** Simulates a colleague editing a note between our read and write. */
  afterRead: null as ((key: string) => void) | null,
  /** Error for the initial list load (e.g. table not migrated yet). */
  listError: null as { code: string; message: string } | null,
  /** customer_contact_attempts rows, oldest first. */
  attempts: [] as Record<string, unknown>[],
  /** Error for anything on customer_contact_attempts (e.g. not migrated yet). */
  attemptsError: null as { code: string; message: string } | null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "staff-1", email: "ben@fettle.ie" } }),
}));

vi.mock("@/integrations/supabase/client", async () => {
  // The database trigger that turns an attempt into the customer's summary
  // row is mirrored by applyOutcome, so the mock uses it.
  const { applyOutcome } = await import("@/lib/contactOutcomes");

  const blank = (key: string) => ({
    customer_key: key,
    contacted: false,
    contacted_at: null,
    contacted_by: null,
    contacted_by_email: null,
    note: null,
    note_updated_at: null,
    note_updated_by: null,
    note_updated_by_email: null,
    outcome: null,
    outcome_at: null,
    outcome_by: null,
    outcome_by_email: null,
    not_continuing_reasons: null,
    not_continuing_other: null,
    follow_up_due: null,
    attempt_count: 0,
    last_attempt_at: null,
    last_reached_at: null,
    customer_name: null,
    updated_at: "2026-10-07T09:00:00Z",
  });

  class Query {
    op: "select" | "upsert" | "insert" | "update" | null = null;
    payload: Record<string, unknown> = {};
    filters: [string, unknown][] = [];
    columns = "*";

    constructor(public table: string) {}

    select(columns = "*") {
      if (!this.op) {
        this.op = "select";
        this.columns = columns;
      }
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    upsert(payload: Record<string, unknown>) {
      this.op = "upsert";
      this.payload = payload;
      return this;
    }
    insert(payload: Record<string, unknown>) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.op = "update";
      this.payload = payload;
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push([column, value]);
      return this;
    }
    is(column: string, value: unknown) {
      this.filters.push([column, value]);
      return this;
    }
    single() {
      return this.run();
    }
    maybeSingle() {
      return this.run();
    }
    then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
      if (this.table === "customer_contact_attempts") {
        return this.attempts().then(resolve, reject);
      }
      // Awaited without single(): the list load.
      const result = db.listError
        ? { data: null, error: db.listError }
        : { data: [...db.rows.values()], error: null };
      return Promise.resolve(result).then(resolve, reject);
    }

    // Insert = record an outcome; select = the history or the availability check.
    async attempts() {
      if (db.attemptsError) return { data: null, error: db.attemptsError };
      const key = this.filters.find(([c]) => c === "customer_key")?.[1];
      if (this.op === "select") {
        const rows = db.attempts.filter((a) => !key || a.customer_key === key).reverse();
        return { data: rows, error: null };
      }

      if (db.gate) await db.gate;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { customer_key, customer_name, outcome, reasons, reason_other } = this.payload as {
        customer_key: string;
        customer_name: string | null;
        outcome: string;
        reasons: string[] | null;
        reason_other: string | null;
      };
      if (db.failKeys.has(customer_key)) {
        return { data: null, error: { code: "42501", message: "permission denied" } };
      }
      db.attempts.push({
        ...this.payload,
        id: `attempt-${db.attempts.length + 1}`,
        created_at: new Date().toISOString(),
        created_by_email: "ben@fettle.ie",
      });
      const existing = db.rows.get(customer_key);
      const input = (
        outcome === "not_continuing" ? { outcome, reasons, reasonOther: reason_other } : { outcome }
      ) as Parameters<typeof applyOutcome>[3];
      const [next] = applyOutcome(
        existing ? [existing as never] : [],
        customer_key,
        customer_name,
        input,
        "ben@fettle.ie"
      );
      db.rows.set(customer_key, next);
      return { data: null, error: null };
    }

    async run() {
      const key = (this.payload.customer_key ??
        this.filters.find(([c]) => c === "customer_key")?.[1]) as string;
      const existing = db.rows.get(key);

      if (this.op === "select") {
        const data = existing ? (this.columns === "*" ? existing : { note: existing.note }) : null;
        db.afterRead?.(key);
        return { data, error: null };
      }

      if (db.gate) await db.gate;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (db.failKeys.has(key)) {
        return { data: null, error: { code: "42501", message: "permission denied" } };
      }

      if (this.op === "insert" && existing) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      if (this.op === "update") {
        const matches = existing && this.filters.every(([c, v]) => existing[c] === v);
        if (!matches) return { data: null, error: null };
      }

      const next = { ...(existing ?? blank(key)), ...this.payload };
      if (this.payload.contacted === true && !existing?.contacted) {
        next.contacted_by_email = "ben@fettle.ie";
        next.contacted_at = "2026-10-07T10:00:00Z";
      }
      if (this.payload.contacted === false) {
        next.contacted_by_email = null;
        next.contacted_at = null;
      }
      db.rows.set(key, next);
      return { data: next, error: null };
    }
  }

  return {
    supabase: {
      rpc: async () => ({ data: true, error: null }),
      from: (table: string) => new Query(table),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NAMES = ["Ann Archer", "Bo Byrne", "Cy Cole", "Di Doyle"];
const keyOf = (name: string) => `email:${name.split(" ")[0].toLowerCase()}@example.com`;

function row(name: string, daysAgo: number): ProgressionRow {
  return {
    key: keyOf(name),
    name,
    email: keyOf(name).slice(6),
    phone: null,
    fromSessionAt: "2026-10-01T10:00:00Z",
    fromSessionType: "Therapy",
    daysSinceFromSession: daysAgo,
    nextSessionStatus: "none",
    nextSessionAt: null,
    nextSessionType: null,
    portalStatus: "no_account",
    historyStatus: "verified",
    historyNote: null,
    grade: null,
    gradeReason: null,
  };
}

function insights(names = NAMES): CustomerInsightsResponse {
  // Larger "days ago" sorts first, so rows appear in the order given.
  const rows = names.map((name, i) => row(name, 10 - i));
  return {
    generatedAt: new Date().toISOString(),
    activeWindowDays: 30,
    progressionPeriods: [30],
    progression: [{ fromSession: 1, rows, totals: { verified: rows.length, unverified: 0 }, legend: [] }],
    dataIssues: {
      incompleteDates: [],
      unknownTypes: [],
      customersWithoutEmail: 0,
      customersWithoutPhone: 0,
      unverifiedHistory: 0,
    },
  } as unknown as CustomerInsightsResponse;
}

function followup(name: string, overrides: Partial<CustomerFollowup> = {}) {
  db.rows.set(keyOf(name), {
    ...blankFollowup(keyOf(name)),
    updated_at: "2026-10-07T09:00:00Z",
    ...overrides,
  });
}

function renderPage({ seedFollowups = true } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(["is-admin", "staff-1"], true);
  queryClient.setQueryData(["admin-customer-insights"], insights());
  if (seedFollowups) queryClient.setQueryData(["customer-followups"], [...db.rows.values()]);

  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionProgression fromSession={1} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { ...utils, user, queryClient };
}

const rowCheckbox = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` });
const headerCheckbox = () => screen.getByRole("checkbox", { name: /all \d+ shown customers/ });
const bar = () => screen.queryByRole("region", { name: "Bulk actions for selected customers" });
const tableRow = (name: string) => rowCheckbox(name).closest("tr")!;

beforeEach(() => {
  db.rows.clear();
  db.failKeys.clear();
  db.gate = null;
  db.afterRead = null;
  db.listError = null;
  db.attempts = [];
  db.attemptsError = null;
});

/** Picks an outcome from the bulk bar's Record outcome menu. */
async function bulkOutcome(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(within(bar()!).getByRole("button", { name: /Record outcome/ }));
  await user.click(await screen.findByRole("menuitem", { name: label }));
}

/** Opens the bulk bar's `…` menu and picks an item. */
async function bulkMenu(user: ReturnType<typeof userEvent.setup>, item: RegExp) {
  await user.click(within(bar()!).getByRole("button", { name: "More bulk actions" }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

// ---------------------------------------------------------------------------
describe("row selection", () => {
  it("selects and deselects a single row", async () => {
    const { user } = renderPage();
    expect(bar()).toBeNull();

    await user.click(rowCheckbox("Ann Archer"));
    expect(rowCheckbox("Ann Archer")).toBeChecked();
    expect(tableRow("Ann Archer")).toHaveAttribute("data-state", "selected");
    expect(within(bar()!).getByText(/1 selected/)).toBeInTheDocument();

    await user.click(rowCheckbox("Ann Archer"));
    expect(rowCheckbox("Ann Archer")).not.toBeChecked();
    expect(tableRow("Ann Archer")).not.toHaveAttribute("data-state");
    expect(bar()).toBeNull();
  });

  it("selects several rows and shows the count", async () => {
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Cy Cole"));
    expect(within(bar()!).getByText(/2 selected/)).toBeInTheDocument();
    expect(within(bar()!).getByText(/of 4 shown/)).toBeInTheDocument();
    expect(screen.getByText(/Showing 4 of 4 customers · 2 selected/)).toBeInTheDocument();
  });

  it("header checkbox shows partly ticked, then selects and clears all shown", async () => {
    const { user } = renderPage();
    expect(headerCheckbox()).toHaveAttribute("aria-checked", "false");

    await user.click(rowCheckbox("Bo Byrne"));
    expect(headerCheckbox()).toHaveAttribute("aria-checked", "mixed");

    await user.click(headerCheckbox());
    expect(headerCheckbox()).toHaveAttribute("aria-checked", "true");
    expect(headerCheckbox()).toHaveAccessibleName("Deselect all 4 shown customers");
    NAMES.forEach((name) => expect(rowCheckbox(name)).toBeChecked());

    await user.click(headerCheckbox());
    NAMES.forEach((name) => expect(rowCheckbox(name)).not.toBeChecked());
    expect(bar()).toBeNull();
  });

  it("select all only covers the rows a search leaves showing", async () => {
    const { user } = renderPage();
    await user.type(screen.getByRole("textbox", { name: "Search customers" }), "Bo");
    expect(headerCheckbox()).toHaveAccessibleName("Select all 1 shown customers");

    await user.click(headerCheckbox());
    expect(within(bar()!).getByText(/1 selected/)).toBeInTheDocument();
    expect(within(bar()!).getByText(/of 1 shown/)).toBeInTheDocument();
  });

  it("drops selected rows that a search hides", async () => {
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Bo Byrne"));
    const search = screen.getByRole("textbox", { name: "Search customers" });
    await user.type(search, "Bo");
    expect(within(bar()!).getByText(/1 selected/)).toBeInTheDocument();

    // Clearing the search doesn't bring the hidden selection back.
    await user.clear(search);
    expect(rowCheckbox("Ann Archer")).not.toBeChecked();
    expect(rowCheckbox("Bo Byrne")).toBeChecked();
  });

  it("keeps the selection when sorting", async () => {
    const { user } = renderPage();
    await user.click(rowCheckbox("Cy Cole"));
    await user.click(screen.getByRole("button", { name: /Customer/ }));
    expect(rowCheckbox("Cy Cole")).toBeChecked();
    expect(within(bar()!).getByText(/1 selected/)).toBeInTheDocument();
  });

  it("keeps the selection on refresh, minus customers no longer listed", async () => {
    const { user, queryClient } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Di Doyle"));

    act(() => {
      queryClient.setQueryData(["admin-customer-insights"], insights(["Ann Archer", "Bo Byrne"]));
    });
    // React Query delivers cache updates on the next tick.
    await waitFor(() => expect(screen.queryByText("Di Doyle")).toBeNull());
    expect(rowCheckbox("Ann Archer")).toBeChecked();
    expect(within(bar()!).getByText(/1 selected/)).toBeInTheDocument();
  });

  it("clears the selection from the bar and returns focus to the header checkbox", async () => {
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(within(bar()!).getByRole("button", { name: "Clear selection" }));
    expect(bar()).toBeNull();
    expect(rowCheckbox("Ann Archer")).not.toBeChecked();
    expect(headerCheckbox()).toHaveFocus();
  });

  it("works from the keyboard: Space toggles, Escape in the bar clears", async () => {
    const { user } = renderPage();
    rowCheckbox("Bo Byrne").focus();
    await user.keyboard(" ");
    expect(rowCheckbox("Bo Byrne")).toBeChecked();

    within(bar()!).getByRole("button", { name: "Clear selection" }).focus();
    await user.keyboard("{Escape}");
    expect(bar()).toBeNull();
  });

  it("offers the four outcomes in one menu and the rest in the `…` menu", async () => {
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(within(bar()!).getByRole("button", { name: /Record outcome/ }));
    for (const label of [
      "No answer",
      "Doesn't want to continue",
      "Interested, but will continue later",
      "Successfully booked",
    ]) {
      expect(await screen.findByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    await user.keyboard("{Escape}");
    await user.click(within(bar()!).getByRole("button", { name: "More bulk actions" }));
    expect(await screen.findByRole("menuitem", { name: /Mark contacted/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Mark not contacted/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Add note/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe("bulk contacted status", () => {
  it("marks the selected customers as contacted and clears them from the selection", async () => {
    followup("Bo Byrne", { contacted: true, contacted_by_email: "alex@fettle.ie" });
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Bo Byrne"));
    await user.click(rowCheckbox("Cy Cole"));
    await bulkMenu(user, /Mark contacted/);

    expect(await screen.findByText("Marked as contacted: 2 customers")).toBeInTheDocument();
    expect(bar()).toBeNull();
    expect(db.rows.get(keyOf("Ann Archer"))?.contacted).toBe(true);
    expect(db.rows.get(keyOf("Cy Cole"))?.contacted).toBe(true);
    // Already contacted: not rewritten, so who contacted them is kept.
    expect(db.rows.get(keyOf("Bo Byrne"))?.contacted_by_email).toBe("alex@fettle.ie");
    expect(within(tableRow("Ann Archer")).getByText("Contacted")).toBeInTheDocument();
    expect(within(tableRow("Di Doyle")).getByText("Not contacted")).toBeInTheDocument();
  });

  it("asks before marking customers as not contacted", async () => {
    followup("Ann Archer", { contacted: true });
    followup("Bo Byrne", { contacted: true });
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Bo Byrne"));
    await user.click(rowCheckbox("Cy Cole"));
    await bulkMenu(user, /Mark not contacted/);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Mark 2 customers as not contacted?")).toBeInTheDocument();
    expect(within(dialog).getByText(/other 1 selected isn't marked as contacted/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(db.rows.get(keyOf("Ann Archer"))?.contacted).toBe(true);
    expect(within(bar()!).getByText(/3 selected/)).toBeInTheDocument();

    await bulkMenu(user, /Mark not contacted/);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Mark 2 customers as not contacted",
      })
    );
    expect(await screen.findByText("Marked as not contacted: 2 customers")).toBeInTheDocument();
    expect(db.rows.get(keyOf("Ann Archer"))?.contacted).toBe(false);
    expect(db.rows.get(keyOf("Bo Byrne"))?.contacted).toBe(false);
  });

  it("shows progress and blocks repeat submissions while saving", async () => {
    let release!: () => void;
    db.gate = new Promise((resolve) => (release = resolve));
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Bo Byrne"));
    await bulkMenu(user, /Mark contacted/);

    expect(await within(bar()!).findByText(/Saving 0 of 2/)).toBeInTheDocument();
    expect(within(bar()!).getByRole("button", { name: "More bulk actions" })).toBeDisabled();
    expect(within(bar()!).getByRole("button", { name: /Record outcome/ })).toBeDisabled();
    expect(within(bar()!).getByRole("button", { name: "Clear selection" })).toBeDisabled();
    expect(rowCheckbox("Cy Cole")).toBeDisabled();

    await act(async () => release());
    expect(await screen.findByText("Marked as contacted: 2 customers")).toBeInTheDocument();
    expect(rowCheckbox("Cy Cole")).toBeEnabled();
  });

  it("on partial failure, names the failed customers and keeps only them selected", async () => {
    db.failKeys.add(keyOf("Bo Byrne"));
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Bo Byrne"));
    await user.click(rowCheckbox("Cy Cole"));
    await bulkMenu(user, /Mark contacted/);

    expect(await screen.findByText("Updated 2 of 3 customers")).toBeInTheDocument();
    expect(screen.getByText(/Not saved: Bo Byrne\. permission denied/)).toBeInTheDocument();
    expect(rowCheckbox("Bo Byrne")).toBeChecked();
    expect(rowCheckbox("Ann Archer")).not.toBeChecked();
    expect(within(bar()!).getByText(/1 selected/)).toBeInTheDocument();
    expect(within(tableRow("Bo Byrne")).getByText("Not contacted")).toBeInTheDocument();
    expect(within(tableRow("Ann Archer")).getByText("Contacted")).toBeInTheDocument();
  });

  it("on total failure, keeps everything selected", async () => {
    db.failKeys.add(keyOf("Ann Archer"));
    db.failKeys.add(keyOf("Bo Byrne"));
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Bo Byrne"));
    await bulkMenu(user, /Mark contacted/);

    expect(await screen.findByText("Couldn't update 2 customers")).toBeInTheDocument();
    expect(within(bar()!).getByText(/2 selected/)).toBeInTheDocument();
    expect(db.rows.size).toBe(0);
  });

  it("explains why actions are unavailable before the follow-ups table exists", async () => {
    db.listError = { code: "PGRST205", message: "not found" };
    const { user } = renderPage({ seedFollowups: false });
    await user.click(rowCheckbox("Ann Archer"));
    expect(
      await within(bar()!).findByText(/Available once the follow-ups database update is deployed/)
    ).toBeInTheDocument();
    expect(within(bar()!).queryByRole("button", { name: /Record outcome/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("bulk notes", () => {
  const today = format(new Date(), "d MMM yyyy");

  async function openBulkNote(names: string[]) {
    const page = renderPage();
    for (const name of names) await page.user.click(rowCheckbox(name));
    await bulkMenu(page.user, /Add note/);
    return { ...page, dialog: await screen.findByRole("dialog") };
  }

  it("adds the note below existing notes for every selected customer", async () => {
    followup("Ann Archer", { note: "Prefers email" });
    const { user, dialog } = await openBulkNote(["Ann Archer", "Bo Byrne"]);

    expect(within(dialog).getByText("Add a note to 2 customers")).toBeInTheDocument();
    expect(within(dialog).getByText(/added to every selected customer/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 of them already has a note/)).toBeInTheDocument();

    await user.type(within(dialog).getByRole("textbox", { name: "Note to add" }), "Sent reminder");
    await user.click(within(dialog).getByRole("button", { name: "Add to 2 customers" }));

    expect(await screen.findByText("Note added for 2 customers")).toBeInTheDocument();
    expect(db.rows.get(keyOf("Ann Archer"))?.note).toBe(
      `Prefers email\n\n— ${today}, ben@fettle.ie\nSent reminder`
    );
    expect(db.rows.get(keyOf("Bo Byrne"))?.note).toBe(`— ${today}, ben@fettle.ie\nSent reminder`);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(headerCheckbox()).toHaveFocus());
  });

  it("needs some text and stops notes that are too long", async () => {
    const { user, dialog } = await openBulkNote(["Ann Archer"]);
    const save = within(dialog).getByRole("button", { name: "Add to 1 customer" });
    expect(save).toBeDisabled();

    const textbox = within(dialog).getByRole("textbox", { name: "Note to add" });
    await user.click(textbox);
    await user.paste("x".repeat(2000));
    expect(within(dialog).getByText(/This note is too long/)).toBeInTheDocument();
    expect(textbox).toHaveAttribute("aria-invalid", "true");
    expect(save).toBeDisabled();
  });

  it("warns about customers whose note is too full, and they fail and stay selected", async () => {
    followup("Bo Byrne", { note: "y".repeat(1990) });
    const { user, dialog } = await openBulkNote(["Ann Archer", "Bo Byrne"]);
    await user.type(within(dialog).getByRole("textbox", { name: "Note to add" }), "Sent reminder");
    expect(within(dialog).getByText(/Bo Byrne has too long a note/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add to 2 customers" }));
    expect(await screen.findByText("Updated 1 of 2 customers")).toBeInTheDocument();
    expect(db.rows.get(keyOf("Bo Byrne"))?.note).toBe("y".repeat(1990));
    expect(rowCheckbox("Bo Byrne")).toBeChecked();
    expect(rowCheckbox("Ann Archer")).not.toBeChecked();
  });

  it("never overwrites a note a colleague changed while saving", async () => {
    followup("Ann Archer", { note: "Original" });
    db.afterRead = (key) => {
      db.rows.set(key, { ...db.rows.get(key)!, note: "Colleague's edit" });
      db.afterRead = null;
    };
    const { user, dialog } = await openBulkNote(["Ann Archer"]);
    await user.type(within(dialog).getByRole("textbox", { name: "Note to add" }), "Mine");
    await user.click(within(dialog).getByRole("button", { name: "Add to 1 customer" }));

    expect(
      await within(dialog).findByText(/Someone else changed this note just now/)
    ).toBeInTheDocument();
    expect(db.rows.get(keyOf("Ann Archer"))?.note).toBe("Colleague's edit");
  });

  it("stays open with the error when nothing could be saved", async () => {
    db.failKeys.add(keyOf("Ann Archer"));
    const { user, dialog } = await openBulkNote(["Ann Archer"]);
    await user.type(within(dialog).getByRole("textbox", { name: "Note to add" }), "Hello");
    await user.click(within(dialog).getByRole("button", { name: "Add to 1 customer" }));

    expect(
      await within(dialog).findByText("Couldn't add the note: permission denied")
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Note to add" })).toHaveValue("Hello");
  });

  it("cancels without saving", async () => {
    const { user, dialog } = await openBulkNote(["Ann Archer"]);
    await user.type(within(dialog).getByRole("textbox", { name: "Note to add" }), "Hello");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(db.rows.size).toBe(0);
    expect(within(bar()!).getByText(/1 selected/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe("single-customer actions", () => {
  it("marks one customer as contacted from the row menu", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "More actions for Cy Cole" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark as contacted" }));

    expect(await screen.findByText("Marked as contacted")).toBeInTheDocument();
    expect(db.rows.get(keyOf("Cy Cole"))?.contacted).toBe(true);
    expect(within(tableRow("Cy Cole")).getByText("Contacted")).toBeInTheDocument();
  });

  it("edits one customer's note and returns focus to the note button", async () => {
    followup("Di Doyle", { note: "Old" });
    const { user } = renderPage();
    const noteButton = screen.getByRole("button", { name: "Edit note for Di Doyle" });
    await user.click(noteButton);

    const dialog = await screen.findByRole("dialog");
    const textbox = within(dialog).getByRole("textbox", { name: "Note" });
    expect(textbox).toHaveValue("Old");
    await user.clear(textbox);
    await user.type(textbox, "New");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Note saved")).toBeInTheDocument();
    expect(db.rows.get(keyOf("Di Doyle"))?.note).toBe("New");
    await waitFor(() => expect(noteButton).toHaveFocus());
  });

  it("opens the note from the row menu too", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "More actions for Ann Archer" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add note" }));
    expect(await screen.findByRole("dialog", { name: "Note for Ann Archer" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe("contact outcomes", () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
    user.click(screen.getByRole("button", { name: `More actions for ${name}` }));
  // Item names can carry a hidden "(Current)" / "(In Acuity)" suffix.
  const menuItem = (label: string) =>
    screen.getByRole("menuitem", { name: new RegExp(`^${label}`) });
  async function pick(user: ReturnType<typeof userEvent.setup>, name: string, label: string) {
    await openMenu(user, name);
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${label}`) }));
  }

  it("logs No answer as an attempt without marking them contacted", async () => {
    const { user } = renderPage();
    await pick(user, "Ann Archer", "No answer");

    expect(await screen.findByText("Recorded: No answer")).toBeInTheDocument();
    const row = within(tableRow("Ann Archer"));
    expect(row.getByText("1 attempt · not reached yet")).toBeInTheDocument();
    expect(row.getByText("No answer")).toBeInTheDocument();
    expect(db.rows.get(keyOf("Ann Archer"))?.contacted).toBe(false);

    // Clicking again logs another attempt.
    await pick(user, "Ann Archer", "No answer");
    expect(await row.findByText("2 attempts · not reached yet")).toBeInTheDocument();
    expect(db.attempts).toHaveLength(2);
  });

  it("keeps the row compact and marks the current outcome in the menu", async () => {
    followup("Ann Archer", { outcome: "no_answer", attempt_count: 1 });
    const { user } = renderPage();
    // No outcome buttons in the row itself.
    expect(within(tableRow("Ann Archer")).queryByRole("button", { name: /No answer/ })).toBeNull();

    await openMenu(user, "Ann Archer");
    expect(menuItem("No answer")).toHaveAccessibleName("No answer (Log again)");
    expect(menuItem("Successfully booked")).toHaveAccessibleName("Successfully booked");
  });

  it("asks for the reasons when a customer doesn't want to continue", async () => {
    const { user } = renderPage();
    await pick(user, "Bo Byrne", "Doesn't want to continue");

    const dialog = await screen.findByRole("dialog", { name: "What is the reason for not continuing?" });
    for (const reason of ["Price", "Timing", "No longer interested", "Other"]) {
      expect(within(dialog).getByRole("checkbox", { name: reason })).toBeInTheDocument();
    }
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Choose at least one reason.")).toBeInTheDocument();
    expect(db.attempts).toHaveLength(0);

    // The text field only appears with Other, and is then required.
    expect(within(dialog).queryByRole("textbox", { name: "Other reason" })).toBeNull();
    await user.click(within(dialog).getByRole("checkbox", { name: "Price" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Other" }));
    const other = within(dialog).getByRole("textbox", { name: "Other reason" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Enter the reason.")).toBeInTheDocument();

    await user.type(other, "Moving abroad");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Recorded: Doesn't want to continue")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(db.attempts[0]).toMatchObject({
      outcome: "not_continuing",
      reasons: ["price", "other"],
      reason_other: "Moving abroad",
      customer_name: "Bo Byrne",
    });
    expect(within(tableRow("Bo Byrne")).getByText("Price, Other: Moving abroad")).toBeInTheDocument();
    expect(within(tableRow("Bo Byrne")).getByText("Not continuing")).toBeInTheDocument();
  });

  it("keeps the reasons popup open with the error when saving fails", async () => {
    db.failKeys.add(keyOf("Bo Byrne"));
    const { user } = renderPage();
    await pick(user, "Bo Byrne", "Doesn't want to continue");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Timing" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Couldn't save: permission denied")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Timing" })).toBeChecked();
  });

  it("sets a follow-up date 30 days out for Continue later", async () => {
    const { user } = renderPage();
    await pick(user, "Cy Cole", "Interested, but will continue later");

    const due = format(new Date(Date.now() + 30 * 86_400_000), "d MMM yyyy");
    expect(await screen.findByText(`Cy Cole · Follow up on ${due}`)).toBeInTheDocument();
    expect(
      within(tableRow("Cy Cole")).getByText(`Follow up ${due} · Due in 30 days`)
    ).toBeInTheDocument();
    expect(db.rows.get(keyOf("Cy Cole"))?.contacted).toBe(true);
  });

  it("clears a mistaken outcome from the row menu and keeps the history", async () => {
    const { user } = renderPage();
    await pick(user, "Di Doyle", "Successfully booked");
    expect(await screen.findByText("Recorded: Successfully booked")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions for Di Doyle" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear outcome" }));
    expect(await screen.findByText("Outcome cleared")).toBeInTheDocument();
    expect(within(tableRow("Di Doyle")).queryByText("Booked")).toBeNull();
    expect(within(tableRow("Di Doyle")).getByText("Contacted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions for Di Doyle" }));
    await user.click(await screen.findByRole("menuitem", { name: "Contact history" }));
    const dialog = await screen.findByRole("dialog", { name: "Contact history · Di Doyle" });
    expect(await within(dialog).findByText("Outcome cleared")).toBeInTheDocument();
    expect(within(dialog).getByText("Successfully booked")).toBeInTheDocument();
  });

  it("records an outcome for every selected customer from the bar", async () => {
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Bo Byrne"));
    await bulkOutcome(user, "Interested, but will continue later");

    expect(await screen.findByText("Continue later: 2 customers")).toBeInTheDocument();
    expect(bar()).toBeNull();
    expect(db.rows.get(keyOf("Ann Archer"))?.outcome).toBe("follow_up_later");
    expect(db.rows.get(keyOf("Bo Byrne"))?.customer_name).toBe("Bo Byrne");
  });

  it("asks for reasons once for a bulk Not continuing", async () => {
    const { user } = renderPage();
    await user.click(rowCheckbox("Ann Archer"));
    await user.click(rowCheckbox("Cy Cole"));
    await bulkOutcome(user, "Doesn't want to continue");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Marks 2 customers as not wanting to continue/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "No longer interested" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Not continuing: 2 customers")).toBeInTheDocument();
    expect(db.rows.get(keyOf("Cy Cole"))?.not_continuing_reasons).toEqual(["not_interested"]);
  });

  it("filters the table by outcome", async () => {
    followup("Bo Byrne", { outcome: "booked", attempt_count: 1 });
    followup("Cy Cole", { outcome: "no_answer", attempt_count: 1 });
    const { user } = renderPage();

    await user.click(screen.getByRole("combobox", { name: "Filter by outcome" }));
    await user.click(await screen.findByRole("option", { name: "Booked" }));
    expect(screen.queryByText("Ann Archer")).toBeNull();
    expect(rowCheckbox("Bo Byrne")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Filter by outcome" }));
    await user.click(await screen.findByRole("option", { name: "No outcome yet" }));
    expect(rowCheckbox("Ann Archer")).toBeInTheDocument();
    expect(rowCheckbox("Di Doyle")).toBeInTheDocument();
    expect(screen.queryByText("Bo Byrne")).toBeNull();
    expect(screen.queryByText("Cy Cole")).toBeNull();
  });

  it("disables the outcome buttons with the reason before the database update", async () => {
    db.attemptsError = { code: "PGRST205", message: "not found" };
    const { user } = renderPage();
    await openMenu(user, "Ann Archer");
    expect(
      await screen.findByText(/Outcomes are available once the contact-outcomes database update/)
    ).toBeInTheDocument();
    expect(menuItem("No answer")).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    // Contacted and notes still work.
    expect(screen.getByRole("button", { name: "Add note for Ann Archer" })).toBeEnabled();
  });
});
