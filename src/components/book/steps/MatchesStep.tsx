import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Check, Sparkles } from 'lucide-react';
import { findEarliestSlot } from '@/lib/booking/availability';
import { type EarliestDay, rankTherapists } from '@/lib/booking/matching';
import {
  type TherapistRow,
  type TherapyService,
  calendarIdOf,
  firstNameOf,
  sessionTypeId,
  therapistTags,
} from '@/lib/booking/therapists';
import { dublinDateKey, formatShortDate, formatSlotTime } from '@/lib/booking/time';
import { withTherapist } from '@/lib/booking/wizard';
import { useWizard } from '../context';
import { ActionBar, StepHeader, WizardAvatar } from '../parts';

const PAGE = 3;
// Give up waiting for availability after this long and show the cards anyway.
const SETTLE_TIMEOUT_MS = 6000;

export function MatchesStep() {
  const w = useWizard();
  const service = (w.state.who ?? 'individual') as TherapyService;
  const today = dublinDateKey(new Date());

  // Topic and pinned score only; the earliest-time bonus is added once known.
  const candidates = useMemo(
    () => rankTherapists(w.therapists, service, w.state.topics, {}, today, w.publicTypeIds),
    [w.therapists, service, w.state.topics, today, w.publicTypeIds]
  );

  const [order, setOrder] = useState<string[]>([]);
  const probeCount = Math.min(candidates.length, Math.max(order.length, w.state.matchCount) + PAGE);
  const probed = candidates.slice(0, probeCount);

  const earliest = useQueries({
    queries: probed.map(({ therapist }) => {
      const typeId = sessionTypeId(therapist, service);
      const calendarId = calendarIdOf(therapist);
      return {
        queryKey: ['book-earliest', typeId, calendarId],
        queryFn: () => findEarliestSlot({ typeId: typeId!, calendarId }),
        enabled: !!typeId,
        staleTime: 5 * 60_000,
        retry: 0,
      };
    }),
  });

  const earliestById: Record<string, EarliestDay> = {};
  const slotById: Record<string, { date: string; time: string } | null | undefined> = {};
  probed.forEach(({ therapist }, i) => {
    const q = earliest[i];
    const id = String(therapist.id);
    // A failed lookup shows "Limited availability" but isn't scored as "no times".
    slotById[id] = q?.isSuccess ? q.data : q?.isError ? null : undefined;
    earliestById[id] = q?.isSuccess ? (q.data ? q.data.date : null) : undefined;
  });
  const settled = earliest.every((q) => !q.isLoading);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [probeCount]);

  // Freeze the order of cards the client has seen; append new ones ranked with what's known.
  const earliestKey = JSON.stringify(earliestById);
  useEffect(() => {
    if (order.length >= w.state.matchCount || order.length >= candidates.length) return;
    if (!settled && !timedOut) return;
    const pool = probed.map((c) => c.therapist).filter((t) => !order.includes(String(t.id)));
    const ranked = rankTherapists(pool, service, w.state.topics, earliestById, today, w.publicTypeIds);
    setOrder((prev) => [...prev, ...ranked.map((r) => String(r.therapist.id))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, timedOut, w.state.matchCount, candidates.length, earliestKey]);

  const byId = new Map(candidates.map((c) => [String(c.therapist.id), c]));
  const shown = order
    .slice(0, w.state.matchCount)
    .map((id) => byId.get(id))
    .filter((c): c is (typeof candidates)[number] => !!c);
  const loadingCards = order.length === 0 && candidates.length > 0;

  const heading =
    candidates.length === 0
      ? 'No therapists available'
      : candidates.length <= 2
        ? 'We found your matches for you'
        : 'We found great matches for you';

  const selected = w.state.therapistId ? byId.get(w.state.therapistId)?.therapist : undefined;

  return (
    <>
      <StepHeader
        eyebrow="Your matches"
        eyebrowIcon={<Sparkles className="h-4 w-4" />}
        heading={heading}
        sub="Based on your answers. Pick the therapist you’d like to see. You’ll choose a time next."
        headingRef={w.headingRef}
      />
      <div className="bw-body bw-options" role="group" aria-label="Therapist matches">
        {loadingCards &&
          Array.from({ length: PAGE }, (_, i) => <div key={i} className="bw-skeleton" style={{ height: 112 }} />)}
        {shown.map((c, i) => (
          <MatchCard
            key={String(c.therapist.id)}
            therapist={c.therapist}
            matched={c.matched.map((t) => t.label)}
            topMatch={i === 0 && c.matched.length > 0}
            next={slotById[String(c.therapist.id)]}
            selected={w.state.therapistId === String(c.therapist.id)}
            onSelect={() => w.update((s) => withTherapist(s, String(c.therapist.id)))}
          />
        ))}
      </div>
      {!loadingCards && candidates.length > w.state.matchCount && (
        <button
          type="button"
          className="bw-btn bw-btn-ghost mt-4"
          onClick={() => w.update((s) => ({ ...s, matchCount: s.matchCount + PAGE }))}
        >
          Show more therapists
        </button>
      )}
      <ActionBar
        label={selected ? `Continue with ${firstNameOf(selected.name)}` : 'Continue with this therapist'}
        enabled={!!selected}
        onContinue={w.goNext}
      />
    </>
  );
}

function MatchCard({
  therapist,
  matched,
  topMatch,
  next,
  selected,
  onSelect,
}: {
  therapist: TherapistRow;
  matched: string[];
  topMatch: boolean;
  next: { date: string; time: string } | null | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const tags = matched.length ? [] : [...therapistTags(therapist)].filter((t) => t !== 'couples').slice(0, 4);
  const availability =
    next === undefined
      ? 'Checking availability…'
      : next
        ? `Next available: ${formatShortDate(next.date)}, ${formatSlotTime(next.time)}`
        : 'Limited availability';
  return (
    <button type="button" className="bw-option" aria-pressed={selected} onClick={onSelect} style={{ alignItems: 'flex-start' }}>
      <WizardAvatar name={therapist.name} imageUrl={therapist.imageurl} size={64} />
      <span className="bw-option-text">
        <span className="bw-option-title">
          {therapist.name}
          {topMatch && (
            <span className="bw-tag is-green ml-2" style={{ verticalAlign: 'middle' }}>
              Top match
            </span>
          )}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {matched.map((label) => (
            <span key={label} className="bw-tag is-green">
              <Check className="h-3 w-3" /> {label}
            </span>
          ))}
          {tags.map((t) => (
            <span key={t} className="bw-tag" style={{ textTransform: 'capitalize' }}>
              {t}
            </span>
          ))}
        </span>
        <span className="bw-option-desc mt-2">{availability}</span>
      </span>
      <span className="bw-tick" aria-hidden="true">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    </button>
  );
}
