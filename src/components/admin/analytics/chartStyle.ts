// Chart colours (--series-* in index.css, light and dark), validated as a set
// for colour-blind separation against the card backgrounds. Aqua and yellow
// are under 3:1 on the light card, so every chart has a labelled legend and
// a table view.
export const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"] as const;

/** Neutral fill for "not checked yet": a gap in the data, not a series. */
export const NEUTRAL_COLOR = "var(--series-neutral)";

export type Tone = "up" | "down" | "neutral";

export function toneOf(change: number | null): Tone {
  if (change === null || change === 0) return "neutral";
  return change > 0 ? "up" : "down";
}
