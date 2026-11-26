// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ClinicalResponse } from "@/hooks/useAdmin";
import {
  type AcuityAppointment,
  DAY_MS,
  groupCustomers,
} from "../../../supabase/functions/admin-customer-insights/logic.ts";
import {
  buildAssessmentView,
  buildPsychiatryView,
} from "../../../supabase/functions/admin-clinical/logic.ts";
import { AssessmentPipeline } from "./AssessmentPipeline";
import { PsychiatryFollowUps } from "./PsychiatryFollowUps";

// The data hook gets a response built by the real edge-function logic from
// fixed Acuity appointments; the Contact column has its own tests.
const state = vi.hoisted(() => ({ data: null as unknown as ClinicalResponse, periods: undefined as unknown }));

vi.mock("@/hooks/useAdmin", () => ({
  useClinical: () => ({
    data: state.data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useFollowupsForPage: () => ({ followups: [], unavailable: null, outcomesUnavailable: null }),
  useWorklistPeriods: () => ({ data: state.periods, isPending: state.periods === undefined, error: null }),
}));

const CLINICAL_TOTALS = {
  psychiatryAppointments: 6,
  psychiatryClients: 4,
  screenings: 3,
  fullAssessments: 2,
  otherAssessments: 0,
  assessmentClients: 5,
};
const periodsResponse = (compare: Partial<typeof CLINICAL_TOTALS>) => ({
  generatedAt: "",
  data: { lastRefreshedAt: "" },
  params: { list: "clinical" },
  totals: CLINICAL_TOTALS,
  compare: { ...CLINICAL_TOTALS, ...compare },
});

async function pickLast30WithCompare() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /last 90 days/i }));
  await user.click(screen.getByRole("button", { name: "Last 30 days" }));
  await user.click(screen.getByRole("switch"));
  await user.click(screen.getByRole("button", { name: "Apply" }));
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("./FollowupActions", () => ({
  FollowupActions: ({ customerName }: { customerName: string | null }) => (
    <span>actions for {customerName}</span>
  ),
}));

const NOW = Date.now();
let nextId = 1;
function appt(name: string, daysFromNow: number, type: string, calendar = "Dr Rubeo"): AcuityAppointment {
  return {
    id: nextId++,
    firstName: name,
    lastName: "Test",
    email: `${name.toLowerCase()}@example.com`,
    phone: "087 123 4567",
    datetime: new Date(NOW + daysFromNow * DAY_MS).toISOString(),
    type,
    calendar,
    canceled: false,
  };
}

function load(appointments: AcuityAppointment[]) {
  const customers = groupCustomers(appointments);
  state.data = {
    generatedAt: new Date(NOW).toISOString(),
    lookbackDays: 90,
    psychiatryRule: { contactAfterDays: 21, followUpByDays: 28 },
    psychiatry: buildPsychiatryView(customers, NOW),
    assessments: buildAssessmentView(customers, NOW),
    dataIssues: { incompleteDates: [], psychiatryWithoutEmail: 0, assessmentsWithoutEmail: 0 },
    diagnostics: { windowAppointments: appointments.length, acuityRequests: 0, durationMs: 0 },
  };
}

const renderWithTooltips = (ui: JSX.Element) => render(<TooltipProvider>{ui}</TooltipProvider>);

const tableNames = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent?.match(/^(\w+ Test)/)?.[1]);

describe("Psychiatry page", () => {
  it("lists who is due a call, overdue first, and moves through the tabs", async () => {
    load([
      appt("Due", -23, "Psychiatry Medication Appointment"),
      appt("Overdue", -35, "Psychiatry Medication Appointment"),
      appt("Recent", -5, "Follow Up Consultation"),
      appt("Booked", -25, "Psychiatry Medication Appointment"),
      appt("Booked", 3, "Follow Up Consultation"),
    ]);
    renderWithTooltips(<PsychiatryFollowUps />);

    expect(tableNames()).toEqual(["Overdue Test", "Due Test"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Overdue")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Due now")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Not due yet (1)" }));
    expect(tableNames()).toEqual(["Recent Test"]);

    await userEvent.click(screen.getByRole("radio", { name: "Follow-up booked (1)" }));
    expect(tableNames()).toEqual(["Booked Test"]);
  });

  it("narrows the list to clients last seen in a period, and compares the period's figures", async () => {
    load([
      appt("Due", -23, "Psychiatry Medication Appointment"),
      appt("Overdue", -35, "Psychiatry Medication Appointment"),
    ]);
    state.periods = periodsResponse({ psychiatryAppointments: 3 });
    renderWithTooltips(<PsychiatryFollowUps />);
    expect(tableNames()).toEqual(["Overdue Test", "Due Test"]);

    await pickLast30WithCompare();
    expect(tableNames()).toEqual(["Due Test"]);
    expect(screen.getByText("Psychiatry appointments").parentElement!).toHaveTextContent("+3 (+100%) vs previous period");
  });
});

describe("Assessments page", () => {
  it("shows the next step each client needs booked", async () => {
    load([
      appt("Screened", -6, "OCD Assessment - Consultation + Screening", "Dr Byrne"),
      appt("Assessed", -10, "Full Anxiety Assessment", "Dr Byrne"),
      appt("Waiting", -12, "Depression Assessment - Consultation + Screening", "Dr Byrne"),
      appt("Waiting", 9, "Full Depression Assessment", "Dr Byrne"),
      appt("Psych", -20, "Psychiatry Medication Appointment"),
    ]);
    renderWithTooltips(<AssessmentPipeline />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(tableNames()).toEqual(["Assessed Test", "Screened Test"]);
    expect(within(rows[0]).getByText("Aftercare therapy")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Full clinical assessment")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Next step booked (1)" }));
    expect(tableNames()).toEqual(["Waiting Test"]);
  });

  it("narrows the list to a period, with tab counts to match, and compares its figures", async () => {
    load([
      appt("Screened", -6, "OCD Assessment - Consultation + Screening", "Dr Byrne"),
      appt("Assessed", -40, "Full Anxiety Assessment", "Dr Byrne"),
    ]);
    state.periods = periodsResponse({ screenings: 1 });
    renderWithTooltips(<AssessmentPipeline />);
    expect(screen.getByRole("radio", { name: "Needs booking (2)" })).toBeInTheDocument();

    await pickLast30WithCompare();
    expect(screen.getByRole("radio", { name: "Needs booking (1)" })).toBeInTheDocument();
    expect(tableNames()).toEqual(["Screened Test"]);
    // The figure at the top stays as of now.
    expect(screen.getByText("Need aftercare booked").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Screenings").parentElement!).toHaveTextContent("+2 (+200%) vs previous period");
  });
});
