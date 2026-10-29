import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useAcuityAppointments } from '@/hooks/useAcuity';
import { useReferrals } from '@/hooks/useReferrals';
import { useTherapistDirectory } from '@/hooks/useTherapistDirectory';
import { useActivePackages } from '@/hooks/useUserPackages';
import { getPackageCategory } from '@/lib/packageCategory';
import { intakeFieldsFor } from '@/lib/booking/intake';
import { buildBookingNotes } from '@/lib/booking/notes';
import { CREDIT_PLAN_ID, WIZARD_RETURN_PARAM, loadPendingPayment } from '@/lib/booking/payment';
import { formatSlotTime, slotDateKey } from '@/lib/booking/time';
import { track } from '@/lib/booking/analytics';
import { CONSULTATION_OPTIONS, SESSION_MINUTES } from '@/lib/booking/content';
import { type BookingPlan, DEFAULT_SINGLE_PRICE, PSYCHOLOGIST_PRICE, plansFor } from '@/lib/booking/plans';
import {
  type ConsultationKey,
  type TherapyService,
  blockedReason,
  calendarIdOf,
  consultationsOffered,
  findTherapist,
  firstNameOf,
  isPsychologist,
  servicesOffered,
  sessionTypeId,
} from '@/lib/booking/therapists';
import {
  type FlowContext,
  type StepId,
  type WizardState,
  STEP_IDS,
  clearWizard,
  flowSteps,
  initialState,
  loadWizard,
  nextStep,
  phaseOf,
  resolveStep,
  saveWizard,
} from '@/lib/booking/wizard';
import { type BookingRequest, completeSessionPayment, confirmBundlePayment } from './checkout';
import { type BookedInfo, type BookingResult, type PaymentResume, type WizardApi, WizardContext } from './context';
import { MessageDialog, ProgressBar, type WizardMessage, WizardAvatar } from './parts';
import { SummaryCard } from './SummaryCard';
import { DetailsStep } from './steps/DetailsStep';
import { DoneStep } from './steps/DoneStep';
import { IntroStep } from './steps/IntroStep';
import { MatchesStep } from './steps/MatchesStep';
import { PayStep } from './steps/PayStep';
import { PlanStep } from './steps/PlanStep';
import { ConsultationStep, HistoryStep, TopicsStep, WhoStep } from './steps/QuestionSteps';
import { ReviewStep } from './steps/ReviewStep';
import { SlotStep } from './steps/SlotStep';
import './bookingWizard.css';

const THERAPY_SERVICES: TherapyService[] = ['individual', 'couples', 'youth'];
const CONSULTATION_KEYS: ConsultationKey[] = ['depression', 'anxiety', 'ocd'];

const STEP_COMPONENTS: Record<StepId, () => JSX.Element | null> = {
  intro: IntroStep,
  who: WhoStep,
  consultation: ConsultationStep,
  topics: TopicsStep,
  matches: MatchesStep,
  slot: SlotStep,
  history: HistoryStep,
  details: DetailsStep,
  plan: PlanStep,
  review: ReviewStep,
  pay: PayStep,
  done: DoneStep,
};

/** URL params that make up the entry link (step and payment-return params aside). */
function entryKey(params: URLSearchParams): string {
  const p = new URLSearchParams();
  for (const key of ['therapist', 'service', 'type']) {
    const v = params.get(key);
    if (v) p.set(key, v);
  }
  return p.toString();
}

function historyIndex(): number {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' ? idx : 0;
}

