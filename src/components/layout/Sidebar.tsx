import { useState } from "react";
import { Calendar, Home, FileText, User, LogOut, Plus, Menu, X, Shield } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useAdmin";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { name: "My Sessions", href: "/sessions", icon: Calendar },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Profile", href: "/profile", icon: User },
];

const adminNavigation = [
  { name: "Admin", href: "/admin", icon: Shield },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { data: isAdmin } = useIsAdmin();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const displayName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ''}`.trim()
    : profile?.email || 'User';

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
          const isActive = location.pathname === item.href;
          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 2xl:gap-3 px-3 2xl:px-4 py-2.5 2xl:py-3 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
              {item.name}
            </NavLink>
          );
        })}

        {/* Admin Navigation - only visible to admins */}
        {isAdmin && (
          <>
            <div className="my-3 border-t border-sidebar-border" />
            {adminNavigation.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5 2xl:gap-3 px-3 2xl:px-4 py-2.5 2xl:py-3 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-amber-500 text-white shadow-soft"
                      : "text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                  )}
                >
                  <item.icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
                  {item.name}
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

      {/* Sticky bottom section */}
      <div className="flex-shrink-0 bg-sidebar">
        {/* Book Session CTA */}
        <div className="px-3 2xl:px-4 pb-3 2xl:pb-4">
          <Button className="w-full gap-2 shadow-soft text-sm" size="default" asChild onClick={onNavigate}>
            <NavLink to="/sessions">
              <Plus className="h-4 w-4" />
              Book Session
            </NavLink>
          </Button>
        </div>

        {/* User section */}
        <div className="border-t border-sidebar-border p-3 2xl:p-4">
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
        <span className="font-heading text-lg sm:text-xl font-bold text-primary">fettle</span>
        <span className="ml-1 text-xs text-muted-foreground">.ie</span>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="xl:hidden h-9 w-9 sm:h-10 sm:w-10">
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
