// Plan rows for the booking wizard's Payment step (docs/QUIZ_BOOKING_FLOW.md
// §3.5, §4.1, §4.4). Bundle numbers come from SESSION_BUNDLES; this file only
// adds the website's tag lines, features and flags. The flags differ from
// SESSION_BUNDLES.popular on purpose (Q20), so PackageBookingModal is unchanged.

import { SESSION_BUNDLES, formatEuro, type SessionBundle } from '@/lib/sessionBundles';
import type { TherapyHistory } from './content';
import type { TherapyService } from './therapists';

export interface BookingPlan {
  /** "single-individual" etc., or the bundle's Acuity product id as a string. */
  id: string;
  service: TherapyService;
  title: string;
  sessions: number;
  total: number;
  perSession: number;
  save: number;
  tagLine: string;
  features: string[];
  flag?: 'Most popular' | 'Best value' | 'Biggest saving';
  /** Hidden behind "Looking for longer-term support?" unless selected. */
  more?: boolean;
  /** Set for bundles; undefined for a single session. */
  bundle?: SessionBundle;
}

/** Fallback single prices; the wizard charges the Acuity type's live price. */
export const DEFAULT_SINGLE_PRICE: Record<TherapyService, number> = {
  individual: 95,
  couples: 135,
  youth: 125,
};

export const PSYCHOLOGIST_PRICE = 89;

const CIRCLE = 'Fettle Circle access included';

const SINGLE_COPY: Record<TherapyService, { tagLine: string; features: string[] }> = {
  individual: {
    tagLine: 'No commitment',
    features: ['1 x 50-minute session', 'Insurance receipt provided', 'Upgrade to a bundle anytime'],
  },
  couples: {
    tagLine: 'Both partners attend',
    features: ['1 x 60-minute couples session', 'Insurance receipt provided', 'Upgrade to a bundle anytime'],
  },
  youth: {
    tagLine: 'No commitment',
    features: ['1 x 60-minute youth session', 'Insurance receipt provided', 'Upgrade to a bundle anytime'],
  },
};

/** Website copy per bundle, keyed by the Acuity product id in SESSION_BUNDLES. */
const BUNDLE_COPY: Record<number, Pick<BookingPlan, 'tagLine' | 'flag' | 'more'> & { features?: string[] }> = {
  1122832: { tagLine: 'A gentle start' },
  996385: { tagLine: 'Keep momentum going', flag: 'Most popular' },
  1197875: {
    tagLine: 'Lowest price per session',
    flag: 'Best value',
    more: true,
    features: ['9 x 50-minute sessions', 'Lowest price per session', 'Insurance receipt for every session', CIRCLE],
  },
  2000708: { tagLine: 'Build your foundation' },
  1967869: { tagLine: 'Biggest total saving', flag: 'Biggest saving' },
  1370588: { tagLine: 'Time to settle in', flag: 'Most popular' },
  1975510: { tagLine: 'Biggest total saving', flag: 'Biggest saving' },
};

function bundleFeatures(bundle: SessionBundle): string[] {
  const kind = bundle.category === 'individual' ? '' : ` ${bundle.category}`;
  return [
    `${bundle.sessions} x ${bundle.sessionDuration}-minute${kind} sessions`,
    'Book each session when it suits you',
    'Insurance receipt for every session',
    CIRCLE,
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Single session first, then the service's bundles from SESSION_BUNDLES. */
export function plansFor(service: TherapyService, singlePrice = DEFAULT_SINGLE_PRICE[service]): BookingPlan[] {
  const single: BookingPlan = {
    id: `single-${service}`,
    service,
    title: 'Single session',
    sessions: 1,
    total: singlePrice,
    perSession: singlePrice,
    save: 0,
    ...SINGLE_COPY[service],
  };
  const bundles = SESSION_BUNDLES.filter((b) => b.category === service)
    .sort((a, b) => a.sessions - b.sessions)
    .map((bundle): BookingPlan => {
      const copy = BUNDLE_COPY[bundle.id] ?? { tagLine: '' };
      return {
        id: String(bundle.id),
        service,
        title: `${bundle.sessions}-session bundle`,
        sessions: bundle.sessions,
        total: bundle.price,
        perSession: round2(bundle.price / bundle.sessions),
        save: bundle.savings,
        tagLine: copy.tagLine,
        features: copy.features ?? bundleFeatures(bundle),
        flag: copy.flag,
        more: copy.more,
        bundle,
      };
    });
  return [single, ...bundles];
}

/** §4.4: 6 sessions for individual clients who've had therapy before, otherwise 3. */
export function recommendedPlan(
  service: TherapyService,
  history: TherapyHistory | null | undefined,
  plans: BookingPlan[] = plansFor(service)
): BookingPlan {
  const sessions = service === 'individual' && history && history !== 'first' ? 6 : 3;
  return plans.find((p) => p.bundle && p.sessions === sessions) ?? plans[0];
}

/** The orange note under the plan rows (§4.4). */
export function recommendationReason(service: TherapyService, plan: BookingPlan, therapistFirstName: string): string {
  const per = formatEuro(plan.perSession);
  if (service === 'couples') {
    return `Recommended for you: three sessions give you both time to settle in with ${therapistFirstName} and build a foundation, at ${per} per session.`;
  }
  if (service === 'youth') {
    return `Recommended for you: young people often need a session or two to feel at ease. Three sessions give them that time, at ${per} per session.`;
  }
  if (plan.sessions === 6) {
    return `Recommended for you: as you’ve had therapy before, six sessions keep momentum going at ${per} per session.`;
  }
  return `Recommended for you: three sessions give you time to settle in with ${therapistFirstName} and start making progress, at ${per} per session.`;
}
