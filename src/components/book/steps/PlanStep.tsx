import { useEffect } from 'react';
import { Check, Tag } from 'lucide-react';
import { formatEuro } from '@/lib/sessionBundles';
import { track } from '@/lib/booking/analytics';
import { type BookingPlan, recommendationReason, recommendedPlan } from '@/lib/booking/plans';
import type { TherapyService } from '@/lib/booking/therapists';
import { formatLongDate, formatSlotTime, slotDateKey } from '@/lib/booking/time';
import { useWizard } from '../context';
import { ActionBar, StepHeader, WizardAvatar } from '../parts';

export function PlanStep() {
  const w = useWizard();
  const service = w.service as TherapyService;
  const rec = recommendedPlan(service, w.state.history, w.plans);
  const selectedId = w.state.planId;

  // The recommended plan starts selected.
  useEffect(() => {
    if (!selectedId) w.update((s) => ({ ...s, planId: rec.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (plan: BookingPlan) => {
    w.update((s) => ({ ...s, planId: plan.id }));
    track('booking_plan_selected', w.therapistName || null, { package_id: plan.id });
  };

  const hidden = w.plans.filter((p) => p.more && p.id !== selectedId);
  const visible = w.plans.filter((p) => !p.more || p.id === selectedId || w.state.showMorePlans);
  const slot = w.state.slot;

  return (
    <>
      <StepHeader
        eyebrow="Your plan"
        eyebrowIcon={<Tag className="h-4 w-4" />}
        heading="How would you like to start?"
        sub={
          slot
            ? `Pay as you go for ${formatLongDate(slotDateKey(slot))} at ${formatSlotTime(slot)}, or save with a bundle.`
            : 'Pay as you go, or save with a bundle.'
        }
        headingRef={w.headingRef}
      />
      <div className="bw-body">
        <div className="bw-strip">
          <WizardAvatar name={w.therapistName} imageUrl={w.therapist?.imageurl} size={44} />
          <span className="min-w-0">
            <strong className="block">Sessions with {w.therapistName}</strong>
            <span className="bw-option-desc">{w.minutes} minutes, online · insurance receipts provided</span>
          </span>
        </div>
        <div className="grid gap-4" role="radiogroup" aria-label="Plans">
          {visible.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              minutes={w.minutes}
              recommended={plan.id === rec.id}
              selected={plan.id === selectedId}
              onSelect={() => select(plan)}
            />
          ))}
        </div>
        {!w.state.showMorePlans && hidden.length > 0 && (
          <p className="mt-4">
            <button type="button" className="bw-link" onClick={() => w.update((s) => ({ ...s, showMorePlans: true }))}>
              Looking for longer-term support? See {hidden.length} more option{hidden.length === 1 ? '' : 's'}
            </button>
          </p>
        )}
        <p className="bw-note is-orange">{recommendationReason(service, rec, w.therapistFirst)}</p>
      </div>
      <ActionBar
        label="Continue →"
        enabled={!!selectedId}
        onContinue={() => {
          track('booking_plan_confirmed', w.therapistName || null, { package_id: selectedId });
          w.goNext();
        }}
      />
    </>
  );
}

function PlanRow({
  plan,
  minutes,
  recommended,
  selected,
  onSelect,
}: {
  plan: BookingPlan;
  minutes: number;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = recommended ? 'Recommended for you' : plan.flag;
  const sessionsLine = `${plan.sessions} x ${minutes}-minute session${plan.sessions === 1 ? '' : 's'} · ${plan.tagLine}`;
  return (
    <button type="button" role="radio" aria-checked={selected} aria-pressed={selected} className="bw-plan" onClick={onSelect}>
      {badge && <span className={`bw-plan-badge${recommended ? ' is-recommended' : ''}`}>{badge}</span>}
      <span className={`bw-tick${selected ? ' is-on' : ''}`} aria-hidden="true" style={{ marginTop: 2 }}>
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
      <span className="bw-plan-main">
        <span className="bw-option-title">{plan.title}</span>
        <span className="bw-option-desc">{sessionsLine}</span>
        {selected && (
          <ul className="bw-features">
            {plan.features.map((f) => (
              <li key={f}>
                <Check className="h-4 w-4" strokeWidth={3} /> {f}
              </li>
            ))}
          </ul>
        )}
      </span>
      <span className="bw-plan-price">
        <span className="bw-plan-per">{formatEuro(plan.perSession)}</span>
        <span className="bw-option-desc" style={{ display: 'inline' }}>
          {' '}
          / session
        </span>
        <span className="bw-option-desc">
          {plan.bundle ? (
            <>
              {formatEuro(plan.total)} total<span className="bw-save">Save {formatEuro(plan.save)}</span>
            </>
          ) : (
            'Pay as you go'
          )}
        </span>
      </span>
    </button>
  );
}
