import { useEffect, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { type Stripe, type StripeElementsOptions, loadStripe } from '@stripe/stripe-js';
import { Check, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useInvalidateSlots } from '@/hooks/useTherapistSlots';
import { recheckSlot } from '@/lib/booking/availability';
import { track } from '@/lib/booking/analytics';
import { couponRejectionMessage, euroWithCents } from '@/lib/booking/coupon';
import {
  CREDIT_PLAN_ID,
  type PaymentKind,
  clearPendingPayment,
  savePendingPayment,
  wizardReturnUrl,
} from '@/lib/booking/payment';
import { formatLongDate, formatSlotTime, slotDateKey } from '@/lib/booking/time';
import {
  type BookingOutcome,
  bookWithPackageCredit,
  bookWithReferralCredit,
  completeSessionPayment,
  confirmBundlePayment,
  createBundleIntent,
  createSessionIntent,
  redeemBundleCode,
} from '../checkout';
import { type WizardApi, useWizard } from '../context';
import { StepHeader } from '../parts';

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise && STRIPE_KEY) stripePromise = loadStripe(STRIPE_KEY);
  return stripePromise;
}

// Stripe's iframe can't read the hub's CSS variables, so these are the hex
// values of --primary, --foreground and --border from src/index.css.
const APPEARANCE: StripeElementsOptions['appearance'] = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#e87a30',
    colorText: '#30251d',
    borderRadius: '12px',
    fontFamily: '"DM Sans", system-ui, sans-serif',
  },
  rules: {
    '.Input': { border: '1.5px solid #e8e2d9', boxShadow: 'none' },
    '.Input:focus': { borderColor: '#e87a30', boxShadow: '0 0 0 3px rgba(232, 122, 48, 0.2)' },
    '.Label': { fontWeight: '700' },
  },
};
const FONTS: StripeElementsOptions['fonts'] = [
  { cssSrc: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap' },
];

/** What the Pay step is collecting. */
type Checkout =
  | { mode: 'loading' }
  | { mode: 'error'; message: string }
  | { mode: 'credit'; packageId: string }
  | { mode: 'covered'; referralCents: number }
  | {
      mode: 'card';
      kind: PaymentKind;
      clientSecret: string;
      paymentIntentId: string;
      amountCents: number;
      originalCents: number;
      discount: { code: string; savedCents: number } | null;
      rejected: string | null;
      referralCents: number;
    };

export function PayStep() {
  const w = useWizard();
  const [checkout, setCheckout] = useState<Checkout>({ mode: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const invalidateSlots = useInvalidateSlots();
  const s = w.state;
  const plan = w.selectedPlan;
  const isBundle = !!plan?.bundle;
  const slot = s.slot ?? '';
  const resumed = useRef(false);
  // Re-pricing an existing card form shows "Updating price…".
  const checkoutWasCard = useRef(false);
  useEffect(() => {
    checkoutWasCard.current = checkout.mode === 'card';
  }, [checkout.mode]);

  // ---- Shared outcomes ----
  const slotTaken = (charged: boolean, bundleSaved = false) => {
    track('booking_payment_failed', w.therapistName, { reason: 'slot_unavailable', detail: charged ? 'after_charge' : 'before_charge' });
    invalidateSlots(w.slotSource);
    w.update((st) => ({ ...st, slot: null }));
    w.showMessage({
      kind: 'warning',
      title: 'That time was just taken',
      text: bundleSaved
        ? 'That time was just taken. Your bundle is saved — choose another time.'
        : charged
          ? 'Sorry, someone booked this time moments ago. Your payment will be refunded in full. Please choose another time.'
          : 'Sorry, someone booked this time moments ago. You have not been charged. Please choose another time.',
      buttons: [
        {
          label: 'Choose another time',
          primary: true,
          onClick: () => {
            w.showMessage(null);
            w.goTo('slot');
          },
        },
      ],
    });
  };

  const fail = (reason: string, title: string, text: string, detail?: string) => {
    track('booking_payment_failed', w.therapistName, { reason, detail: detail ?? text });
    w.showMessage({ kind: 'error', title, text });
  };

  /** Re-checks the slot before any money moves; false means stop. */
  const slotStillFree = async (): Promise<boolean> => {
    if (!w.slotSource || !slot) return false;
    setBusy('Checking your time is still free…');
    try {
      if (await recheckSlot(w.slotSource, slot)) return true;
      setBusy(null);
      slotTaken(false);
      return false;
    } catch (e) {
      setBusy(null);
      fail(
        'slot_check_failed',
        'Couldn’t check availability',
        'Please check your connection and try again. You have not been charged.',
        String(e)
      );
      return false;
    }
  };

  const handleOutcome = (
    outcome: BookingOutcome,
    paid: { amountCents: number; charged: boolean; paymentStatus: string },
    bundle?: { packageId: string }
  ) => {
    setBusy(null);
    clearPendingPayment();
    if (outcome.status === 'booked') {
      w.completeBooking({
        appointmentId: outcome.appointmentId,
        remaining: outcome.remaining,
        unverified: outcome.unverified,
        amountCents: paid.amountCents,
        paymentStatus: paid.paymentStatus,
      });
      return;
    }
    const { failure, network } = outcome;
    if (network && paid.charged && !bundle) {
      // The booking may well exist: go to Done and let the team check (§7.3).
      console.error('[Booking wizard] Charged, but the booking call failed on the network', slot);
      w.completeBooking({ appointmentId: null, unverified: true, amountCents: paid.amountCents, paymentStatus: paid.paymentStatus });
      return;
    }
    if (bundle) {
      // The bundle exists with all its credits: book with a credit next time, no second payment.
      w.update((st) => ({ ...st, planId: CREDIT_PLAN_ID, creditPackageId: bundle.packageId }));
      w.markCreditsChanged();
      if (failure.slotTaken) {
        slotTaken(true, true);
        return;
      }
      fail(
        'acuity_booking_failed',
        'Booking not completed',
        `${network ? 'We couldn’t reach our booking system.' : failure.reason} Your bundle is saved on your account, so you won’t pay again.`
      );
      setCheckout({ mode: 'credit', packageId: bundle.packageId });
      return;
    }
    if (failure.slotTaken) {
      slotTaken(paid.charged);
      return;
    }
    if (!paid.charged || failure.moneyReturned === 'not_charged') {
      fail('acuity_booking_failed', 'Booking not completed', `${failure.reason} You have not been charged.`);
      return;
    }
    fail(
      'acuity_booking_failed',
      'Payment received, booking not confirmed',
      failure.moneyReturned === 'refunded'
        ? 'Your payment went through but we couldn’t confirm the time with your therapist. A full refund has been issued to your payment method, so you can choose another time.'
        : 'Your payment went through but we couldn’t confirm the time with your therapist. Our team will contact you to arrange your session or a full refund. Please don’t book again.'
    );
  };

  /** After Stripe confirms: book (single) or create the bundle and book with a credit. */
  const finishPaid = async (kind: PaymentKind, paymentIntentId: string, amountCents: number, paymentStatus: string) => {
    setBusy('Confirming your booking…');
    if (kind === 'session') {
      handleOutcome(await completeSessionPayment(paymentIntentId), { amountCents, charged: true, paymentStatus });
      return;
    }
    const bundle = await confirmBundlePayment(paymentIntentId);
    if (!bundle.ok) {
      setBusy(null);
      clearPendingPayment();
      fail(
        'acuity_booking_failed',
        'Payment received, booking not confirmed',
        'Your payment went through but we couldn’t set up your bundle just now. Our team will contact you to arrange your sessions or a full refund. Please don’t book again.',
        ('message' in bundle ? bundle.message : null) ?? 'network'
      );
      return;
    }
    const request = w.bookingRequest();
    if (!request) return;
    handleOutcome(await bookWithPackageCredit(bundle.packageId, request), { amountCents, charged: true, paymentStatus }, {
      packageId: bundle.packageId,
    });
  };

  // ---- Set up the payment for this plan (and again when the code or credit changes) ----
  const couponKey = `${s.coupon}|${s.useReferral}|${s.planId}|${s.creditPackageId}`;
  useEffect(() => {
    if (w.resume) return;
    let cancelled = false;
    const request = w.bookingRequest();
    (async () => {
      if (!request || !plan) {
        setCheckout({ mode: 'error', message: 'Something’s missing from your booking. Please go back and check it.' });
        return;
      }
      if (s.planId === CREDIT_PLAN_ID && w.credits) {
        setCheckout({ mode: 'credit', packageId: s.creditPackageId ?? w.credits.packageId });
        return;
      }
      setCheckout((c) => (c.mode === 'card' ? c : { mode: 'loading' }));
      if (checkoutWasCard.current) setBusy('Updating price…');

      if (isBundle && plan.bundle) {
        const res = await createBundleIntent(
          plan.bundle.id,
          { firstName: request.firstName, lastName: request.lastName, email: request.email, phone: request.phone },
          { useReferralCredit: s.useReferral }
        );
        if (cancelled) return;
        setBusy(null);
        if (!res.ok) {
          setCheckout({ mode: 'error', message: ('message' in res ? res.message : null) ?? 'Please check your connection and try again.' });
          return;
        }
        if ('creditCoversAll' in res && res.creditCoversAll) {
          // Unticking re-runs this effect, which sets up the full-price payment.
          w.update((st) => ({ ...st, useReferral: false }));
          w.showMessage({
            kind: 'info',
            title: 'Referral credit not used',
            text: 'Your credit covers this whole bundle, and a bundle can’t be bought with credit alone yet. You can use it on a single session instead.',
          });
          return;
        }
        if (!('intent' in res)) return;
        setCheckout({
          mode: 'card',
          kind: 'bundle',
          clientSecret: res.intent.clientSecret,
          paymentIntentId: res.intent.paymentIntentId,
          amountCents: res.intent.amount,
          originalCents: res.intent.originalAmount,
          discount: null,
          rejected: null,
          referralCents: res.intent.referralCreditApplied,
        });
        return;
      }

      const psych = w.service === 'psychologist';
      const res = await createSessionIntent(request, {
        couponCode: psych ? undefined : s.coupon,
        useReferralCredit: psych ? false : s.useReferral,
      });
      if (cancelled) return;
      setBusy(null);
      if (!res.ok) {
        setCheckout({ mode: 'error', message: ('message' in res ? res.message : null) ?? 'Please check your connection and try again.' });
        return;
      }
      const intent = res.intent;
      if (intent.fullyCovered) {
        setCheckout({ mode: 'covered', referralCents: intent.referralCreditApplied ?? 0 });
        return;
      }
      if (intent.packageCertificate?.code) {
        const link = await redeemBundleCode(intent.packageCertificate.code, request.appointmentTypeID);
        if (cancelled) return;
        w.update((st) => ({ ...st, coupon: '' }));
        if (link.ok && link.applicable !== false && link.package?.id) {
          w.markCreditsChanged();
          w.update((st) => ({ ...st, planId: CREDIT_PLAN_ID, creditPackageId: String(link.package!.id) }));
          w.showMessage({
            kind: 'success',
            title: link.alreadyLinked ? 'Bundle found on your account' : 'Bundle linked to your account',
            text: `${link.remainingSessions ?? 0} session${link.remainingSessions === 1 ? '' : 's'} available. You can use one for this booking, with nothing to pay.`,
          });
        } else {
          w.showMessage({
            kind: link.ok ? 'info' : 'error',
            title: link.ok ? 'Bundle linked to your account' : 'Bundle code not linked',
            text: link.ok
              ? `It can’t be used for this session${link.categoryLabel ? ` (it’s for ${link.categoryLabel})` : ''}, so you can pay for this one instead.`
              : (link.message ?? 'We couldn’t link this bundle code. Please try again.'),
          });
        }
        return;
      }
      if (!intent.clientSecret || !intent.paymentIntentId) {
        setCheckout({ mode: 'error', message: 'Payment couldn’t be set up. Please try again.' });
        return;
      }
      const amount = intent.amount ?? Math.round(plan.total * 100);
      const original = intent.originalAmount ?? amount;
      setCheckout({
        mode: 'card',
        kind: 'session',
        clientSecret: intent.clientSecret,
        paymentIntentId: intent.paymentIntentId,
        amountCents: amount,
        originalCents: original,
        discount: intent.discountApplied && s.coupon ? { code: s.coupon, savedCents: original - amount - (intent.referralCreditApplied ?? 0) } : null,
        rejected: s.coupon && !intent.discountApplied && intent.couponRejected ? couponRejectionMessage(intent.couponRejected) : null,
        referralCents: intent.referralCreditApplied ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couponKey, w.resume]);

  // ---- Back from a redirect payment method (§7.4) ----
  useEffect(() => {
    const resume = w.resume;
    if (!resume || resumed.current) return;
    resumed.current = true;
    (async () => {
      setBusy('Finalising your booking…');
      const stripe = await getStripe();
      const result = stripe ? await stripe.retrievePaymentIntent(resume.clientSecret) : null;
      const status = result?.paymentIntent?.status;
      // Clear the resume flag only once finished, so no new payment is set up meanwhile.
      if (status === 'succeeded' || status === 'requires_capture' || status === 'processing') {
        await finishPaid(resume.kind, resume.paymentIntentId, result?.paymentIntent?.amount ?? 0, status);
        w.clearResume();
        return;
      }
      w.clearResume();
      setBusy(null);
      clearPendingPayment();
      fail('unexpected_payment_status', 'Payment not completed', 'Your payment wasn’t completed. Please try again.', status ?? 'unknown');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.resume]);

  // ---- No-card paths ----
  const bookWithoutCard = async () => {
    if (busy) return;
    const request = w.bookingRequest();
    if (!request || !(await slotStillFree())) return;
    track('booking_payment_submitted', w.therapistName, {});
    setBusy('Confirming your booking…');
    if (checkout.mode === 'credit') {
      handleOutcome(await bookWithPackageCredit(checkout.packageId, request), { amountCents: 0, charged: false, paymentStatus: 'package_credit' });
    } else if (checkout.mode === 'covered') {
      handleOutcome(await bookWithReferralCredit(request), { amountCents: 0, charged: false, paymentStatus: 'referral_credit' });
    }
  };

  const amountLabel =
    checkout.mode === 'card'
      ? euroWithCents(checkout.amountCents / 100)
      : checkout.mode === 'credit' || checkout.mode === 'covered'
        ? euroWithCents(0)
        : euroWithCents(w.total);

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
            <span>{amountLabel}</span>
          </div>
        </div>
        {checkout.mode === 'card' && <DiscountBanner checkout={checkout} />}
        {checkout.mode === 'card' && w.service !== 'psychologist' && w.referralBalanceCents > 0 && (
          <label className="bw-check mt-4">
            <input
              type="checkbox"
              checked={s.useReferral}
              disabled={!!busy}
              onChange={(e) => w.update((st) => ({ ...st, useReferral: e.target.checked }))}
            />
            <span>Use my {euroWithCents(w.referralBalanceCents / 100)} referral credit</span>
          </label>
        )}

        <div className="mt-6">
          {checkout.mode === 'loading' && (
            <div aria-busy="true">
              <div className="bw-skeleton" style={{ height: 180 }} />
            </div>
          )}
          {checkout.mode === 'error' && (
            <div>
              <p className="bw-note is-orange" role="alert">
                {checkout.message}
              </p>
              <button type="button" className="bw-btn bw-btn-ghost mt-4" onClick={() => w.goTo('review')}>
                Back to review
              </button>
            </div>
          )}
          {(checkout.mode === 'credit' || checkout.mode === 'covered') && (
            <>
              <p className="bw-note">
                {checkout.mode === 'credit'
                  ? `This booking uses 1 session from your bundle${w.credits ? ` (${w.credits.remaining} left)` : ''}. Nothing to pay.`
                  : `Fully covered by your referral credit: ${euroWithCents(0)} to pay.`}
              </p>
              <div className="bw-actions">
                <button type="button" className="bw-btn bw-btn-primary bw-btn-block" onClick={bookWithoutCard} disabled={!!busy}>
                  {busy ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" /> {busy}
                    </>
                  ) : (
                    'Confirm booking'
                  )}
                </button>
              </div>
            </>
          )}
          {checkout.mode === 'card' && (
            <Elements
              key={checkout.clientSecret}
              stripe={getStripe()}
              options={{ clientSecret: checkout.clientSecret, appearance: APPEARANCE, fonts: FONTS }}
            >
              <CardForm
                api={w}
                checkout={checkout}
                busy={busy}
                setBusy={setBusy}
                slotStillFree={slotStillFree}
                finishPaid={finishPaid}
                fail={fail}
              />
            </Elements>
          )}
          {busy && checkout.mode === 'loading' && (
            <p className="bw-hint mt-4" role="status">
              {busy}
            </p>
          )}
        </div>
        <p className="bw-privacy inline-flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4" /> Payments are processed securely by Stripe. We never see your card details.
        </p>
      </div>
    </>
  );
}

function DiscountBanner({ checkout }: { checkout: Extract<Checkout, { mode: 'card' }> }) {
  if (checkout.discount) {
    return (
      <div className="bw-note mt-4" role="status">
        <strong className="inline-flex items-center gap-1">
          <Check className="h-4 w-4" /> Discount applied · {checkout.discount.code}
        </strong>
        <span className="block">
          You save {euroWithCents(checkout.discount.savedCents / 100)} — you pay {euroWithCents(checkout.amountCents / 100)}{' '}
          <s>{euroWithCents(checkout.originalCents / 100)}</s>
        </span>
      </div>
    );
  }
  return (
    <>
      {checkout.rejected && (
        <p className="bw-note is-orange mt-4" role="status">
          {checkout.rejected}
        </p>
      )}
      {checkout.referralCents > 0 && (
        <p className="bw-note mt-4" role="status">
          Referral credit applied: you save {euroWithCents(checkout.referralCents / 100)}.
        </p>
      )}
    </>
  );
}

function CardForm({
  api: w,
  checkout,
  busy,
  setBusy,
  slotStillFree,
  finishPaid,
  fail,
}: {
  api: WizardApi;
  checkout: Extract<Checkout, { mode: 'card' }>;
  busy: string | null;
  setBusy: (text: string | null) => void;
  slotStillFree: () => Promise<boolean>;
  finishPaid: (kind: PaymentKind, paymentIntentId: string, amountCents: number, status: string) => Promise<void>;
  fail: (reason: string, title: string, text: string, detail?: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);

  const pay = async () => {
    if (busy) return;
    if (!stripe || !elements || !ready) {
      w.showMessage({
        kind: 'info',
        title: 'Payment not ready',
        text: 'The payment form is still loading. Please wait a moment and try again.',
      });
      return;
    }
    if (!(await slotStillFree())) return;
    track('booking_payment_submitted', w.therapistName, {});

    const submitted = await elements.submit();
    if (submitted.error) {
      setBusy(null);
      fail(
        'stripe_form_invalid',
        'Payment not completed',
        submitted.error.message || 'Your payment didn’t go through. Please try again.'
      );
      return;
    }

    savePendingPayment({ kind: checkout.kind, paymentIntentId: checkout.paymentIntentId, entry: w.entry, state: w.state });
    setBusy('Processing payment…');
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: wizardReturnUrl(window.location.origin, w.entry) },
      redirect: 'if_required',
    });
    if (error) {
      setBusy(null);
      clearPendingPayment();
      fail('stripe_confirm_error', 'Payment not completed', error.message || 'Your payment didn’t go through. Please try again.');
      return;
    }
    const status = paymentIntent?.status ?? 'unknown';
    if (status === 'requires_action') {
      setBusy('Waiting for verification…');
      return;
    }
    if (status === 'succeeded' || status === 'requires_capture' || status === 'processing') {
      await finishPaid(checkout.kind, checkout.paymentIntentId, checkout.amountCents, status);
      return;
    }
    setBusy(null);
    clearPendingPayment();
    fail('unexpected_payment_status', 'Payment not completed', 'Your payment didn’t go through. Please try again.', status);
  };

  return (
    <>
      <div style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : undefined }}>
        <PaymentElement options={{ layout: 'tabs' }} onReady={() => setReady(true)} />
      </div>
      <div className="bw-actions">
        <button type="button" className="bw-btn bw-btn-primary bw-btn-block" onClick={pay} disabled={!!busy}>
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> {busy}
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" /> Pay {euroWithCents(checkout.amountCents / 100)}
            </>
          )}
        </button>
      </div>
    </>
  );
}
