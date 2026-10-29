import { type ReactNode, useState } from 'react';
import { CalendarDays, CheckCircle2, Mail, Tag, User, Users } from 'lucide-react';
import { formatEuro } from '@/lib/sessionBundles';
import { track } from '@/lib/booking/analytics';
import { normaliseCouponCode } from '@/lib/booking/coupon';
import { formatSlot, formatSlotTime, slotDateKey } from '@/lib/booking/time';
import { type Consents, type StepId, consentsComplete } from '@/lib/booking/wizard';
import { useWizard } from '../context';
import { ActionBar, StepHeader } from '../parts';

function Row({
  icon,
  label,
  value,
  onEdit,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div className="bw-review-row">
      <span className="bw-option-icon" style={{ width: 40, height: 40 }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="bw-review-label block">{label}</span>
        <span className="bw-review-value block">{value}</span>
      </span>
      {onEdit && (
        <button type="button" className="bw-link" onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`}>
          Edit
        </button>
      )}
    </div>
  );
}

/** Whether the discount-code field applies: single therapy sessions only (§3.5b hub notes). */
function acceptsCoupon(service: string | null, isBundle: boolean): boolean {
  return service !== 'psychologist' && !isBundle;
}

export function ReviewStep() {
  const w = useWizard();
  const s = w.state;
  const youth = w.service === 'youth';
  const psych = w.service === 'psychologist';
  const plan = w.selectedPlan;
  const isBundle = !!plan?.bundle;
  const [code, setCode] = useState(s.coupon);
  const [codeSaved, setCodeSaved] = useState(!!s.coupon);
  const [showConsentError, setShowConsentError] = useState(false);

  const editStep = (step: StepId) => (w.steps.includes(step) ? () => w.editFromReview(step) : undefined);
  const therapistEdit = w.mode === 'chosen' ? editStep('intro') : editStep('matches');

  const applyCode = () => {
    const normalised = normaliseCouponCode(code);
    setCode(normalised);
    w.update((st) => ({ ...st, coupon: normalised }));
    setCodeSaved(!!normalised);
  };

  const setConsent = (key: keyof Consents, value: boolean) =>
    w.update((st) => ({ ...st, consents: { ...st.consents, [key]: value } }));

  const onContinue = () => {
    if (!consentsComplete(s.consents)) {
      setShowConsentError(true);
      return;
    }
    if (code.trim() && normaliseCouponCode(code) !== s.coupon) applyCode();
    const slot = s.slot ?? '';
    track('booking_payment_initiated', w.therapistName || null, {
      package_id: s.planId,
      package_title: plan?.title,
      package_price: plan?.total,
      amount: w.total,
      currency: 'EUR',
      selected_date: slot ? slotDateKey(slot) : null,
      selected_time: slot ? formatSlotTime(slot) : null,
    });
    w.goNext();
  };

  const totalNote = psych
    ? '30-minute clinical consultation'
    : isBundle && plan
      ? `${formatEuro(plan.perSession)} per session · you save ${formatEuro(plan.save)}`
      : 'Pay per session, no commitment';

  const consentRow = (key: keyof Consents, content: ReactNode) => {
    const bad = showConsentError && !s.consents[key];
    return (
      <label className={`bw-check${bad ? ' is-bad' : ''}`}>
        <input
          type="checkbox"
          checked={s.consents[key]}
          aria-invalid={bad}
          onChange={(e) => setConsent(key, e.target.checked)}
        />
        <span>{content}</span>
      </label>
    );
  };

  return (
    <>
      <StepHeader
        eyebrow="Review"
        eyebrowIcon={<CheckCircle2 className="h-4 w-4" />}
        heading="Everything look right?"
        sub="Check your booking, then continue to secure payment."
        headingRef={w.headingRef}
      />
      <div className="bw-body">
        <Row icon={<User className="h-5 w-5" />} label="Therapist" value={w.therapistName} onEdit={therapistEdit} />
        <Row
          icon={<CalendarDays className="h-5 w-5" />}
          label="Date and time"
          value={s.slot ? `${formatSlot(s.slot)} (Irish time)` : ''}
          onEdit={editStep('slot')}
        />
        <Row
          icon={<Tag className="h-5 w-5" />}
          label={psych ? 'Consultation' : 'Plan'}
          value={plan?.title ?? ''}
          onEdit={psych ? editStep('consultation') : editStep('plan')}
        />
        <Row
          icon={<Mail className="h-5 w-5" />}
          label={youth ? 'Parent or guardian' : 'Your details'}
          value={`${s.details.firstName} ${s.details.lastName} · ${s.details.email}`}
          onEdit={editStep('details')}
        />
        {w.service === 'couples' && (
          <Row icon={<Users className="h-5 w-5" />} label="Partner" value={s.details.partnerName} onEdit={editStep('details')} />
        )}

        <div className="bw-total">
          <div className="bw-total-line">
            <span>Total due today</span>
            <span>{formatEuro(w.total)}</span>
          </div>
          <p className="bw-option-desc">{totalNote}</p>
        </div>

        {acceptsCoupon(w.service, isBundle) && (
          <div className="bw-field mt-6">
            <label className="bw-label" htmlFor="bw-coupon">
              Have a discount code?
            </label>
            <div className="flex gap-2">
              <input
                id="bw-coupon"
                className="bw-input"
                value={code}
                autoComplete="off"
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    applyCode();
                  }
                }}
              />
              <button type="button" className="bw-btn bw-btn-ghost" onClick={applyCode} disabled={!code.trim()}>
                Apply
              </button>
            </div>
            {codeSaved && s.coupon && (
              <span className="bw-option-desc" role="status">
                Code saved. Your total is confirmed on the next step.
              </span>
            )}
          </div>
        )}

        <div className="mt-6 grid gap-3">
          {consentRow(
            'first',
            youth
              ? 'I am the parent or legal guardian of the young person attending.'
              : 'I confirm I am over 18. This service is for over 18s only.'
          )}
          {consentRow(
            'contact',
            'I agree to be contacted by email and text by Fettle. Texts are how we send your session log-in details.'
          )}
          {consentRow(
            'terms',
            <>
              I accept the{' '}
              <a className="bw-link" href="https://www.fettle.ie/terms-of-use" target="_blank" rel="noreferrer">
                terms of use
              </a>
              , including the 48-hour cancellation policy.
            </>
          )}
          {showConsentError && !consentsComplete(s.consents) && (
            <p className="bw-error" role="alert">
              Please tick all three boxes to continue.
            </p>
          )}
        </div>
      </div>
      <ActionBar label="Continue to payment →" enabled onContinue={onContinue} showEnterHint={false} />
    </>
  );
}
