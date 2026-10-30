import { describe, expect, it } from 'vitest';
import {
  balanceMessage,
  bundleUsedFor,
  bundleWarnings,
  deductionMessage,
  expiryLabel,
  notUsableReason,
  sessionsLeftLabel,
  summariseBundle,
  type BundleLike,
} from './bundles';

const NOW = new Date('2026-10-30T12:00:00Z');

function bundle(overrides: Partial<BundleLike> = {}): BundleLike {
  return {
    package_id: '996385', // 6 Session Bundle, individual
    package_name: '6 Session Bundle',
    total_sessions: 6,
    remaining_sessions: 4,
    expires_at: '2027-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('summariseBundle', () => {
  it('describes a healthy bundle', () => {
    const s = summariseBundle(bundle(), NOW);
    expect(sessionsLeftLabel(s)).toBe('4 of 6 sessions left');
    expect(s.coversLabel).toBe('Individual therapy');
    expect(expiryLabel(s)).toBe('Expires 1 Jun 2027');
    expect(bundleWarnings(s)).toEqual([]);
  });

  it('warns when credits are low or expiry is close', () => {
    const s = summariseBundle(bundle({ remaining_sessions: 1, expires_at: '2026-11-10T12:00:00Z' }), NOW);
    expect(bundleWarnings(s)).toEqual([
      'Expires in 11 days: book soon to use your sessions',
      'Only 1 session left',
    ]);
  });

  it('does not warn about bundles already expired or used up', () => {
    expect(bundleWarnings(summariseBundle(bundle({ expires_at: '2026-10-01T00:00:00Z' }), NOW))).toEqual([]);
    expect(bundleWarnings(summariseBundle(bundle({ remaining_sessions: 0 }), NOW))).toEqual([]);
    expect(expiryLabel(summariseBundle(bundle({ expires_at: '2026-10-01T00:00:00Z' }), NOW))).toBe('Expired 1 Oct 2026');
  });

  it('handles bundles the hub does not know and no expiry', () => {
    const s = summariseBundle(bundle({ package_id: '0', package_name: 'Session Bundle', expires_at: null }), NOW);
    expect(s.category).toBeUndefined();
    expect(s.coversLabel).toBe('Any therapy session');
    expect(expiryLabel(s)).toBe('No expiry date');
  });
});

describe('notUsableReason', () => {
  it('allows a matching bundle', () => {
    expect(notUsableReason(bundle(), 'individual', NOW)).toBeNull();
  });

  it('explains a bundle for another session type', () => {
    expect(notUsableReason(bundle({ package_id: '1370588', package_name: 'Youth Bundle 3 x 60min' }), 'individual', NOW)).toBe(
      'This bundle is for youth therapy, so it can\'t be used for individual therapy sessions.'
    );
  });

  it('never allows assessments or psychiatry', () => {
    expect(notUsableReason(bundle(), 'psychiatry', NOW)).toBe("Bundles can't be used for psychiatry.");
  });

  it('lets unknown bundles pay for any therapy session', () => {
    expect(notUsableReason(bundle({ package_id: '0' }), 'couples', NOW)).toBeNull();
  });

  it('explains expired and used-up bundles', () => {
    expect(notUsableReason(bundle({ expires_at: '2026-10-01T00:00:00Z' }), 'individual', NOW)).toBe('This bundle has expired.');
    expect(notUsableReason(bundle({ remaining_sessions: 0 }), 'individual', NOW)).toBe('All sessions on this bundle are used.');
  });
});

describe('messages', () => {
  it('explains the deduction before booking', () => {
    expect(deductionMessage({ package_name: '6 Session Bundle', remaining_sessions: 4 })).toBe(
      "This booking will use 1 credit from your 6 Session Bundle. You'll have 3 left."
    );
  });

  it('finds the bundle that paid for a hub booking', () => {
    expect(bundleUsedFor('Running late\n\n[Bundle: 6 Session Bundle | Credits remaining: 3/6]')).toBe('6 Session Bundle');
    expect(bundleUsedFor('[Bundle: Couples 3 x 60 min | Credits remaining: 0/3]')).toBe('Couples 3 x 60 min');
    expect(bundleUsedFor('Paid by card')).toBeNull();
    expect(bundleUsedFor(undefined)).toBeNull();
  });

  it('gives the balance after booking', () => {
    expect(balanceMessage('6 Session Bundle', 3)).toBe('You have 3 sessions left on your 6 Session Bundle.');
    expect(balanceMessage('6 Session Bundle', 1)).toBe('You have 1 session left on your 6 Session Bundle.');
    expect(balanceMessage('6 Session Bundle', 0)).toBe('That was the last session on your 6 Session Bundle.');
  });
});