export function BookingWizard() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const dir = useTherapistDirectory();
  const { appointments, loading: appointmentsLoading } = useAcuityAppointments(profile?.email, 10 * 60_000);

  const therapistParam = params.get('therapist');
  const serviceParam = params.get('service');
  const typeParam = params.get('type');
  const slotParam = params.get('slot');
  const entry = entryKey(params);

  const [state, setState] = useState<WizardState | null>(null);
  const queryClient = useQueryClient();
  const { packages: activePackages, isLoading: packagesLoading } = useActivePackages();
  const { data: referralData } = useReferrals();

  // A redirect payment method (Revolut Pay, PayPal…) came back here (§7.4).
  const [resume, setResume] = useState<PaymentResume | null>(null);
  const returnInfo = useRef(
    params.has(WIZARD_RETURN_PARAM) && params.get('payment_intent') && params.get('payment_intent_client_secret')
      ? { paymentIntentId: params.get('payment_intent')!, clientSecret: params.get('payment_intent_client_secret')! }
      : null
  );
  const pendingReturn = useRef(returnInfo.current ? loadPendingPayment(returnInfo.current.paymentIntentId) : null);
  const forceMatching = !!(state ?? pendingReturn.current?.state ?? loadWizard(entry))?.switchedToMatching;
  const [booked, setBookedState] = useState<BookedInfo | null>(null);
  const [message, setMessage] = useState<WizardMessage | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startIndex = useRef(historyIndex());

  // ---- Client ----
  const active = useMemo(() => appointments.filter((a) => !a.canceled), [appointments]);
  const hasPastSessions = active.length > 0;
  const knownPhone = useMemo(() => {
    const latest = [...appointments].filter((a) => a.phone?.trim()).sort((a, b) => b.datetime.localeCompare(a.datetime))[0];
    return latest?.phone?.trim() ?? '';
  }, [appointments]);

  // ---- Therapist ----
  const mode: 'chosen' | 'matching' = forceMatching || !therapistParam ? 'matching' : 'chosen';
  const linkTherapist = useMemo(
    () => (therapistParam ? findTherapist(therapistParam, dir.therapists) : null),
    [therapistParam, dir.therapists]
  );
  const blocked =
    mode === 'chosen' && !dir.loading
      ? linkTherapist
        ? blockedReason(linkTherapist, dir.publicTypeIds)
        : 'not_found'
      : null;
  const therapist =
    mode === 'chosen'
      ? linkTherapist
      : (state?.therapistId && dir.therapists.find((t) => String(t.id) === state.therapistId)) || null;
  const psych = mode === 'chosen' && !!linkTherapist && isPsychologist(linkTherapist);
  const serviceOptions = useMemo(
    () => (therapist && !isPsychologist(therapist) ? servicesOffered(therapist, dir.publicTypeIds) : []),
    [therapist, dir.publicTypeIds]
  );
  const consultations = useMemo(
    () => (therapist && psych ? consultationsOffered(therapist, dir.publicTypeIds) : []),
    [therapist, psych, dir.publicTypeIds]
  );

  const ready = !dir.loading && !dir.error && !appointmentsLoading && !packagesLoading;

  // ---- Start (or restore) the flow once everything is loaded ----
  useEffect(() => {
    if (!ready || state) return;
    const back = returnInfo.current;
    const pending = pendingReturn.current;
    if (back) {
      // Drop Stripe's params so a refresh doesn't try to finish twice.
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of ['payment_intent', 'payment_intent_client_secret', 'redirect_status', WIZARD_RETURN_PARAM]) p.delete(k);
          return p;
        },
        { replace: true }
      );
    }
    if (back && pending) {
      setState(pending.state);
      setResume({ kind: pending.kind, ...back });
      return;
    }
    if (back) {
      showLostReturn(back.paymentIntentId);
    }
    let s = loadWizard(entry) ?? initialState();
    s = {
      ...s,
      details: {
        ...s.details,
        firstName: s.details.firstName || profile?.first_name?.trim() || '',
        lastName: s.details.lastName || profile?.last_name?.trim() || '',
        email: s.details.email || profile?.email?.trim() || '',
        phone: s.details.phone || knownPhone,
      },
    };
    if (mode === 'chosen' && linkTherapist && !blocked) {
      s.therapistId = String(linkTherapist.id);
      if (psych) {
        s.who = 'psychologist';
        const fromLink = CONSULTATION_KEYS.find((k) => k === typeParam && consultations.some((c) => c.key === k));
        if (fromLink) s.consultation = fromLink;
        else if (consultations.length === 1) s.consultation = consultations[0].key;
        else if (s.consultation && !consultations.some((c) => c.key === s.consultation)) s.consultation = null;
      } else {
        const fromLink = THERAPY_SERVICES.find((x) => x === serviceParam && serviceOptions.includes(x));
        if (fromLink) s.who = fromLink;
        else if (serviceOptions.length === 1) s.who = serviceOptions[0];
        else if (s.who && !serviceOptions.includes(s.who as TherapyService)) s.who = null;
      }
    }
    if (hasPastSessions && !s.history) s.history = 'past';
    if (slotParam && !s.slot) s.slot = slotParam;
    setState(s);
    track('booking_page_view', linkTherapist?.name ?? null, { step_name: params.get('step') ?? 'intro', entry_therapist: therapistParam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Phone can arrive after the profile; fill it in if the client hasn't typed one.
  useEffect(() => {
    if (knownPhone) setState((s) => (s && !s.details.phone ? { ...s, details: { ...s.details, phone: knownPhone } } : s));
  }, [knownPhone]);

  // Save on every change; a refresh restores the answers (§8).
  useEffect(() => {
    if (state && !booked) saveWizard(entry, state);
  }, [state, booked, entry]);

  // ---- Flow ----
  const serviceFromLink = !!serviceParam && serviceOptions.includes(serviceParam as TherapyService);
  const steps: StepId[] = useMemo(() => {
    if (blocked) return ['intro'];
    const ctx: FlowContext = {
      mode,
      psychologist: psych,
      serviceCount: mode === 'matching' ? THERAPY_SERVICES.length : serviceOptions.length,
      serviceFromLink,
      consultationCount: consultations.length,
      skipHistory: hasPastSessions,
    };
    return flowSteps(ctx);
  }, [blocked, mode, psych, serviceOptions.length, serviceFromLink, consultations.length, hasPastSessions]);
  const rawStep = params.get('step');
  const wanted = STEP_IDS.includes(rawStep as StepId) ? (rawStep as StepId) : null;
  const step: StepId = state ? resolveStep(steps, wanted, state, !!booked) : 'intro';

  const setStepParam = useCallback(
    (next: StepId, replace: boolean) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('step', next);
          return p;
        },
        { replace }
      );
    },
    [setParams]
  );

  // Keep the URL on the step actually shown.
  useEffect(() => {
    if (state && wanted !== step) setStepParam(step, true);
  }, [state, wanted, step, setStepParam]);

  // ---- Step changes: direction, focus, analytics ----
  const prevStep = useRef<StepId>(step);
  const direction = steps.indexOf(step) < steps.indexOf(prevStep.current) ? 'back' : 'forward';
  useEffect(() => {
    if (!state) return;
    if (step !== 'details') headingRef.current?.focus({ preventScroll: true });
    const card = document.getElementById('bw-card');
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    track('booking_step_view', therapist?.name ?? null, { step_name: step, step: steps.indexOf(step) + 1 });
    prevStep.current = step;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, !!state]);

  const update = useCallback((fn: (s: WizardState) => WizardState) => setState((s) => (s ? fn(s) : s)), []);

  // ---- Booking details derived from the answers ----
  const service = state?.who ?? null;
  const typeId =
    service === 'psychologist'
      ? (consultations.find((c) => c.key === state?.consultation)?.typeId ?? null)
      : therapist && service
        ? sessionTypeId(therapist, service)
        : null;
  const calendarId = therapist ? calendarIdOf(therapist) : null;
  const slotSource = useMemo(
    () => (typeId ? { typeId, calendarId, psychologist: service === 'psychologist' } : null),
    [typeId, calendarId, service]
  );
  const appointmentType = typeId ? dir.typeById.get(String(typeId)) : undefined;
  const minutes = service ? SESSION_MINUTES[service] : 50;
  const livePrice = Number(appointmentType?.price);
  // Unused bundle credits for this service (§10.2). Unknown bundle products
  // count for any therapy session, as in BookingModal; never for psychologists.
  const credits = useMemo(() => {
    if (!service || service === 'psychologist') return null;
    const usable = activePackages.filter((pkg) => {
      const category = getPackageCategory(pkg.package_id);
      return category ? category === service : true;
    });
    const linked = state?.creditPackageId ? activePackages.find((p) => p.id === state.creditPackageId) : undefined;
    const first = linked ?? usable[0];
    if (!first) return state?.creditPackageId ? { packageId: state.creditPackageId, remaining: 0 } : null;
    const remaining = [first, ...usable.filter((p) => p.id !== first.id)].reduce((sum, p) => sum + p.remaining_sessions, 0);
    return { packageId: first.id, remaining };
  }, [service, activePackages, state?.creditPackageId]);

  const plans = useMemo(
    () =>
      service && service !== 'psychologist'
        ? plansFor(service, Number.isFinite(livePrice) && livePrice > 0 ? livePrice : DEFAULT_SINGLE_PRICE[service])
        : [],
    [service, livePrice]
  );
  const selectedPlan: BookingPlan | null =
    service === 'psychologist'
      ? state?.consultation
        ? {
            id: `consultation-${state.consultation}`,
            service: 'individual',
            title: CONSULTATION_OPTIONS[state.consultation].title,
            sessions: 1,
            total: Number.isFinite(livePrice) && livePrice > 0 ? livePrice : PSYCHOLOGIST_PRICE,
            perSession: Number.isFinite(livePrice) && livePrice > 0 ? livePrice : PSYCHOLOGIST_PRICE,
            save: 0,
            tagLine: '',
            features: [],
          }
        : null
      : state?.planId === CREDIT_PLAN_ID && credits
        ? {
            id: CREDIT_PLAN_ID,
            service: service as TherapyService,
            title: 'Bundle session',
            sessions: 1,
            total: 0,
            perSession: 0,
            save: 0,
            tagLine:
              credits.remaining > 0
                ? `Use 1 of your ${credits.remaining} remaining sessions`
                : 'Use 1 of your bundle sessions',
            features: [],
          }
        : (plans.find((p) => p.id === state?.planId) ?? null);

  const bookingRequest = (): BookingRequest | null => {
    if (!state || !therapist || !typeId || !state.slot || !service) return null;
    const d = state.details;
    return {
      appointmentTypeID: Number(typeId),
      appointmentTypeName: appointmentType?.name ?? selectedPlan?.title ?? 'Session',
      appointmentTypePrice: appointmentType?.price ?? String(selectedPlan?.total ?? ''),
      datetime: state.slot,
      calendarID: calendarId,
      calendarName: therapist.name.trim(),
      firstName: d.firstName.trim(),
      lastName: d.lastName.trim(),
      email: d.email.trim(),
      phone: d.phone.trim(),
      notes: buildBookingNotes({
        service,
        topicIds: mode === 'matching' ? state.topics : [],
        history: state.history,
        youngPersonName: d.youngPersonName,
        partnerName: d.partnerName,
        clientNote: d.note,
      }),
      intakeFormFields: intakeFieldsFor(service, d.partnerName),
      timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  };

  // ---- Navigation ----
  const goTo = useCallback((next: StepId) => setStepParam(next, false), [setStepParam]);
  const goNext = useCallback(() => {
    if (!state) return;
    const target = nextStep(steps, step, state);
    if (state.returnToReview && target === 'review') update((s) => ({ ...s, returnToReview: false }));
    goTo(target);
  }, [state, steps, step, goTo, update]);
  const editFromReview = useCallback(
    (target: StepId) => {
      update((s) => ({ ...s, returnToReview: true }));
      goTo(target);
    },
    [goTo, update]
  );
  const back = () => {
    if (historyIndex() > startIndex.current) {
      navigate(-1);
      return;
    }
    const i = steps.indexOf(step);
    if (i > 0) setStepParam(steps[i - 1], true);
  };
  const startMatching = () => {
    update((s) =>
      initialState({
        started: true,
        switchedToMatching: true,
        details: s.details,
        history: s.history,
        timeOfDay: s.timeOfDay,
      })
    );
    goTo('who');
  };
  const completeBooking = (r: BookingResult) => {
    if (!state?.slot) return;
    const slot = state.slot;
    const d = state.details;
    const amount = r.amountCents / 100;
    const bookingId = r.appointmentId;
    const name = therapist?.name ?? null;
    track('stripe-success-conversion', name, {
      conversion: amount,
      booking_id: bookingId,
      appointment_type_id: typeId,
      Email: d.email,
      ID: bookingId,
      Type: service,
      AppointmentType: appointmentType?.name,
      Calendar: name,
      Price: amount,
    });
    track('consultation_reserved', name, {
      client_name: `${d.firstName} ${d.lastName}`.trim(),
      client_email: d.email,
      payment_status: r.paymentStatus,
      booking_id: bookingId,
      plan: state.planId,
      plan_price: selectedPlan?.total,
      slot_day: slotDateKey(slot),
      slot_time: formatSlotTime(slot),
    });
    track('booking_completed', name, {
      booking_id: bookingId,
      package_id: state.planId,
      package_title: selectedPlan?.title,
      package_price: selectedPlan?.total,
      amount,
      currency: 'EUR',
      selected_date: slotDateKey(slot),
      selected_time: formatSlotTime(slot),
      appointment_type_id: typeId,
      calendar_id: calendarId,
      who: service,
    });
    for (const key of [['user-packages'], ['unpaid-sessions'], ['referral-overview'], ['book-month'], ['book-first-month']]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
    const usedBundle = state.planId === CREDIT_PLAN_ID || !!selectedPlan?.bundle;
    setBooked({
      appointmentId: bookingId,
      slot,
      therapistName: therapist?.name?.trim() ?? '',
      firstName: d.firstName.trim(),
      email: d.email.trim(),
      minutes,
      bundleRemaining: usedBundle ? r.remaining : undefined,
      unverified: r.unverified,
    });
  };

  // The saved flow was lost during a redirect payment (rare): finish from the intent alone.
  async function showLostReturn(paymentIntentId: string) {
    const session = await completeSessionPayment(paymentIntentId);
    if (session.status === 'booked') {
      setMessage({
        kind: 'success',
        title: 'You’re booked',
        text: 'Your payment went through and your session is booked. A confirmation is on its way to your email.',
        buttons: [{ label: 'Go to my sessions', primary: true, onClick: () => navigate('/sessions') }],
      });
      return;
    }
    if (/not a session booking/i.test(session.failure.reason)) {
      const bundle = await confirmBundlePayment(paymentIntentId);
      void queryClient.invalidateQueries({ queryKey: ['user-packages'] });
      setMessage(
        bundle.ok
          ? {
              kind: 'success',
              title: 'Your bundle is ready',
              text: 'Your payment went through. Choose a time and book it with one of your bundle sessions.',
            }
          : {
              kind: 'error',
              title: 'Payment received, booking not confirmed',
              text: 'Your payment went through but we couldn’t set up your bundle just now. Our team will contact you. Please don’t book again.',
            }
      );
      return;
    }
    setMessage({ kind: 'error', title: 'Booking not completed', text: session.failure.reason });
  }

  const setBooked = (info: BookedInfo) => {
    clearWizard();
    setBookedState(info);
    setStepParam('done', true);
  };

  // Enter = Continue, except in the note box and on buttons and links (§12).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey) return;
    const target = e.target as HTMLElement;
    if (['TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(target.tagName)) return;
    const button = e.currentTarget.querySelector<HTMLButtonElement>('[data-bw-continue]');
    if (button && !button.disabled) {
      e.preventDefault();
      button.click();
    }
  };

  if (dir.error) {
    return (
      <div className="booking-wizard">
        <div className="bw-card mx-auto" style={{ maxWidth: 720 }}>
          <p className="bw-heading">We couldn’t load our therapists just now.</p>
          <p className="bw-sub">Please check your connection and try again.</p>
          <div className="bw-actions">
            <button type="button" className="bw-btn bw-btn-primary" onClick={dir.refetch}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="booking-wizard" aria-busy="true">
        <div className="bw-layout">
          <div className="bw-card">
            <div className="bw-skeleton" style={{ height: 8, marginBottom: 40 }} />
            <div className="bw-skeleton" style={{ height: 40, width: '70%', marginBottom: 16 }} />
            <div className="bw-skeleton" style={{ height: 20, width: '50%', marginBottom: 40 }} />
            <div className="bw-skeleton" style={{ height: 160 }} />
          </div>
        </div>
      </div>
    );
  }

  const therapistName = therapist?.name?.trim() || (blocked === 'not_found' ? 'That therapist' : '');
  const api: WizardApi = {
    state,
    update,
    steps,
    step,
    goNext,
    goTo,
    editFromReview,
    headingRef,
    mode,
    blocked,
    startMatching,
    therapists: dir.therapists,
    publicTypeIds: dir.publicTypeIds,
    typeById: dir.typeById,
    therapist,
    therapistName,
    therapistFirst: therapist ? firstNameOf(therapist.name) : 'your therapist',
    service,
    serviceOptions,
    consultations,
    slotSource,
    appointmentType,
    minutes,
    plans,
    selectedPlan,
    total: selectedPlan?.total ?? 0,
    clientFirstName: state.details.firstName.trim() || profile?.first_name?.trim() || '',
    hasPastSessions,
    knownPhone,
    credits,
    markCreditsChanged: () => void queryClient.invalidateQueries({ queryKey: ['user-packages'] }),
    referralBalanceCents: referralData?.balance_cents ?? 0,
    bookingRequest,
    completeBooking,
    entry,
    resume,
    clearResume: () => setResume(null),
    showMessage: setMessage,
    booked,
    setBooked,
  };

  const Step = STEP_COMPONENTS[step];
  const phase = phaseOf(step);
  const showBack = step !== 'intro' && step !== 'done';

  return (
    <WizardContext.Provider value={api}>
      <div className="booking-wizard" onKeyDown={onKeyDown}>
        <div className="bw-layout">
          <main className="bw-card" id="bw-card">
            {!blocked && (
              <ProgressBar
                phase={phase}
                firstLabel={psych ? 'Consultation' : 'Who it’s for'}
                onBack={showBack ? back : undefined}
                avatar={
                  therapist ? (
                    <span className="bw-mini-avatar">
                      <WizardAvatar name={therapistName} imageUrl={therapist.imageurl} size={36} />
                    </span>
                  ) : null
                }
              />
            )}
            <div key={step} className={`bw-step${direction === 'back' ? ' is-back' : ''}`} aria-live="polite">
              <Step />
            </div>
          </main>
          <SummaryCard />
        </div>
      </div>
      <MessageDialog message={message} onClose={() => setMessage(null)} />
    </WizardContext.Provider>
  );
}
