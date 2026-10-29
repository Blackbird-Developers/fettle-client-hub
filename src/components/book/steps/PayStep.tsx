import { Lock } from 'lucide-react';
import { formatEuro } from '@/lib/sessionBundles';
import { formatLongDate, formatSlotTime, slotDateKey } from '@/lib/booking/time';
import { useWizard } from '../context';
import { StepHeader } from '../parts';

// Payment is wired up in the next build phase (docs/QUIZ_BOOKING_FLOW.md §16, Phase 4).
export function PayStep() {
  const w = useWizard();
  const slot = w.state.slot ?? '';
  return (
    <>
      <StepHeader
        eyebrow="Secure payment"
        eyebrowIcon={<Lock className="h-4 w-4" />}
        heading="Confirm and pay"
        sub={slot ? `${formatLongDate(slotDateKey(slot))} at ${formatSlotTime(slot)} with ${w.therapistName}.` : undefined}
        headingRef={w.headingRef}
      />
      <div className="bw-body">
        <div className="bw-total">
          <div className="bw-total-line">
            <span>Amount to pay</span>
            <span>{formatEuro(w.total)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
