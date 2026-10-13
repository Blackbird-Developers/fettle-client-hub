// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Feedback from "./Feedback";

const state = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/hooks/useHubFeedback", () => ({
  useSendFeedback: () => ({ mutate: state.mutate, isPending: false, isError: false }),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderPage(from?: string) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[{ pathname: "/feedback", state: from ? { from } : null }]}>
      <Feedback />
    </MemoryRouter>
  );
  return { user };
}

beforeEach(() => {
  state.mutate.mockReset();
  state.mutate.mockImplementation((_input, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
});

describe("Feedback page (client)", () => {
  it("asks for a category and a message before sending", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(screen.getByText("Choose what your feedback is about.")).toBeInTheDocument();
    expect(screen.getByText("Write a message before sending.")).toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("sends the category, rating, message and the page they came from, then says thanks", async () => {
    const { user } = renderPage("/sessions");

    await user.click(screen.getByRole("radio", { name: "Accessibility" }));
    await user.click(screen.getByRole("button", { name: /^4 out of 5/ }));
    await user.type(screen.getByLabelText(/Your message/), "The text is hard to read");
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(state.mutate).toHaveBeenCalledWith(
      { category: "accessibility", rating: 4, message: "The text is hard to read", page: "/sessions" },
      expect.anything()
    );
    expect(screen.getByText("Thanks, we got your feedback")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send more feedback" }));
    expect(screen.getByLabelText(/Your message/)).toHaveValue("");
  });

  it("leaves the rating out when none is chosen", async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole("radio", { name: "Other" }));
    await user.click(screen.getByRole("button", { name: /^2 out of 5/ }));
    await user.click(screen.getByRole("button", { name: /^2 out of 5/ }));
    await user.type(screen.getByLabelText(/Your message/), "Hello");
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(state.mutate).toHaveBeenCalledWith(
      { category: "other", rating: null, message: "Hello", page: null },
      expect.anything()
    );
  });
});
