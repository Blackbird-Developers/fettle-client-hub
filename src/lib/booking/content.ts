// Answer options shared by the booking wizard's steps, its summary card and
// the booking notes. Wording is the fettle.ie booking page's
// (docs/QUIZ_BOOKING_FLOW.md §3.1, §3.1b, §3.3).

import type { ConsultationKey, TherapyService } from './therapists';

export const WHO_OPTIONS: Record<TherapyService, { title: string; description: string; summary: string }> = {
  individual: { title: 'Just me', description: 'One-to-one therapy for you', summary: 'Individual therapy' },
  couples: { title: 'Me and my partner', description: 'Couples therapy, both partners attend', summary: 'Couples therapy' },
  youth: {
    title: 'My child or teenager',
    description: 'Youth therapy for young people, booked by a parent',
    summary: 'Youth therapy',
  },
};

export const CONSULTATION_OPTIONS: Record<ConsultationKey, { title: string; description: string }> = {
  depression: { title: 'Depression consultation', description: '30 minutes · PHQ-9 validated' },
  anxiety: { title: 'Anxiety consultation', description: '30 minutes · GAD-7 validated' },
  ocd: { title: 'OCD consultation', description: '30 minutes · Validated screening' },
};

export type TherapyHistory = 'first' | 'past' | 'switching';

export const HISTORY_OPTIONS: Record<
  TherapyHistory,
  { title: string; youthTitle: string; description: string; reply: string }
> = {
  first: {
    title: 'This is my first time',
    youthTitle: 'This is their first time',
    description: 'Never tried therapy before',
    reply: 'Taking the first step is often the hardest part. We’ll keep the rest simple.',
  },
  past: {
    title: 'I’ve had therapy before',
    youthTitle: 'They’ve had therapy before',
    description: 'Coming back to it',
    reply: 'Welcome back. Your therapist will build on what’s helped you before.',
  },
  switching: {
    title: 'I’m looking to switch therapist',
    youthTitle: 'They’re switching therapist',
    description: 'Currently seeing someone',
    reply: 'Finding the right fit matters. You’re in good hands.',
  },
};

/** Session length in minutes for each kind of booking. */
export const SESSION_MINUTES: Record<TherapyService | 'psychologist', number> = {
  individual: 50,
  couples: 60,
  youth: 60,
  psychologist: 30,
};
