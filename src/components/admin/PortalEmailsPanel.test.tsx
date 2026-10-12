// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type EmailSendRow,
  percentOf,
  recentSends,
  sendStage,
  summarizeSends,
} from "@/lib/portalEmails";
import { PortalEmailsPanel } from "./PortalEmailsPanel";

const state = vi.hoisted(() => ({
  result: {} as { data?: unknown; error?: unknown; isLoading: boolean },
}));

vi.mock("@/hooks/useAdmin", () => ({ usePortalEmailSends: () => state.result }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

let nextId = 1;
function send(overrides: Partial<EmailSendRow> = {}): EmailSendRow {
  return {
    id: String(nextId++),
    campaign: "existing_clients",
    status: "sent",
    customer_name: "Aoife Byrne",
    email: "aoife@example.com",
    sent_at: "2026-10-12T09:30:00Z",
    delivered_at: null,
    opened_at: null,
    first_clicked_at: null,
    bounced_at: null,
    complained_at: null,
    signed_up_at: null,
    ...overrides,
  };
}

const AT = "2026-10-12T10:00:00Z";

describe("portal email summaries", () => {
  it("counts the funnel per email from sent rows only", () => {
    const summary = summarizeSends([
      send({ delivered_at: AT, opened_at: AT, first_clicked_at: AT, signed_up_at: AT }),
      send({ delivered_at: AT }),
      send({ status: "seeded", sent_at: null }),
      send({ status: "claimed", sent_at: null }),
      send({ campaign: "new_enquiries", bounced_at: AT }),
    ]);
    expect(summary.existing_clients).toMatchObject({
      sent: 2, delivered: 2, opened: 1, clicked: 1, signedUp: 1, seeded: 1,
    });
    expect(summary.new_enquiries).toMatchObject({ sent: 1, bounced: 1 });
  });

  it("names the furthest result, with problems first", () => {
    expect(sendStage(send({ delivered_at: AT, first_clicked_at: AT }))).toBe("clicked");
    expect(sendStage(send({ signed_up_at: AT, first_clicked_at: AT }))).toBe("signed_up");
    expect(sendStage(send({ delivered_at: AT, complained_at: AT }))).toBe("complained");
    expect(sendStage(send())).toBe("sent");
  });

  it("lists the newest sends first", () => {
    const older = send({ sent_at: "2026-10-01T09:30:00Z" });
    const newer = send({ sent_at: "2026-10-10T09:30:00Z" });
    expect(recentSends([older, send({ status: "seeded", sent_at: null }), newer], 5)).toEqual([newer, older]);
  });

  it("formats percentages and avoids dividing by zero", () => {
    expect(percentOf(1, 3)).toBe("33%");
    expect(percentOf(0, 0)).toBe("–");
  });
});

describe("PortalEmailsPanel", () => {
  beforeEach(() => {
    state.result = { isLoading: false };
  });

  it("explains when the database update hasn't been applied", () => {
    state.result = { isLoading: false, error: { code: "PGRST205", message: "missing" } };
    render(<PortalEmailsPanel />);
    expect(screen.getByText(/hasn't been applied/)).toBeInTheDocument();
  });

  it("says nothing has been sent yet", () => {
    state.result = { isLoading: false, data: { sends: [send({ status: "seeded" })], unsubscribed: 0 } };
    render(<PortalEmailsPanel />);
    expect(screen.getByText(/No emails sent yet/)).toBeInTheDocument();
  });

  it("shows each email's funnel and the latest sends", () => {
    state.result = {
      isLoading: false,
      data: {
        sends: [
          send({ delivered_at: AT, first_clicked_at: AT, opened_at: AT }),
          send({ delivered_at: AT, customer_name: "Ciara Walsh", email: "ciara@example.com" }),
        ],
        unsubscribed: 1,
      },
    };
    render(<PortalEmailsPanel />);

    const email1 = screen.getByText(/Your Fettle account is waiting/).closest("tr")!;
    const cells = within(email1).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.slice(1, 5)).toEqual(["2", "2 100%", "1 50%", "1 50%"]);
    expect(screen.getByText(/1 person has unsubscribed/)).toBeInTheDocument();
    expect(within(screen.getByText("Ciara Walsh").closest("tr")!).getByText("Delivered")).toBeInTheDocument();
    const aoife = screen.getAllByText("Aoife Byrne")[0].closest("tr")!;
    expect(within(aoife).getByText("Clicked")).toBeInTheDocument();
  });
});
