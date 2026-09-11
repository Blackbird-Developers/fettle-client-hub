import { useState } from "react";
import { NavLink } from "react-router-dom";
import { ArrowRight, Stethoscope, X } from "lucide-react";

const STORAGE_KEY = "fettle:announcement:psychiatry";

export function AnnouncementBar() {
  // Lazy initializer reads localStorage synchronously on the very first render
  // so the bar is either shown or hidden immediately — no layout shift on navigation
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true"
  );

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="relative bg-gradient-to-r from-primary via-accent to-primary text-primary-foreground">
      <div className="flex items-center justify-center gap-2 sm:gap-3 px-10 sm:px-12 py-2 sm:py-2.5">
        <Stethoscope className="hidden sm:inline-block h-4 w-4 flex-shrink-0" />
        <p className="text-xs sm:text-sm font-medium text-center">
          <span className="font-semibold">Online psychiatry</span>{" "}
          <span className="hidden sm:inline">
            — medication reviewed and managed by registered psychiatrists.
          </span>{" "}
          <NavLink
            to="/psychiatry"
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-90 transition-opacity"
          >
            Book a consultation
            <ArrowRight className="h-3.5 w-3.5" />
          </NavLink>
        </p>
      </div>
      <button
        onClick={handleDismiss}
        className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-primary-foreground/20 transition-colors"
        aria-label="Dismiss announcement"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
