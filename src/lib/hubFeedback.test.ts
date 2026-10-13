import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEEDBACK_FILTERS,
  type HubFeedback,
  categoryLabel,
  feedbackSourcePage,
  filterFeedback,
  pageLabel,
  summariseFeedback,
} from "./hubFeedback";

let nextId = 1;
function feedback(overrides: Partial<HubFeedback> = {}): HubFeedback {
  return {
    id: String(nextId++),
    user_id: "user-1",
    category: "hub_experience",
    message: "Hard to find my invoices",
    rating: null,
    page: null,
    status: "new",
    created_at: "2026-10-10T12:00:00.000Z",
    sender_email: "aoife@example.com",
    sender_name: "Aoife Byrne",
    status_updated_at: null,
    status_updated_by_email: null,
    ...overrides,
  };
}

describe("filterFeedback", () => {
  const rows = [
    feedback({ id: "a", category: "accessibility", created_at: "2026-10-01T12:00:00.000Z" }),
    feedback({ id: "b", category: "psychiatry", created_at: "2026-10-05T12:00:00.000Z", status: "read" }),
    feedback({ id: "c", category: "accessibility", created_at: "2026-10-09T12:00:00.000Z", status: "actioned" }),
  ];
  const ids = (list: HubFeedback[]) => list.map((row) => row.id);

  it("returns everything newest first with no filters", () => {
    expect(ids(filterFeedback(rows, DEFAULT_FEEDBACK_FILTERS))).toEqual(["c", "b", "a"]);
  });

  it("filters by category and status", () => {
    expect(ids(filterFeedback(rows, { ...DEFAULT_FEEDBACK_FILTERS, category: "accessibility" }))).toEqual(["c", "a"]);
    expect(ids(filterFeedback(rows, { ...DEFAULT_FEEDBACK_FILTERS, status: "read" }))).toEqual(["b"]);
  });

  it("filters by an inclusive date range", () => {
    expect(ids(filterFeedback(rows, { ...DEFAULT_FEEDBACK_FILTERS, from: "2026-10-05", to: "2026-10-09" }))).toEqual([
      "c",
      "b",
    ]);
    expect(ids(filterFeedback(rows, { ...DEFAULT_FEEDBACK_FILTERS, to: "2026-10-01" }))).toEqual(["a"]);
  });
});

describe("summariseFeedback", () => {
  it("counts new feedback and averages only the rated ones", () => {
    expect(
      summariseFeedback([
        feedback({ rating: 4 }),
        feedback({ rating: 5, status: "read" }),
        feedback({ rating: 4, status: "actioned" }),
        feedback({ rating: null }),
      ])
    ).toEqual({ total: 4, new: 2, averageRating: 4.3, rated: 3 });
  });

  it("has no average when nothing is rated", () => {
    expect(summariseFeedback([feedback()]).averageRating).toBeNull();
  });
});

describe("feedbackSourcePage", () => {
  it("keeps in-app paths only", () => {
    expect(feedbackSourcePage({ from: "/sessions" })).toBe("/sessions");
    expect(feedbackSourcePage({ from: "/feedback" })).toBeNull();
    expect(feedbackSourcePage({ from: "//evil.example" })).toBeNull();
    expect(feedbackSourcePage({ from: "https://evil.example" })).toBeNull();
    expect(feedbackSourcePage(null)).toBeNull();
    expect(feedbackSourcePage({ from: 42 })).toBeNull();
  });
});

describe("labels", () => {
  it("names categories and pages", () => {
    expect(categoryLabel("therapist")).toBe("Psychologist / therapist (overall)");
    expect(categoryLabel("mystery")).toBe("mystery");
    expect(pageLabel("/sessions")).toBe("My Sessions");
    expect(pageLabel("/help/booking")).toBe("Help article");
    expect(pageLabel(null)).toBeNull();
  });
});
