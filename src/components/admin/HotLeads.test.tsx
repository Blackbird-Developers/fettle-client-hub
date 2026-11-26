// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { HotLeadsResponse } from "@/hooks/useAdmin";
import { type CustomerFollowup, blankFollowup } from "@/lib/customerFollowups";
import type { RecentAttempt } from "@/lib/hotLeads";
import type { LeadRow } from "../../../supabase/functions/admin-leads/logic.ts";
import { HotLeads } from "./HotLeads";

// The page's data hooks are replaced with fixed data; the row actions and
// bulk bar have their own tests (SessionProgression.test.tsx).
const state = vi.hoisted(() => ({
  leads: null as unknown as HotLeadsResponse,
  followups: [] as CustomerFollowup[],
  attempts: [] as RecentAttempt[],
  periods: undefined as unknown,
  periodQueries: [] as string[],
}));

vi.mock("@/hooks/useAdmin", () => ({
  useHotLeads: () => ({
    data: state.leads,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useCustomerFollowups: () => ({ data: state.followups, isPending: false, isError: false }),
  useRecentContactAttempts: () => ({ data: state.attempts }),
  useContactOutcomesAvailable: () => ({ data: true, isPending: false, isError: false }),
  useBulkUpdateFollowups: () => ({ run: vi.fn(), isPending: false, progress: null }),
  useWorklistPeriods: (query: string) => {
    state.periodQueries.push(query);
    return { data: state.periods, isPending: state.periods === undefined, error: null };
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("./FollowupActions", () => ({
  FollowupActions: ({ customerName }: { customerName: string | null }) => (
    <span>actions for {customerName}</span>
  ),
}));

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function lead(name: string, overrides: Partial<LeadRow> = {}): LeadRow {
  const daysSinceLead = overrides.daysSinceLead ?? 5;
  return {
    key: `email:${name.toLowerCase()}@example.com`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    phone: "087 123 4567",
    source: "quoted",
    leadAt: daysAgo(daysSinceLead),
    leadType: "Let's Talk - Finding your Path",
    owner: "Alex",
    daysSinceLead,
    status: "open",
    statusAt: null,
    statusDetail: null,
    priorSessions: 0,
    noShows: 0,
    historyStatus: "verified",
    portalStatus: "no_account",
    ...overrides,
  };
}

function response(rows: LeadRow[]): HotLeadsResponse {
  return {
    generatedAt: new Date(NOW).toISOString(),
    lookbackDays: 90,
    leads: { rows, totals: { open: 0, call_rebooked: 0, converted: 0, quoted: 0, noShow: 0 } },
    dataIssues: { incompleteDates: [], leadsWithoutEmail: 0, unverifiedHistory: 0 },
    diagnostics: { windowAppointments: 0, leads: rows.length, acuityRequests: 0, durationMs: 0 },
  };
}

const renderPage = () =>
  render(
    <TooltipProvider>
      <HotLeads />
    </TooltipProvider>
  );

/** Customer names in table order. */
const tableNames = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByText(/^actions for /).textContent?.replace("actions for ", ""));

beforeEach(() => {
  state.followups = [];
  state.attempts = [];
  state.periods = undefined;
  state.periodQueries = [];
});

describe("Hot leads", () => {
  it("lists open leads highest score first", () => {
    state.leads = response([
      lead("Older", { daysSinceLead: 40, source: "no_show" }),
      lead("Fresh", { daysSinceLead: 1, source: "both" }),
      lead("Middle", { daysSinceLead: 10 }),
    ]);
    renderPage();
    expect(tableNames()).toEqual(["Fresh", "Middle", "Older"]);
    // 40 recency + 30 source + 15 not contacted.
    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("drops a lead down the list once it has been called today", () => {
    state.leads = response([lead("Called"), lead("Waiting", { daysSinceLead: 6 })]);
    state.attempts = [
      { customer_key: "email:called@example.com", outcome: "no_answer", created_at: new Date(NOW - 3_600_000).toISOString() },
    ];
    renderPage();
    expect(tableNames()).toEqual(["Waiting", "Called"]);
    expect(screen.getByText("1 attempt")).toBeInTheDocument();
  });

  it("moves converted, rebooked and staff-closed leads to their own tabs", async () => {
    const user = userEvent.setup();
    state.leads = response([
      lead("Open"),
      lead("Converted", { status: "converted", statusAt: daysAgo(-3), statusDetail: "Individual Session" }),
      lead("Rebooked", { status: "call_rebooked", statusAt: daysAgo(-2) }),
      lead("Declined"),
    ]);
    state.followups = [
      {
        ...blankFollowup("email:declined@example.com"),
        outcome: "not_continuing",
        outcome_at: daysAgo(1),
      },
    ];
    renderPage();

    expect(tableNames()).toEqual(["Open"]);
    expect(screen.getByRole("radio", { name: "Converted (1)" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Converted (1)" }));
    expect(tableNames()).toEqual(["Converted"]);
    expect(screen.getByText("Individual Session")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Call rebooked (1)" }));
    expect(tableNames()).toEqual(["Rebooked"]);

    await user.click(screen.getByRole("radio", { name: "Closed by staff (1)" }));
    expect(tableNames()).toEqual(["Declined"]);
  });

  it("filters by source and calendar", async () => {
    const user = userEvent.setup();
    state.leads = response([
      lead("Quote", { owner: "Alex" }),
      lead("Missed", { source: "no_show", owner: "Courtney" }),
    ]);
    renderPage();

    await user.click(screen.getByRole("combobox", { name: "Filter by calendar" }));
    await user.click(screen.getByRole("option", { name: "Courtney" }));
    expect(tableNames()).toEqual(["Missed"]);

    await user.click(screen.getByRole("combobox", { name: "Filter by source" }));
    await user.click(screen.getByRole("option", { name: "Quoted" }));
    expect(screen.getByText("No leads match your search or filters.")).toBeInTheDocument();
  });

  it("narrows the list to a period and shows its figures, compared with the period before", async () => {
    state.leads = response([lead("Ann", { daysSinceLead: 3 }), lead("Bo", { daysSinceLead: 40 })]);
    const totals = { leads: 4, missedCalls: 3, quoted: 2, converted: 2, conversionRate: 0.5 };
    state.periods = {
      generatedAt: new Date(NOW).toISOString(),
      data: { lastRefreshedAt: new Date(NOW).toISOString() },
      params: { list: "leads" },
      totals,
      compare: { ...totals, leads: 2, converted: 0, conversionRate: 0 },
    };
    const user = userEvent.setup();
    renderPage();
    expect(tableNames()).toEqual(["Ann", "Bo"]);
    expect(state.periodQueries.at(-1)).toContain("action=periods&list=leads");

    await user.click(screen.getByRole("button", { name: /last 90 days/i }));
    await user.click(screen.getByRole("button", { name: "Last 30 days" }));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(tableNames()).toEqual(["Ann"]);
    const people = screen.getByText("People with a lead").parentElement!;
    expect(people).toHaveTextContent("+2 (+100%) vs previous period");
    const converted = screen.getAllByText("Converted").map((el) => el.parentElement!).find((el) => el.textContent?.includes("50%"))!;
    expect(converted).toHaveTextContent("+50.0 pts vs previous period");
  });

  it("says when the period figures need the server update", () => {
    state.leads = response([lead("Ann")]);
    state.periods = { generatedAt: "", data: {}, params: { range: {} }, progression: {} };
    renderPage();
    expect(screen.getByText(/appear once the latest admin-analytics function is deployed/)).toBeInTheDocument();
  });
});
