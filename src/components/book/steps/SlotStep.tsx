import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Moon, Sun, Sunset, Zap } from 'lucide-react';
import { useFirstOpenMonth, useMonthSlots } from '@/hooks/useTherapistSlots';
import { MONTHS_AHEAD } from '@/lib/booking/availability';
import {
  type AvailableDay,
  type PartOfDay,
  type TimeOfDayFilter,
  addMonthsToKey,
  defaultDay,
  dublinDateKey,
  earliestSlot,
  formatLongDate,
  formatSlot,
  formatSlotTime,
  groupTimes,
  matchesTimeOfDay,
  slotDateKey,
  visibleTimes,
  weekdayOfKey,
} from '@/lib/booking/time';
import { useWizard } from '../context';
import { ActionBar, StepHeader } from '../parts';

const FILTERS: { id: TimeOfDayFilter; label: string; icon: JSX.Element }[] = [
  { id: 'any', label: 'Any time', icon: <Clock className="h-4 w-4" /> },
  { id: 'morning', label: 'Mornings', icon: <Sun className="h-4 w-4" /> },
  { id: 'afternoon', label: 'Afternoons', icon: <Sunset className="h-4 w-4" /> },
  { id: 'evening', label: 'Evenings', icon: <Moon className="h-4 w-4" /> },
];

const PART_LABEL: Record<PartOfDay, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const FILTER_NOUN: Record<PartOfDay, string> = { morning: 'mornings', afternoon: 'afternoons', evening: 'evenings' };
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1, 12))
  );
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function lengthText(service: string | null, minutes: number): string {
  return service === 'psychologist' ? `${minutes}-minute consultation` : `${minutes}-minute session`;
}

