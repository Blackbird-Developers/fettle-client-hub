import { describe, expect, it } from "vitest";
import { formatEuro } from "@/lib/sessionBundles";
import { plansFor, recommendationReason, recommendedPlan } from "./plans";

describe("plansFor", () => {
  it("lists the single session then the individual bundles with the website copy", () => {
    const plans = plansFor("individual");
    expect(plans.map((p) => p.title)).toEqual([
      "Single session",
      "3-session bundle",
      "6-session bundle",
      "9-session bundle",
    ]);
    const [single, three, six, nine] = plans;
    expect(single).toMatchObject({ total: 95, tagLine: "No commitment" });
    expect(single.bundle).toBeUndefined();
    expect(three).toMatchObject({ id: "1122832", total: 271.5, perSession: 90.5, save: 13.5, tagLine: "A gentle start" });
    expect(three.features).toEqual([
      "3 x 50-minute sessions",
      "Book each session when it suits you",
      "Insurance receipt for every session",
      "Fettle Circle access included",
    ]);
    expect(six).toMatchObject({ perSession: 88, save: 42, flag: "Most popular" });
    expect(nine).toMatchObject({ perSession: 85, flag: "Best value", more: true });
    expect(nine.features[1]).toBe("Lowest price per session");
  });

  it("uses the brief's flags for youth and couples", () => {
    const youth = plansFor("youth");
    expect(youth.map((p) => p.flag)).toEqual([undefined, "Most popular", "Biggest saving"]);
    expect(formatEuro(youth[1].perSession)).toBe("€108.33");
    expect(youth[1].features[0]).toBe("3 x 60-minute youth sessions");

    const couples = plansFor("couples");
    expect(couples.map((p) => p.flag)).toEqual([undefined, undefined, "Biggest saving"]);
    expect(couples[0].tagLine).toBe("Both partners attend");
    expect(couples[2].features[0]).toBe("5 x 60-minute couples sessions");
  });

  it("charges the live single price when given", () => {
    expect(plansFor("couples", 140)[0]).toMatchObject({ total: 140, perSession: 140 });
  });
});

describe("recommendedPlan", () => {
  it("recommends 3 sessions for first-timers or unknown history", () => {
    expect(recommendedPlan("individual", "first").sessions).toBe(3);
    expect(recommendedPlan("individual", null).sessions).toBe(3);
  });

  it("recommends 6 sessions for individual clients who've had therapy", () => {
    expect(recommendedPlan("individual", "past").sessions).toBe(6);
    expect(recommendedPlan("individual", "switching").sessions).toBe(6);
  });

  it("recommends 3 sessions for couples and youth whatever the history", () => {
    expect(recommendedPlan("couples", "past").sessions).toBe(3);
    expect(recommendedPlan("youth", "switching").sessions).toBe(3);
  });
});

describe("recommendationReason", () => {
  it("matches the website copy", () => {
    expect(recommendationReason("individual", recommendedPlan("individual", "first"), "Lisa")).toBe(
      "Recommended for you: three sessions give you time to settle in with Lisa and start making progress, at €90.50 per session."
    );
    expect(recommendationReason("individual", recommendedPlan("individual", "past"), "Lisa")).toBe(
      "Recommended for you: as you’ve had therapy before, six sessions keep momentum going at €88 per session."
    );
    expect(recommendationReason("couples", recommendedPlan("couples", null), "Lisa")).toBe(
      "Recommended for you: three sessions give you both time to settle in with Lisa and build a foundation, at €115 per session."
    );
    expect(recommendationReason("youth", recommendedPlan("youth", null), "Lisa")).toBe(
      "Recommended for you: young people often need a session or two to feel at ease. Three sessions give them that time, at €108.33 per session."
    );
  });
});
