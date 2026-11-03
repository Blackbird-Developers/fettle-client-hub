// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadGtm } from "./gtm";

afterEach(() => {
  document.head.querySelectorAll("script[data-gtm]").forEach((s) => s.remove());
  delete (window as Window & { dataLayer?: unknown }).dataLayer;
});

describe("loadGtm", () => {
  it("does nothing without a container ID", () => {
    expect(loadGtm("")).toBe(false);
    expect(loadGtm(undefined)).toBe(false);
    expect(document.querySelector("script[data-gtm]")).toBeNull();
  });

  it("ignores a value that isn't a GTM ID", () => {
    expect(loadGtm("G-ABC123")).toBe(false);
    expect(document.querySelector("script[data-gtm]")).toBeNull();
  });

  it("loads the container once and starts the dataLayer", () => {
    expect(loadGtm("GTM-ABC123")).toBe(true);
    expect(loadGtm("GTM-ABC123")).toBe(true);
    const scripts = document.querySelectorAll("script[data-gtm]");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute("src")).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-ABC123");
    expect((window as Window & { dataLayer?: unknown[] }).dataLayer?.[0]).toMatchObject({ event: "gtm.js" });
  });
});