export function SlotStep() {
  const w = useWizard();
  const source = w.slotSource;
  const first = useFirstOpenMonth(source);
  const thisMonth = dublinDateKey(new Date()).slice(0, 7);
  const lastMonth = addMonthsToKey(thisMonth, MONTHS_AHEAD - 1);

  const [month, setMonth] = useState<string | null>(w.state.slot ? slotDateKey(w.state.slot).slice(0, 7) : null);
  const [day, setDay] = useState<string | null>(w.state.slot ? slotDateKey(w.state.slot) : null);
  const tod = w.state.timeOfDay;

  // Open the calendar on the first month with times.
  useEffect(() => {
    if (!month && first.data) setMonth(first.data.month);
  }, [first.data, month]);

  const monthQuery = useMonthSlots(source, month);
  const days: AvailableDay[] = useMemo(() => monthQuery.data ?? [], [monthQuery.data]);

  // Pick a day when the month changes, and drop a chosen slot that's gone.
  useEffect(() => {
    if (!monthQuery.data) return;
    const slot = w.state.slot;
    if (slot && slotDateKey(slot).slice(0, 7) === month) {
      const open = days.some((d) => d.times.includes(slot));
      if (!open) w.update((s) => ({ ...s, slot: null }));
    }
    if (!day || !days.some((d) => d.date === day)) setDay(defaultDay(days, tod, slot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthQuery.data, month]);

  const earliest = useMemo(() => {
    const pool = [...(first.data?.days ?? []), ...days.filter((d) => !first.data?.days.some((f) => f.date === d.date))];
    pool.sort((a, b) => a.date.localeCompare(b.date));
    return earliestSlot(pool, tod);
  }, [first.data, days, tod]);

  const pickSlot = (time: string) => w.update((s) => ({ ...s, slot: time }));
  const setFilter = (f: TimeOfDayFilter) => {
    w.update((s) => ({ ...s, timeOfDay: f }));
    const next = defaultDay(days, f, w.state.slot);
    if (next) setDay(next);
  };
  const jumpToEarliest = () => {
    if (!earliest) return;
    pickSlot(earliest.time);
    setMonth(earliest.date.slice(0, 7));
    setDay(earliest.date);
  };

  const heading = w.clientFirstName ? `When suits you, ${w.clientFirstName}?` : 'When suits you?';
  const header = (
    <StepHeader
      eyebrow="Date and time"
      eyebrowIcon={<CalendarDays className="h-4 w-4" />}
      heading={heading}
      sub={`${lengthText(w.service, w.minutes)} with ${w.therapistName}, online.`}
      headingRef={w.headingRef}
    />
  );

  if (first.isError || monthQuery.isError) {
    return (
      <>
        {header}
        <div className="bw-body">
          <p className="bw-note is-orange" role="alert">
            We couldn’t load {w.therapistFirst}’s calendar just now. Please try again.
          </p>
          <div className="bw-actions">
            <button
              type="button"
              className="bw-btn bw-btn-primary"
              onClick={() => (first.isError ? first.refetch() : monthQuery.refetch())}
            >
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  if (first.isLoading || !source) {
    return (
      <>
        {header}
        <div className="bw-body" aria-busy="true">
          <div className="bw-skeleton" style={{ height: 64, marginBottom: 16 }} />
          <div className="bw-skeleton" style={{ height: 44, width: '60%', marginBottom: 16 }} />
          <div className="bw-skeleton" style={{ height: 260 }} />
          <p className="bw-hint mt-4" role="status">
            Checking {w.therapistFirst}’s calendar…
          </p>
        </div>
      </>
    );
  }

  if (!first.data) {
    return (
      <>
        {header}
        <div className="bw-body">
          <p className="bw-note is-orange" role="status">
            {w.therapistFirst} has no open times in the next 12 months.{' '}
            {w.mode === 'chosen'
              ? 'We can match you with another therapist who has availability.'
              : 'Please choose another therapist.'}
          </p>
          <div className="bw-actions">
            <button
              type="button"
              className="bw-btn bw-btn-primary"
              onClick={() => (w.mode === 'chosen' ? w.startMatching() : w.goTo('matches'))}
            >
              Find another therapist →
            </button>
          </div>
        </div>
      </>
    );
  }

  const dayEntry = days.find((d) => d.date === day);
  const shown = dayEntry ? visibleTimes(dayEntry.times, tod) : null;
  const today = dublinDateKey(new Date());
  const monthDays = month ? daysInMonth(month) : [];
  const lead = month ? (weekdayOfKey(monthDays[0]) + 6) % 7 : 0;
  const showEarliest = earliest && earliest.time !== w.state.slot;

  return (
    <>
      {header}
      <div className="bw-body">
        {showEarliest && (
          <button type="button" className="bw-earliest" onClick={jumpToEarliest}>
            <Zap className="h-5 w-5 shrink-0" style={{ color: 'var(--bw-orange)' }} />
            <span>
              <strong className="block">
                {tod === 'any' ? 'Earliest time' : `Earliest ${PART_LABEL[tod as PartOfDay].toLowerCase()} time`}:{' '}
                {formatSlot(earliest.time)}
              </strong>
              <span className="bw-option-desc">Tap to choose it, or pick another time below</span>
            </span>
          </button>
        )}

        <div className="bw-segment" role="group" aria-label="Time of day">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={tod === f.id} onClick={() => setFilter(f.id)}>
              <span className="inline-flex items-center gap-1.5">
                <span className="hidden sm:inline">{f.icon}</span>
                {f.label}
              </span>
            </button>
          ))}
        </div>

        <div className="bw-slot-grid">
          <div className="bw-cal">
            <div className="bw-cal-head">
              <button
                type="button"
                className="bw-cal-nav"
                aria-label="Previous month"
                disabled={!month || month <= thisMonth}
                onClick={() => month && setMonth(addMonthsToKey(month, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span aria-live="polite">{month ? monthTitle(month) : ''}</span>
              <button
                type="button"
                className="bw-cal-nav"
                aria-label="Next month"
                disabled={!month || month >= lastMonth}
                onClick={() => month && setMonth(addMonthsToKey(month, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="bw-cal-grid" role="grid" aria-busy={monthQuery.isLoading}>
              {DOW.map((d) => (
                <span key={d} className="bw-cal-dow" aria-hidden="true">
                  {d}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`lead-${i}`} />
              ))}
              {monthDays.map((key) => {
                const entry = days.find((d) => d.date === key);
                const count = entry?.times.length ?? 0;
                const faded = !!entry && tod !== 'any' && !entry.times.some((t) => matchesTimeOfDay(t, tod));
                const classes = [
                  'bw-day',
                  entry ? 'has-times' : '',
                  faded ? 'is-faded' : '',
                  key === day ? 'is-selected' : '',
                  key === today ? 'is-today' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={key}
                    type="button"
                    className={classes}
                    disabled={!entry}
                    aria-pressed={key === day}
                    aria-label={`${formatLongDate(key)}, ${count ? `${count} ${count === 1 ? 'time' : 'times'}` : 'no times'}`}
                    onClick={() => setDay(key)}
                  >
                    {Number(key.slice(8))}
                  </button>
                );
              })}
            </div>
            {monthQuery.isLoading && <div className="bw-skeleton mt-3" style={{ height: 12 }} />}
            {monthQuery.data && days.length === 0 && (
              <p className="bw-hint mt-3">No open times this month. Try the next one.</p>
            )}
          </div>

          <div>
            {dayEntry && shown ? (
              <>
                <p className="bw-times-head">{formatLongDate(dayEntry.date)}</p>
                <p className="bw-hint">
                  {dayEntry.times.length} {dayEntry.times.length === 1 ? 'time' : 'times'} available
                </p>
                {shown.fallback && tod !== 'any' && (
                  <p className="bw-note is-orange">
                    No {FILTER_NOUN[tod as PartOfDay]} on this day, so we’re showing all times.
                  </p>
                )}
                {groupTimes(shown.times).map((g) => (
                  <div key={g.part} className="bw-times-group">
                    <p className="bw-times-label">
                      {PART_LABEL[g.part]} · {g.times.length}
                    </p>
                    <div className="bw-times">
                      {g.times.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="bw-time"
                          aria-pressed={w.state.slot === t}
                          onClick={() => pickSlot(t)}
                        >
                          {formatSlotTime(t)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              !monthQuery.isLoading && days.length > 0 && <p className="bw-hint">Pick a day to see its times.</p>
            )}
          </div>
        </div>
        <p className="bw-hint mt-4">All times are shown in Irish time.</p>
      </div>
      <ActionBar
        label={w.state.slot ? 'Continue →' : 'Choose a time to continue'}
        enabled={!!w.state.slot}
        onContinue={w.goNext}
      />
    </>
  );
}
