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
const state = vi.hoisted(() => ({ data: null as unknown as ClinicalResponse }));

vi.mock("@/hooks/useAdmin", () => ({
  useClinical: () => ({
    data: state.data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useFollowupsForPage: () => ({ followups: [], unavailable: null, outcomesUnavailable: null }),
}));

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
});
