// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "./NotificationsPage";

const state = vi.hoisted(() => ({
  pageQueries: [] as unknown[],
  countQueries: [] as { range: unknown; enabled: boolean }[],
}));

vi.mock("@/hooks/useAdminNotifications", () => ({
  useAdminNotificationsPage: (query: unknown) => {
    state.pageQueries.push(query);
    return { data: { rows: [], total: 4 }, isLoading: false, isFetching: false, error: null };
  },
  useAdminNotificationCount: (query: { range: unknown }, enabled: boolean) => {
    state.countQueries.push({ range: query.range, enabled });
    return { data: enabled ? 2 : undefined };
  },
  useMarkNotificationsRead: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

beforeEach(() => {
  state.pageQueries = [];
  state.countQueries = [];
});

describe("NotificationsPage", () => {
  it("shows every date until a period is picked, then counts and compares it", async () => {
    const user = userEvent.setup();
    render(<NotificationsPage />);
    expect(state.pageQueries.at(-1)).toMatchObject({ range: null });
    expect(screen.queryByText(/notifications .* vs/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /all time/i }));
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const query = state.pageQueries.at(-1) as { range: { from: string; to: string }; page: number };
    expect(query.page).toBe(1);
    expect(query.range.from < query.range.to).toBe(true);
    expect(state.countQueries.at(-1)?.enabled).toBe(true);
    expect(screen.getByText(/^4 notifications .* · \+2 \(\+100%\) vs previous period$/)).toBeTruthy();
  });
});
