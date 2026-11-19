// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminNotification } from "@/lib/adminNotifications";
import { AdminNotificationsBell } from "./AdminNotificationsBell";

const state = vi.hoisted(() => ({
  rows: [] as AdminNotification[],
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useAdminNotifications", () => ({
  useAdminNotifications: () => ({ data: state.rows, isLoading: false, error: null }),
  useMarkNotificationsRead: () => ({ mutate: state.mutate }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

function notification(i: number, overrides: Partial<AdminNotification> = {}): AdminNotification {
  return {
    id: String(i),
    created_at: "2026-11-09T19:05:00.000Z",
    kind: "bundle_code_refused",
    title: `Problem ${i}`,
    body: null,
    client_email: null,
    client_name: null,
    details: {},
    read_at: null,
    read_by_email: null,
    ...overrides,
  };
}

function renderBell() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/admin" element={<AdminNotificationsBell />} />
        <Route path="/admin/notifications" element={<p>Notifications page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminNotificationsBell", () => {
  beforeEach(() => {
    state.mutate.mockReset();
    state.rows = Array.from({ length: 14 }, (_, i) => notification(i + 1));
  });

  it("shows the latest 10 in a scrolling list", async () => {
    renderBell();
    await userEvent.click(screen.getByRole("button", { name: "Notifications, 14 unread" }));
    expect(screen.getByText("Problem 1")).toBeTruthy();
    expect(screen.getByText("Problem 10")).toBeTruthy();
    expect(screen.queryByText("Problem 11")).toBeNull();
    expect(screen.getByTestId("notifications-scroll").className).toContain("overflow-y-auto");
  });

  it("marks every unread one read with Mark all read", async () => {
    renderBell();
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await userEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(state.mutate).toHaveBeenCalledWith({ allUnread: true });
  });

  it("opens the Notifications page from View all", async () => {
    renderBell();
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await userEvent.click(screen.getByRole("link", { name: /View all notifications/ }));
    expect(screen.getByText("Notifications page")).toBeTruthy();
  });
});
