// Therapist name rules for the booking wizard. These mirror the lists on the
// fettle.ie booking page (/book-a-session), the therapist directory and the
// pathway quiz, so a therapist is treated the same way everywhere. Keep them
// in this one module.

/** Not taking new clients: not bookable, the intro offers matching instead. */
export const NOT_ACCEPTING = ['Ana Moore'];

/** Hidden from booking altogether. */
export const HIDDEN = ['Janet Homan'];

/** Never suggested by matching, but still bookable directly. */
export const MATCHING_EXCLUDED = ['Emma Keane', 'Brendan Slattery', 'Doreen Maher'];

/** Never offered for youth therapy. */
export const YOUTH_EXCLUDED = ['Fergal Clancy'];

/** Ranked first in matches, in this order. */
export const PINNED = ['Lisa Kelly', 'Nicole Dunne', 'Olivia Fahy'];

/**
 * Comparable form of a name: no accents, apostrophes or punctuation, single
 * spaces, lower case. "Cara Bourke O’Shaughnessy" → "cara bourke oshaughnessy".
 */
export function normaliseName(name: string | null | undefined): string {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’'`´]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * True when the name is on the list. An entry also matches a longer name that
 * starts with it ("Ana Moore" matches "Ana Moore Byrne").
 */
export function isNameInList(name: string | null | undefined, list: string[]): boolean {
  const n = normaliseName(name);
  if (!n) return false;
  return list.some((entry) => {
    const e = normaliseName(entry);
    return n === e || n.startsWith(`${e} `);
  });
}

/** Position in the pinned list (0 = first), or -1. */
export function pinnedRank(name: string | null | undefined): number {
  const n = normaliseName(name);
  return PINNED.findIndex((entry) => normaliseName(entry) === n);
}
