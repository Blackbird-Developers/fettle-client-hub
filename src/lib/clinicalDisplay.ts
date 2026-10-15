// Display helpers shared by the admin Psychiatry and Assessments pages.

export const BADGE_STYLES = {
  red: "bg-red-50 text-red-700 border-red-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-green-50 text-green-700 border-green-200",
  muted: "bg-muted text-muted-foreground border-border",
} as const;

export type BadgeTone = keyof typeof BADGE_STYLES;

/** Distinct, sorted Acuity calendar names (blank ones dropped). */
export function uniqueCalendars(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}
