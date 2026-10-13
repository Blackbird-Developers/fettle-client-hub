// @vitest-environment jsdom
import "@/test/setupDom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLoadStart, clearLoadStart } from "@/lib/adminLoadProgress";
import { AdminDataLoader } from "./AdminDataLoader";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
  localStorage.setItem("fettle-admin-load-ms:admin-bundles", "20000");
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  clearLoadStart("admin-bundles");
});

describe("AdminDataLoader", () => {
  it("shows the title, steps and an advancing progress bar", () => {
    render(<AdminDataLoader source="admin-bundles" />);

    expect(screen.getByText("Loading bundles from Acuity")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("About 20s left")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Fetching bundles");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("About 10s left")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Fetching appointments");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "45");
  });

  it("carries on from a load that started before the page opened", () => {
    markLoadStart("admin-bundles", Date.now() - 30_000);
    render(<AdminDataLoader source="admin-bundles" />);

    expect(screen.getByText("Taking a little longer than usual — still working…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Working out credits used");
  });
});
