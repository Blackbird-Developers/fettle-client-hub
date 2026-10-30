import { describe, expect, it } from 'vitest';
import { bundleProblem, couponProblem, shouldCheckAsBundle, supportMailto } from './codeProblem';

describe('shouldCheckAsBundle', () => {
    it('re-checks codes Stripe and the rewards did not recognise', () => {
        expect(shouldCheckAsBundle('unknown_code')).toBe(true);
        expect(shouldCheckAsBundle('acuity_expired')).toBe(true);
        expect(shouldCheckAsBundle('acuity_not_applicable')).toBe(true);
    });

    it('leaves recognised discount codes alone', () => {
        expect(shouldCheckAsBundle('promo_expired')).toBe(false);
        expect(shouldCheckAsBundle('not_earned')).toBe(false);
        expect(shouldCheckAsBundle(null)).toBe(false);
    });
});

describe('bundleProblem', () => {
    it.each([
        ['wrong_email', 'This bundle is registered to a different email'],
        ['used_up', 'All sessions on this bundle are used'],
        ['not_applicable', 'This bundle is for a different session type'],
        ['expired', 'This bundle has expired'],
    ])('titles %s', (reason, title) => {
        const p = bundleProblem('704E3907', { reason, message: 'From the server.' });
        expect(p).toEqual({ code: '704E3907', reason, title, message: 'From the server.' });
    });

    it('falls back to a support message when the server gave none', () => {
        const p = bundleProblem('X1', null);
        expect(p.reason).toBe('unknown');
        expect(p.message).toContain('hello@fettle.ie');
    });

    it('uses the coupon wording when Acuity says it is a discount code', () => {
        const p = bundleProblem('SAVE10', { reason: 'discount_code', message: 'x' }, 'acuity_expired');
        expect(p).toEqual(couponProblem('SAVE10', 'acuity_expired'));
        expect(p.message).toBe('This code has expired.');
    });
});

describe('couponProblem', () => {
    it('has a default for unknown reasons', () => {
        expect(couponProblem('A', 'something_new').message).toBe("This code couldn't be applied.");
    });
});

describe('supportMailto', () => {
    it('fills in the code and the problem', () => {
        const link = supportMailto(bundleProblem('704E3907', { reason: 'used_up', message: 'm' }));
        expect(link.startsWith('mailto:hello@fettle.ie?subject=')).toBe(true);
        expect(decodeURIComponent(link)).toContain('704E3907');
        expect(decodeURIComponent(link)).toContain('All sessions on this bundle are used');
    });
});
