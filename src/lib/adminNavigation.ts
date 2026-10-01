import { LayoutDashboard, MonitorSmartphone, Repeat, UserPlus, type LucideIcon } from "lucide-react";

// Sections of the admin area. Drives both the admin sidebar and the /admin
// page; add new admin features here.
export type AdminSectionId = "overview" | "adoption" | "progression" | "team";

export interface AdminSection {
  id: AdminSectionId;
  name: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

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
    description: "How first-time customers progress to their second session.",
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
