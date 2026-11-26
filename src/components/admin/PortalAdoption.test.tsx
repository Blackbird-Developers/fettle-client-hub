// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CustomerInsightsResponse } from "@/hooks/useAdmin";
import {
  type AcuityAppointment,
  DAY_MS,
  buildAdoptionView,
  groupCustomers,
} from "../../../supabase/functions/admin-customer-insights/logic.ts";
import { PortalAdoption } from "./PortalAdoption";

const state = vi.hoisted(() => ({ data: null as unknown, periods: undefined as unknown }));

vi.mock("@/hooks/useAdmin", () => ({
  useCustomerInsights: () => ({ data: state.data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useWorklistPeriods: () => ({ data: state.periods, isPending: state.periods === undefined, error: null }),
}));
vi.mock("./PortalEmailsPanel", () => ({ PortalEmailsPanel: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const NOW = Date.now();
let nextId = 1;
const session = (name: string, daysAgo: number): AcuityAppointment => ({
  id: nextId++,
  firstName: name,
  lastName: "Test",
  email: `${name.toLowerCase()}@example.com`,
  phone: "087 123 4567",
  datetime: new Date(NOW - daysAgo * DAY_MS).toISOString(),
  type: "Individual Therapy",
  canceled: false,
});

const TOTALS = { activeCustomers: 10, withAccount: 6, withoutAccount: 3, noEmail: 1, adoptionRate: 2 / 3 };

describe("Portal adoption page", () => {
  it("narrows the list by last session, and compares the period's adoption with the one before", async () => {
    const customers = groupCustomers([session("Ann", 3), session("Bo", 20)]);
    state.data = {
      generatedAt: new Date(NOW).toISOString(),
      activeWindowDays: 30,
      progressionPeriods: [],
      adoption: { ...buildAdoptionView(customers, new Set(), NOW), legend: [] },
      progression: [],
      dataIssues: { incompleteDates: [], unknownTypes: [], customersWithoutEmail: 0, customersWithoutPhone: 0, unverifiedHistory: 0 },
      diagnostics: { windowAppointments: 0, customersInWindow: 0, historyLookups: 0, acuityRequests: 0, durationMs: 0 },
    } satisfies CustomerInsightsResponse;
    state.periods = {
      generatedAt: "",
      data: { lastRefreshedAt: "" },
      params: { list: "adoption" },
      totals: TOTALS,
      compare: { ...TOTALS, withAccount: 3, adoptionRate: 0.5 },
    };
    render(
      <TooltipProvider>
        <PortalAdoption />
      </TooltipProvider>
    );
    expect(screen.getByText("Ann Test")).toBeInTheDocument();
    expect(screen.getByText("Bo Test")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByText("Ann Test")).toBeInTheDocument();
    expect(screen.queryByText("Bo Test")).toBeNull();
    const period = screen.getByRole("heading", { name: /In this period/ }).closest("section")!;
    expect(period).toHaveTextContent("67%");
    expect(period).toHaveTextContent("+16.7 pts vs previous period");
  });
});
