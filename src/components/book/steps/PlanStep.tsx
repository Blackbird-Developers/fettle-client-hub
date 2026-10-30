import { useEffect, useState } from 'react';
import { Check, Tag, Ticket } from 'lucide-react';
import { AddBundleCode } from '@/components/bundles/AddBundleCode';
import { BundleCard } from '@/components/bundles/BundleCard';
import { notUsableReason } from '@/lib/bundles';
import { formatEuro } from '@/lib/sessionBundles';
import { track } from '@/lib/booking/analytics';
import { CREDIT_PLAN_ID } from '@/lib/booking/payment';
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

  const credits = w.credits && w.credits.remaining > 0 ? w.credits : null;
  const [showCodeForm, setShowCodeForm] = useState(false);

  // The client's bundles: those that can pay for this session, and the rest
  // with the reason they can't (shown rather than hidden).
  const usable = w.activeBundles.filter((pkg) => notUsableReason(pkg, service) === null);
  const others = w.activeBundles
    .map((pkg) => ({ pkg, reason: notUsableReason(pkg, service) }))
    .filter((b): b is { pkg: (typeof b)['pkg']; reason: string } => b.reason !== null);
  const chosenBundleId = w.state.creditPackageId ?? w.credits?.packageId ?? null;

  // Unused bundle credits start selected (§10.2), otherwise the recommended plan.
  useEffect(() => {
    if (!selectedId) w.update((s) => ({ ...s, planId: credits ? CREDIT_PLAN_ID : rec.id }));
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
          {credits && (
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === CREDIT_PLAN_ID}
              aria-pressed={selectedId === CREDIT_PLAN_ID}
              className="bw-plan"
              onClick={() => {
                w.update((s) => ({ ...s, planId: CREDIT_PLAN_ID }));
                track('booking_plan_selected', w.therapistName || null, { package_id: CREDIT_PLAN_ID });
              }}
            >
              <span className={`bw-tick${selectedId === CREDIT_PLAN_ID ? ' is-on' : ''}`} aria-hidden="true" style={{ marginTop: 2 }}>
                <Check className="h-4 w-4" strokeWidth={3} />
              </span>
              <span className="bw-plan-main">
                <span className="bw-option-title">
                  Use 1 of your {credits.remaining} remaining session{credits.remaining === 1 ? '' : 's'}
                </span>
                <span className="bw-option-desc">From the bundle on your account</span>
              </span>
              <span className="bw-plan-price">
                <span className="bw-plan-per">{formatEuro(0)}</span>
                <span className="bw-option-desc">Nothing to pay</span>
              </span>
            </button>
          )}
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
        {/* Which bundle the session comes from, and bundles that don't fit. */}
        {credits && selectedId === CREDIT_PLAN_ID && usable.length > 0 && (
          <div className="mt-4 grid gap-2">
            {usable.length > 1 && <p className="bw-option-desc">Choose which bundle to use</p>}
            {usable.map((pkg) => (
              <BundleCard
                key={pkg.id}
                bundle={pkg}
                selected={pkg.id === chosenBundleId}
                onSelect={
                  usable.length > 1 ? () => w.update((s) => ({ ...s, creditPackageId: pkg.id })) : undefined
                }
              />
            ))}
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-4 grid gap-2">
            <p className="bw-option-desc">Can’t be used for this session</p>
            {others.map(({ pkg, reason }) => (
              <BundleCard key={pkg.id} bundle={pkg} unusableReason={reason} />
            ))}
          </div>
        )}

        {/* "Have a bundle? Add your code" (bought on fettle.ie, or from the clinic). */}
        <div className="mt-4">
          <button
            type="button"
            className="bw-link inline-flex items-center gap-1.5"
            aria-expanded={showCodeForm}
            onClick={() => setShowCodeForm((v) => !v)}
          >
            <Ticket className="h-4 w-4" /> Have a bundle? Add your code
          </button>
          {showCodeForm && (
            <AddBundleCode
              inputId="bw-bundle-code"
              className="mt-3"
              onLinked={(bundle) => {
                setShowCodeForm(false);
                w.markCreditsChanged();
                const sessionsText = `${bundle.remainingSessions} session${bundle.remainingSessions === 1 ? '' : 's'}`;
                if (!bundle.category || bundle.category === service) {
                  w.update((s) => ({ ...s, planId: CREDIT_PLAN_ID, creditPackageId: bundle.packageId ?? s.creditPackageId }));
                  w.showMessage({
                    kind: 'success',
                    title: bundle.alreadyLinked ? 'Bundle found on your account' : 'Bundle added to your account',
                    text: `${bundle.packageName}: ${sessionsText} left. We’ll use one for this booking, with nothing to pay.`,
                  });
                } else {
                  w.showMessage({
                    kind: 'info',
                    title: bundle.alreadyLinked ? 'Bundle found on your account' : 'Bundle added to your account',
                    text: `${bundle.packageName} is for ${bundle.categoryLabel ?? 'another session type'}, so it can’t be used for this session. You can use it when you book one of those.`,
                  });
                }
              }}
            />
          )}
        </div>

        {!w.state.showMorePlans && hidden.length > 0 && (
          <p className="mt-4">
            <button type="button" className="bw-link" onClick={() => w.update((s) => ({ ...s, showMorePlans: true }))}>
              Looking for longer-term support? See {hidden.length} more option{hidden.length === 1 ? '' : 's'}
            </button>
          </p>
        )}
        {!credits && <p className="bw-note is-orange">{recommendationReason(service, rec, w.therapistFirst)}</p>}
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
