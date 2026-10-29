// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  type FlowContext,
  RESTORE_MAX_AGE_MS,
  clearWizard,
  flowSteps,
  initialState,
  loadWizard,
  nextStep,
  phaseOf,
  questionNumber,
  resolveStep,
  saveWizard,
  withTherapist,
  withWho,
} from "./wizard";

const chosen: FlowContext = {
  mode: "chosen",
  psychologist: false,
  serviceCount: 2,
  serviceFromLink: false,
  consultationCount: 0,
  skipHistory: false,
};

const completeDetails = {
  firstName: "Sarah",
  lastName: "Byrne",
  email: "sarah@example.com",
  phone: "087 123 4567",
  partnerName: "",
  youngPersonName: "",
  note: "",
};

describe("flowSteps", () => {
  it("puts the time first for a chosen therapist", () => {
    expect(flowSteps(chosen)).toEqual(["intro", "who", "slot", "history", "details", "plan", "review", "pay", "done"]);
  });

  it("skips who for one service or a service in the link", () => {
    expect(flowSteps({ ...chosen, serviceCount: 1 })).not.toContain("who");
    expect(flowSteps({ ...chosen, serviceFromLink: true })).not.toContain("who");
  });

  it("has topics and matches when matching", () => {
    expect(flowSteps({ ...chosen, mode: "matching" }).slice(0, 5)).toEqual(["intro", "who", "topics", "matches", "slot"]);
  });

  it("has no plan step for psychologists and asks the consultation only when there's a choice", () => {
    const psych = { ...chosen, psychologist: true, consultationCount: 3 };
    expect(flowSteps(psych)).toEqual(["intro", "consultation", "slot", "history", "details", "review", "pay", "done"]);
    expect(flowSteps({ ...psych, consultationCount: 1 })).not.toContain("consultation");
  });

  it("drops history for clients with past sessions, and renumbers questions", () => {
    const steps = flowSteps({ ...chosen, skipHistory: true });
    expect(steps).not.toContain("history");
    expect(questionNumber(flowSteps(chosen), "history")).toBe(2);
    expect(questionNumber(flowSteps({ ...chosen, serviceCount: 1 }), "history")).toBe(1);
    expect(questionNumber(steps, "slot")).toBe(0);
  });

  it("maps steps to the five progress phases", () => {
    expect(phaseOf("intro")).toBe(-1);
    expect(phaseOf("matches")).toBe(0);
    expect(phaseOf("slot")).toBe(1);
    expect(phaseOf("review")).toBe(4);
    expect(phaseOf("done")).toBe(5);
  });
});

describe("resolveStep", () => {
  const steps = flowSteps(chosen);

  it("sends the client to the first unanswered step", () => {
    const state = initialState({ started: true, who: "individual" });
    expect(resolveStep(steps, "review", state, false)).toBe("slot");
    expect(resolveStep(steps, "who", state, false)).toBe("who");
    expect(resolveStep(steps, null, initialState(), false)).toBe("intro");
  });

  it("allows review once everything before it is answered", () => {
    const state = initialState({
      started: true,
      who: "individual",
      slot: "2026-11-02T09:00:00+0000",
      history: "first",
      details: completeDetails,
      planId: "1122832",
    });
    expect(resolveStep(steps, "review", state, false)).toBe("review");
    expect(resolveStep(steps, "pay", state, false)).toBe("review");
    expect(resolveStep(steps, "pay", { ...state, consents: { first: true, contact: true, terms: true } }, false)).toBe(
      "pay"
    );
  });

  it("only shows Done after booking", () => {
    expect(resolveStep(steps, "done", initialState(), false)).toBe("intro");
    expect(resolveStep(steps, "slot", initialState(), true)).toBe("done");
  });

  it("goes straight back to review after an edit", () => {
    expect(nextStep(steps, "slot", initialState())).toBe("history");
    expect(nextStep(steps, "slot", initialState({ returnToReview: true }))).toBe("review");
  });
});

describe("answer resets", () => {
  it("changing who clears topics, plan and slot, and the therapist when matching", () => {
    const state = initialState({ who: "individual", topics: ["anxiety"], planId: "x", slot: "s", therapistId: "7" });
    expect(withWho(state, "couples", false)).toMatchObject({ topics: [], planId: null, slot: null, therapistId: "7" });
    expect(withWho(state, "couples", true).therapistId).toBeNull();
    expect(withWho(state, "individual", true)).toBe(state);
  });

  it("changing therapist clears the slot", () => {
    expect(withTherapist(initialState({ therapistId: "1", slot: "s" }), "2")).toMatchObject({ therapistId: "2", slot: null });
  });
});

describe("saving and restoring", () => {
  afterEach(() => clearWizard());

  it("restores answers for the same link within 45 minutes, without the slot or consents", () => {
    const state = initialState({
      started: true,
      who: "individual",
      slot: "2026-11-02T09:00:00+0000",
      history: "past",
      consents: { first: true, contact: true, terms: true },
    });
    saveWizard("therapist=7", state, 1_000);
    const restored = loadWizard("therapist=7", 1_000 + RESTORE_MAX_AGE_MS - 1);
    expect(restored).toMatchObject({ who: "individual", history: "past", slot: null });
    expect(restored?.consents.terms).toBe(false);
  });

  it("starts fresh for another link or after 45 minutes", () => {
    saveWizard("therapist=7", initialState({ started: true }), 1_000);
    expect(loadWizard("therapist=8", 1_000)).toBeNull();
    expect(loadWizard("therapist=7", 1_000 + RESTORE_MAX_AGE_MS + 1)).toBeNull();
  });
});
