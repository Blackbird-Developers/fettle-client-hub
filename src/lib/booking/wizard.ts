// Booking wizard state and flow (docs/QUIZ_BOOKING_FLOW.md §2, §8, §12).
// Pure: the page keeps the state, this module says which steps exist, which
// one the client may be on, and how answers reset each other.

import type { TherapyHistory } from './content';
import { type BookingDetails, validateDetails } from './details';
import type { ConsultationKey, TherapyService } from './therapists';
import type { TimeOfDayFilter } from './time';

export type StepId =
  | 'intro'
  | 'who'
  | 'consultation'
  | 'topics'
  | 'matches'
  | 'slot'
  | 'history'
  | 'details'
  | 'plan'
  | 'review'
  | 'pay'
  | 'done';

export const STEP_IDS: StepId[] = [
  'intro',
  'who',
  'consultation',
  'topics',
  'matches',
  'slot',
  'history',
  'details',
  'plan',
  'review',
  'pay',
  'done',
];

export type WizardService = TherapyService | 'psychologist';

export interface Consents {
  first: boolean;
  contact: boolean;
  terms: boolean;
}

export interface WizardState {
  started: boolean;
  /** The client left a blocked/unavailable therapist for matching. */
  switchedToMatching: boolean;
  /** therapists_duplicate id of the chosen therapist. */
  therapistId: string | null;
  who: WizardService | null;
  consultation: ConsultationKey | null;
  topics: string[];
  history: TherapyHistory | null;
  timeOfDay: TimeOfDayFilter;
  details: BookingDetails;
  /** The compact "Booking for …" row was opened for editing. */
  editingContact: boolean;
  slot: string | null;
  planId: string | null;
  showMorePlans: boolean;
  coupon: string;
  /** user_packages row used for "Use 1 of your N remaining sessions" (planId "credit"). */
  creditPackageId: string | null;
  /** Apply the client's referral credit to a single session (Q18). */
  useReferral: boolean;
  consents: Consents;
  /** Set by Edit on the review step: Continue goes straight back to review. */
  returnToReview: boolean;
  matchCount: number;
}

export const EMPTY_DETAILS: BookingDetails = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  partnerName: '',
  youngPersonName: '',
  note: '',
};

export function initialState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    started: false,
    switchedToMatching: false,
    therapistId: null,
    who: null,
    consultation: null,
    topics: [],
    history: null,
    timeOfDay: 'any',
    details: { ...EMPTY_DETAILS },
    editingContact: false,
    slot: null,
    planId: null,
    showMorePlans: false,
    coupon: '',
    creditPackageId: null,
    useReferral: false,
    consents: { first: false, contact: false, terms: false },
    returnToReview: false,
    matchCount: 3,
    ...overrides,
  };
}

/** What the page knows about the entry and the client, used to build the flow. */
export interface FlowContext {
  /** 'chosen' = therapist from the link; 'matching' = no (bookable) therapist. */
  mode: 'chosen' | 'matching';
  psychologist: boolean;
  /** Services the chosen therapist offers (matching: all three). */
  serviceCount: number;
  /** A valid `service` in the link, so "who" is skipped. */
  serviceFromLink: boolean;
  /** Consultations the psychologist offers. */
  consultationCount: number;
  /** Client has past sessions, so the history question is skipped (Q2). */
  skipHistory: boolean;
}

/** The steps of this booking, in order (§2). */
export function flowSteps(ctx: FlowContext): StepId[] {
  const steps: StepId[] = ['intro'];
  if (ctx.mode === 'matching') {
    if (!ctx.serviceFromLink) steps.push('who');
    steps.push('topics', 'matches');
  } else if (ctx.psychologist) {
    if (ctx.consultationCount > 1) steps.push('consultation');
  } else if (ctx.serviceCount > 1 && !ctx.serviceFromLink) {
    steps.push('who');
  }
  steps.push('slot');
  if (!ctx.skipHistory) steps.push('history');
  steps.push('details');
  if (!ctx.psychologist) steps.push('plan');
  steps.push('review', 'pay', 'done');
  return steps;
}

const QUESTION_STEPS: StepId[] = ['who', 'consultation', 'topics', 'history'];

/** "Question 2" numbering: counts only question steps, in flow order. 0 when not a question. */
export function questionNumber(steps: StepId[], step: StepId): number {
  if (!QUESTION_STEPS.includes(step)) return 0;
  return steps.filter((s) => QUESTION_STEPS.includes(s)).indexOf(step) + 1;
}

