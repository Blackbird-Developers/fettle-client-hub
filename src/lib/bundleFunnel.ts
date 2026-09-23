import type { PackageCategory } from '@/lib/packageCategory';
import { findSessionBundle, getSessionBundle } from '@/lib/sessionBundles';

// Bundle funnel. fettle.ie therapy pages link to
//   my.fettle.ie/packages?bundle=6&therapy=anxiety
// The client signs in (or registers), then /get-started walks them through
// buying that bundle and booking their first session with it.
//
// The choice is kept in localStorage rather than the URL: registration
// requires email verification, so the client usually comes back through the
// link in their inbox (often in a new tab), and Google sign-in always returns
// to /dashboard. BundleFunnelResume picks it up wherever they land.

interface FunnelTherapy {
  /** Used in sentences, e.g. "6-session bundle for anxiety therapy". */
  topic: string;
  category: PackageCategory;
  /**
   * Acuity appointment type pre-selected for the first session. Left out when
   * Acuity has no matching type, so the client picks the topic themselves.
   */
  appointmentTypeId?: number;
}

export const FUNNEL_THERAPIES: Record<string, FunnelTherapy> = {
  abuse: { topic: 'abuse therapy', category: 'individual', appointmentTypeId: 76499046 },
  act: { topic: 'ACT', category: 'individual', appointmentTypeId: 76499103 },
  addiction: { topic: 'addiction therapy', category: 'individual', appointmentTypeId: 76499216 },
  adhd: { topic: 'ADHD therapy', category: 'individual', appointmentTypeId: 76496589 },
  anger: { topic: 'anger management', category: 'individual', appointmentTypeId: 76498878 },
  anxiety: { topic: 'anxiety therapy', category: 'individual', appointmentTypeId: 76498640 },
  cbt: { topic: 'CBT', category: 'individual', appointmentTypeId: 77043213 },
  chronic: { topic: 'chronic pain therapy', category: 'individual', appointmentTypeId: 76498982 },
  // Acuity has no CPT type; CPT is a trauma-focused therapy.
  cpt: { topic: 'CPT', category: 'individual', appointmentTypeId: 76626984 },
  dbt: { topic: 'DBT', category: 'individual', appointmentTypeId: 76499788 },
  depression: { topic: 'depression therapy', category: 'individual', appointmentTypeId: 76627364 },
  general: { topic: 'general therapy', category: 'individual' },
  grief: { topic: 'grief & loss therapy', category: 'individual', appointmentTypeId: 76538539 },
  // Marriage counselling is booked as couples therapy (per-therapist types).
  marriage: { topic: 'marriage counselling', category: 'couples' },
  menopause: { topic: 'menopause therapy', category: 'individual' },
  trauma: { topic: 'trauma therapy', category: 'individual', appointmentTypeId: 76626984 },
  // youth.html and couples.html: youth and couples types are per therapist, so
  // the client picks their therapist at booking.
  youth: { topic: 'youth therapy', category: 'youth' },
  couples: { topic: 'couples therapy', category: 'couples' },
};

export interface BundleFunnelIntent {
  /** Validated therapy slug, or null when missing/unknown. */
  therapy: string | null;
  /** Bundle size requested in the link. */
  bundleSize: number | null;
  category: PackageCategory;
  /** Acuity product to pre-select; null when that size doesn't exist. */
  packageId: number | null;
  appointmentTypeId: number | null;
  /** "pending-auth" until the client first reaches /get-started. */
  status: 'pending-auth' | 'active';
  savedAt: number;
}

type FunnelChoice = Omit<BundleFunnelIntent, 'status' | 'savedAt'>;

const STORAGE_KEY = 'fettle:bundle-funnel';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // allows for a late email verification

/**
 * Reads ?bundle=&therapy= from a /packages link. Returns null when the link
 * carries neither a known therapy nor a real bundle, so plain /packages keeps
 * its existing behaviour.
 */
export function parseBundleFunnelParams(params: URLSearchParams): FunnelChoice | null {
  const rawTherapy = params.get('therapy')?.trim().toLowerCase() ?? '';
  const rawBundle = params.get('bundle')?.trim() ?? '';

  const therapy = Object.prototype.hasOwnProperty.call(FUNNEL_THERAPIES, rawTherapy)
    ? rawTherapy
    : null;
  const definition = therapy ? FUNNEL_THERAPIES[therapy] : undefined;
  const category: PackageCategory = definition?.category ?? 'individual';
  const bundleSize = /^\d{1,2}$/.test(rawBundle) ? parseInt(rawBundle, 10) : null;
  const packageId = bundleSize ? findSessionBundle(category, bundleSize)?.id ?? null : null;

  if (!therapy && !packageId) return null;

  return {
    therapy,
    bundleSize,
    category,
    packageId,
    appointmentTypeId: definition?.appointmentTypeId ?? null,
  };
}

export function saveBundleFunnelIntent(choice: FunnelChoice): void {
  const intent: BundleFunnelIntent = { ...choice, status: 'pending-auth', savedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    /* storage unavailable: the client can still buy from the dashboard */
  }
}

export function readBundleFunnelIntent(): BundleFunnelIntent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw) as BundleFunnelIntent;
    const valid =
      intent &&
      typeof intent.savedAt === 'number' &&
      Date.now() - intent.savedAt <= TTL_MS &&
      ['individual', 'youth', 'couples'].includes(intent.category) &&
      (intent.status === 'pending-auth' || intent.status === 'active');
    if (!valid) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return intent;
  } catch {
    return null;
  }
}

/** Called once the client reaches /get-started, so they're never redirected there again. */
export function markBundleFunnelActive(): void {
  const intent = readBundleFunnelIntent();
  if (!intent || intent.status === 'active') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...intent, status: 'active' }));
  } catch {
    /* ignore */
  }
}

export function clearBundleFunnelIntent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** e.g. "6-session bundle for anxiety therapy". */
export function describeBundleFunnel(intent: BundleFunnelIntent): string {
  const bundle = getSessionBundle(intent.packageId);
  const therapy = intent.therapy ? FUNNEL_THERAPIES[intent.therapy] : undefined;
  // "couples session bundle for marriage counselling", but not
  // "couples session bundle for couples therapy".
  const categoryPrefix =
    intent.category !== 'individual' && !therapy?.topic.includes(intent.category)
      ? `${intent.category} `
      : '';
  const bundleText = bundle
    ? `${bundle.sessions}-session bundle`
    : `${categoryPrefix}session bundle`;
  return therapy ? `${bundleText} for ${therapy.topic}` : bundleText;
}
