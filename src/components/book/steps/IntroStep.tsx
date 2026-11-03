import { AlertTriangle, BadgeCheck, Clock, Receipt, Sparkles, Video } from 'lucide-react';
import { accreditationLabel, isPsychologist } from '@/lib/booking/therapists';
import { useWizard } from '../context';
import { StepHeader, WizardAvatar } from '../parts';

function cleanQuote(q: string | null | undefined): string {
  return String(q ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”\s]+|["“”\s.]+$/g, '')
    .trim();
}

function Trust() {
  return (
    <div className="bw-trust">
      <span>
        <BadgeCheck className="h-4 w-4" /> Accredited therapists
      </span>
      <span>
        <Video className="h-4 w-4" /> Online, from home
      </span>
      <span>
        <Receipt className="h-4 w-4" /> Insurance receipts
      </span>
    </div>
  );
}

const BLOCKED_HEADING = {
  not_accepting: (first: string) => `${first} isn’t taking new bookings right now`,
  no_services: (first: string) => `${first} has no sessions open for online booking`,
  no_consultations: (first: string) => `${first} has no consultations open for booking`,
  not_found: () => 'We couldn’t find that therapist',
};

export function IntroStep() {
  const w = useWizard();
  const start = () => {
    w.update((s) => ({ ...s, started: true }));
    w.goNext();
  };

  if (w.blocked) {
    return (
      <>
        <StepHeader
          eyebrow="Not available right now"
          eyebrowIcon={<AlertTriangle className="h-4 w-4" />}
          warning
          heading={BLOCKED_HEADING[w.blocked](w.therapistFirst)}
          sub="Answer a few quick questions and we’ll match you with an accredited Fettle therapist who has availability."
          headingRef={w.headingRef}
        />
        <div className="bw-actions">
          <button type="button" className="bw-btn bw-btn-primary" onClick={w.startMatching} data-bw-continue>
            Find me a therapist →
          </button>
        </div>
      </>
    );
  }

  if (w.mode === 'matching' || !w.therapist) {
    return (
      <>
        <StepHeader
          eyebrow="Book a session"
          eyebrowIcon={<Sparkles className="h-4 w-4" />}
          heading="Let’s find the right therapist for you"
          sub="Answer a few short questions and we’ll match you with an accredited therapist, then you can pick a time that suits you."
          headingRef={w.headingRef}
        />
        <div className="bw-actions">
          <button type="button" className="bw-btn bw-btn-primary" onClick={start} data-bw-continue>
            Get started →
          </button>
          <span className="bw-hint inline-flex items-center gap-1">
            <Clock className="h-4 w-4" /> Takes about 2 minutes
          </span>
        </div>
        <Trust />
      </>
    );
  }

  const t = w.therapist;
  const badge = accreditationLabel(t.Accreditation);
  const quote = cleanQuote(t.quote);
  return (
    <>
      <div className="bw-intro">
        <WizardAvatar name={w.therapistName} imageUrl={t.imageurl} size={140} />
        <div className="min-w-0">
          <StepHeader
            eyebrow={`Book with ${w.therapistFirst}`}
            eyebrowIcon={<Sparkles className="h-4 w-4" />}
            heading={`Your session with ${w.therapistName}`}
            headingRef={w.headingRef}
          />
          {badge && (
            <p className="mt-3">
              <span className="bw-tag is-green">
                <BadgeCheck className="h-3.5 w-3.5" /> {badge}
              </span>
            </p>
          )}
          <p className="bw-sub">
            {isPsychologist(t)
              ? 'A 30-minute clinical consultation with a validated assessment, then a clear plan for what comes next.'
              : `Start by choosing a time that suits you. Then a few quick questions help ${w.therapistFirst} prepare for your session.`}
          </p>
          {quote && <p className="bw-quote">“{quote}”</p>}
        </div>
      </div>
      <div className="bw-actions">
        <button type="button" className="bw-btn bw-btn-primary" onClick={start} data-bw-continue>
          Let’s begin →
        </button>
        <span className="bw-hint inline-flex items-center gap-1">
          <Clock className="h-4 w-4" /> Takes about 2 minutes
        </span>
      </div>
      <Trust />
    </>
  );
}
