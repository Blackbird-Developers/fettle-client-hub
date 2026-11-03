// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddBundleCode } from "./AddBundleCode";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

function renderForm(onLinked?: Parameters<typeof AddBundleCode>[0]["onLinked"]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddBundleCode onLinked={onLinked} />
    </QueryClientProvider>
  );
}

beforeEach(() => invoke.mockReset());

describe("AddBundleCode", () => {
  it("links a code and says how many sessions are left", async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        package: { id: "pkg-1" },
        packageName: "6 Session Bundle",
        remainingSessions: 4,
        categoryLabel: "individual therapy",
      },
      error: null,
    });
    renderForm();

    expect(screen.getByText(/order confirmation email from fettle.ie/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Bundle code"), "704e 3907");
    await userEvent.click(screen.getByRole("button", { name: "Add code" }));

    expect(invoke).toHaveBeenCalledWith("redeem-package-code", { body: { code: "704E3907" } });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Added to your account: 6 Session Bundle, 4 sessions left for individual therapy."
    );
  });

  it("hands the linked bundle to the parent when asked", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, package: { id: "pkg-1" }, packageName: "3 Session Bundle", remainingSessions: 1, alreadyLinked: true },
      error: null,
    });
    const onLinked = vi.fn();
    renderForm(onLinked);

    await userEvent.type(screen.getByLabelText("Bundle code"), "ABC123{enter}");
    await vi.waitFor(() =>
      expect(onLinked).toHaveBeenCalledWith({
        packageId: "pkg-1",
        packageName: "3 Session Bundle",
        remainingSessions: 1,
        categoryLabel: null,
        category: null,
        alreadyLinked: true,
      })
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains a refused code and offers to email the clinic", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, reason: "used_up", message: "All 6 sessions on this bundle have been used." },
      error: null,
    });
    renderForm();

    await userEvent.type(screen.getByLabelText("Bundle code"), "704E3907");
    await userEvent.click(screen.getByRole("button", { name: "Add code" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("All sessions on this bundle are used");
    expect(alert).toHaveTextContent("All 6 sessions on this bundle have been used.");
    expect(screen.getByRole("link", { name: /Email hello@fettle.ie/ })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:hello@fettle.ie")
    );
  });

  it("uses the function's own message when it answers with an error status", async () => {
    const context = new Response(JSON.stringify({ reason: "not_signed_in", message: "Please sign in again to add a code." }));
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("401"), { context }) });
    renderForm();

    await userEvent.type(screen.getByLabelText("Bundle code"), "704E3907");
    await userEvent.click(screen.getByRole("button", { name: "Add code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please sign in again to add a code.");
  });
});
