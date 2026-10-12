// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEmailParam } from "../../supabase/functions/_shared/unsubscribe.ts";
import Unsubscribe from "./Unsubscribe";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

const e = encodeEmailParam("aoife@example.com");

function renderAt(query: string) {
  render(
    <MemoryRouter initialEntries={[`/unsubscribe${query}`]}>
      <Unsubscribe />
    </MemoryRouter>
  );
}

beforeEach(() => invoke.mockReset());

describe("Unsubscribe page", () => {
  it("does nothing until the button is clicked, then confirms", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    renderAt(`?e=${e}&t=token`);

    expect(screen.getByText("aoife@example.com")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(invoke).toHaveBeenCalledWith("email-unsubscribe", { body: { e, t: "token" } });
    expect(await screen.findByText("You're unsubscribed")).toBeInTheDocument();
  });

  it("shows an error and keeps the button when the link is rejected", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("400") });
    renderAt(`?e=${e}&t=bad`);

    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't unsubscribe you");
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeEnabled();
  });

  it("explains an incomplete link and offers no button", () => {
    renderAt(`?e=${e}`);
    expect(screen.getByText(/isn't complete/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
