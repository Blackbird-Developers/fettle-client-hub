// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { type CustomerFollowup, blankFollowup } from "@/lib/customerFollowups";
import { FollowUpsReport } from "./FollowUpsReport";
import { FollowUpsSummaryCard } from "./FollowUpsSummaryCard";

// customer_followups rows by key. Recording an outcome goes through the same
// applyOutcome mirror the Progression tests use.
const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "staff-1", email: "ben@fettle.ie" } }),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { applyOutcome } = await import("@/lib/contactOutcomes");

  class Query {
    op: "select" | "insert" = "select";
    payload: Record<string, unknown> = {};
    key: string | null = null;
    constructor(public table: string) {}
    select() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    eq(_column: string, value: string) {
      this.key = value;
      return this;
    }
    insert(payload: Record<string, unknown>) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }
    async single() {
      return { data: db.rows.get(this.key!) ?? null, error: null };
    }
    then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
      if (this.op === "insert") {
        const p = this.payload as { customer_key: string; customer_name: string | null; outcome: "booked" };
        const existing = db.rows.get(p.customer_key);
        const [next] = applyOutcome(
          existing ? [existing as never] : [],
          p.customer_key,
          p.customer_name,
          { outcome: p.outcome },
          "ben@fettle.ie"
        );
        db.rows.set(p.customer_key, next);
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
      const data = this.table === "customer_followups" ? [...db.rows.values()] : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
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

const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");

function seed(key: string, overrides: Partial<CustomerFollowup>) {
  db.rows.set(key, { ...blankFollowup(key), attempt_count: 1, ...overrides });
}

function renderWith(ui: JSX.Element) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(["is-admin", "staff-1"], true);
  queryClient.setQueryData(["customer-followups"], [...db.rows.values()]);
  queryClient.setQueryData(["customer-contact-history", "available"], true);
  // No insights: the report falls back to the stored name and the customer key.
  queryClient.setQueryData(["admin-customer-insights"], { progression: [] });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TooltipProvider>
          {ui}
          <Toaster />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { user };
}

beforeEach(() => {
  db.rows.clear();
  seed("email:ann@x.ie", {
    outcome: "follow_up_later",
    follow_up_due: day(-3),
    customer_name: "Ann Archer",
    outcome_at: "2026-09-05T10:00:00Z",
    outcome_by_email: "alex@fettle.ie",
  });
  seed("phone:0871234567", {
    outcome: "follow_up_later",
    follow_up_due: day(4),
    customer_name: "Bo Byrne",
  });
  seed("email:cy@x.ie", {
    outcome: "follow_up_later",
    follow_up_due: day(20),
    customer_name: "Cy Cole",
  });
  seed("email:di@x.ie", {
    outcome: "not_continuing",
    not_continuing_reasons: ["price", "other"],
    not_continuing_other: "Moving abroad",
    customer_name: "Di Doyle",
  });
  seed("email:ed@x.ie", { outcome: "booked", customer_name: "Ed Egan" });
});

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

describe("Follow-ups report", () => {
  it("lists Continue later customers, most overdue first, with when to call", () => {
    renderWith(<FollowUpsReport />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByText(/Archer|Byrne|Cole/).textContent)).toEqual([
      "Ann Archer",
      "Bo Byrne",
      "Cy Cole",
    ]);
    expect(within(rowOf("Ann Archer")).getByText("3 days overdue")).toBeInTheDocument();
    expect(within(rowOf("Ann Archer")).getByText("by alex@fettle.ie")).toBeInTheDocument();
    expect(within(rowOf("Bo Byrne")).getByText("Due in 4 days")).toBeInTheDocument();
    // Contact details come from the customer key when Acuity data isn't loaded.
    expect(within(rowOf("Ann Archer")).getByText("Email: ann@x.ie")).toBeInTheDocument();
    expect(within(rowOf("Bo Byrne")).getByText("Phone: 0871234567")).toBeInTheDocument();
    expect(screen.queryByText("Ed Egan")).toBeNull();
  });

  it("narrows to customers to call now or this week", async () => {
    const { user } = renderWith(<FollowUpsReport />);
    await user.click(screen.getByRole("radio", { name: "To call now (1)" }));
    expect(screen.getByText("Ann Archer")).toBeInTheDocument();
    expect(screen.queryByText("Bo Byrne")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Next 7 days (2)" }));
    expect(screen.getByText("Bo Byrne")).toBeInTheDocument();
    expect(screen.queryByText("Cy Cole")).toBeNull();
  });

  it("takes a customer off the list once another outcome is recorded", async () => {
    const { user } = renderWith(<FollowUpsReport />);
    await user.click(
      within(rowOf("Ann Archer")).getByRole("button", { name: "Successfully booked — Ann Archer" })
    );
    expect(await screen.findByText("Recorded: Successfully booked")).toBeInTheDocument();
    // Still named in the toast, but no longer in the table.
    expect(within(screen.getByRole("table")).queryByText("Ann Archer")).toBeNull();
    expect(db.rows.get("email:ann@x.ie")?.follow_up_due).toBeNull();
  });

  it("shows why customers aren't continuing", async () => {
    const { user } = renderWith(<FollowUpsReport />);
    await user.click(screen.getByRole("tab", { name: "Not continuing (1)" }));
    expect((await screen.findAllByText("Price, Other: Moving abroad")).length).toBeGreaterThan(0);
    expect(screen.getByText("Di Doyle")).toBeInTheDocument();
    const price = screen.getByText("Price").closest("li")!;
    expect(price).toHaveTextContent("1 of 1 customers(100%)");
  });
});

describe("Overview follow-ups card", () => {
  it("counts who to call now and links to the report", () => {
    renderWith(<FollowUpsSummaryCard />);
    const tile = (label: string) => screen.getByText(label).parentElement!;
    expect(tile("To call now")).toHaveTextContent("1");
    expect(tile("Due in the next 7 days")).toHaveTextContent("1");
    expect(tile("Continue later (all)")).toHaveTextContent("3");
    expect(tile("Not continuing")).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: /Open report/ })).toHaveAttribute("href", "/admin/followups");
  });
});
