import { LayoutDashboard, MonitorSmartphone, Repeat, UserPlus, type LucideIcon } from "lucide-react";
import { PROGRESSION_RANGES } from "../../supabase/functions/admin-customer-insights/logic.ts";

// Sections of the admin area. Drives both the admin sidebar and the /admin
// page; add new admin features here.
export type AdminSectionId = "overview" | "adoption" | "progression" | "team";

/** A page under a section, e.g. Progression → Session 2–3. */
export interface AdminSubsection {
  /** URL segment after the section, e.g. "2-3". */
  id: string;
  name: string;
  href: string;
  description: string;
}

export interface AdminSection {
  id: AdminSectionId;
  name: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** Sections with children have no page of their own: they open the first child. */
  children?: AdminSubsection[];
}

/** URL segment for the "session N → N+1" view, e.g. 2 → "2-3". */
export function progressionRangeSlug(fromSession: number): string {
  return `${fromSession}-${fromSession + 1}`;
}

/** The "from" session for a progression URL segment, or undefined if it isn't one. */
export function parseProgressionRange(slug: string | undefined): number | undefined {
  return PROGRESSION_RANGES.find((from) => progressionRangeSlug(from) === slug);
}

const PROGRESSION_SUBSECTIONS: AdminSubsection[] = PROGRESSION_RANGES.map((from) => ({
  id: progressionRangeSlug(from),
  name: `Session ${from}–${from + 1}`,
  href: `/admin/progression/${progressionRangeSlug(from)}`,
  description: `Customers who recently completed session ${from}, and whether they've completed or booked session ${from + 1}.`,
}));

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "overview",
    name: "Overview",
    href: "/admin",
    icon: LayoutDashboard,
    description: "Business metrics across sessions, packages and retention.",
  },
  {
    id: "adoption",
    name: "Portal adoption",
    href: "/admin/adoption",
    icon: MonitorSmartphone,
    description: "Recently active Acuity customers who don't have a My Fettle Hub account.",
  },
  {
    id: "progression",
    name: "Progression",
    href: "/admin/progression",
    icon: Repeat,
    description: "How customers progress from one session to the next.",
    children: PROGRESSION_SUBSECTIONS,
  },
  {
    id: "team",
    name: "Team",
    href: "/admin/team",
    icon: UserPlus,
    description: "Manage who has admin access.",
  },
];

export function getAdminSection(id: string | undefined): AdminSection | undefined {
  return ADMIN_SECTIONS.find((section) => section.id === (id ?? "overview"));
}

export type AdminRoute =
  | { section: AdminSection; subsection?: AdminSubsection }
  | { redirect: string };

// Resolves /admin/:section/:subsection to a page, or to where to redirect:
// unknown sections go to the overview, a section with children (or an unknown
// child) opens its first child, and a stray child segment is dropped.
export function resolveAdminRoute(
  sectionId: string | undefined,
  subsectionId: string | undefined
): AdminRoute {
  const section = getAdminSection(sectionId);
  if (!section) return { redirect: "/admin" };
  if (!section.children) {
    return subsectionId === undefined ? { section } : { redirect: section.href };
  }
  const subsection = section.children.find((child) => child.id === subsectionId);
  return subsection ? { section, subsection } : { redirect: section.children[0].href };
}

/** True when `pathname` is one of the section's child pages. */
export function hasActiveChild(
  children: { href: string }[] | undefined,
  pathname: string
): boolean {
  return !!children?.some((child) => child.href === pathname);
}
