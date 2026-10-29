import { describe, expect, it } from "vitest";
import { isMatchCandidate, isOnlyUnsure, matchedTopics, rankTherapists, scoreTherapist } from "./matching";
import type { TherapistRow } from "./therapists";

const TODAY = "2026-10-29";

let nextId = 1;
function row(overrides: Partial<TherapistRow> = {}): TherapistRow {
  return {
    id: nextId++,
    name: `Therapist ${nextId}`,
    status: "active",
    calendarid: "100",
    appointmentidindividual: "200",
    tags: [],
    ...overrides,
  };
}

describe("candidates", () => {
  it("leaves out psychologists, excluded names, the unbookable and those without the service", () => {
    expect(isMatchCandidate(row(), "individual")).toBe(true);
    expect(isMatchCandidate(row({ isPsychologist: "true" }), "individual")).toBe(false);
    expect(isMatchCandidate(row({ name: "Doreen Maher" }), "individual")).toBe(false);
    expect(isMatchCandidate(row({ name: "Ana Moore" }), "individual")).toBe(false);
    expect(isMatchCandidate(row({ status: "inactive" }), "individual")).toBe(false);
    expect(isMatchCandidate(row(), "couples")).toBe(false);
  });
});

describe("scoreTherapist", () => {
  it("adds 2 per matching topic tag", () => {
    const t = row({ tags: ["anxiety", "ocd", "stress"] });
    // "Anxiety and worry" covers anxiety + ocd, "Stress and burnout" covers stress.
    expect(scoreTherapist(t, "individual", ["anxiety", "stress"], undefined, TODAY)).toBe(6);
    expect(scoreTherapist(t, "individual", ["unsure"], undefined, TODAY)).toBe(0);
  });

  it("ignores the plain couples tag", () => {
    const t = row({ appointmentidcouples: "300", tags: ["couples", "relationships"] });
    expect(scoreTherapist(t, "couples", ["communication"], undefined, TODAY)).toBe(2);
  });

  it("adds the pinned bonus in order", () => {
    expect(scoreTherapist(row({ name: "Lisa Kelly" }), "individual", [], undefined, TODAY)).toBeCloseTo(1.5);
    expect(scoreTherapist(row({ name: "Nicole Dunne" }), "individual", [], undefined, TODAY)).toBeCloseTo(1.3);
    expect(scoreTherapist(row({ name: "Olivia Fahy" }), "individual", [], undefined, TODAY)).toBeCloseTo(1.1);
  });

  it("rewards sooner times, shrinking by week, and penalises no times", () => {
    const t = row();
    expect(scoreTherapist(t, "individual", [], TODAY, TODAY)).toBeCloseTo(1.5);
    expect(scoreTherapist(t, "individual", [], "2026-11-05", TODAY)).toBeCloseTo(0.5);
    expect(scoreTherapist(t, "individual", [], "2026-12-25", TODAY)).toBe(0);
    expect(scoreTherapist(t, "individual", [], null, TODAY)).toBe(-5);
    expect(scoreTherapist(t, "individual", [], undefined, TODAY)).toBe(0);
  });
});

describe("rankTherapists", () => {
  it("sorts by score and keeps the original order for ties", () => {
    const a = row({ name: "Aoife A" });
    const b = row({ name: "Brian B", tags: ["anxiety"] });
    const c = row({ name: "Ciara C" });
    const none = row({ name: "Dara D" });
    const ranked = rankTherapists([a, b, c, none], "individual", ["anxiety"], { [String(none.id)]: null }, TODAY);
    expect(ranked.map((r) => r.therapist.name)).toEqual(["Brian B", "Aoife A", "Ciara C", "Dara D"]);
    expect(ranked[0].matched.map((t) => t.label)).toEqual(["Anxiety and worry"]);
  });
});

describe("topics", () => {
  it("lists matched topics for the cards", () => {
    const t = row({ tags2: "grief, self esteem" });
    expect(matchedTopics(t, "individual", ["loss", "self-esteem", "anger"]).map((x) => x.id)).toEqual([
      "loss",
      "self-esteem",
    ]);
  });

  it("knows when only Not sure yet is picked", () => {
    expect(isOnlyUnsure(["unsure"])).toBe(true);
    expect(isOnlyUnsure(["unsure", "anxiety"])).toBe(false);
    expect(isOnlyUnsure([])).toBe(false);
  });
});
