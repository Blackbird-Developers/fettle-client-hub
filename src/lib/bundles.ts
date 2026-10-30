import { differenceInCalendarDays, format } from 'date-fns';
import { getPackageCategory, type PackageCategory } from '@/lib/packageCategory';

// How a client's session bundles are described across the hub: the credit
// cards on the dashboard, the booking confirm step and the /book wizard.

/** A row of user_packages, as far as these helpers need it. */
export interface BundleLike {
  package_id: string;
  package_name: string;
  total_sessions: number;
  remaining_sessions: number;
  expires_at: string | null;
}

export const SESSION_TYPE_LABEL: Record<PackageCategory, string> = {
  individual: 'Individual therapy',
  youth: 'Youth therapy',
  couples: 'Couples therapy',
};

/** Warn when this many sessions or fewer are left. */
export const LOW_CREDITS_AT = 1;
/** Warn when the bundle expires within this many days. */
export const EXPIRY_WARNING_DAYS = 30;

export interface BundleSummary {
  name: string;
  remaining: number;
  total: number;
  /** undefined for bundles the hub doesn't know (clinic-issued codes). */
  category: PackageCategory | undefined;
  /** "Individual therapy", or "Any therapy session" for unknown bundles. */
  coversLabel: string;
  expiresAt: Date | null;
  /** Calendar days until expiry (0 = today), null when it never expires. */
  daysToExpiry: number | null;
  expired: boolean;
  usedUp: boolean;
  lowCredits: boolean;
  expiringSoon: boolean;
}

export function summariseBundle(pkg: BundleLike, now: Date = new Date()): BundleSummary {
  const category = getPackageCategory(pkg.package_id);
  const remaining = Math.max(0, pkg.remaining_sessions);
  const total = Math.max(pkg.total_sessions, remaining);
  const expiresAt = pkg.expires_at ? new Date(pkg.expires_at) : null;
  const validExpiry = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null;
  const daysToExpiry = validExpiry ? differenceInCalendarDays(validExpiry, now) : null;
  const expired = !!validExpiry && validExpiry.getTime() < now.getTime();
  const usedUp = remaining === 0;
  return {
    name: pkg.package_name || 'Session bundle',
    remaining,
    total,
    category,
    coversLabel: category ? SESSION_TYPE_LABEL[category] : 'Any therapy session',
    expiresAt: validExpiry,
    daysToExpiry,
    expired,
    usedUp,
    lowCredits: !expired && !usedUp && remaining <= LOW_CREDITS_AT,
    expiringSoon:
      !expired && !usedUp && daysToExpiry !== null && daysToExpiry <= EXPIRY_WARNING_DAYS,
  };
}

/** "3 of 6 sessions left" */
export function sessionsLeftLabel(s: Pick<BundleSummary, 'remaining' | 'total'>): string {
  return `${s.remaining} of ${s.total} session${s.total === 1 ? '' : 's'} left`;
}

/** "Expires 12 Mar 2027", "Expired 1 Oct 2026" or "No expiry date". */
export function expiryLabel(s: Pick<BundleSummary, 'expiresAt' | 'expired'>): string {
  if (!s.expiresAt) return 'No expiry date';
  return `${s.expired ? 'Expired' : 'Expires'} ${format(s.expiresAt, 'd MMM yyyy')}`;
}

/** The warnings to show on a bundle, most urgent first. */
export function bundleWarnings(s: BundleSummary): string[] {
  const warnings: string[] = [];
  if (s.expiringSoon && s.daysToExpiry !== null) {
    warnings.push(
      s.daysToExpiry <= 0
        ? 'Expires today'
        : `Expires in ${s.daysToExpiry} day${s.daysToExpiry === 1 ? '' : 's'}: book soon to use your sessions`
    );
  }
  if (s.lowCredits) {
    warnings.push(s.remaining === 1 ? 'Only 1 session left' : `Only ${s.remaining} sessions left`);
  }
  return warnings;
}

/** Session types a booking can be for; assessments and psychiatry never take bundles. */
export type BookingCategory = PackageCategory | 'assessment' | 'psychiatry';

const CATEGORY_NOUN: Record<BookingCategory, string> = {
  individual: 'individual therapy',
  youth: 'youth therapy',
  couples: 'couples therapy',
  assessment: 'assessments',
  psychiatry: 'psychiatry',
};

/**
 * Why this bundle can't pay for a session of `booking`, or null when it can.
 * Bundles the hub doesn't know may pay for any therapy session (Acuity
 * enforces their own restriction when booking).
 */
export function notUsableReason(pkg: BundleLike, booking: BookingCategory, now: Date = new Date()): string | null {
  const s = summariseBundle(pkg, now);
  if (s.expired) return 'This bundle has expired.';
  if (s.usedUp) return 'All sessions on this bundle are used.';
  if (booking === 'assessment' || booking === 'psychiatry') {
    return `Bundles can't be used for ${CATEGORY_NOUN[booking]}.`;
  }
  if (s.category && s.category !== booking) {
    return `This bundle is for ${CATEGORY_NOUN[s.category]}, so it can't be used for ${CATEGORY_NOUN[booking]} sessions.`;
  }
  return null;
}

/** "This booking will use 1 credit from your 6 Session Bundle. You'll have 3 left." */
export function deductionMessage(pkg: Pick<BundleLike, 'package_name' | 'remaining_sessions'>): string {
  const after = Math.max(0, pkg.remaining_sessions - 1);
  const name = pkg.package_name || 'session bundle';
  return `This booking will use 1 credit from your ${name}. You'll have ${after} left.`;
}

/** "You have 3 sessions left on your 6 Session Bundle." */
export function balanceMessage(packageName: string | null | undefined, remaining: number): string {
  const name = packageName || 'bundle';
  if (remaining <= 0) return `That was the last session on your ${name}.`;
  return `You have ${remaining} session${remaining === 1 ? '' : 's'} left on your ${name}.`;
}

/** Where clients find their code; shown wherever a code can be entered. */
export const BUNDLE_CODE_HELP =
  'Your bundle code is in the order confirmation email from fettle.ie, sent right after you bought the bundle (it looks like 704E3907).';
