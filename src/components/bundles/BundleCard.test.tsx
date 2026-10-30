// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BundleCard } from "./BundleCard";

const bundle = {
  package_id: "996385", // 6 Session Bundle, individual
  package_name: "6 Session Bundle",
  total_sessions: 6,
  remaining_sessions: 4,
  expires_at: "2027-06-01T00:00:00Z",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("BundleCard", () => {
  it("shows sessions left, what it covers and the expiry", () => {
    render(<BundleCard bundle={bundle} />);
    expect(screen.getByText("6 Session Bundle")).toBeInTheDocument();
    expect(screen.getByText("Individual therapy · 4 of 6 sessions left")).toBeInTheDocument();
    expect(screen.getByText("Expires 1 Jun 2027")).toBeInTheDocument();
  });

  it("warns when the last session is left and expiry is close", () => {
    render(<BundleCard bundle={{ ...bundle, remaining_sessions: 1, expires_at: "2026-11-10T12:00:00Z" }} />);
    expect(screen.getByText("Only 1 session left")).toBeInTheDocument();
    expect(screen.getByText(/Expires in 11 days/)).toBeInTheDocument();
  });

  it("says why a bundle can't be used and can't be picked", () => {
    const onSelect = vi.fn();
    render(<BundleCard bundle={bundle} unusableReason="Bundles can't be used for psychiatry." onSelect={onSelect} />);
    expect(screen.getByText("Bundles can't be used for psychiatry.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a choice when the client has more than one bundle", async () => {
    const onSelect = vi.fn();
    render(<BundleCard bundle={bundle} onSelect={onSelect} />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalled();
  });
});
