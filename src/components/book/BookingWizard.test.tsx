// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TherapistRow } from "@/lib/booking/therapists";
import { addDaysToKey, dublinDateKey } from "@/lib/booking/time";
import { clearWizard } from "@/lib/booking/wizard";
import { BookingWizard } from "./BookingWizard";

const data = vi.hoisted(() => ({
  therapists: [] as TherapistRow[],
  appointments: [] as { canceled: boolean; phone: string; datetime: string }[],
  days: [] as { date: string; times: string[] }[],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { first_name: "Sarah", last_name: "Byrne", email: "sarah@example.com" } }),
}));

vi.mock("@/hooks/useAcuity", () => ({
  useAcuityAppointments: () => ({ appointments: data.appointments, loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useUserPackages", () => ({ useActivePackages: () => ({ packages: [], isLoading: false }) }));
vi.mock("@/hooks/useReferrals", () => ({ useReferrals: () => ({ data: { balance_cents: 0 } }) }));

vi.mock("@/hooks/useTherapistDirectory", () => ({
  useTherapistDirectory: () => ({
    therapists: data.therapists,
    publicTypeIds: new Set(["111", "222"]),
    typeById: new Map([
      ["111", { id: 111, name: "Individual Session with Elaine O'Dwyer", price: "95.00", duration: 50 }],
      ["222", { id: 222, name: "Couple's Therapy Session with Elaine O'Dwyer", price: "135.00", duration: 60 }],
    ]),
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useTherapistSlots", () => ({
  useFirstOpenMonth: (source: unknown) => ({
    data: source && data.days.length ? { month: data.days[0].date.slice(0, 7), days: data.days } : null,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMonthSlots: (source: unknown, month: string | null) => ({
    data: source && month ? data.days.filter((d) => d.date.startsWith(month)) : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useInvalidateSlots: () => vi.fn(),
}));

vi.mock("@/lib/booking/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/booking/availability")>()),
  findEarliestSlot: async () => (data.days[0] ? { date: data.days[0].date, time: data.days[0].times[0] } : null),
}));

const elaine: TherapistRow = {
  id: 7,
  name: "Elaine O'Dwyer",
  calendarid: "4567890",
  status: "active",
  tags2: "couples, anxiety",
  appointmentidindividual: "111",
  appointmentidcouples: "222",
  Accreditation: "IACPFull",
  quote: "Small steps count.",
};

function renderWizard(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/book${search}`]}>
        <BookingWizard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  clearWizard();
  data.therapists = [elaine, { ...elaine, id: 8, name: "Ana Moore", calendarid: "999" }];
  data.appointments = [];
  const day = addDaysToKey(dublinDateKey(new Date()), 2);
  data.days = [{ date: day, times: [`${day}T18:00:00+0000`, `${day}T19:00:00+0000`] }];
});

describe("BookingWizard", () => {
  it("books an individual session time-first, up to the Pay step", async () => {
    const user = userEvent.setup();
    renderWizard("?therapist=4567890");

    expect(await screen.findByRole("heading", { name: "Your session with Elaine O'Dwyer" })).toBeInTheDocument();
    expect(screen.getAllByText("IACP Accredited").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Let’s begin →" }));

    // Who: two services, nothing picked yet.
    expect(await screen.findByRole("heading", { name: "Who are the sessions for?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue →" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Just me/ }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    // Date and time: the earliest card picks the first slot.
    expect(await screen.findByRole("heading", { name: "When suits you, Sarah?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a time to continue" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Earliest time/ }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    // History: no auto-advance; the reply shows and Continue moves on.
    expect(await screen.findByRole("heading", { name: "Have you had therapy before?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /This is my first time/ }));
    expect(screen.getByText(/Taking the first step is often the hardest part/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    // Details: prefilled from the profile; phone is missing, so the form shows.
    expect(await screen.findByRole("heading", { name: "Great. Where should we send your confirmation?" })).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("Sarah");
    await user.click(screen.getByRole("button", { name: "Continue to payment →" }));
    expect(screen.getByText("Please enter your mobile number")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Mobile number"), "087 123 4567");
    await user.click(screen.getByRole("button", { name: "Continue to payment →" }));

    // Plan: first-timers get the 3-session bundle recommended and preselected.
    expect(await screen.findByRole("heading", { name: "How would you like to start?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /3-session bundle/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/three sessions give you time to settle in with Elaine/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /9-session bundle/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    // Review: all three consents are required.
    expect(await screen.findByRole("heading", { name: "Everything look right?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to payment →" }));
    expect(screen.getByText("Please tick all three boxes to continue.")).toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Continue to payment →" }));

    expect(await screen.findByRole("heading", { name: "Confirm and pay" })).toBeInTheDocument();
    expect(screen.getAllByText("€271.50").length).toBeGreaterThan(0);
  });

  it("returns straight to review after editing the plan", async () => {
    const user = userEvent.setup();
    data.appointments = [{ canceled: false, phone: "087 765 4321", datetime: "2026-01-01T10:00:00+0000" }];
    renderWizard("?therapist=7&service=individual");

    await user.click(await screen.findByRole("button", { name: "Let’s begin →" }));
    // The service came from the link and the client has past sessions: straight to the time, no history.
    expect(await screen.findByRole("heading", { name: "When suits you, Sarah?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Earliest time/ }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    // Details shows the compact row with the phone from the last appointment.
    expect(await screen.findByText("Booking for")).toBeInTheDocument();
    expect(screen.getByText(/087 765 4321/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to payment →" }));

    // Returning clients get 6 sessions recommended.
    expect(await screen.findByRole("radio", { name: /6-session bundle/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    await user.click(await screen.findByRole("button", { name: "Edit plan" }));
    await user.click(await screen.findByRole("radio", { name: /Single session/ }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));
    expect(await screen.findByRole("heading", { name: "Everything look right?" })).toBeInTheDocument();
    expect(screen.getByText("Pay per session, no commitment")).toBeInTheDocument();
  });

  it("blocks a therapist who isn't taking bookings and offers matching", async () => {
    const user = userEvent.setup();
    renderWizard("?therapist=999");
    expect(await screen.findByRole("heading", { name: "Ana isn’t taking new bookings right now" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Find me a therapist →" }));
    expect(await screen.findByRole("heading", { name: "Who are the sessions for?" })).toBeInTheDocument();
  });

  it("matches a therapist when none is chosen, then asks for a time", async () => {
    const user = userEvent.setup();
    data.therapists = [
      { ...elaine, id: 1, name: "Brian Byrne", calendarid: "1", tags2: "stress" },
      elaine,
      { ...elaine, id: 3, name: "Doreen Maher", calendarid: "3" },
    ];
    renderWizard("");

    await user.click(await screen.findByRole("button", { name: "Get started →" }));
    await user.click(await screen.findByRole("button", { name: /Just me/ }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    expect(await screen.findByRole("heading", { name: "What’s bringing you to therapy?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Anxiety and worry" }));
    await user.click(screen.getByRole("button", { name: "Continue →" }));

    // Doreen Maher is excluded from matching; Elaine matches the topic and comes first.
    expect(await screen.findByRole("heading", { name: "We found your matches for you" })).toBeInTheDocument();
    const cards = await screen.findAllByRole("button", { name: /Next available/ });
    expect(cards[0]).toHaveTextContent("Elaine O'Dwyer");
    expect(cards[0]).toHaveTextContent("Top match");
    expect(screen.queryByText("Doreen Maher")).not.toBeInTheDocument();
    await user.click(cards[0]);
    await user.click(screen.getByRole("button", { name: "Continue with Elaine" }));

    expect(await screen.findByRole("heading", { name: "When suits you, Sarah?" })).toBeInTheDocument();
    expect(screen.getByText(/50-minute session with Elaine O'Dwyer, online/)).toBeInTheDocument();
  });

  it("says when the link points to nobody", async () => {
    renderWizard("?therapist=nobody-here");
    expect(await screen.findByRole("heading", { name: "We couldn’t find that therapist" })).toBeInTheDocument();
  });
});
