import { type RefObject, createContext, useContext } from 'react';
import type { AcuityAppointmentType } from '@/hooks/useAcuity';
import type { UserPackage } from '@/hooks/useUserPackages';
import type { SlotSource } from '@/lib/booking/availability';
import type { PaymentKind } from '@/lib/booking/payment';
import type { BookingPlan } from '@/lib/booking/plans';
import type { BlockedReason, ConsultationKey, TherapistRow, TherapyService } from '@/lib/booking/therapists';
import type { StepId, WizardService, WizardState } from '@/lib/booking/wizard';
import type { BookingRequest } from './checkout';
import type { WizardMessage } from './parts';

/** What the Done step shows once the booking exists. */
export interface BookedInfo {
  appointmentId: number | string | null;
  slot: string;
  therapistName: string;
  firstName: string;
  email: string;
  minutes: number;
  /** Sessions left in a bundle bought or used for this booking. */
  bundleRemaining?: number;
  /** Payment taken but not finalised (§3.7). */
  paymentIssue?: boolean;
  /** Paid, but the booking couldn't be confirmed yet (pending or network failure). */
  unverified?: boolean;
}

/** What a payment path reports once the booking is made. */
export interface BookingResult {
  appointmentId: number | string | null;
  remaining?: number;
  unverified?: boolean;
  amountCents: number;
  paymentStatus: string;
}

/** A redirect payment method came back to finish (§7.4). */
export interface PaymentResume {
  kind: PaymentKind;
  paymentIntentId: string;
  clientSecret: string;
}

export interface WizardApi {
  state: WizardState;
  update: (fn: (s: WizardState) => WizardState) => void;
  steps: StepId[];
  step: StepId;
  /** Continue from the current step (goes back to review after an Edit). */
  goNext: () => void;
  goTo: (step: StepId) => void;
  /** Edit link on review: open the step, then come straight back. */
  editFromReview: (step: StepId) => void;
  headingRef: RefObject<HTMLHeadingElement>;

  mode: 'chosen' | 'matching';
  blocked: BlockedReason | 'not_found' | null;
  /** Leave a blocked or unavailable therapist and start matching. */
  startMatching: () => void;

  therapists: TherapistRow[];
  publicTypeIds: ReadonlySet<string>;
  typeById: ReadonlyMap<string, AcuityAppointmentType>;
  therapist: TherapistRow | null;
  therapistName: string;
  therapistFirst: string;

  service: WizardService | null;
  serviceOptions: TherapyService[];
  consultations: { key: ConsultationKey; typeId: string }[];
  slotSource: SlotSource | null;
  appointmentType: AcuityAppointmentType | undefined;
  minutes: number;
  plans: BookingPlan[];
  selectedPlan: BookingPlan | null;
  /** Amount due before any discount, in euro. */
  total: number;

  clientFirstName: string;
  hasPastSessions: boolean;
  /** Phone found on the client's latest Acuity appointment. */
  knownPhone: string;

  /** Unused package credits for this service (§10.2), or null. */
  credits: { packageId: string; remaining: number } | null;
  /** All the client's bundles with sessions left (for the bundle cards). */
  activeBundles: UserPackage[];
  /** Refresh credits after a bundle code was linked. */
  markCreditsChanged: () => void;
  referralBalanceCents: number;
  /** Booking fields for the edge functions, or null if something is missing. */
  bookingRequest: () => BookingRequest | null;
  /** Records the booking: analytics, cache refresh, then the Done step. */
  completeBooking: (result: BookingResult) => void;
  /** The entry link (therapist/service/type params) for return URLs and saved state. */
  entry: string;
  resume: PaymentResume | null;
  clearResume: () => void;

  showMessage: (message: WizardMessage | null) => void;
  booked: BookedInfo | null;
  setBooked: (info: BookedInfo) => void;
}

export const WizardContext = createContext<WizardApi | null>(null);

export function useWizard(): WizardApi {
  const api = useContext(WizardContext);
  if (!api) throw new Error('useWizard must be used inside the booking wizard');
  return api;
}
