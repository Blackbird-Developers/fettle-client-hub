/**
 * DUMMY referral data — front-end only mock for the "Refer & Earn" feature.
 *
 * The deal: Give €20, Get €20. No limit.
 *  - The referrer earns €20 in credit for every friend who joins & books.
 *  - The referred friend gets €20 off their first (or any) session.
 *
 * Credits are spendable on individual sessions AND packages/bundles.
 *
 * NOTE: None of this is wired to Supabase/Stripe yet. It's hard-coded mock
 * data so we can review the look & flow before building the real backend.
 */

/** Reward amount per successful referral, in euros. */
export const REFERRAL_REWARD = 20;

/** Base URL used to build the shareable referral link (dummy). */
export const REFERRAL_LINK_BASE = "https://my.fettle.ie/signup";

export type ReferralStatus = "joined" | "booked" | "pending";

export interface ReferredFriend {
  id: string;
  name: string;
  /** Lightly masked email, e.g. "s•••@gmail.com". */
  maskedEmail: string;
  status: ReferralStatus;
  /** ISO date the friend was invited. */
  invitedAt: string;
  /** Credit earned from this friend, in euros (0 while pending). */
  creditEarned: number;
}

export const STATUS_META: Record<
  ReferralStatus,
  { label: string; description: string }
> = {
  booked: {
    label: "Booked",
    description: "Joined and booked their first session",
  },
  joined: {
    label: "Joined",
    description: "Signed up — books soon",
  },
  pending: {
    label: "Invited",
    description: "Invite sent — not signed up yet",
  },
};

/** Dummy list of people the current user has referred. */
export const DUMMY_REFERRALS: ReferredFriend[] = [
  {
    id: "r1",
    name: "Sarah M.",
    maskedEmail: "s•••@gmail.com",
    status: "booked",
    invitedAt: "2026-05-28",
    creditEarned: 20,
  },
  {
    id: "r2",
    name: "James K.",
    maskedEmail: "j•••@outlook.com",
    status: "booked",
    invitedAt: "2026-06-04",
    creditEarned: 20,
  },
  {
    id: "r3",
    name: "Emma D.",
    maskedEmail: "e•••@gmail.com",
    status: "joined",
    invitedAt: "2026-06-15",
    creditEarned: 0,
  },
  {
    id: "r4",
    name: "Tom B.",
    maskedEmail: "t•••@icloud.com",
    status: "pending",
    invitedAt: "2026-06-20",
    creditEarned: 0,
  },
];

/**
 * Characters used for generated codes. Excludes easily-confused
 * glyphs (0/O, 1/I/L) so codes are easy to read and share aloud.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Number of random characters after the "FET-" prefix. */
const CODE_LENGTH = 6;

/**
 * Build a stable, random-looking referral code seeded from the user's id.
 *
 * Deterministic on purpose: the same seed always yields the same code, so a
 * user's code never changes between reloads — but it reveals nothing about
 * their name or email. (Uses a small hash + LCG instead of Math.random so
 * it stays stable.)
 */
export function buildReferralCode(seed?: string | null): string {
  const input = seed && seed.length ? seed : "fettle-guest";

  // djb2-style hash → 32-bit unsigned seed.
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }

  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[h % CODE_ALPHABET.length];
    // Linear congruential step for the next pseudo-random character.
    h = (h * 1103515245 + 12345) >>> 0;
  }

  return `FET-${code}`;
}

/** Build the full shareable referral link for a given code. */
export function buildReferralLink(code: string): string {
  return `${REFERRAL_LINK_BASE}?ref=${encodeURIComponent(code)}`;
}
