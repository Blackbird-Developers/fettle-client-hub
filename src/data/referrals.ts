/**
 * Shared constants for the "Refer & Earn" feature.
 *
 * The deal: Give €20, Get €20. No limit.
 *  - The referee gets €20 off when they sign up via a code / link / email.
 *  - The referrer earns €20 credit, unlocked once the friend signs up.
 *
 * Credits are spendable on individual sessions AND packages/bundles, and are
 * never paid out as cash.
 *
 * Live data now comes from the `get_referral_overview` Supabase RPC
 * (see src/hooks/useReferrals.ts). This file only holds display constants.
 */

/** Reward amount per successful referral, in euros (server source of truth: referral_reward_cents). */
export const REFERRAL_REWARD = 20;
