// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubFeedback } from "@/lib/hubFeedback";
import { Feedback } from "./Feedback";

const state = vi.hoisted(() => ({
  rows: [] as HubFeedback[],
  error: null as { code?: string; message: string } | null,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useHubFeedback: () => ({
    data: state.error ? undefined : state.rows,
    error: state.error,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useUpdateFeedbackStatus: () => ({ mutate: state.mutate, isPending: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

let nextId = 1;
function feedback(name: string, overrides: Partial<HubFeedback> = {}): HubFeedback {
  return {
    id: String(nextId++),
    user_id: "user-1",
    category: "hub_experience",
    message: `Message from ${name}`,
    rating: null,
    page: null,
    status: "new",
    created_at: "2026-10-10T12:00:00.000Z",
    sender_email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    sender_name: name,
    status_updated_at: null,
    status_updated_by_email: null,
    ...overrides,
  };
}

function renderPage() {
  const user = userEvent.setup();
  render(<Feedback />);
  return { user };
}

beforeEach(() => {
  // Only Date is faked, so the calendar opens on October 2026 and user events still run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00.000Z"));
  state.rows = [];
  state.error = null;
  state.mutate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Feedback page", () => {
  it("lists feedback with sender, category, rating, message and page", () => {
    state.rows = [
      feedback("Ann Archer", { rating: 4, page: "/sessions", category: "accessibility" }),
      feedback("Bo Byrne", { rating: 2, status: "read" }),
    ];
    renderPage();

    expect(screen.getByText("Unread").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Average rating").previousSibling).toHaveTextContent("3 / 5");

    const ann = within(screen.getByText("Ann Archer").closest("tr")!);
    expect(ann.getByText("ann@example.com")).toBeInTheDocument();
    expect(ann.getByText("Accessibility")).toBeInTheDocument();
    expect(ann.getByRole("img", { name: "4 out of 5" })).toBeInTheDocument();
    expect(ann.getByText("Message from Ann Archer")).toBeInTheDocument();
    expect(ann.getByText("From My Sessions")).toBeInTheDocument();
  });

  it("filters by status, category and date", async () => {
    state.rows = [
      feedback("Ann Archer", { category: "psychiatry", created_at: "2026-10-01T12:00:00.000Z" }),
      feedback("Bo Byrne", { status: "actioned", created_at: "2026-10-08T12:00:00.000Z" }),
      feedback("Cy Cole", { created_at: "2026-10-12T12:00:00.000Z" }),
    ];
    const { user } = renderPage();

    await user.click(screen.getByRole("radio", { name: "Actioned (1)" }));
    expect(screen.getByText("Bo Byrne")).toBeInTheDocument();
    expect(screen.queryByText("Ann Archer")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "All (3)" }));
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Psychiatry" }));
    expect(screen.getByText("Ann Archer")).toBeInTheDocument();
    expect(screen.queryByText("Cy Cole")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.click(screen.getByRole("button", { name: "Date" }));
    await user.click(screen.getByRole("gridcell", { name: "5" }));
    await user.click(screen.getByRole("gridcell", { name: "10" }));
    expect(screen.getByRole("button", { name: "Date" })).toHaveTextContent("5 Oct – 10 Oct 2026");
    expect(screen.getByText("Bo Byrne")).toBeInTheDocument();
    expect(screen.queryByText("Ann Archer")).toBeNull();
    expect(screen.queryByText("Cy Cole")).toBeNull();
  });

  it("marks feedback as read or actioned", async () => {
    state.rows = [feedback("Ann Archer", { id: "fb-1" })];
    const { user } = renderPage();

    await user.click(screen.getByRole("combobox", { name: "Status for feedback from Ann Archer" }));
    await user.click(screen.getByRole("option", { name: "Actioned" }));
    expect(state.mutate).toHaveBeenCalledWith({ id: "fb-1", status: "actioned" }, expect.anything());
  });

  it("says when there's no feedback yet", () => {
    renderPage();
    expect(screen.getByText("No feedback yet.")).toBeInTheDocument();
  });

  it("explains a missing table instead of erroring", () => {
    state.error = { code: "PGRST205", message: "missing" };
    renderPage();
    expect(screen.getByText(/once the hub-feedback database update is deployed/)).toBeInTheDocument();
  });
});

describe("Feedback status history", () => {
  it("shows the full email of whoever last changed the status", () => {
    state.rows = [
      feedback("Ann Archer", {
        status: "actioned",
        status_updated_by_email: "tech@blackbird.marketing",
        status_updated_at: "2026-10-13T13:48:00.000Z",
      }),
    ];
    renderPage();
    expect(screen.getByText("tech@blackbird.marketing")).toBeInTheDocument();
  });
});
