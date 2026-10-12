// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BundlesResponse } from "@/hooks/useAdmin";
import type { BundleRow, BundleSegment } from "../../../supabase/functions/admin-bundles/logic.ts";
import { Bundles } from "./Bundles";

const state = vi.hoisted(() => ({ data: null as unknown as BundlesResponse }));

vi.mock("@/hooks/useAdmin", () => ({
  useBundles: () => ({ data: state.data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useCustomerFollowups: () => ({ data: [], isPending: false, isError: false }),
  useContactOutcomesAvailable: () => ({ data: true, isPending: false, isError: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("./FollowupActions", () => ({
  FollowupActions: ({ customerName }: { customerName: string | null }) => <span>actions for {customerName}</span>,
}));

let nextId = 1;
function bundle(name: string, segment: BundleSegment, overrides: Partial<BundleRow> = {}): BundleRow {
  return {
    id: nextId++,
    code: `CODE${nextId}`,
    key: `email:${name.split(" ")[0].toLowerCase()}@example.com`,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    phone: "087 123 4567",
    bundleName: "6 Session Bundle",
    knownProduct: true,
    totalCredits: 6,
    usedCredits: 2,
    remainingCredits: 4,
    utilisation: 33,
    purchasedAt: "2026-08-01T10:00:00.000Z",
    purchasedSource: "acuity",
    expiresAt: null,
    daysToExpiry: null,
    lastSessionAt: "2026-10-01T10:00:00.000Z",
    daysSinceLastSession: 13,
    nextSessionAt: null,
    sessionsMatchedBy: "code",
    portalStatus: "no_account",
    otherBundles: 0,
    segment,
    ...overrides,
  };
}

function response(rows: BundleRow[], overrides: Partial<BundlesResponse["dataIssues"]> = {}): BundlesResponse {
  const counts = { expiring: 0, not_started: 0, stalled: 0, nearly_done: 0, on_track: 0, used_up: 0, expired: 0 };
  for (const row of rows) counts[row.segment]++;
  return {
    generatedAt: new Date().toISOString(),
    lookbackDays: 365,
    bundles: {
      rows,
      counts,
      totals: { activeBundles: 3, unusedCredits: 11, expiringSoon: counts.expiring, stalled: counts.stalled, averageUtilisation: 40 },
      skipped: { notSessionBundles: 2, oldUsedUp: 5, oldExpired: 1, unknownProducts: 0 },
    },
    dataIssues: { incompleteDates: [], bundlesWithoutEmail: 0, matchedByEmailOnly: 0, ...overrides },
    diagnostics: { certificates: 10, windowAppointments: 100, acuityRequests: 50, durationMs: 1000 },
  };
}

function renderPage() {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <Bundles />
    </TooltipProvider>
  );
  return { user };
}

beforeEach(() => {
  state.data = response([]);
});

describe("Bundles page", () => {
  it("shows the header numbers and opens on the most urgent segment", () => {
    state.data = response([
      bundle("Ann Archer", "expiring", { expiresAt: "2026-10-30T00:00:00.000Z", daysToExpiry: 16 }),
      bundle("Bo Byrne", "stalled"),
    ]);
    renderPage();

    expect(screen.getByText("Active bundles").previousSibling).toHaveTextContent("3");
    expect(screen.getByText("Average utilisation").previousSibling).toHaveTextContent("40%");
    expect(screen.getByRole("radio", { name: "Expiring soon (1)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Call to book before credits are lost/)).toBeInTheDocument();

    const ann = within(screen.getByText("Ann Archer").closest("tr")!);
    expect(ann.getByText("2 of 6 used ·", { exact: false })).toBeInTheDocument();
    expect(ann.getByText(/16 days left/)).toBeInTheDocument();
    expect(screen.queryByText("Bo Byrne")).toBeNull();
  });

  it("switches segments and searches by bundle code", async () => {
    state.data = response([
      bundle("Bo Byrne", "stalled", { code: "AB12CD" }),
      bundle("Cy Cole", "stalled", { code: "ZZ9" }),
    ]);
    const { user } = renderPage();

    await user.click(screen.getByRole("radio", { name: "Stalled (2)" }));
    expect(screen.getByText("Bo Byrne")).toBeInTheDocument();
    expect(screen.getByText("Cy Cole")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search bundles"), "ab12");
    expect(screen.getByText("Bo Byrne")).toBeInTheDocument();
    expect(screen.queryByText("Cy Cole")).toBeNull();
  });

  it("handles unknown products, a second bundle and sessions found by email", async () => {
    state.data = response(
      [
        bundle("Ann Archer", "on_track", {
          bundleName: "Unknown bundle (Old pack)",
          knownProduct: false,
          totalCredits: null,
          usedCredits: null,
          utilisation: null,
          remainingCredits: 2,
          otherBundles: 1,
          sessionsMatchedBy: "email",
          purchasedSource: "first_session",
        }),
      ],
      { matchedByEmailOnly: 1 }
    );
    const { user } = renderPage();
    await user.click(screen.getByRole("radio", { name: "On track (1)" }));

    const row = within(screen.getByText("Ann Archer").closest("tr")!);
    expect(row.getByText("2 bundles")).toBeInTheDocument();
    expect(row.getByText("Total unknown")).toBeInTheDocument();
    expect(row.getByText("(first session)", { exact: false })).toBeInTheDocument();
    expect(row.getByText("From their email, not the bundle code")).toBeInTheDocument();
    expect(screen.getByText(/1 bundle\(s\) had no sessions booked with their code/)).toBeInTheDocument();
    expect(row.getByText("actions for Ann Archer")).toBeInTheDocument();
  });

  it("says what was left out", () => {
    renderPage();
    expect(screen.getByText(/Not shown: 2 discount or gift codes, 5 bundles used up/)).toBeInTheDocument();
  });
});
