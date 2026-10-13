// @vitest-environment jsdom
import "@/test/setupDom";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCachedAdminData, writeCachedAdminData } from "@/lib/adminDataCache";
import { useBundles, usePreloadAdminData } from "./useAdmin";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: true, error: null }),
    auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) },
  },
}));

const fetchMock = vi.fn();

function responseFor(url: string) {
  const name = url.split("/").pop();
  return { generatedAt: "2026-10-13T10:00:00.000Z", source: name };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => responseFor(url) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});

describe("Acuity admin data", () => {
  it("shows data saved in this tab straight away, without loading again while it's fresh", async () => {
    writeCachedAdminData("admin-bundles", "admin-1", { generatedAt: "saved", source: "saved" });

    const { result } = renderHook(() => useBundles(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toMatchObject({ source: "saved" });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows stale saved data while it refreshes in the background", async () => {
    writeCachedAdminData("admin-bundles", "admin-1", { source: "saved" }, Date.now() - 40 * 60_000);

    const { result } = renderHook(() => useBundles(), { wrapper });

    expect(result.current.data).toMatchObject({ source: "saved" });
    await waitFor(() => expect(result.current.data).toMatchObject({ source: "admin-bundles" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores data another admin saved, then saves its own", async () => {
    writeCachedAdminData("admin-bundles", "someone-else", { source: "theirs" });

    const { result } = renderHook(() => useBundles(), { wrapper });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toMatchObject({ source: "admin-bundles" }));
    expect(readCachedAdminData("admin-bundles", "admin-1")?.data).toMatchObject({ source: "admin-bundles" });
  });

  it("preloads the three pages one request at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    fetchMock.mockImplementation(async (url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, json: async () => responseFor(url) };
    });

    renderHook(() => usePreloadAdminData(true), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([url]) => String(url).split("/").pop())).toEqual([
      "admin-customer-insights",
      "admin-leads",
      "admin-bundles",
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("doesn't preload for non-admins", async () => {
    renderHook(() => usePreloadAdminData(false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
