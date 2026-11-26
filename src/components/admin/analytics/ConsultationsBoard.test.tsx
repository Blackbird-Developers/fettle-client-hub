// @vitest-environment jsdom
import "@/test/setupDom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardComparison } from "@/lib/adminAnalytics";
import type { ConsultationsResponse } from "@/lib/adminConsultations";
import {
  type ConsultationRow,
  consultationReport,
} from "../../../../supabase/functions/admin-analytics/consultations.ts";
import { type SessionRow, buildHistories } from "../../../../supabase/functions/admin-analytics/logic.ts";
import { ConsultationsBoard } from "./ConsultationsBoard";

const state = vi.hoisted(() => ({ data: null as unknown, queries: [] as string[] }));

vi.mock("@/hooks/useAdmin", () => ({
  useAdminConsultations: (query: string) => {
    state.queries.push(query);
    return { data: state.data, error: null, isPending: false, isFetching: false, refetch: vi.fn() };
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const range = { from: "2026-11-01", to: "2026-11-30" };
const compareRange = { from: "2026-10-02", to: "2026-10-31" };
const NOW = Date.parse("2026-11-26T12:00:00Z");
let nextId = 1;

function call(customer: string, datetime: string, overrides: Partial<ConsultationRow> = {}): ConsultationRow {
  return {
    id: nextId++,
    customerKey: `email:${customer}@example.com`,
    at: Date.parse(datetime),
    canceled: false,
    type: "lets_talk",
    calendarId: 7,
    calendar: "Courtney",
    noShow: false,
    ...overrides,
  };
}

function session(customer: string, datetime: string, bookedAt: string): SessionRow {
  return {
    id: nextId++,
    customerKey: `email:${customer}@example.com`,
    at: Date.parse(datetime),
    createdAt: Date.parse(bookedAt),
    kind: "therapy",
    bookedByClient: true,
    calendarId: 1,
    canceled: false,
    category: "individual",
    bookingSource: null,
  };
}

function response(): ConsultationsResponse {
  const params = { range, compareRange, compareTo: "previous" as const, groupBy: "day" as const, windowDays: 30 };
  return {
    generatedAt: "2026-11-26T12:00:00Z",
    data: { lastRefreshedAt: "2026-11-26T11:00:00Z", historyComplete: true, historyFrom: null },
    params,
    ...consultationReport({
      calls: [
        call("new1", "2026-11-03T10:00:00Z"),
        call("new2", "2026-11-04T10:00:00Z", { noShow: true }),
        call("old1", "2026-11-04T15:00:00Z"),
        call("new3", "2026-11-29T10:00:00Z"),
        call("oct1", "2026-10-10T10:00:00Z"),
        call("oct2", "2026-10-11T10:00:00Z"),
      ],
      histories: buildHistories([
        session("new1", "2026-11-10T10:00:00Z", "2026-11-03T11:00:00Z"),
        session("old1", "2026-03-01T10:00:00Z", "2026-02-20T10:00:00Z"),
      ]),
      params,
      now: NOW,
    }),
  };
}

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

function renderBoard(compare: BoardComparison = { preset: "previous", range: compareRange }, onWindowChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/admin?board=consultations"]}>
      <ConsultationsBoard range={range} compare={compare} windowDays={30} onWindowChange={onWindowChange} />
      <LocationProbe />
    </MemoryRouter>
  );
  return { onWindowChange };
}

// Tiles come first, before the tables with the same column names.
const tile = (label: string) => screen.getAllByText(label)[0].closest("div")!;

beforeEach(() => {
  cleanup();
  state.data = null;
  state.queries = [];
});

describe("ConsultationsBoard", () => {
  it("asks for the range, grouping, window and comparison", () => {
    state.data = response();
    renderBoard();
    expect(state.queries.at(-1)).toBe("action=consultations&from=2026-11-01&to=2026-11-30&group=day&window=30&compare=previous");
  });

  it("shows booked, no-shows, new vs existing and the conversion rate with changes", () => {
    state.data = response();
    renderBoard();
    expect(within(tile("Calls booked")).getByText("4")).toBeTruthy();
    expect(within(tile("Calls booked")).getByText("+2 (+100%) vs previous period")).toBeTruthy();
    expect(within(tile("No-shows")).getByText("1")).toBeTruthy();
    expect(within(tile("New vs existing")).getByText("3 / 1")).toBeTruthy();
    // 1 of 2 attended converted now; 0 of 2 in October.
    expect(within(tile("Conversion rate")).getByText("50%")).toBeTruthy();
    expect(within(tile("Conversion rate")).getByText("+50.0 pts vs previous period")).toBeTruthy();

    const segments = screen.getByRole("heading", { name: "New and existing customers" }).parentElement!;
    const newRow = within(segments).getByText("New customers").closest("tr")!;
    expect(within(newRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(["New customers", "3", "1", "1", "1", "100% (1/1)"]);

    const days = screen.getByRole("heading", { name: "Day by day" }).parentElement!;
    const nov4 = within(days).getByText("Wed 4 Nov 2026").closest("tr")!;
    expect(within(nov4).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Wed 4 Nov 2026", "2", "1", "1", "1", "1", "0", "0% (0/1)"]);
    expect(screen.getByText(/Let's Talk: 4 · Introduction Chat: 0/)).toBeTruthy();
  });

  it("hides the changes with compare off", () => {
    state.data = response();
    renderBoard(null);
    expect(screen.queryByText(/vs previous period/)).toBeNull();
    expect(screen.queryByText(/Compared with/)).toBeNull();
  });

  it("keeps the Day / Week / Month choice in the URL and passes the window up", async () => {
    state.data = response();
    const { onWindowChange } = renderBoard();
    await userEvent.click(screen.getByRole("radio", { name: "Week" }));
    expect(location).toContain("cgroup=week");
    expect(state.queries.at(-1)).toContain("group=week");
    await userEvent.click(screen.getByRole("radio", { name: "60 days" }));
    expect(onWindowChange).toHaveBeenCalledWith(60);
  });

  it("says so when the server side isn't deployed yet", () => {
    state.data = { progression: {}, customers: {} };
    renderBoard();
    expect(screen.getByText("The Free consultations tab isn't switched on yet")).toBeTruthy();
  });
});