export const PHASE_LABELS = ['Who it’s for', 'Date & time', 'About you', 'Your details', 'Payment'];

/** Progress phase 0–4 for a step; -1 on the intro, 5 when done. */
export function phaseOf(step: StepId): number {
  switch (step) {
    case 'intro':
      return -1;
    case 'who':
    case 'consultation':
    case 'topics':
    case 'matches':
      return 0;
    case 'slot':
      return 1;
    case 'history':
      return 2;
    case 'details':
      return 3;
    case 'done':
      return 5;
    default:
      return 4;
  }
}

export function consentsComplete(c: Consents): boolean {
  return c.first && c.contact && c.terms;
}

/** Whether a step's answer is in place, so the client may move past it. */
export function isStepComplete(step: StepId, state: WizardState, booked: boolean): boolean {
  switch (step) {
    case 'intro':
      return state.started;
    case 'who':
      return !!state.who;
    case 'consultation':
      return !!state.consultation;
    case 'topics':
      return state.topics.length > 0;
    case 'matches':
      return !!state.therapistId;
    case 'slot':
      return !!state.slot;
    case 'history':
      return !!state.history;
    case 'details':
      return !!state.who && Object.keys(validateDetails(state.details, state.who)).length === 0;
    case 'plan':
      return !!state.planId;
    case 'review':
      return consentsComplete(state.consents);
    case 'pay':
      return booked;
    case 'done':
      return booked;
  }
}

/**
 * The step the client may actually see when asking for `wanted`: the first
 * incomplete step before it wins. After booking only Done is shown.
 */
export function resolveStep(steps: StepId[], wanted: StepId | null, state: WizardState, booked: boolean): StepId {
  if (booked) return 'done';
  const target = wanted && steps.includes(wanted) && wanted !== 'done' ? wanted : null;
  for (const step of steps) {
    if (step === target) return step;
    if (!isStepComplete(step, state, booked)) return step;
  }
  return target ?? steps[0];
}

/** The step after `step`, or the review step when editing from review. */
export function nextStep(steps: StepId[], step: StepId, state: WizardState): StepId {
  const i = steps.indexOf(step);
  const next = steps[i + 1] ?? step;
  if (state.returnToReview && steps.includes('review') && steps.indexOf('review') > i) return 'review';
  return next;
}

/** Changing who it's for clears topics, plan, slot and (when matching) the therapist (§3.1, §8). */
export function withWho(state: WizardState, who: WizardService, matching: boolean): WizardState {
  if (state.who === who) return state;
  return {
    ...state,
    who,
    topics: [],
    planId: null,
    slot: null,
    showMorePlans: false,
    therapistId: matching ? null : state.therapistId,
  };
}

/** Changing therapist clears the slot (§8); the plan stays, it doesn't depend on the therapist. */
export function withTherapist(state: WizardState, therapistId: string): WizardState {
  if (state.therapistId === therapistId) return state;
  return { ...state, therapistId, slot: null };
}

/** Changing consultation changes the Acuity type, so the slot goes. */
export function withConsultation(state: WizardState, consultation: ConsultationKey): WizardState {
  if (state.consultation === consultation) return state;
  return { ...state, consultation, slot: null };
}

// ---- Saving the flow in sessionStorage (§8, §12) ----

export const STORAGE_KEY = 'fettle:book-wizard';
export const RESTORE_MAX_AGE_MS = 45 * 60_000;

interface SavedWizard {
  savedAt: number;
  /** The link the flow started from, so a different link starts fresh. */
  entry: string;
  state: WizardState;
}

export function saveWizard(entry: string, state: WizardState, now = Date.now()): void {
  try {
    const saved: SavedWizard = { savedAt: now, entry, state };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the flow still works, it just won't survive a refresh.
  }
}

export function clearWizard(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Restores answers saved less than 45 minutes ago for the same entry link.
 * The slot is never restored (it isn't held), so the client picks it again.
 */
export function loadWizard(entry: string, now = Date.now()): WizardState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedWizard;
    if (!saved || saved.entry !== entry || now - saved.savedAt > RESTORE_MAX_AGE_MS) return null;
    return {
      ...initialState(),
      ...saved.state,
      details: { ...EMPTY_DETAILS, ...saved.state.details },
      slot: null,
      consents: { first: false, contact: false, terms: false },
      returnToReview: false,
    };
  } catch {
    return null;
  }
}
