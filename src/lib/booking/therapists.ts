// Therapist rules for the booking wizard, read from the live
// fettleschema.therapists_duplicate table: which services a therapist offers,
// whether they can be booked, and how a link finds them. Mirrors the fettle.ie
// booking page (docs/QUIZ_BOOKING_FLOW.md §4.2, §4.3, §8).

import { HIDDEN, NOT_ACCEPTING, YOUTH_EXCLUDED, isNameInList, normaliseName } from './nameLists';

/** A row of fettleschema.therapists_duplicate (only the columns the wizard uses). */
export interface TherapistRow {
  id: number | string;
  name: string;
  url?: string | null;
  calendarid?: string | number | null;
  imageurl?: string | null;
  status?: string | null;
  tag1?: string | null;
  tag2?: string | null;
  tag3?: string | null;
  tag4?: string | null;
  tag5?: string | null;
  tags?: string[] | null;
  tags2?: string | null;
  appointmentidindividual?: string | number | null;
  appointmentidcouples?: string | number | null;
  appointmentidyouth?: string | number | null;
  quote?: string | null;
  Accreditation?: string | null;
  isPsychologist?: string | boolean | number | null;
  ocdAssessment?: string | number | null;
  anxietyAssessment?: string | number | null;
  depressionAssessment?: string | number | null;
}

export type TherapyService = 'individual' | 'couples' | 'youth';
export type ConsultationKey = 'depression' | 'anxiety' | 'ocd';

/** Collection of Acuity type ids that are public; ids are compared as strings. */
export type PublicTypeIds = ReadonlySet<string>;

/**
 * True when a table value is filled in. Empty values in the live table come
 * as null, "" or the string "NULL".
 */
export function isSet(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return s !== '' && s.toUpperCase() !== 'NULL';
}

function idOf(value: unknown): string | null {
  return isSet(value) ? String(value).trim() : null;
}

/** One tag in the comparable form: "Self esteem," → "self-esteem". */
export function normaliseTag(tag: unknown): string {
  let t = String(tag ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s,.;:]+$/, '')
    .replace(/\s+/g, ' ');
  if (t === 'self esteem') t = 'self-esteem';
  if (t === 'eating-disorders') t = 'eating disorders';
  return t;
}

/** All of a therapist's tags (tag1–tag5, tags[], comma-separated tags2), normalised. */
export function therapistTags(row: TherapistRow): Set<string> {
  const raw: unknown[] = [row.tag1, row.tag2, row.tag3, row.tag4, row.tag5];
  if (Array.isArray(row.tags)) raw.push(...row.tags);
  if (typeof row.tags2 === 'string') raw.push(...row.tags2.split(','));
  const out = new Set<string>();
  for (const tag of raw) {
    const t = normaliseTag(tag);
    if (t && t.toUpperCase() !== 'NULL') out.add(t);
  }
  return out;
}

export function isPsychologist(row: TherapistRow): boolean {
  const v = row.isPsychologist;
  return v === true || v === 1 || /^(true|1|yes)$/i.test(String(v ?? '').trim());
}

/** Raw column value for a consultation, accepting the case/underscore variants. */
function consultationColumn(row: TherapistRow, key: ConsultationKey): unknown {
  const r = row as unknown as Record<string, unknown>;
  const wanted = `${key}assessment`;
  for (const column of Object.keys(r)) {
    if (column.toLowerCase().replace(/_/g, '') === wanted && isSet(r[column])) return r[column];
  }
  return null;
}

const CONSULTATION_ORDER: ConsultationKey[] = ['depression', 'anxiety', 'ocd'];

function isPublic(typeId: string, publicTypeIds?: PublicTypeIds): boolean {
  return !publicTypeIds || publicTypeIds.has(typeId);
}

/** Consultations a psychologist offers, in display order, with their Acuity type ids. */
export function consultationsOffered(
  row: TherapistRow,
  publicTypeIds?: PublicTypeIds
): { key: ConsultationKey; typeId: string }[] {
  if (!isPsychologist(row)) return [];
  return CONSULTATION_ORDER.map((key) => ({ key, typeId: idOf(consultationColumn(row, key)) }))
    .filter((c): c is { key: ConsultationKey; typeId: string } => !!c.typeId && isPublic(c.typeId, publicTypeIds));
}

