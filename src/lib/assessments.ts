// Curated list of the assessments offered in the hub, in display order.
//
// Only the initial consultation (Acuity "screening" type) can be booked
// directly — the full assessment and follow-up stages are arranged by the
// clinical team after the consultation, so they are shown locked with an
// explanatory note rather than being bookable.
//
// ADHD and Autism assessments run on partner booking systems (ADHD Now /
// AutismCare), not Acuity, so they link out to the fettle.ie pages instead.
//
// Acuity appointment type IDs are verified against the live account and match
// the booking links on the fettle.ie assessment pages.

const FULL_ASSESSMENT_NOTE =
    'Booked only after your initial consultation, if recommended by the clinical team.';
const FOLLOW_UP_NOTE = 'Available once your full assessment is complete.';

export interface AssessmentTier {
    label: string;
    /** Acuity appointment type for this stage (used to show live pricing). */
    typeId: number;
    note: string;
}

export interface Assessment {
    name: string;
    /** Partner-run assessment — links out instead of booking through Acuity. */
    external?: { partner: string; url: string };
    /** Acuity type for the bookable initial consultation. */
    screeningTypeId?: number;
    /** Later stages shown for context but not directly bookable. */
    lockedTiers?: AssessmentTier[];
}

export const ASSESSMENTS: Assessment[] = [
    {
        name: 'ADHD Assessment',
        external: {
            partner: 'ADHD Now',
            url: 'https://fettle.ie/adhd-assessment/',
        },
    },
    {
        name: 'Autism Assessment',
        external: {
            partner: 'AutismCare',
            url: 'https://fettle.ie/autism-assesments/',
        },
    },
    {
        name: 'OCD Assessment',
        screeningTypeId: 92852936,
        lockedTiers: [
            { label: 'Full Assessment', typeId: 93759134, note: FULL_ASSESSMENT_NOTE },
            { label: 'Follow-Up Session', typeId: 94365786, note: FOLLOW_UP_NOTE },
        ],
    },
    {
        name: 'Anxiety Assessment',
        screeningTypeId: 92853020,
        lockedTiers: [
            { label: 'Full Assessment', typeId: 94070389, note: FULL_ASSESSMENT_NOTE },
            { label: 'Follow-Up Session', typeId: 94365810, note: FOLLOW_UP_NOTE },
        ],
    },
    {
        name: 'Depression Assessment',
        screeningTypeId: 92853161,
        lockedTiers: [
            { label: 'Full Assessment', typeId: 94070403, note: FULL_ASSESSMENT_NOTE },
            { label: 'Follow-Up Session', typeId: 94365860, note: FOLLOW_UP_NOTE },
        ],
    },
    {
        name: 'Addiction Assessment',
        screeningTypeId: 94856237,
    },
];

/** The only assessment types bookable directly from the hub. */
export const ASSESSMENT_SCREENING_TYPE_IDS = ASSESSMENTS.map(
    (a) => a.screeningTypeId
).filter((id): id is number => typeof id === 'number');
