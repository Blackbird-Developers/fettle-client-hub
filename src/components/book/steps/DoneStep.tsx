import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Check } from 'lucide-react';
import { track } from '@/lib/booking/analytics';
import { formatSlot, parseSlotTime } from '@/lib/booking/time';
import { useWizard } from '../context';
import { StepHeader } from '../parts';

const SOURCES = ['Google', 'Social media', 'Friend or family', 'GP or healthcare provider', 'Insurance provider', 'Other'];

function gcalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** "Add to Google Calendar" link with the session's real length (§3.7). */
function googleCalendarUrl(therapistName: string, slot: string, minutes: number): string {
  const start = parseSlotTime(slot);
  const end = new Date(start.getTime() + minutes * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Fettle session with ${therapistName}`,
    dates: `${gcalDate(start)}/${gcalDate(end)}`,
    details: 'Your online session link will be sent by text and email before the session.',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function DoneStep() {
  const w = useWizard();
  const booked = w.booked;
  const [source, setSource] = useState<string | null>(null);
  if (!booked) return null;
  const first = booked.therapistName.split(/\s+/)[0];
  const remaining = booked.bundleRemaining;

  return (
    <>
      <div className="bw-done-tick" aria-hidden="true">
        <Check className="h-9 w-9" strokeWidth={3} />
      </div>
      <StepHeader
        heading={`You’re booked, ${booked.firstName}!`}
        sub={`${formatSlot(booked.slot)} with ${booked.therapistName}. A confirmation is on its way to ${booked.email}.`}
        headingRef={w.headingRef}
      />
      {typeof remaining === 'number' && (
        <p className="bw-note">
          {remaining} {remaining === 1 ? 'session' : 'sessions'} left in your bundle
        </p>
      )}
      {booked.unverified && (
        <p className="bw-note is-orange" role="status">
          Your payment was received and your booking is being finalised. If no confirmation email arrives within the hour,
          please contact hello@fettle.ie. Please don’t book again.
        </p>
      )}
      {booked.paymentIssue && (
        <p className="bw-note is-orange" role="alert">
          Your session is booked, but we couldn’t finalise the payment. Our team will be in touch. Please don’t book again.
        </p>
      )}
      <ol className="bw-steps-list">
        <li>
          <span>
            <strong className="block">Check your inbox</strong>
            <span className="bw-option-desc">Your confirmation email has the date, time and how to manage your booking.</span>
          </span>
        </li>
        <li>
          <span>
            <strong className="block">Look out for your session link</strong>
            <span className="bw-option-desc">We’ll text and email your secure log-in details before the session.</span>
          </span>
        </li>
        <li>
          <span>
            <strong className="block">Meet {first} online</strong>
            <span className="bw-option-desc">Find a quiet, private spot. That’s all you need.</span>
          </span>
        </li>
      </ol>
      <div className="bw-actions" style={{ position: 'static', margin: '32px 0 0', padding: 0, background: 'none' }}>
        <a
          className="bw-btn bw-btn-primary"
          href={googleCalendarUrl(booked.therapistName, booked.slot, booked.minutes)}
          target="_blank"
          rel="noreferrer"
        >
          <CalendarPlus className="h-5 w-5" /> Add to Google Calendar
        </a>
        <Link className="bw-btn bw-btn-ghost" to="/sessions">
          Go to my sessions
        </Link>
        <Link className="bw-link" to="/dashboard">
          Back to dashboard
        </Link>
      </div>
      <div className="mt-10">
        <p className="bw-label mb-3">{source ? 'Thanks for letting us know!' : 'One last thing: how did you hear about Fettle? (optional)'}</p>
        <div className="bw-chips" role="group" aria-label="How did you hear about Fettle?">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              className="bw-chip"
              aria-pressed={source === s}
              onClick={() => {
                setSource(s);
                track('booking_referral_source', booked.therapistName, { referral_source: s });
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
