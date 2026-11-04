// @vitest-environment jsdom
import "@/test/setupDom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunnelResponse } from "@/lib/adminFunnel";
import { type FunnelSession, funnelReport } from "../../../../supabase/functions/admin-analytics/funnel.ts";
import { FunnelBoard } from "./FunnelBoard";

const state = vi.hoisted(() => ({ data: null as unknown, queries: [] as string[] }));

vi.mock("@/hooks/useAdmin", () => ({
  useAdminFunnel: (query: string) => {
    state.queries.push(query);
    return { data: state.data, error: null, isPending: false, isFetching: false, refetch: vi.fn() };
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const range = { from: "2026-11-01", to: "2026-11-30" };
const T = Date.parse("2026-11-10T12:00:00Z");
const FULL = ["booking_page_view", "step:who", "step:slot", "step:history", "step:details", "step:plan", "step:review", "step:pay", "booking_payment_submitted", "booking_completed"];

function s(over: Partial<FunnelSession>): FunnelSession {
  return {
    startedAt: T,
    flow: "website",
    bookingFlow: "quiz_v2_time_first",
    device: "mobile",
    clickTherapist: "Lisa Kelly",
    therapist: "Lisa Kelly",
    service: "individual",
    markers: ["booking_page_redirect", ...FULL],
    failReasons: [],
    referralSource: "Google",
    utmSource: null,
    ...over,
  };
}

function response(sessions: FunnelSession[], trackingStart: string | null = "2026-11-05T09:00:00Z"): FunnelResponse {
  const filters = { flow: null, device: null, path: null, service: null, therapist: null };
  return { generatedAt: new Date().toISOString(), trackingStart, params: { range, filters }, funnel: funnelReport(sessions, { range, filters }) };
}

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

function renderBoard(initial = "/admin") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <FunnelBoard range={range} />
      <LocationProbe />
    </MemoryRouter>
  );
}

beforeEach(() => {
  cleanup();
  state.queries = [];
});

describe("FunnelBoard", () => {
  it("shows the steps, the biggest drop and the therapist table", () => {
    state.data = response([
      s({}),
      s({ markers: ["booking_page_redirect", "booking_page_view", "step:who", "step:slot"] }),
      s({ clickTherapist: "Judith Malone", therapist: "Judith Malone", markers: ["booking_page_redirect", "booking_page_view", "step:slot"], failReasons: [] }),
      s({ markers: [...FULL.slice(0, 8), "booking_payment_failed"], failReasons: ["slot_unavailable"], referralSource: null }),
    ]);
    renderBoard();

    expect(screen.getByText("Tracking since 5 Nov 2026")).toBeTruthy();
    expect(screen.getByText("Biggest drop: About you")).toBeTruthy();
    const steps = screen.getByRole("list", { name: "How far visitors get" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(10);

    const table = screen.getByRole("columnheader", { name: "Book Now clicks" }).closest("table")!;
    const lisa = within(table).getByRole("button", { name: "Lisa Kelly" }).closest("tr")!;
    // clicks, opened, reached payment, booked, conversion, matching
    expect(within(lisa).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Lisa Kelly", "2", "3", "2", "1", "33%", "0"]);

    expect(screen.getByText("Time was just taken")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
  });

  it("filters by therapist when a name is clicked, and sends it in the query", async () => {
    state.data = response([s({})]);
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Lisa Kelly" }));
    expect(location).toContain("ftherapist=Lisa+Kelly");
    expect(state.queries.at(-1)).toContain("therapist=Lisa+Kelly");
    expect(state.queries.at(-1)).toContain("action=funnel");
    await userEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(location).not.toContain("ftherapist");
  });

  it("explains when nothing has been recorded yet", () => {
    state.data = response([], null);
    renderBoard();
    expect(screen.getByText(/No booking-form visits recorded yet/)).toBeTruthy();
  });

  it("keeps only the last year of a longer range", () => {
    state.data = response([]);
    render(
      <MemoryRouter>
        <FunnelBoard range={{ from: "2024-01-01", to: "2026-11-30" }} />
      </MemoryRouter>
    );
    expect(state.queries.at(-1)).toContain("from=2025-11-30");
    expect(screen.getByText(/at most a year/)).toBeTruthy();
  });
});