/** The therapist's own Acuity type for a service, or null. */
export function sessionTypeId(row: TherapistRow, service: TherapyService): string | null {
  const value =
    service === 'couples'
      ? row.appointmentidcouples
      : service === 'youth'
        ? row.appointmentidyouth
        : row.appointmentidindividual;
  return idOf(value);
}

/**
 * Whether the therapist offers a service (§4.2). When the public Acuity type
 * ids are given, a type that isn't public counts as not offered.
 */
export function offersService(
  row: TherapistRow,
  service: TherapyService,
  publicTypeIds?: PublicTypeIds
): boolean {
  const typeId = sessionTypeId(row, service);
  if (!typeId || !isPublic(typeId, publicTypeIds)) return false;
  if (service === 'individual') return true;
  const tags = therapistTags(row);
  if (service === 'couples') return tags.has('couples');
  return (tags.has('youth') || tags.has('teen')) && !isNameInList(row.name, YOUTH_EXCLUDED);
}

/** Therapy services the therapist offers, in the order the wizard lists them. */
export function servicesOffered(row: TherapistRow, publicTypeIds?: PublicTypeIds): TherapyService[] {
  return (['individual', 'couples', 'youth'] as TherapyService[]).filter((s) =>
    offersService(row, s, publicTypeIds)
  );
}

export type BlockedReason = 'not_accepting' | 'no_services' | 'no_consultations';

/** Active and not on the hidden or not-accepting lists. */
export function isBookable(row: TherapistRow): boolean {
  return (
    String(row.status ?? '').trim().toLowerCase() === 'active' &&
    !isNameInList(row.name, HIDDEN) &&
    !isNameInList(row.name, NOT_ACCEPTING)
  );
}

/** Why the intro must block this therapist, or null when they can be booked. */
export function blockedReason(row: TherapistRow, publicTypeIds?: PublicTypeIds): BlockedReason | null {
  if (!isBookable(row)) return 'not_accepting';
  if (isPsychologist(row)) {
    return consultationsOffered(row, publicTypeIds).length ? null : 'no_consultations';
  }
  return servicesOffered(row, publicTypeIds).length ? null : 'no_services';
}

/** Last part of the fettle.ie profile URL, e.g. "elaine-o-dwyer". */
export function profileSlug(row: TherapistRow): string | null {
  const url = String(row.url ?? '').trim().toLowerCase().replace(/\/+$/, '');
  if (!url) return null;
  return url.split('/').pop() || null;
}

/**
 * Finds the therapist a link points to. The param may be the table id, the
 * Acuity calendar id, the profile slug or the name (§8), tried in that order.
 */
export function findTherapist(
  param: string | number | null | undefined,
  rows: TherapistRow[]
): TherapistRow | null {
  if (param === null || param === undefined) return null;
  const p = String(param).trim();
  if (!p) return null;

  const byId = rows.find((r) => String(r.id) === p);
  if (byId) return byId;

  const byCalendar = rows.find((r) => isSet(r.calendarid) && String(r.calendarid).trim() === p);
  if (byCalendar) return byCalendar;

  const slug = p.toLowerCase().replace(/^\/+|\/+$/g, '');
  const bySlug = rows.find((r) => profileSlug(r) === slug);
  if (bySlug) return bySlug;

  const n = normaliseName(p.replace(/-/g, ' '));
  if (!n) return null;
  return (
    rows.find((r) => normaliseName(r.name) === n) ??
    rows.find((r) => {
      const rn = normaliseName(r.name);
      return !!rn && (rn.startsWith(n) || n.startsWith(rn));
    }) ??
    null
  );
}

/** "Elaine O'Dwyer" → "Elaine". */
export function firstNameOf(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] || 'your therapist';
}

/** Badge text from the Accreditation column: "APCPPre" → "APCP Pre-Accredited", "PSIFull" → "PSI Accredited". */
export function accreditationLabel(value: string | null | undefined): string | null {
  const raw = String(value ?? '').toLowerCase().replace(/[\s_-]/g, '');
  const m = raw.match(/^([a-z]+?)(ful|full|pre)$/);
  if (!m) return null;
  const org = m[1].toUpperCase();
  return m[2] === 'pre' ? `${org} Pre-Accredited` : `${org} Accredited`;
}

/** Calendar id as a number for the Acuity calls, or null. */
export function calendarIdOf(row: TherapistRow): number | null {
  const id = idOf(row.calendarid);
  const n = id === null ? NaN : Number(id);
  return Number.isFinite(n) ? n : null;
}
