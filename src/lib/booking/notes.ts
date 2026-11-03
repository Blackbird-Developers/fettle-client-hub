// The notes string sent with a wizard booking (docs/QUIZ_BOOKING_FLOW.md
// §4.5). Notes travel in Stripe PaymentIntent metadata, whose values are
// capped at 500 characters, so the client's own note is trimmed first.

import { HISTORY_OPTIONS, WHO_OPTIONS, type TherapyHistory } from './content';
import { TOPICS } from './matching';
import type { TherapyService } from './therapists';

export const NOTES_MAX_LENGTH = 500;

export interface NotesInput {
  service: TherapyService | 'psychologist';
  topicIds?: string[];
  history?: TherapyHistory | null;
  youngPersonName?: string;
  partnerName?: string;
  clientNote?: string;
}

export function buildBookingNotes(input: NotesInput): string {
  const { service } = input;
  const youth = service === 'youth';
  const parts = ['Booked via My Fettle (quiz flow).'];
  parts.push(
    `For: ${service === 'psychologist' ? 'psychology consultation' : WHO_OPTIONS[service].summary.toLowerCase()}.`
  );
  if (service !== 'psychologist' && input.topicIds?.length) {
    const labels = TOPICS[service].filter((t) => input.topicIds!.includes(t.id)).map((t) => t.label.toLowerCase());
    if (labels.length) parts.push(`Focus: ${labels.join(', ')}.`);
  }
  if (input.history) {
    const h = HISTORY_OPTIONS[input.history];
    parts.push(`Therapy before: ${youth ? h.youthTitle : h.title}.`);
  }
  const young = input.youngPersonName?.trim();
  if (youth && young) parts.push(`Young person: ${young}.`);
  const partner = input.partnerName?.trim();
  if (service === 'couples' && partner) parts.push(`Partner: ${partner}.`);

  const head = parts.join(' ');
  const note = input.clientNote?.trim().replace(/\s+/g, ' ');
  if (!note) return head.slice(0, NOTES_MAX_LENGTH);

  const prefix = `${head} Client note: `;
  const room = NOTES_MAX_LENGTH - prefix.length;
  if (room <= 1) return head.slice(0, NOTES_MAX_LENGTH);
  return prefix + (note.length <= room ? note : `${note.slice(0, room - 1)}…`);
}
