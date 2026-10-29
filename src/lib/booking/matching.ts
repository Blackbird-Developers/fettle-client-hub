// Matching for clients who haven't chosen a therapist
// (docs/QUIZ_BOOKING_FLOW.md §6). Topic chips, the eligibility rules and the
// score are the fettle.ie booking page's, including the "earliest time" bonus
// (Q23: 1.5 minus the weeks until the first open time, never below 0).

import { MATCHING_EXCLUDED, isNameInList, pinnedRank } from './nameLists';
import {
  type PublicTypeIds,
  type TherapistRow,
  type TherapyService,
  isBookable,
  isPsychologist,
  offersService,
  therapistTags,
} from './therapists';
import { daysBetweenKeys } from './time';

export interface Topic {
  id: string;
  label: string;
  /** Therapist tags this topic matches. */
  tags: string[];
}

export const UNSURE_TOPIC_ID = 'unsure';

const UNSURE: Topic = { id: UNSURE_TOPIC_ID, label: 'Not sure yet', tags: [] };

export const TOPICS: Record<TherapyService, Topic[]> = {
  individual: [
    { id: 'anxiety', label: 'Anxiety and worry', tags: ['anxiety', 'ocd'] },
    { id: 'low-mood', label: 'Low mood', tags: ['depression'] },
    { id: 'stress', label: 'Stress and burnout', tags: ['stress'] },
    { id: 'relationships', label: 'Relationships', tags: ['relationships'] },
    { id: 'trauma', label: 'Trauma', tags: ['trauma', 'ptsd', 'abuse'] },
    { id: 'loss', label: 'Grief and loss', tags: ['loss', 'grief'] },
    { id: 'self-esteem', label: 'Self-esteem', tags: ['self-esteem', 'identity'] },
    { id: 'anger', label: 'Anger', tags: ['anger', 'anger management'] },
    { id: 'addiction', label: 'Addiction', tags: ['addiction'] },
    { id: 'adhd', label: 'ADHD', tags: ['adhd'] },
    UNSURE,
  ],
  couples: [
    { id: 'communication', label: 'Communication', tags: ['couples', 'relationships'] },
    { id: 'conflict', label: 'Frequent arguments', tags: ['couples', 'relationships'] },
    { id: 'trust', label: 'Trust or infidelity', tags: ['couples', 'relationships'] },
    { id: 'intimacy', label: 'Intimacy and connection', tags: ['couples', 'sexuality'] },
    { id: 'life-change', label: 'A big life change', tags: ['couples', 'stress'] },
    { id: 'future', label: 'Deciding our future', tags: ['couples', 'relationships'] },
    UNSURE,
  ],
  youth: [
    { id: 'anxiety', label: 'Anxiety and worry', tags: ['anxiety'] },
    { id: 'low-mood', label: 'Low mood', tags: ['depression'] },
    { id: 'school', label: 'School stress', tags: ['stress'] },
    { id: 'friends', label: 'Friendships or bullying', tags: ['relationships', 'self-esteem'] },
    { id: 'self-esteem', label: 'Self-esteem', tags: ['self-esteem'] },
    { id: 'behaviour', label: 'Anger or behaviour', tags: ['anger'] },
    UNSURE,
  ],
};

export const UNSURE_REPLY =
  'That’s completely fine. Many people start without knowing exactly what to say, and working it out together is part of the process.';

function chosenTopics(service: TherapyService, topicIds: string[]): Topic[] {
  return TOPICS[service].filter((t) => topicIds.includes(t.id));
}

/** True when "Not sure yet" is the only topic picked. */
export function isOnlyUnsure(topicIds: string[]): boolean {
  return topicIds.length === 1 && topicIds[0] === UNSURE_TOPIC_ID;
}

/** The chosen topics this therapist matches (ignoring the plain "couples" tag). */
export function matchedTopics(row: TherapistRow, service: TherapyService, topicIds: string[]): Topic[] {
  const tags = therapistTags(row);
  return chosenTopics(service, topicIds).filter((t) => t.tags.some((tag) => tag !== 'couples' && tags.has(tag)));
}

/** Bookable, not a psychologist, not excluded from matching, and offers the service. */
export function isMatchCandidate(row: TherapistRow, service: TherapyService, publicTypeIds?: PublicTypeIds): boolean {
  return (
    isBookable(row) &&
    !isPsychologist(row) &&
    !isNameInList(row.name, MATCHING_EXCLUDED) &&
    offersService(row, service, publicTypeIds)
  );
}

/**
 * Earliest open day for a therapist: a "yyyy-MM-dd" key, null when they have
 * no times, undefined while it is still loading.
 */
export type EarliestDay = string | null | undefined;

export const PINNED_BONUS = [1.5, 1.3, 1.1];
export const MAX_SOONEST_BONUS = 1.5;
export const NO_TIMES_PENALTY = -5;

export function scoreTherapist(
  row: TherapistRow,
  service: TherapyService,
  topicIds: string[],
  earliest: EarliestDay,
  todayKey: string
): number {
  const tags = therapistTags(row);
  const wanted = new Set(chosenTopics(service, topicIds).flatMap((t) => t.tags));
  let score = 0;
  wanted.forEach((tag) => {
    if (tag !== 'couples' && tags.has(tag)) score += 2;
  });
  const pin = pinnedRank(row.name);
  if (pin !== -1) score += PINNED_BONUS[pin] ?? 0;
  if (earliest === null) score += NO_TIMES_PENALTY;
  else if (earliest) {
    const weeks = Math.max(0, daysBetweenKeys(todayKey, earliest)) / 7;
    score += Math.max(0, MAX_SOONEST_BONUS - weeks);
  }
  return score;
}

export interface RankedTherapist {
  therapist: TherapistRow;
  score: number;
  matched: Topic[];
}

/** Candidates for the service, highest score first (stable for equal scores). */
export function rankTherapists(
  rows: TherapistRow[],
  service: TherapyService,
  topicIds: string[],
  earliestById: Record<string, EarliestDay>,
  todayKey: string,
  publicTypeIds?: PublicTypeIds
): RankedTherapist[] {
  return rows
    .filter((row) => isMatchCandidate(row, service, publicTypeIds))
    .map((row, index) => ({
      index,
      therapist: row,
      score: scoreTherapist(row, service, topicIds, earliestById[String(row.id)], todayKey),
      matched: matchedTopics(row, service, topicIds),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ therapist, score, matched }) => ({ therapist, score, matched }));
}
