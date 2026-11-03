import type { ReactNode } from 'react';
import { BadgeCheck, CheckCircle2, Users } from 'lucide-react';
import { formatEuro } from '@/lib/sessionBundles';
import { CONSULTATION_OPTIONS, WHO_OPTIONS } from '@/lib/booking/content';
import { TOPICS } from '@/lib/booking/matching';
import { accreditationLabel, type TherapyService } from '@/lib/booking/therapists';
import { formatLongDate, formatSlotTime, slotDateKey } from '@/lib/booking/time';
import { phaseOf } from '@/lib/booking/wizard';
import { useWizard } from './context';
import { WizardAvatar } from './parts';

function SumRow({ value }: { value: ReactNode | null }) {
  return (
    <div className="bw-sum-row">
      {value ? (
        <>
          <CheckCircle2 className="h-4 w-4 is-done shrink-0" />
          <span className="min-w-0">{value}</span>
        </>
      ) : (
        <span className="is-empty" aria-hidden="true" />
      )}
    </div>
  );
}

const ASSURANCES = [
  'Accredited, vetted therapists',
  'Online sessions from home',
  'Evenings and weekends available',
  'Insurance receipt after every session',
  'Secure payment by Stripe',
];

/** "Your booking" card beside the steps (under them on phones), §3.8. */
export function SummaryCard({ totalOverride }: { totalOverride?: { amount: number; discounted: boolean } | null }) {
  const w = useWizard();
  const s = w.state;
  const atPayment = phaseOf(w.step) >= 4;
  const badge = accreditationLabel(w.therapist?.Accreditation);

  const whoLabel =
    w.service === 'psychologist'
      ? 'Psychology consultation'
      : w.service
        ? WHO_OPTIONS[w.service as TherapyService].summary
        : null;
  const topics =
    w.mode === 'matching' && w.service && w.service !== 'psychologist'
      ? TOPICS[w.service as TherapyService]
          .filter((t) => s.topics.includes(t.id))
          .map((t) => t.label)
          .join(', ')
      : '';

  const rows: ReactNode[] = [<SumRow key="who" value={whoLabel} />];
  if (w.service === 'psychologist') {
    rows.push(<SumRow key="consult" value={s.consultation ? CONSULTATION_OPTIONS[s.consultation].title : null} />);
  }
  if (w.mode === 'matching') rows.push(<SumRow key="topics" value={topics || null} />);
  rows.push(
    <SumRow
      key="slot"
      value={s.slot ? `${formatLongDate(slotDateKey(s.slot))} · ${formatSlotTime(s.slot)}` : null}
    />
  );
  if (atPayment && w.service !== 'psychologist') rows.push(<SumRow key="plan" value={w.selectedPlan?.title ?? null} />);

  const total = totalOverride ?? { amount: w.total, discounted: false };

  return (
    <aside className="bw-side" aria-label="Your booking">
      <div className="bw-side-card">
        <div className="flex items-center gap-3">
          {w.therapist ? (
            <WizardAvatar name={w.therapistName} imageUrl={w.therapist.imageurl} size={52} />
          ) : (
            <span className="bw-avatar" style={{ width: 52, height: 52 }}>
              <Users className="h-6 w-6" />
            </span>
          )}
          <div className="min-w-0">
            <p className="font-extrabold" style={{ overflowWrap: 'anywhere' }}>
              {w.therapist ? w.therapistName : 'Your therapist'}
            </p>
            {w.therapist ? (
              badge && (
                <span className="bw-tag is-green mt-1">
                  <BadgeCheck className="h-3.5 w-3.5" /> {badge}
                </span>
              )
            ) : (
              <p className="bw-option-desc">Matched to your answers</p>
            )}
          </div>
        </div>
        <p className="bw-sum-title">YOUR BOOKING</p>
        {rows}
        {atPayment && (
          <div className="bw-total-line mt-4 pt-4" style={{ borderTop: '1px solid var(--bw-line-2)' }}>
            <span>{total.discounted ? 'Total after discount' : 'Total'}</span>
            <span>{formatEuro(total.amount)}</span>
          </div>
        )}
      </div>
      <div className="bw-side-card">
        <ul className="bw-assurance">
          {ASSURANCES.map((a) => (
            <li key={a}>
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {a}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
