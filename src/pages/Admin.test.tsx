// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Admin from "./Admin";

// Access to the admin pages, Sales tasks included: only admins get in; the
// database and the sales-tasks function check the admin role again.

const state = vi.hoisted(() => ({ isAdmin: false as boolean | undefined, isLoading: false }));

vi.mock("@/hooks/useAdmin", () => ({
  useIsAdmin: () => ({ data: state.isAdmin, isLoading: state.isLoading }),
  usePreloadAdminData: () => undefined,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/admin/SalesTasks", () => ({ SalesTasks: () => <p>Sales tasks content</p> }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/:section?/:subsection?" element={<Admin />} />
        <Route path="/dashboard" element={<p>Client dashboard</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  state.isAdmin = false;
  state.isLoading = false;
});

describe("Admin access", () => {
  it("sends non-admins to their dashboard instead of the Sales tasks page", () => {
    renderAt("/admin/sales-tasks");
    expect(screen.getByText("Client dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Sales tasks content")).not.toBeInTheDocument();
  });

  it("shows the Sales tasks page to admins", () => {
    state.isAdmin = true;
    renderAt("/admin/sales-tasks");
    expect(screen.getByRole("heading", { name: "Sales tasks" })).toBeInTheDocument();
    expect(screen.getByText("Sales tasks content")).toBeInTheDocument();
  });

  it("shows nothing while the role is still being checked", () => {
    state.isLoading = true;
    renderAt("/admin/sales-tasks");
    expect(screen.queryByText("Sales tasks content")).not.toBeInTheDocument();
    expect(screen.queryByText("Client dashboard")).not.toBeInTheDocument();
  });
});
