// Email outage popup (WhatsApp / phone deflection), the hub version of the
// popup on fettle.ie. Flip ENABLED to false and redeploy once Outlook is back.
// Change OUTAGE_ID for a new outage and everyone sees the popup again.

export const OUTAGE_NOTICE = {
  ENABLED: true,
  OUTAGE_ID: "2026-11-13",
  DELAY_MS: 1200,
  /** Phone lines, Europe/Dublin time, every day (same as the website ribbon). */
  OPEN_HOUR: 9,
  CLOSE_HOUR: 17,
  PHONE_E164: "+35319131090",
  PHONE_DISPLAY: "+353 1 913 1090",
  WHATSAPP_NUMBER: "35319131090",
  WHATSAPP_TEXT: "Hi Fettle, I saw your email is down. I'm getting in touch about: ",
  /** Paths (and anything under them) where the popup never shows. */
  EXCLUDED_PATHS: ["/admin"],
} as const;

export const outageDismissKey = (id: string = OUTAGE_NOTICE.OUTAGE_ID) =>
  `fettle:outage-closed:${id}`;

export function whatsappHref(
  number: string = OUTAGE_NOTICE.WHATSAPP_NUMBER,
  text: string = OUTAGE_NOTICE.WHATSAPP_TEXT,
): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function isExcludedPath(
  pathname: string,
  excluded: readonly string[] = OUTAGE_NOTICE.EXCLUDED_PATHS,
): boolean {
  const path = pathname.replace(/\/$/, "").toLowerCase();
  return excluded.some((raw) => {
    const ex = raw.replace(/\/$/, "").toLowerCase();
    return path === ex || path.startsWith(`${ex}/`);
  });
}

/** Current hour (0-23) in Irish time, or null if Intl can't tell us. */
export function dublinHour(now: Date = new Date()): number | null {
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Dublin" }).format(now),
      10,
    );
    return Number.isNaN(hour) ? null : hour;
  } catch {
    return null;
  }
}

/** true/false when we know, null when the hour couldn't be worked out. */
export function phoneLinesOpen(
  hour: number | null,
  open: number = OUTAGE_NOTICE.OPEN_HOUR,
  close: number = OUTAGE_NOTICE.CLOSE_HOUR,
): boolean | null {
  if (hour === null) return null;
  return hour >= open && hour < close;
}
