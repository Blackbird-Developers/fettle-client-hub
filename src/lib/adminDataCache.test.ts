// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { clearCachedAdminData, readCachedAdminData, writeCachedAdminData } from "./adminDataCache";

afterEach(() => sessionStorage.clear());

describe("adminDataCache", () => {
  it("reads back what was saved for the same admin", () => {
    writeCachedAdminData("admin-leads", "user-1", { leads: 3 }, 1000);
    expect(readCachedAdminData("admin-leads", "user-1")).toEqual({ data: { leads: 3 }, savedAt: 1000 });
  });

  it("never hands one admin's saved data to another", () => {
    writeCachedAdminData("admin-leads", "user-1", { leads: 3 });
    expect(readCachedAdminData("admin-leads", "user-2")).toBeUndefined();
    expect(readCachedAdminData("admin-leads", undefined)).toBeUndefined();
  });

  it("saves nothing without a signed-in admin", () => {
    writeCachedAdminData("admin-leads", undefined, { leads: 3 });
    expect(sessionStorage.length).toBe(0);
  });

  it("ignores corrupt entries", () => {
    sessionStorage.setItem("fettle-admin-data:v1:admin-leads", "{not json");
    expect(readCachedAdminData("admin-leads", "user-1")).toBeUndefined();
  });

  it("clears only admin data", () => {
    writeCachedAdminData("admin-leads", "user-1", { leads: 3 });
    writeCachedAdminData("admin-bundles", "user-1", { bundles: 1 });
    sessionStorage.setItem("acuity-sync-done", "true");

    clearCachedAdminData();

    expect(readCachedAdminData("admin-leads", "user-1")).toBeUndefined();
    expect(readCachedAdminData("admin-bundles", "user-1")).toBeUndefined();
    expect(sessionStorage.getItem("acuity-sync-done")).toBe("true");
  });
});
