// Progress estimates for the slow Acuity-backed admin pages.
//
// Each edge function answers with a single response after up to a minute,
// so there is no real progress to report. Instead the loader times each
// load, remembers how long the last ones took (per browser), and moves a
// progress bar and step list along that expected duration. Only timings are
// stored, never client data.

export type AdminDataSource = "admin-customer-insights" | "admin-leads" | "admin-bundles";

export interface LoadStep {
  label: string;
  /** Rough share of the total load time this step takes (shares sum to 1). */
  share: number;
}

export interface LoadProfile {
  /** What is loading, as it reads in "Loading … from Acuity". */
  label: string;
  /** Used until this browser has timed a real load. */
  defaultMs: number;
  /** Mirrors the numbered steps in the edge function's index.ts. */
  steps: LoadStep[];
}

export const LOAD_PROFILES: Record<AdminDataSource, LoadProfile> = {
  "admin-customer-insights": {
    label: "customer data",
    defaultMs: 45_000,
    steps: [
      { label: "Fetching appointments", share: 0.35 },
      { label: "Matching Hub accounts", share: 0.05 },
      { label: "Checking each customer's session history", share: 0.55 },
      { label: "Building the view", share: 0.05 },
    ],
  },
  "admin-leads": {
    label: "leads",
    defaultMs: 30_000,
    steps: [
      { label: "Fetching appointments", share: 0.4 },
      { label: "Matching Hub accounts", share: 0.05 },
      { label: "Checking each lead's history", share: 0.5 },
      { label: "Scoring leads", share: 0.05 },
    ],
  },
  "admin-bundles": {
    label: "bundles",
    defaultMs: 30_000,
    steps: [
      { label: "Fetching bundles", share: 0.15 },
      { label: "Fetching appointments", share: 0.65 },
      { label: "Matching Hub accounts", share: 0.1 },
      { label: "Working out credits used", share: 0.1 },
    ],
  },
};

/** The bar reaches this when the expected time is up, then creeps toward 99. */
const EXPECTED_END_PERCENT = 90;
const MIN_EXPECTED_MS = 3_000;
const MAX_EXPECTED_MS = 5 * 60_000;

export interface LoadEstimate {
  /** 0–99; 100 is only reached by the data arriving. */
  percent: number;
  remainingMs: number;
  /** Past the expected time. */
  overdue: boolean;
  /** Index into the profile's steps of the one in progress. */
  activeStep: number;
}

export function estimateLoad(profile: LoadProfile, elapsedMs: number, expectedMs: number): LoadEstimate {
  const expected = Math.max(expectedMs, MIN_EXPECTED_MS);
  const ratio = Math.max(0, elapsedMs) / expected;
  const percent =
    ratio <= 1
      ? ratio * EXPECTED_END_PERCENT
      : EXPECTED_END_PERCENT + (99 - EXPECTED_END_PERCENT) * (1 - Math.exp(-(ratio - 1) * 2));

  let activeStep = profile.steps.length - 1;
  let cumulative = 0;
  for (let i = 0; i < profile.steps.length; i++) {
    cumulative += profile.steps[i].share;
    if (ratio < cumulative) {
      activeStep = i;
      break;
    }
  }

  return {
    percent: Math.min(99, percent),
    remainingMs: Math.max(0, expected - elapsedMs),
    overdue: ratio > 1,
    activeStep,
  };
}

export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 5) return "A few seconds left";
  if (seconds < 60) return `About ${Math.ceil(seconds / 5) * 5}s left`;
  const minutes = Math.round(seconds / 60);
  return `About ${minutes} min left`;
}

// ---------------------------------------------------------------------------
// Timings. Start times live in memory so a page opened mid-load (e.g. the
// load was started by the preload on the Overview) carries on from where it
// is rather than starting the bar again.
// ---------------------------------------------------------------------------

const loadStarts = new Map<AdminDataSource, number>();

export function markLoadStart(source: AdminDataSource, at: number = Date.now()): void {
  loadStarts.set(source, at);
}

export function getLoadStart(source: AdminDataSource): number | undefined {
  return loadStarts.get(source);
}

export function clearLoadStart(source: AdminDataSource): void {
  loadStarts.delete(source);
}

const DURATION_KEY_PREFIX = "fettle-admin-load-ms:";

export function readExpectedDuration(source: AdminDataSource): number {
  try {
    const stored = Number(localStorage.getItem(DURATION_KEY_PREFIX + source));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // Storage blocked (private window etc.) — fall back to the default.
  }
  return LOAD_PROFILES[source].defaultMs;
}

/** Blends the new timing with the stored one so a single odd load doesn't swing the estimate. */
export function recordDuration(source: AdminDataSource, ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const clamped = Math.min(MAX_EXPECTED_MS, Math.max(MIN_EXPECTED_MS, ms));
  let next = clamped;
  try {
    const previous = Number(localStorage.getItem(DURATION_KEY_PREFIX + source));
    if (Number.isFinite(previous) && previous > 0) next = Math.round((previous + clamped) / 2);
    localStorage.setItem(DURATION_KEY_PREFIX + source, String(next));
  } catch {
    // Storage blocked — the estimate just stays at the default.
  }
}

/** Times a load: marks its start for the loader and records how long it took. */
export async function timeLoad<T>(source: AdminDataSource, load: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  markLoadStart(source, startedAt);
  try {
    const result = await load();
    recordDuration(source, Date.now() - startedAt);
    return result;
  } finally {
    clearLoadStart(source);
  }
}
