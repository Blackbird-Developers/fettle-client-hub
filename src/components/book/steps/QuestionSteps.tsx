import { ArrowLeftRight, Brain, Repeat, Sprout, User, Users } from 'lucide-react';
import { CONSULTATION_OPTIONS, HISTORY_OPTIONS, type TherapyHistory, WHO_OPTIONS } from '@/lib/booking/content';
import { TOPICS, UNSURE_REPLY, UNSURE_TOPIC_ID, isOnlyUnsure } from '@/lib/booking/matching';
import type { TherapyService } from '@/lib/booking/therapists';
import { questionNumber, withConsultation, withWho } from '@/lib/booking/wizard';
import { useWizard } from '../context';
import { ActionBar, OptionRow, StepHeader } from '../parts';

const WHO_ICON: Record<TherapyService, JSX.Element> = {
  individual: <User className="h-5 w-5" />,
  couples: <Users className="h-5 w-5" />,
  youth: <Sprout className="h-5 w-5" />,
};

export function WhoStep() {
  const w = useWizard();
  const options = w.mode === 'matching' ? (['individual', 'couples', 'youth'] as TherapyService[]) : w.serviceOptions;
  return (
    <>
      <StepHeader
        question={questionNumber(w.steps, 'who')}
        heading="Who are the sessions for?"
        sub={
          w.mode === 'chosen'
            ? `${w.therapistFirst} offers the options below.`
            : 'This helps us show the right therapists and session length.'
        }
        headingRef={w.headingRef}
      />
      <div className="bw-body bw-options" role="group" aria-label="Who are the sessions for?">
        {options.map((who) => (
          <OptionRow
            key={who}
            icon={WHO_ICON[who]}
            title={WHO_OPTIONS[who].title}
            description={WHO_OPTIONS[who].description}
            selected={w.state.who === who}
            onSelect={() => w.update((s) => withWho(s, who, w.mode === 'matching'))}
          />
        ))}
      </div>
      <ActionBar label="Continue →" enabled={!!w.state.who} onContinue={w.goNext} />
    </>
  );
}

export function ConsultationStep() {
  const w = useWizard();
  return (
    <>
      <StepHeader
        question={questionNumber(w.steps, 'consultation')}
        heading="What would you like to explore?"
        sub={`Each consultation includes a validated clinical questionnaire, so ${w.therapistFirst} can give you clear next steps.`}
        headingRef={w.headingRef}
      />
      <div className="bw-body bw-options" role="group" aria-label="Consultation type">
        {w.consultations.map((c) => (
          <OptionRow
            key={c.key}
            icon={<Brain className="h-5 w-5" />}
            title={CONSULTATION_OPTIONS[c.key].title}
            description={CONSULTATION_OPTIONS[c.key].description}
            selected={w.state.consultation === c.key}
            onSelect={() => w.update((s) => withConsultation(s, c.key))}
          />
        ))}
      </div>
      <ActionBar label="Continue →" enabled={!!w.state.consultation} onContinue={w.goNext} />
    </>
  );
}

const TOPIC_HEADINGS: Record<TherapyService, string> = {
  individual: 'What’s bringing you to therapy?',
  couples: 'What would you like to work on together?',
  youth: 'What’s been hardest for them lately?',
};

export function TopicsStep() {
  const w = useWizard();
  const service = (w.state.who ?? 'individual') as TherapyService;
  const toggle = (id: string) =>
    w.update((s) => {
      const on = s.topics.includes(id);
      let topics = on ? s.topics.filter((t) => t !== id) : [...s.topics, id];
      // "Not sure yet" stands alone.
      if (!on) topics = id === UNSURE_TOPIC_ID ? [id] : topics.filter((t) => t !== UNSURE_TOPIC_ID);
      return { ...s, topics, therapistId: null, slot: null };
    });
  return (
    <>
      <StepHeader
        question={questionNumber(w.steps, 'topics')}
        heading={TOPIC_HEADINGS[service]}
        sub="Choose as many as you like. We’ll use this to match you."
        headingRef={w.headingRef}
      />
      <div className="bw-body bw-chips" role="group" aria-label="Topics">
        {TOPICS[service].map((t) => (
          <button
            key={t.id}
            type="button"
            className="bw-chip"
            aria-pressed={w.state.topics.includes(t.id)}
            onClick={() => toggle(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isOnlyUnsure(w.state.topics) && <p className="bw-note">{UNSURE_REPLY}</p>}
      <ActionBar label="Continue →" enabled={w.state.topics.length > 0} onContinue={w.goNext} />
    </>
  );
}

const HISTORY_ICON: Record<TherapyHistory, JSX.Element> = {
  first: <Sprout className="h-5 w-5" />,
  past: <Repeat className="h-5 w-5" />,
  switching: <ArrowLeftRight className="h-5 w-5" />,
};

export function HistoryStep() {
  const w = useWizard();
  const youth = w.service === 'youth';
  const chosen = w.state.history;
  return (
    <>
      <StepHeader
        question={questionNumber(w.steps, 'history')}
        heading={youth ? 'Have they spoken to a therapist before?' : 'Have you had therapy before?'}
        sub={`There’s no wrong answer. It just helps ${w.therapistFirst} know where to start.`}
        headingRef={w.headingRef}
      />
      <div className="bw-body bw-options" role="group" aria-label="Therapy before">
        {(Object.keys(HISTORY_OPTIONS) as TherapyHistory[]).map((h) => (
          <OptionRow
            key={h}
            icon={HISTORY_ICON[h]}
            title={youth ? HISTORY_OPTIONS[h].youthTitle : HISTORY_OPTIONS[h].title}
            description={youth ? undefined : HISTORY_OPTIONS[h].description}
            selected={chosen === h}
            onSelect={() => w.update((s) => ({ ...s, history: h }))}
          />
        ))}
      </div>
      {chosen && (
        <p className="bw-note" role="status">
          {HISTORY_OPTIONS[chosen].reply}
        </p>
      )}
      <ActionBar label="Continue →" enabled={!!chosen} onContinue={w.goNext} />
    </>
  );
}
