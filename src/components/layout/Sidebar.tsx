import { useState } from "react";
import {
  Calendar,
  Home,
  FileText,
  User,
  LogOut,
  LogIn,
  Plus,
  Menu,
  HelpCircle,
  Gift,
  Stethoscope,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useAdmin";
import { ADMIN_SECTIONS, hasActiveChild } from "@/lib/adminNavigation";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  /** Renders the item as an expandable group of these pages. */
  children?: { name: string; href: string }[];
}

const authenticatedNavigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { name: "My Sessions", href: "/sessions", icon: Calendar },
  { name: "Psychiatry", href: "/psychiatry", icon: Stethoscope },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Profile", href: "/profile", icon: User },
  { name: "Refer & Earn", href: "/referrals", icon: Gift },
  { name: "Help Center", href: "/help", icon: HelpCircle },
];

const publicNavigation: NavItem[] = [
  { name: "Help Center", href: "/help", icon: HelpCircle },
];

// Admins only get the admin area — no customer pages or booking.
const adminNavigation: NavItem[] = ADMIN_SECTIONS.map(({ name, href, icon, children }) => ({
  name,
  href,
  icon,
  children: children?.map((child) => ({ name: child.name, href: child.href })),
}));

const navItemClass =
  "flex items-center gap-2.5 2xl:gap-3 px-3 2xl:px-4 py-2.5 2xl:py-3 rounded-lg text-sm font-medium transition-all duration-200";
const activeNavItemClass = "bg-primary text-primary-foreground shadow-soft";
const inactiveNavItemClass =
  "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

// An expandable item (e.g. Progression). It stays open while one of its pages
// is active; otherwise the chevron toggles it.
function NavGroup({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const childActive = hasActiveChild(item.children, pathname);
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = childActive || manuallyOpen;

  return (
    <Collapsible open={open} onOpenChange={(next) => !childActive && setManuallyOpen(next)}>
      <CollapsibleTrigger
        className={cn(
          navItemClass,
          "w-full text-left",
          childActive ? "text-primary bg-primary/5" : inactiveNavItemClass
        )}
      >
        <item.icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
        <span className="flex-1">{item.name}</span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-5 2xl:ml-6 space-y-1 border-l border-sidebar-border pl-2">
        {item.children?.map((child) => {
          const isActive = pathname === child.href;
          return (
            <NavLink
              key={child.href}
              to={child.href}
              end
              onClick={onNavigate}
              className={cn(
                "block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                isActive ? activeNavItemClass : inactiveNavItemClass
              )}
            >
              {child.name}
            </NavLink>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, user, signOut } = useAuth();
  const { data: isAdmin } = useIsAdmin();
  const adminMode = !!user && isAdmin === true;

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const displayName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ""}`.trim()
    : profile?.email || "User";

  const navigation = adminMode
    ? adminNavigation
    : user
      ? authenticatedNavigation
      : publicNavigation;

  const bookSessionHref = user
    ? "/sessions"
    : `/login?returnTo=${encodeURIComponent("/sessions")}`;

  const currentReturnTo = encodeURIComponent(
    location.pathname + location.search
  );

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-14 2xl:h-16 items-center px-4 2xl:px-6 border-b border-sidebar-border flex-shrink-0">
        <span className="font-heading text-xl 2xl:text-2xl font-bold text-primary">
          fettle
        </span>
        <span className="ml-1 text-xs text-muted-foreground">.ie</span>
      </div>

      {/* Navigation - scrollable */}
      <nav className="flex-1 px-3 2xl:px-4 py-4 2xl:py-6 space-y-1.5 2xl:space-y-2 overflow-y-auto">
        {navigation.map((item) => {
          if (item.children) {
            return <NavGroup key={item.name} item={item} onNavigate={onNavigate} />;
          }
          const isActive =
            item.href === "/help"
              ? location.pathname.startsWith("/help")
              : location.pathname === item.href;
          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={onNavigate}
              className={cn(navItemClass, isActive ? activeNavItemClass : inactiveNavItemClass)}
            >
              <item.icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
              <span className="flex-1">{item.name}</span>
              {item.badge ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none",
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-accent text-accent-foreground"
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>

      {/* Sticky bottom section */}
      <div className="flex-shrink-0 bg-sidebar">
        {/* Book Session CTA (customers and visitors only) */}
        {!adminMode && (
          <div className="px-3 2xl:px-4 pb-3 2xl:pb-4">
            <Button
              className="w-full gap-2 shadow-soft text-sm"
              size="default"
              asChild
              onClick={onNavigate}
            >
              <NavLink to={bookSessionHref}>
                <Plus className="h-4 w-4" />
                Book Session
              </NavLink>
            </Button>
          </div>
        )}

        {/* User section OR Log in button */}
        <div className="border-t border-sidebar-border p-3 2xl:p-4">
          {user ? (
            <div className="flex items-center gap-2 2xl:gap-3">
              <div className="h-8 w-8 2xl:h-10 2xl:w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-4 w-4 2xl:h-5 2xl:w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs 2xl:text-sm font-medium text-sidebar-foreground truncate">
                  {displayName}
                </p>
                <p className="text-[10px] 2xl:text-xs text-muted-foreground truncate">
                  {profile?.email}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                className="p-1.5 2xl:p-2 rounded-lg hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-accent-foreground transition-colors"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
              </button>
            </div>
          ) : (
            <Button
              variant="default"
              className="w-full gap-2 shadow-soft"
              asChild
              onClick={onNavigate}
            >
              <NavLink to={`/login?returnTo=${currentReturnTo}`}>
                <LogIn className="h-4 w-4" />
                Log in
              </NavLink>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="xl:hidden flex items-center justify-between h-14 sm:h-16 px-3 sm:px-4 border-b border-border bg-sidebar">
      <div className="flex items-center">
        <span className="font-heading text-lg sm:text-xl font-bold text-primary">
          fettle
        </span>
        <span className="ml-1 text-xs text-muted-foreground">.ie</span>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden h-9 w-9 sm:h-10 sm:w-10"
          >
            <Menu className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="sr-only">Toggle menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] sm:w-72 p-0 bg-sidebar">
          <div className="flex h-full flex-col">
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 2xl:w-64 flex-col bg-sidebar">
      <SidebarContent />
    </aside>
  );
}
