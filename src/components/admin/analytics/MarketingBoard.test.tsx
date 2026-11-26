// @vitest-environment jsdom
import "@/test/setupDom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardComparison } from "@/lib/adminAnalytics";
import type { MarketingResponse } from "@/lib/adminMarketing";
import { type MarketingDay, marketingReport, parseSyncState } from "../../../../supabase/functions/admin-analytics/marketing.ts";
import { MarketingBoard } from "./MarketingBoard";

const state = vi.hoisted(() => ({ data: null as unknown, queries: [] as string[] }));

vi.mock("@/hooks/useAdmin", () => ({
  useAdminMarketing: (query: string) => {
    state.queries.push(query);
    return { data: state.data, error: null, isPending: false, isFetching: false, refetch: vi.fn() };
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const range = { from: "2026-11-01", to: "2026-11-30" };
const compareRange = { from: "2026-10-02", to: "2026-10-31" };

function day(over: Partial<MarketingDay>): MarketingDay {
  return {
    day: "2026-11-10",
    channel: "meta",
    currency: "EUR",
    spend: 300,
    impressions: 10_000,
    clicks: 200,
    outboundClicks: 150,
    conversions: 6,
    conversionValue: null,
    campaigns: 1,
    ...over,
  };
}

function response(days: MarketingDay[], syncRows: unknown[], newCustomers = 10, compareNewCustomers = 8): MarketingResponse {
  return {
    generatedAt: "2026-11-25T10:00:00Z",
    ...marketingReport({
      params: { range, groupBy: "week", compareTo: "previous", compareRange },
      compareRange,
      days,
      statuses: parseSyncState(syncRows),
      newCustomers,
      compareNewCustomers,
      newCustomersByPeriod: new Map([["2026-11-09", newCustomers]]),
    }),
  };
}

const META_SYNCED = { channel: "meta", last_success_at: "2026-11-25T03:00:00Z", history_from: "2025-11-01" };
const GOOGLE_SYNCED = { channel: "google", last_success_at: "2026-11-25T03:00:00Z", history_from: "2025-11-01" };

function renderBoard(compare: BoardComparison = { preset: "previous", range: compareRange }) {
  return render(<MarketingBoard range={range} groupBy="week" compare={compare} />);
}

function tile(label: string) {
  return screen.getByText(label).closest("div")!;
}

beforeEach(() => {
  cleanup();
  state.data = null;
  state.queries = [];
});

describe("MarketingBoard", () => {
  it("asks for the shared range, grouping and comparison", () => {
    state.data = response([], []);
    renderBoard();
    expect(state.queries.at(-1)).toBe("action=marketing&from=2026-11-01&to=2026-11-30&group=week&compare=previous");
  });

  it("sends a weekday-matched comparison as custom dates, and hides changes with compare off", () => {
    state.data = response([day({})], [META_SYNCED]);
    renderBoard({ preset: "previousWeekday", range: { from: "2026-10-04", to: "2026-11-02" } });
    expect(state.queries.at(-1)).toBe(
      "action=marketing&from=2026-11-01&to=2026-11-30&group=week&compare=custom&cfrom=2026-10-04&cto=2026-11-02"
    );
    expect(within(tile("Ad spend")).getByText(/vs previous period .same weekdays./)).toBeTruthy();

    cleanup();
    renderBoard(null);
    expect(within(tile("Ad spend")).queryByText(/ vs /)).toBeNull();
    expect(screen.queryByText(/Compared with/)).toBeNull();
  });

  it("says nothing is connected yet instead of showing zeros", () => {
    state.data = response([], []);
    renderBoard();
    expect(screen.getByText("No ad accounts connected yet")).toBeTruthy();
    expect(screen.queryByText("Cost per new customer")).toBeNull();
    expect(screen.getAllByText("Not connected yet")).toHaveLength(3);
  });

  it("shows spend, cost per new customer and the channel rows", () => {
    state.data = response(
      [
        day({ channel: "meta", spend: 300, conversions: 6 }),
        day({ channel: "google", spend: 200, conversions: 4, outboundClicks: null, impressions: 4_000, clicks: 100 }),
        day({ day: "2026-10-15", channel: "meta", spend: 400, conversions: 5 }),
      ],
      [META_SYNCED, GOOGLE_SYNCED]
    );
    renderBoard();

    expect(within(tile("Ad spend")).getByText("€500")).toBeTruthy();
    expect(within(tile("Ad spend")).getByText(/\+€100 \(\+25%\) vs previous period/)).toBeTruthy();
    // Spend + 23% VAT: €615 now, €492 before.
    expect(within(tile("Ad spend (inc. VAT)")).getByText("€615")).toBeTruthy();
    expect(within(tile("Ad spend (inc. VAT)")).getByText(/\+€123 \(\+25%\) vs previous period/)).toBeTruthy();
    // 615 / 10 now, 492 / 8 before: €61.50 both times.
    expect(within(tile("Cost per new customer")).getByText("€61.50")).toBeTruthy();
    expect(within(tile("New customers")).getByText("10")).toBeTruthy();

    const rows = screen.getAllByRole("row");
    const meta = rows.find((r) => within(r).queryByText("Meta") && within(r).queryByText(/Synced/))!;
    expect(within(meta).getByText("1.50%")).toBeTruthy(); // outbound CTR 150 / 10,000
    const google = rows.find((r) => within(r).queryByText("Google Ads") && within(r).queryByText(/Synced/))!;
    expect(within(google).getByText("n/a")).toBeTruthy();
    expect(within(google).getByText("2.50%")).toBeTruthy(); // CTR 100 / 4,000
    // TikTok was never set up: no empty row, just a line under the table.
    expect(rows.find((r) => within(r).queryByText("TikTok"))).toBeUndefined();
    expect(screen.getByText("Not connected: TikTok.")).toBeTruthy();
  });

  it("keeps a channel whose first sync failed in the table, with its error", () => {
    state.data = response([day({})], [META_SYNCED, { channel: "google", last_error: "Developer token not approved" }]);
    renderBoard();
    const google = screen.getAllByRole("row").find((r) => within(r).queryByText("Google Ads"))!;
    expect(within(google).getByText("Not connected yet")).toBeTruthy();
    expect(within(google).getByText(/Last try failed: Developer token not approved/)).toBeTruthy();
    expect(screen.getByText("Not connected: TikTok.")).toBeTruthy();
  });

  it("warns when a channel's history starts after the range does", () => {
    state.data = response([day({})], [{ ...META_SYNCED, history_from: "2026-11-10" }]);
    renderBoard();
    expect(screen.getByText("Some spend before this range is missing")).toBeTruthy();
    expect(screen.getByText(/Meta figures start on 10 Nov 2026/)).toBeTruthy();
  });

  it("warns about spend in another currency", () => {
    state.data = response([day({}), day({ channel: "meta", currency: "USD", spend: 42.5 })], [META_SYNCED]);
    renderBoard();
    expect(screen.getByText("Spend in another currency left out")).toBeTruthy();
  });

  it("says the tab isn't switched on when an older admin-analytics answers", () => {
    // The pre-marketing function ignores action=marketing and sends the boards' numbers.
    state.data = { generatedAt: "2026-11-25T10:00:00Z", data: {}, params: {}, progression: {}, customers: {} };
    renderBoard();
    expect(screen.getByText("The Marketing tab isn't switched on yet")).toBeTruthy();
  });

  it("shows a failed sync next to the channel", () => {
    state.data = response([day({})], [{ ...META_SYNCED, last_error: "Token expired" }]);
    renderBoard();
    expect(screen.getByText(/Latest sync failed: Token expired/)).toBeTruthy();
  });
});
