import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Phone, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  OUTAGE_NOTICE,
  dublinHour,
  isExcludedPath,
  outageDismissKey,
  phoneLinesOpen,
  whatsappHref,
} from "@/lib/outageNotice";

type DataLayerWindow = Window & { dataLayer?: Record<string, unknown>[] };

function track(event: string, extra: Record<string, unknown> = {}) {
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event, outage_id: OUTAGE_NOTICE.OUTAGE_ID, ...extra });
}

// Remembered in localStorage (shared by every tab), keyed to the user's
// current sign-in, so it shows once per login session: not on every page,
// reload or new tab, but again after they sign out and back in.
const readSeen = (key: string) => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

const writeSeen = (key: string) => {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* private mode: shows once per page view */
  }
};

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.43 9.43 0 01-4.8-1.32l-.35-.21-3.57.94.95-3.48-.22-.36a9.4 9.4 0 01-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44 2.52 0 4.89.99 6.67 2.77a9.37 9.37 0 012.76 6.68c0 5.2-4.24 9.44-9.44 9.44zm8.04-17.48A11.3 11.3 0 0012.04.69C5.77.69.67 5.79.67 12.06c0 2 .52 3.96 1.52 5.68L.57 23.69l6.08-1.6a11.33 11.33 0 005.39 1.37h.01c6.27 0 11.37-5.1 11.37-11.37 0-3.04-1.18-5.89-3.34-8.04z" />
    </svg>
  );
}

/**
 * Site-wide popup while Fettle's Outlook is down, steering clients to
 * WhatsApp or phone. Mirrors the fettle.ie popup in the dashboard's look.
 * Mounted by DashboardLayout for signed-in clients only, so it never shows
 * on login/signup or to admins. Once per login session (per OUTAGE_ID).
 */
export function OutageNoticeModal() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const key = outageDismissKey(OUTAGE_NOTICE.OUTAGE_ID, user?.id, user?.last_sign_in_at);
  const excluded = isExcludedPath(pathname);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!OUTAGE_NOTICE.ENABLED || !user || excluded || readSeen(key)) return;
    const timer = window.setTimeout(() => {
      // Re-check: another tab may have shown it during the delay.
      if (readSeen(key)) return;
      // Counts as seen the moment it opens, so the next page never repeats it.
      writeSeen(key);
      setOpen(true);
      track("outage_popup_shown");
    }, OUTAGE_NOTICE.DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [excluded, key, user]);

  // Navigating into /admin while it's open closes it without counting as seen.
  useEffect(() => {
    if (excluded) setOpen(false);
  }, [excluded]);

  const linesOpen = useMemo(() => (open ? phoneLinesOpen(dublinHour()) : null), [open]);

  if (!OUTAGE_NOTICE.ENABLED) return null;

  const dismiss = (method: string) => {
    setOpen(false);
    track("outage_popup_dismissed", { close_method: method });
  };

  const contacted = (channel: "whatsapp" | "call") => {
    track(`outage_popup_${channel}_click`);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss("escape_or_backdrop")}>
      <DialogContent
        hideCloseButton
        className="max-w-[calc(100%-1rem)] sm:max-w-md gap-0 overflow-hidden border-border bg-card p-0 shadow-elevated"
      >
        <div className="h-1.5 bg-gradient-to-r from-primary via-accent to-primary" aria-hidden="true" />

        <button
          type="button"
          onClick={() => dismiss("x")}
          className="absolute right-4 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-5 pt-6 sm:px-7">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            <span className="h-2 w-2 rounded-full bg-warning motion-safe:animate-pulse" aria-hidden="true" />
            Email temporarily unavailable
          </div>

          <DialogTitle className="mb-2.5 pr-10 text-xl leading-snug sm:text-2xl">
            Our email is down.{" "}
            <span className="text-primary">WhatsApp or call us instead.</span>
          </DialogTitle>

          <DialogDescription className="mb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
            A widespread Microsoft Outlook outage is affecting many organisations, including us, so{" "}
            <strong className="font-semibold text-foreground">emails to our team may be delayed or not arrive</strong>.
            If you’ve emailed us recently, please reach us on WhatsApp or by phone instead.
          </DialogDescription>

          <div className="mb-4 flex flex-col gap-2.5">
            {/* green-700, not WhatsApp's #25D366, so white text passes AA */}
            <a
              href={whatsappHref()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => contacted("whatsapp")}
              className="flex w-full items-center justify-center gap-2.5 rounded-full bg-green-700 px-5 py-3.5 font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <WhatsAppIcon className="h-5 w-5 shrink-0" />
              Message us on WhatsApp
            </a>
            <a
              href={`tel:${OUTAGE_NOTICE.PHONE_E164}`}
              onClick={() => contacted("call")}
              className="flex w-full items-center justify-center gap-2.5 rounded-full bg-primary px-5 py-3.5 font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Phone className="h-5 w-5 shrink-0" />
              <span>
                Call <span className="whitespace-nowrap">{OUTAGE_NOTICE.PHONE_DISPLAY}</span>
              </span>
            </a>
          </div>

          <p className="mb-4 flex items-start gap-2 rounded-xl bg-muted px-3.5 py-2.5 text-[0.8125rem] leading-normal text-muted-foreground">
            <span
              className={`mt-[0.4em] h-2 w-2 shrink-0 rounded-full ${linesOpen ? "bg-success" : "bg-muted-foreground/50"}`}
              aria-hidden="true"
            />
            <span>
              {linesOpen === true && (
                <>
                  <strong className="font-semibold text-foreground">Phone lines are open now</strong>, until 5pm today.
                </>
              )}
              {linesOpen === false && (
                <>
                  Phone lines open again at <strong className="font-semibold text-foreground">9am</strong>. Send us a
                  WhatsApp now and we'll reply as soon as we're back.
                </>
              )}
              {linesOpen === null && (
                <>
                  Phone lines are open <strong className="font-semibold text-foreground">9am – 5pm</strong>, 7 days a
                  week.
                </>
              )}
            </span>
          </p>

          <button
            type="button"
            onClick={() => dismiss("continue_link")}
            className="mx-auto block rounded px-2 py-1 text-[0.8125rem] text-muted-foreground underline underline-offset-[3px] transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Continue to MyFettle
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
