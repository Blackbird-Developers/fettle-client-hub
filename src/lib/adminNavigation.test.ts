import { describe, expect, it } from "vitest";
import {
  ADMIN_SECTIONS,
  hasActiveChild,
  parseProgressionRange,
  progressionRangeSlug,
  resolveAdminRoute,
} from "./adminNavigation";

const progression = ADMIN_SECTIONS.find((section) => section.id === "progression")!;

describe("progression navigation", () => {
  it("lists Session 1–2 to 4–5 under Progression", () => {
    expect(progression.children?.map((child) => [child.name, child.href])).toEqual([
      ["Session 1–2", "/admin/progression/1-2"],
      ["Session 2–3", "/admin/progression/2-3"],
      ["Session 3–4", "/admin/progression/3-4"],
      ["Session 4–5", "/admin/progression/4-5"],
    ]);
  });

  it("maps range slugs to the from-session and back", () => {
    expect(progressionRangeSlug(2)).toBe("2-3");
    expect(parseProgressionRange("1-2")).toBe(1);
    expect(parseProgressionRange("4-5")).toBe(4);
    expect(parseProgressionRange("5-6")).toBeUndefined();
    expect(parseProgressionRange("2-4")).toBeUndefined();
    expect(parseProgressionRange(undefined)).toBeUndefined();
  });

  it("gives only Progression a submenu", () => {
    expect(ADMIN_SECTIONS.filter((s) => s.children).map((s) => s.id)).toEqual(["progression"]);
  });
});

describe("resolveAdminRoute", () => {
  it("opens the overview at /admin", () => {
    expect(resolveAdminRoute(undefined, undefined)).toMatchObject({
      section: { id: "overview" },
    });
  });

  it("opens plain sections and drops stray sub-paths", () => {
    expect(resolveAdminRoute("adoption", undefined)).toMatchObject({ section: { id: "adoption" } });
    expect(resolveAdminRoute("followups", undefined)).toMatchObject({ section: { id: "followups" } });
    expect(resolveAdminRoute("team", "extra")).toEqual({ redirect: "/admin/team" });
  });

  it("sends unknown sections to the overview", () => {
    expect(resolveAdminRoute("nope", undefined)).toEqual({ redirect: "/admin" });
    expect(resolveAdminRoute("nope", "1-2")).toEqual({ redirect: "/admin" });
  });

  it("sends /admin/progression and unknown ranges to Session 1–2", () => {
    expect(resolveAdminRoute("progression", undefined)).toEqual({
      redirect: "/admin/progression/1-2",
    });
    expect(resolveAdminRoute("progression", "9-10")).toEqual({
      redirect: "/admin/progression/1-2",
    });
  });

  it("opens each progression range", () => {
    for (const slug of ["1-2", "2-3", "3-4", "4-5"]) {
      expect(resolveAdminRoute("progression", slug)).toMatchObject({
        section: { id: "progression" },
        subsection: { id: slug, href: `/admin/progression/${slug}` },
      });
    }
  });
});

describe("hasActiveChild", () => {
  it("keeps Progression expanded only on its own pages", () => {
    expect(hasActiveChild(progression.children, "/admin/progression/3-4")).toBe(true);
    expect(hasActiveChild(progression.children, "/admin/progression")).toBe(false);
    expect(hasActiveChild(progression.children, "/admin/adoption")).toBe(false);
    expect(hasActiveChild(undefined, "/admin/progression/1-2")).toBe(false);
  });
});
