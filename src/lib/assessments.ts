// Curated list of the assessments offered in the hub, in display order.
// Stage structure, pricing and wording mirror the fettle.ie assessment pages
// (ocd/anxiety/depression/addiction pages + the ADHD Now and AutismCare
// partner pages).
//
// Only the stage-1 consultation (Acuity "screening" type) can be booked
// directly — its live price/duration come from Acuity, which is what the
// client is actually charged. Later stages are display-only: they are
// arranged by the clinical team after the consultation, so they are shown
// locked with the website's pricing and conditional notes.
//
// ADHD and Autism assessments run on partner booking systems (ADHD Now /
// AutismCare), not Acuity, so their cards are informational and link out to
// the fettle.ie pages.

export interface AssessmentStage {
    label: string;
    /** Display price, e.g. "€650" or "From €80/session" (not charged in-hub). */
    price: string;
    note: string;
}

export interface Assessment {
    name: string;
    /** Partner-run assessment — links out instead of booking through Acuity. */
    external?: { partner: string; url: string };
    /** Acuity type for the bookable stage-1 consultation. */
    screeningTypeId?: number;
    /** Label for the bookable stage, matching the website's pricing table. */
    screeningLabel?: string;
    /**
     * Price (EUR, e.g. "140.00") shown AND charged instead of the Acuity
     * type's listed price. The fettle.ie booking widgets do the same: the
     * addiction page books Acuity type 94856237 but charges €140 through its
     * own Stripe flow, while the Acuity record still lists €89.
     */
    priceOverride?: string;
    /**
     * Duration (minutes) shown instead of the Acuity type's listed duration,
     * matching the website's copy (the addiction page sells a 1-hour
     * assessment while the Acuity record says 30 min). Display-only — Acuity
     * still blocks its own listed duration in the clinician's calendar.
     */
    durationOverride?: number;
    /** Later stages shown for context but not bookable in the hub. */
    lockedStages?: AssessmentStage[];
    /** Stages shown on partner cards (all booked via the partner). */
    partnerStages?: AssessmentStage[];
}

const CLINICAL_STAGES: AssessmentStage[] = [
    {
        label: 'Full clinical assessment',
        price: '€650',
        note: 'Booked only after your initial consultation, if recommended by your psychologist.',
    },
    {
        label: 'Aftercare therapy',
        price: 'From €80/session',
        note: 'Available once your clinical assessment is complete.',
    },
];

export const ASSESSMENTS: Assessment[] = [
    {
        name: 'OCD Assessment',
        screeningTypeId: 92852936,
        screeningLabel: 'Consultation + screening',
        lockedStages: CLINICAL_STAGES,
    },
    {
        name: 'Anxiety Assessment',
        screeningTypeId: 92853020,
        screeningLabel: 'Consultation + screening',
        lockedStages: CLINICAL_STAGES,
    },
    {
        name: 'Depression Assessment',
        screeningTypeId: 92853161,
        screeningLabel: 'Consultation + screening',
        lockedStages: CLINICAL_STAGES,
    },
    {
        name: 'Addiction Assessment',
        screeningTypeId: 94856237,
        screeningLabel: 'Addiction assessment',
        priceOverride: '140.00',
        durationOverride: 60,
    },
    {
        name: 'ADHD Assessment',
        external: {
            partner: 'ADHD Now',
            url: 'https://fettle.ie/adhd-assessment/',
        },
        partnerStages: [
            { label: 'Initial Consultation', price: '€89', note: '' },
            { label: 'Full Assessment', price: '€695', note: 'If recommended' },
            { label: 'Diagnosis & Report', price: '€495', note: 'After assessment' },
        ],
    },
    {
        name: 'Autism Assessment',
        external: {
            partner: 'AutismCare',
            url: 'https://fettle.ie/autism-assesments/',
        },
        partnerStages: [
            { label: 'Pre-Assessment', price: '€89', note: '' },
            { label: 'Assessment & Diagnosis', price: '€1,199', note: 'If suitable' },
            { label: 'Report & Support Plan', price: '€599', note: 'After assessment' },
        ],
    },
];

/** The only assessment types bookable directly from the hub. */
export const ASSESSMENT_SCREENING_TYPE_IDS = ASSESSMENTS.map(
    (a) => a.screeningTypeId
).filter((id): id is number => typeof id === 'number');

/**
 * Price override for an Acuity appointment type, when the assessment is sold
 * at a different price than the Acuity record lists (see priceOverride).
 */
export function getAssessmentPriceOverride(
    appointmentTypeId: number
): string | undefined {
    return ASSESSMENTS.find((a) => a.screeningTypeId === appointmentTypeId)
        ?.priceOverride;
}

/**
 * Display duration override for an Acuity appointment type (see
 * durationOverride).
 */
export function getAssessmentDurationOverride(
    appointmentTypeId: number
): number | undefined {
    return ASSESSMENTS.find((a) => a.screeningTypeId === appointmentTypeId)
        ?.durationOverride;
}
