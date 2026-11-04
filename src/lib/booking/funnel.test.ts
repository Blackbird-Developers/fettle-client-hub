// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FUNNEL_IDLE_MS,
  captureFunnelSessionFromUrl,
  flushFunnel,
  funnelSessionId,
  resetFunnelForTests,
  sendFunnelEvent,
  trackBundlePurchased,
} from './funnel';
import { track } from './analytics';

type Sent = { session_id: string; flow: string; events: Record<string, unknown>[] };

let sent: Sent[];

async function readBlob(blob: Blob): Promise<string> {
  return typeof blob.text === 'function'
    ? blob.text()
    : new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsText(blob);
      });
}

let pending: Promise<void>[];

beforeEach(() => {
  sessionStorage.clear();
  resetFunnelForTests();
  sent = [];
  pending = [];
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: vi.fn((url: string, blob: Blob) => {
      expect(url).toBe('https://example.supabase.co/functions/v1/track-booking-funnel');
      expect(blob.type).toContain('text/plain');
      pending.push(readBlob(blob).then((t) => { sent.push(JSON.parse(t)); }));
      return true;
    }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function flushed(): Promise<Sent[]> {
  flushFunnel();
  await Promise.all(pending);
  return sent;
}

describe('funnel session id', () => {
  it('is kept for 45 idle minutes, then renewed', () => {
    const a = funnelSessionId(1_000);
    expect(funnelSessionId(1_000 + FUNNEL_IDLE_MS - 1)).toBe(a);
    expect(funnelSessionId(1_000 + 2 * FUNNEL_IDLE_MS + 1)).not.toBe(a);
  });

  it("adopts the website's id from ?fs=", () => {
    captureFunnelSessionFromUrl('?fs=fs_website123456', Date.now());
    expect(funnelSessionId()).toBe('fs_website123456');
  });

  it('ignores a malformed ?fs=', () => {
    captureFunnelSessionFromUrl('?fs=<script>', Date.now());
    expect(funnelSessionId()).not.toBe('<script>');
  });
});

describe('sending', () => {
  it('forwards wizard events from track() without personal data', async () => {
    track('booking_step_view', 'Lisa Kelly', { step_name: 'slot', step: 2 });
    track('consultation_reserved', 'Lisa Kelly', { client_email: 'a@b.ie' });
    track('booking_completed', 'Lisa Kelly', { booking_id: '123', amount: 95, Email: 'a@b.ie' });
    const batches = await flushed();
    const events = batches.flatMap((b) => b.events);
    expect(batches[0].flow).toBe('hub');
    expect(events.map((e) => e.event)).toEqual(['booking_step_view', 'booking_completed']);
    expect(events[0]).toMatchObject({ booking_flow: 'hub_quiz', therapist: 'Lisa Kelly', step_name: 'slot', step: 2 });
    expect(JSON.stringify(batches)).not.toContain('a@b.ie');
  });

  it('ignores events outside the funnel', async () => {
    sendFunnelEvent('something_else', {});
    expect(await flushed()).toEqual([]);
  });

  it('keys bundle purchases on the PaymentIntent and marks website hand-offs', async () => {
    captureFunnelSessionFromUrl('?fs=fs_website123456', Date.now());
    trackBundlePurchased('pi_3ABC', { package_id: '6 sessions', amount: 528 });
    const [batch] = await flushed();
    expect(batch.session_id).toBe('fs_website123456');
    expect(batch.events[0]).toMatchObject({
      event: 'booking_bundle_purchased',
      event_id: 'bp_pi_3ABC',
      booking_flow: 'website_bundle_handoff',
      package_id: '6 sessions',
      amount: 528,
    });
  });

  it('never throws when the beacon fails', () => {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => { throw new Error('blocked'); } });
    expect(() => {
      sendFunnelEvent('booking_completed', {});
      flushFunnel();
    }).not.toThrow();
  });
});
