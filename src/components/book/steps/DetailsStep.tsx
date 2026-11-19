import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { track } from '@/lib/booking/analytics';
import { type BookingDetails, DETAILS_FIELD_ORDER, type DetailsErrors, hasCompleteContact, validateDetails } from '@/lib/booking/details';
import { PhoneInput } from '@/components/PhoneInput';
import { useWizard } from '../context';
import { ActionBar, StepHeader } from '../parts';

type FieldKey = keyof BookingDetails;

export function DetailsStep() {
  const w = useWizard();
  const d = w.state.details;
  const youth = w.service === 'youth';
  const couples = w.service === 'couples';
  const [errors, setErrors] = useState<DetailsErrors>({});
  const formRef = useRef<HTMLDivElement>(null);
  const compact = hasCompleteContact(d) && !w.state.editingContact;

  // Desktop: start in the first field rather than on the heading (§12).
  useEffect(() => {
    if (!window.matchMedia('(min-width: 761px)').matches) return;
    const first = formRef.current?.querySelector<HTMLInputElement>('input, textarea');
    first?.focus({ preventScroll: true });
  }, [compact]);

  const set = (key: FieldKey, value: string) => {
    w.update((s) => ({ ...s, details: { ...s.details, [key]: value } }));
    if (errors[key as keyof DetailsErrors]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = () => {
    const found = validateDetails(d, w.service ?? 'individual');
    setErrors(found);
    const bad = DETAILS_FIELD_ORDER.find((k) => found[k]);
    if (bad) {
      if (bad !== 'partnerName' && compact) w.update((s) => ({ ...s, editingContact: true }));
      requestAnimationFrame(() => {
        const el = document.getElementById(`bw-${bad}`);
        el?.focus();
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    w.update((s) => ({
      ...s,
      details: Object.fromEntries(Object.entries(s.details).map(([k, v]) => [k, v.trim()])) as unknown as BookingDetails,
    }));
    track('booking_details_submitted', w.therapistName || null, { package_id: null, who: w.service });
    w.goNext();
  };

  const field = (
    key: FieldKey,
    label: string,
    placeholder: string,
    opts: { type?: string; autoComplete?: string; full?: boolean; locked?: string } = {}
  ) => {
    const error = errors[key as keyof DetailsErrors];
    const describedBy = [error && `bw-${key}-err`, opts.locked && `bw-${key}-note`].filter(Boolean).join(' ');
    return (
      <div className={`bw-field${opts.full ? ' is-full' : ''}`}>
        <label className="bw-label" htmlFor={`bw-${key}`}>
          {label}
        </label>
        <input
          id={`bw-${key}`}
          className={`bw-input${error ? ' is-bad' : ''}`}
          type={opts.type ?? 'text'}
          autoComplete={opts.autoComplete}
          placeholder={placeholder}
          value={d[key]}
          readOnly={!!opts.locked}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          onChange={(e) => set(key, e.target.value)}
        />
        {opts.locked && (
          <span className="bw-field-note" id={`bw-${key}-note`}>
            {opts.locked}
          </span>
        )}
        {error && (
          <span className="bw-error" id={`bw-${key}-err`}>
            {error}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <StepHeader
        eyebrow="Almost there"
        heading={youth ? 'Your details as parent or guardian' : 'Great. Where should we send your confirmation?'}
        sub={`We’ll use these to confirm your booking and send your session link.${youth ? ' We’ll contact you, not your child.' : ''}`}
        headingRef={w.headingRef}
      />
      <div className="bw-body" ref={formRef}>
        {compact ? (
          <div className="bw-strip" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className="min-w-0" style={{ overflowWrap: 'anywhere' }}>
              <span className="bw-review-label block">Booking for</span>
              <strong>
                {d.firstName} {d.lastName}
              </strong>{' '}
              · {d.email} · {d.phone}
            </span>
            <button type="button" className="bw-link" onClick={() => w.update((s) => ({ ...s, editingContact: true }))}>
              Edit
            </button>
          </div>
        ) : null}
        <div className="bw-form">
          {!compact && (
            <>
              {field('firstName', 'First name', 'e.g. Sarah', { autoComplete: 'given-name' })}
              {field('lastName', 'Last name', 'e.g. Byrne', { autoComplete: 'family-name' })}
              {field('email', 'Email', 'you@example.com', {
                type: 'email',
                autoComplete: 'email',
                full: true,
                locked: 'This is your My Fettle email, so the session appears in My sessions.',
              })}
              <div className="bw-field is-full">
                <label className="bw-label" htmlFor="bw-phone">
                  Mobile number
                </label>
                <PhoneInput
                  id="bw-phone"
                  value={d.phone}
                  onChange={(v) => set('phone', v)}
                  selectClassName={`bw-input${errors.phone ? ' is-bad' : ''}`}
                  inputClassName={`bw-input${errors.phone ? ' is-bad' : ''}`}
                  invalid={!!errors.phone}
                  describedBy={errors.phone ? 'bw-phone-err bw-phone-note' : 'bw-phone-note'}
                />
                <span className="bw-field-note" id="bw-phone-note">
                  We may call this number about your booking, so please double-check it.
                </span>
                {errors.phone && (
                  <span className="bw-error" id="bw-phone-err">
                    {errors.phone}
                  </span>
                )}
              </div>
            </>
          )}
          {couples && field('partnerName', 'Your partner’s name (and pronouns)', 'e.g. Alex Byrne (he/him)', { full: true })}
          {youth && field('youngPersonName', 'Young person’s first name (optional)', 'e.g. Jamie', { full: true })}
          <div className="bw-field is-full">
            <label className="bw-label" htmlFor="bw-note">
              Anything you’d like {w.therapistFirst} to know? (optional)
            </label>
            <textarea
              id="bw-note"
              className="bw-input"
              rows={3}
              placeholder="You can share as much or as little as you like."
              value={d.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </div>
        </div>
        <p className="bw-privacy inline-flex items-center gap-1.5">
          <Lock className="h-4 w-4" /> Your details are confidential and only shared with your therapist.
        </p>
      </div>
      <ActionBar label="Continue to payment →" enabled onContinue={submit} showEnterHint={false} />
    </>
  );
}
