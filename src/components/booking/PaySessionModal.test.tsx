// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaySessionModal } from "./PaySessionModal";
import type { UnpaidSession } from "@/hooks/useUnpaidSessions";

const invoke = vi.hoisted(() => vi.fn());
const packages = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: null }) }));
vi.mock("@/hooks/useUserPackages", () => ({
  useActivePackages: () => ({ packages: packages.list, isLoading: false }),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => null }));

const session: UnpaidSession = {
  id: 501,
  type: "Individual Therapy Session",
  therapist: "Aoife",
  datetime: "2026-10-20T10:00:00+0100",
  price: "95.00",
  amountPaid: "0.00",
  isPast: true,
};

const sixBundle = {
  id: "pkg-6",
  package_id: "996385",
  package_name: "6 Session Bundle",
  total_sessions: 6,
  remaining_sessions: 4,
  expires_at: null,
};

function renderModal() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaySessionModal session={session} open onOpenChange={() => {}} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  invoke.mockReset();
  packages.list = [];
});

describe("PaySessionModal", () => {
  it("offers a bundle credit next to card payment and settles with it", async () => {
    packages.list = [sixBundle];
    invoke.mockResolvedValue({
      data: { success: true, packageName: "6 Session Bundle", remainingSessions: 3 },
      error: null,
    });
    renderModal();

    expect(screen.getByText("This booking will use 1 credit from your 6 Session Bundle. You'll have 3 left.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay by card \(€95.00\)/ })).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Use a bundle credit" }));
    expect(invoke).toHaveBeenCalledWith("pay-session", {
      body: { action: "use-credit", appointmentId: 501, packageId: "pkg-6" },
    });
    expect(await screen.findByText("Paid with 1 bundle credit")).toBeInTheDocument();
    expect(screen.getByText("You have 3 sessions left on your 6 Session Bundle.")).toBeInTheDocument();
  });

  it("keeps the card option when the credit is refused", async () => {
    packages.list = [sixBundle];
    invoke.mockResolvedValue({ data: { error: "This bundle has expired." }, error: null });
    renderModal();

    await userEvent.click(screen.getByRole("button", { name: "Use a bundle credit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This bundle has expired.");
    expect(screen.getByRole("button", { name: /Pay by card/ })).toBeEnabled();
  });

  it("goes straight to card payment when no bundle fits the session", async () => {
    packages.list = [{ ...sixBundle, package_id: "1370588", package_name: "Youth Bundle 3 x 60min" }];
    invoke.mockResolvedValue({ data: { alreadyPaid: true, message: "Already settled" }, error: null });
    renderModal();

    expect(invoke).toHaveBeenCalledWith("pay-session", { body: { action: "create", appointmentId: 501 } });
    expect(screen.queryByRole("button", { name: "Use a bundle credit" })).not.toBeInTheDocument();
  });
});
