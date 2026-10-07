import { describe, expect, it } from "vitest";
import { NOTE_MAX_LENGTH } from "./customerFollowups";
import {
  appendNote,
  appendWouldOverflow,
  customersLabel,
  headerCheckboxState,
  listNames,
  pruneSelection,
  runWithConcurrency,
  splitResults,
  toggleAllVisible,
  toggleSelected,
} from "./bulkFollowups";

const visible = ["email:a", "email:b", "email:c"];
const AT = new Date(2026, 9, 7, 10, 30);

describe("row selection", () => {
  it("selects and deselects a single row", () => {
    const one = toggleSelected(new Set(), "email:a");
    expect([...one]).toEqual(["email:a"]);
    expect(toggleSelected(one, "email:a").size).toBe(0);
  });

  it("selects several rows without touching the others", () => {
    const selected = toggleSelected(toggleSelected(new Set(), "email:a"), "email:c");
    expect([...selected].sort()).toEqual(["email:a", "email:c"]);
  });

  it("reports unticked, partly ticked and ticked header states", () => {
    expect(headerCheckboxState(visible, new Set())).toBe(false);
    expect(headerCheckboxState(visible, new Set(["email:b"]))).toBe("indeterminate");
    expect(headerCheckboxState(visible, new Set(visible))).toBe(true);
    expect(headerCheckboxState([], new Set())).toBe(false);
  });

  it("header click selects every shown row, then clears them", () => {
    const all = toggleAllVisible(visible, new Set(["email:b"]));
    expect([...all].sort()).toEqual(visible);
    expect(toggleAllVisible(visible, all).size).toBe(0);
  });

  it("select all only covers rows currently shown", () => {
    const filtered = ["email:a", "email:b"];
    expect([...toggleAllVisible(filtered, new Set())].sort()).toEqual(filtered);
  });

  it("drops selected rows that a search, period or refresh hides", () => {
    const selected = new Set(["email:a", "email:c"]);
    expect([...pruneSelection(selected, ["email:a", "email:b"])]).toEqual(["email:a"]);
  });

  it("keeps the same selection when sorting or refreshing shows the same rows", () => {
    const selected = new Set(["email:a", "email:c"]);
    expect(pruneSelection(selected, ["email:c", "email:b", "email:a"])).toBe(selected);
  });
});

describe("bulk runner", () => {
  it("saves every key and reports progress", async () => {
    const progress: number[] = [];
    const results = await runWithConcurrency(
      visible,
      2,
      async (key) => key.toUpperCase(),
      (done) => progress.push(done)
    );
    expect(results).toEqual(visible.map((key) => ({ key, ok: true, value: key.toUpperCase() })));
    expect(progress).toEqual([1, 2, 3]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const keys = Array.from({ length: 10 }, (_, i) => `email:${i}`);
    await runWithConcurrency(keys, 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
    });
    expect(peak).toBe(3);
  });

  it("keeps going after a failure and says which keys failed", async () => {
    const results = await runWithConcurrency(visible, 2, async (key) => {
      if (key === "email:b") throw { message: "permission denied" };
      return key;
    });
    const { succeeded, failed } = splitResults(results);
    expect(succeeded.map((r) => r.key)).toEqual(["email:a", "email:c"]);
    expect(failed).toEqual([{ key: "email:b", ok: false, error: { message: "permission denied" } }]);
  });

  it("reports every key when everything fails", async () => {
    const results = await runWithConcurrency(visible, 4, async () => {
      throw new Error("offline");
    });
    expect(splitResults(results).failed.map((r) => r.key)).toEqual(visible);
  });

  it("handles an empty selection", async () => {
    expect(await runWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("bulk notes", () => {
  it("starts a dated, signed note when there was none", () => {
    expect(appendNote(null, "  Left a voicemail ", "alex@fettle.ie", AT)).toBe(
      "— 7 Oct 2026, alex@fettle.ie\nLeft a voicemail"
    );
  });

  it("adds below an existing note instead of replacing it", () => {
    expect(appendNote("Prefers email", "Sent reminder", "alex@fettle.ie", AT)).toBe(
      "Prefers email\n\n— 7 Oct 2026, alex@fettle.ie\nSent reminder"
    );
  });

  it("leaves out the author when unknown", () => {
    expect(appendNote("", "Hi", null, AT)).toBe("— 7 Oct 2026\nHi");
  });

  it("flags notes that would go over the limit", () => {
    const long = "x".repeat(NOTE_MAX_LENGTH - 10);
    expect(appendWouldOverflow(long, "Sent reminder", "alex@fettle.ie", AT)).toBe(true);
    expect(appendWouldOverflow("short", "Sent reminder", "alex@fettle.ie", AT)).toBe(false);
  });
});

describe("labels", () => {
  it("lists names and summarises the rest", () => {
    expect(listNames(["Ann"])).toBe("Ann");
    expect(listNames(["Ann", "Bo"])).toBe("Ann and Bo");
    expect(listNames(["Ann", "Bo", "Cy", "Di", "Ed"])).toBe("Ann, Bo, Cy and 2 others");
  });

  it("pluralises the customer count", () => {
    expect(customersLabel(1)).toBe("1 customer");
    expect(customersLabel(4)).toBe("4 customers");
  });
});
