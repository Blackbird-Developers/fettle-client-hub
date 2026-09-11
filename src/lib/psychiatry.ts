// Psychiatry service offered in the hub, mirroring fettle.ie/psychiatry.
//
// Only the initial consultation can be booked directly. It books the same
// Acuity type as the website's psychiatry widget ("Psychiatry Medication
// Appointment"), pooled across that type's calendars so Acuity assigns the
// psychiatrist. Its live price/duration come from Acuity, which is what the
// client is actually charged (€450 / 60 min at time of writing, matching the
// website).
//
// Follow-up reviews and repeat prescriptions are arranged by the psychiatrist
// after the consultation, so they are display-only with the website's pricing.

import type { AssessmentStage } from './assessments';

/** Acuity type for the bookable initial psychiatry consultation. */
export const PSYCHIATRY_CONSULTATION_TYPE_ID = 95879530;

/** The only psychiatry types bookable directly from the hub. */
export const PSYCHIATRY_BOOKABLE_TYPE_IDS = [PSYCHIATRY_CONSULTATION_TYPE_ID];

/** Later stages of the pathway, shown for context but not bookable. */
export const PSYCHIATRY_LATER_STAGES: AssessmentStage[] = [
    {
        label: 'Follow-up medication review',
        price: '€220',
        note: '30 min, about a month after your consultation.',
    },
    {
        label: 'Second follow-up',
        price: '€220',
        note: '30 min, only if your medication needs more fine-tuning.',
    },
    {
        label: 'Repeat prescriptions',
        price: '€50',
        note: 'Roughly every three months, sent to your pharmacy.',
    },
];

/**
 * Free 20-minute concierge call. The website books it in-page (Acuity type
 * 93169614, €0), but hub checkout only handles paid types, so the hub links
 * out for clients who aren't sure what they need.
 */
export const PSYCHIATRY_FREE_CALL_URL = 'https://fettle.ie/free-consultation/';

/**
 * Reasons offered by the website's psychiatry booking widget. All of them
 * start with the paid initial consultation; the website's fifth option,
 * "Something else / not sure", routes to the free call instead.
 */
export const PSYCHIATRY_REASONS = [
    'Medication for a recent diagnosis',
    'Medication review (already on medication)',
    'Repeat prescription',
    'Second opinion or report',
] as const;

/** "Where did you hear about Fettle?" values, as the website sends them. */
export const PSYCHIATRY_HEARD_ABOUT_OPTIONS = [
    { value: 'Google', label: 'Google' },
    { value: 'Social Media', label: 'Social media' },
    { value: 'Friend or Family', label: 'Friend or family' },
    { value: 'Other', label: 'Other' },
];

/** Acuity intake form fields the website sends for psychiatry bookings. */
export const PSYCHIATRY_INTAKE_FIELD_IDS = {
    heardAbout: 18105514,
    termsAccepted: 9291898,
};

/**
 * The booking notes travel to checkout in Stripe PaymentIntent metadata,
 * where each value is capped at 500 characters.
 */
export const PSYCHIATRY_NOTES_MAX_LENGTH = 500;

/** Clinical intake collected on the details step, as on the website. */
export interface PsychiatryIntake {
    reason: string;
    /** ISO date, e.g. "1990-04-21". */
    dateOfBirth: string;
    gp: string;
    medication: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    heardAbout: string;
}

export const EMPTY_PSYCHIATRY_INTAKE: PsychiatryIntake = {
    reason: '',
    dateOfBirth: '',
    gp: '',
    medication: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    heardAbout: '',
};

/**
 * Appointment notes for the psychiatrist, in the same shape the website's
 * widget writes them ("Reason: … | DOB: … | GP: …").
 */
export function buildPsychiatryNotes(
    intake: PsychiatryIntake,
    notes: string
): string {
    const parts = ['Source: my.fettle.ie psychiatry'];
    if (intake.reason) parts.push(`Reason: ${intake.reason}`);
    if (intake.dateOfBirth) parts.push(`DOB: ${intake.dateOfBirth}`);
    if (intake.gp.trim()) parts.push(`GP: ${intake.gp.trim()}`);
    if (intake.medication.trim()) {
        parts.push(`Current medication: ${intake.medication.trim()}`);
    }
    const emergencyContact = [
        intake.emergencyContactName.trim(),
        intake.emergencyContactPhone.trim(),
    ]
        .filter(Boolean)
        .join(' / ');
    if (emergencyContact) parts.push(`Emergency contact: ${emergencyContact}`);
    if (intake.heardAbout) parts.push(`Hear about: ${intake.heardAbout}`);
    if (notes.trim()) parts.push(`Notes: ${notes.trim()}`);
    return parts.join(' | ');
}

function toIsoDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** Latest date of birth that is 18 today (psychiatry is adults only). */
export function latestAdultDateOfBirth(): string {
    const today = new Date();
    return toIsoDate(
        new Date(today.getFullYear() - 18, today.getMonth(), today.getDate())
    );
}

export function isAdultDateOfBirth(dateOfBirth: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) &&
        dateOfBirth <= latestAdultDateOfBirth()
    );
}

// Every Acuity type that is a psychiatry appointment — the bookable
// consultation plus the types in Acuity's "Psychiatry" category (Psychiatry
// Assessment, Psychiatry Appointment, Follow Up Consultation, payment plan).
// Used to pick a client's psychiatry appointments out of their history.
const PSYCHIATRY_APPOINTMENT_TYPE_IDS = [
    PSYCHIATRY_CONSULTATION_TYPE_ID,
    57165366,
    56229647,
    56229698,
    63878915,
];

export function isPsychiatryAppointment(appointment: {
    type: string;
    appointmentTypeID?: number;
}): boolean {
    if (
        appointment.appointmentTypeID &&
        PSYCHIATRY_APPOINTMENT_TYPE_IDS.includes(appointment.appointmentTypeID)
    ) {
        return true;
    }
    return /psychiatr/i.test(appointment.type ?? '');
}
