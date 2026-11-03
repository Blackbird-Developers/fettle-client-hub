import { describe, expect, it } from 'vitest';
import { notificationDetailLines, unreadCount } from './adminNotifications';

describe('notificationDetailLines', () => {
  it('lists what staff need for a refused bundle code', () => {
    const lines = notificationDetailLines({
      kind: 'bundle_code_refused',
      details: {
        code: '704E3907',
        reason: 'wrong_email',
        appointmentTypeID: 123,
        certificateEmail: 'other@example.com',
        acuityErrors: ['400 invalid_certificate email mismatch'],
        expiration: null,
      },
    });
    expect(lines).toEqual([
      'Code: 704E3907',
      'Bundle email in Acuity: other@example.com',
      'Session type tried: Acuity type 123',
      'Acuity said: 400 invalid_certificate email mismatch',
    ]);
  });

  it('copes with missing or odd details', () => {
    expect(notificationDetailLines({ kind: 'bundle_code_refused', details: null })).toEqual([]);
    expect(notificationDetailLines({ kind: 'something_else', details: { code: 'X' } })).toEqual([]);
  });
});

describe('unreadCount', () => {
  it('counts rows without read_at', () => {
    expect(unreadCount(undefined)).toBe(0);
    expect(unreadCount([{ read_at: null }, { read_at: '2026-10-30T10:00:00Z' }, { read_at: null }])).toBe(2);
  });
});
