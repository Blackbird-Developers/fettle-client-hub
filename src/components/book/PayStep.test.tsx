// @vitest-environment jsdom
import "@/test/setupDom";
import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TherapistRow } from "@/lib/booking/therapists";
import { addDaysToKey, dublinDateKey } from "@/lib/booking/time";
import { savePendingPayment } from "@/lib/booking/payment";
import { clearWizard, initialState } from "@/lib/booking/wizard";
import { BookingWizard } from "./BookingWizard";

vi.hoisted(() => vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "pk_test_wizard"));

const data = vi.hoisted(() => ({
  days: [] as { date: string; times: string[] }[],
  packages: [] as { id: string; package_id: string; remaining_sessions: number }[],
  slotFree: true,
  confirmStatus: "succeeded",
}));

const checkout = vi.hoisted(() => ({
  createSessionIntent: vi.fn(),
  completeSessionPayment: vi.fn(),
  bookWithReferralCredit: vi.fn(),
  bookWithPackageCredit: vi.fn(),
  createBundleIntent: vi.fn(),
  confirmBundlePayment: vi.fn(),
  redeemBundleCode: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { first_name: "Sarah", last_name: "Byrne", email: "sarah@example.com", timezone: "Europe/Dublin" } }),
}));
vi.mock("@/hooks/useAcuity", () => ({
  useAcuityAppointments: () => ({
    // A returning client with a phone: no history question, compact details.
    appointments: [{ canceled: false, phone: "087 765 4321", datetime: "2026-01-01T10:00:00+0000" }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useUserPackages", () => ({ useActivePackages: () => ({ packages: data.packages, isLoading: false }) }));
vi.mock("@/hooks/useReferrals", () => ({ useReferrals: () => ({ data: { balance_cents: 0 } }) }));
vi.mock("@/hooks/useTherapistDirectory", () => ({
  useTherapistDirectory: () => ({
    therapists: [elaine],
    publicTypeIds: new Set(["111"]),
    typeById: new Map([["111", { id: 111, name: "Individual Session with Elaine O'Dwyer", price: "95.00", duration: 50 }]]),
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useTherapistSlots", () => ({
  useFirstOpenMonth: () => ({
    data: { month: data.days[0].date.slice(0, 7), days: data.days },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMonthSlots: (_s: unknown, month: string | null) => ({
    data: month ? data.days.filter((d) => d.date.startsWith(month)) : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useInvalidateSlots: () => vi.fn(),
}));
vi.mock("@/lib/booking/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/booking/availability")>()),
  recheckSlot: async () => data.slotFree,
}));
vi.mock("./checkout", () => checkout);

const confirmPayment = vi.fn(async () => ({ paymentIntent: { status: data.confirmStatus } }));
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(async () => ({
    retrievePaymentIntent: async () => ({ paymentIntent: { status: data.confirmStatus, amount: 9500 } }),
  })),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: ({ onReady }: { onReady?: () => void }) => {
    useEffect(() => onReady?.(), [onReady]);
    return <div>Card form</div>;
  },
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({ submit: async () => ({}) }),
}));

const elaine: TherapistRow = {
  id: 7,
  name: "Elaine O'Dwyer",
  calendarid: "4567890",
  status: "active",
  appointmentidindividual: "111",
};

async function walkToPay(user: ReturnType<typeof userEvent.setup>, choosePlan: RegExp) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/book?therapist=7"]}>
        <BookingWizard />
      </MemoryRouter>
    </QueryClientProvider>
  );
  await user.click(await screen.findByRole("button", { name: "Let’s begin →" }));
  await user.click(await screen.findByRole("button", { name: /Earliest time/ }));
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  await user.click(await screen.findByRole("button", { name: "Continue to payment →" }));
  await user.click(await screen.findByRole("radio", { name: choosePlan }));
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  for (const box of await screen.findAllByRole("checkbox")) await user.click(box);
  await user.click(screen.getByRole("button", { name: "Continue to payment →" }));
  expect(await screen.findByRole("heading", { name: "Confirm and pay" })).toBeInTheDocument();
}

beforeEach(() => {
  clearWizard();
  vi.clearAllMocks();
  data.packages = [];
  data.slotFree = true;
  data.confirmStatus = "succeeded";
  const day = addDaysToKey(dublinDateKey(new Date()), 2);
  data.days = [{ date: day, times: [`${day}T18:00:00+0000`] }];
  checkout.createSessionIntent.mockResolvedValue({
    ok: true,
    intent: { clientSecret: "pi_1_secret", paymentIntentId: "pi_1", amount: 9500, originalAmount: 9500 },
  });
  checkout.completeSessionPayment.mockResolvedValue({ status: "booked", appointmentId: 555 });
});

describe("Pay step", () => {
  it("pays for a single session and books it", async () => {
    const user = userEvent.setup();
    await walkToPay(user, /Single session/);

    const body = checkout.createSessionIntent.mock.calls[0][0];
    expect(body).toMatchObject({
      appointmentTypeID: 111,
      appointmentTypePrice: "95.00",
      calendarID: 4567890,
      calendarName: "Elaine O'Dwyer",
      phone: "087 765 4321",
      notes: "Booked via My Fettle (quiz flow). For: individual therapy. Therapy before: I’ve had therapy before.",
    });
    expect(body.intakeFormFields.map((f: { id: number }) => f.id)).toEqual([10466116, 9292394, 9292405]);

    await user.click(await screen.findByRole("button", { name: /Pay €95\.00/ }));
    expect(confirmPayment).toHaveBeenCalled();
    expect(checkout.completeSessionPayment).toHaveBeenCalledWith("pi_1");
    expect(await screen.findByRole("heading", { name: "You’re booked, Sarah!" })).toBeInTheDocument();
  });

  it("stops before charging when the slot was just taken", async () => {
    const user = userEvent.setup();
    data.slotFree = false;
    await walkToPay(user, /Single session/);
    await user.click(await screen.findByRole("button", { name: /Pay €95\.00/ }));
    expect(await screen.findByText(/You have not been charged\. Please choose another time\./)).toBeInTheDocument();
    expect(confirmPayment).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Choose another time" }));
    expect(await screen.findByRole("heading", { name: "When suits you, Sarah?" })).toBeInTheDocument();
  });

  it("shows a rejected code and charges the full price", async () => {
    const user = userEvent.setup();
    checkout.createSessionIntent.mockResolvedValue({
      ok: true,
      intent: { clientSecret: "pi_2_secret", paymentIntentId: "pi_2", amount: 9500, originalAmount: 9500, couponRejected: "promo_expired" },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/book?therapist=7"]}>
          <BookingWizard />
        </MemoryRouter>
      </QueryClientProvider>
    );
    await user.click(await screen.findByRole("button", { name: "Let’s begin →" }));
    await user.click(await screen.findByRole("button", { name: /Earliest time/ }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));
    await user.click(await screen.findByRole("button", { name: "Continue to payment →" }));
    await user.click(await screen.findByRole("radio", { name: /Single session/ }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));
    await user.type(await screen.findByLabelText("Have a discount code?"), "oldcode{Enter}");
    expect(screen.getByText("Code saved. Your total is confirmed on the next step.")).toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Continue to payment →" }));

    expect(await screen.findByText("That code has expired, so the full price applies.")).toBeInTheDocument();
    expect(checkout.createSessionIntent.mock.calls[0][1]).toEqual({ couponCode: "OLDCODE", useReferralCredit: false });
  });

  it("books with an unused bundle credit, with no card", async () => {
    const user = userEvent.setup();
    data.packages = [{ id: "pkg-1", package_id: "1122832", remaining_sessions: 3 }];
    checkout.bookWithPackageCredit.mockResolvedValue({ status: "booked", appointmentId: 777, remaining: 2 });
    await walkToPay(user, /Use 1 of your 3 remaining sessions/);

    expect(screen.queryByText("Card form")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    expect(checkout.bookWithPackageCredit.mock.calls[0][0]).toBe("pkg-1");
    expect(checkout.createSessionIntent).not.toHaveBeenCalled();
    expect(await screen.findByText("2 sessions left in your bundle")).toBeInTheDocument();
  });

  it("buys a bundle and books the chosen time with its first credit", async () => {
    const user = userEvent.setup();
    checkout.createBundleIntent.mockResolvedValue({ ok: true, clientSecret: "pi_b_secret", paymentIntentId: "pi_b", amount: 52800 });
    checkout.confirmBundlePayment.mockResolvedValue({ ok: true, packageId: "pkg-new", remaining: 6 });
    checkout.bookWithPackageCredit.mockResolvedValue({ status: "booked", appointmentId: 888, remaining: 5 });
    await walkToPay(user, /6-session bundle/);

    expect(checkout.createBundleIntent.mock.calls[0][0]).toBe(996385);
    await user.click(await screen.findByRole("button", { name: /Pay €528\.00/ }));
    expect(checkout.confirmBundlePayment).toHaveBeenCalledWith("pi_b");
    expect(checkout.bookWithPackageCredit.mock.calls[0][0]).toBe("pkg-new");
    expect(await screen.findByText("5 sessions left in your bundle")).toBeInTheDocument();
  });

  it("finishes the booking after a redirect payment method returns", async () => {
    const slot = data.days[0].times[0];
    savePendingPayment({
      kind: "session",
      paymentIntentId: "pi_r",
      entry: "therapist=7",
      state: initialState({
        started: true,
        therapistId: "7",
        who: "individual",
        slot,
        history: "past",
        planId: "single-individual",
        details: { firstName: "Sarah", lastName: "Byrne", email: "sarah@example.com", phone: "087 765 4321", partnerName: "", youngPersonName: "", note: "" },
        consents: { first: true, contact: true, terms: true },
      }),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter
          initialEntries={["/book?therapist=7&step=pay&wizard_return=1&payment_intent=pi_r&payment_intent_client_secret=pi_r_secret&redirect_status=succeeded"]}
        >
          <BookingWizard />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByRole("heading", { name: "You’re booked, Sarah!" })).toBeInTheDocument();
    expect(checkout.completeSessionPayment).toHaveBeenCalledWith("pi_r");
    expect(checkout.createSessionIntent).not.toHaveBeenCalled();
  });

  it("keeps a new bundle when its first booking loses the slot", async () => {
    const user = userEvent.setup();
    checkout.createBundleIntent.mockResolvedValue({ ok: true, clientSecret: "pi_b_secret", paymentIntentId: "pi_b", amount: 27150 });
    checkout.confirmBundlePayment.mockResolvedValue({ ok: true, packageId: "pkg-new", remaining: 3 });
    checkout.bookWithPackageCredit.mockResolvedValue({
      status: "failed",
      network: false,
      failure: { slotTaken: true, moneyReturned: null, reason: "This time slot is no longer available." },
    });
    await walkToPay(user, /3-session bundle/);
    await user.click(await screen.findByRole("button", { name: /Pay €271\.50/ }));
    expect(await screen.findByText("That time was just taken. Your bundle is saved — choose another time.")).toBeInTheDocument();
  });
});
