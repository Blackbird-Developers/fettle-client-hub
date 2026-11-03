// Google Tag Manager for the hub (docs/GTM_BOOKING_WIZARD.md). It only loads
// when VITE_GTM_ID is set (e.g. GTM-XXXXXXX in Vercel's environment variables),
// so nothing is tracked until Fettle's container ID is added. The booking
// wizard's track() fills window.dataLayer either way.

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/;

type GtmWindow = Window & { dataLayer?: Record<string, unknown>[] };

export function loadGtm(id: string | undefined = import.meta.env.VITE_GTM_ID): boolean {
  const gtmId = id?.trim();
  if (!gtmId || !GTM_ID_PATTERN.test(gtmId) || typeof document === 'undefined') return false;
  if (document.querySelector(`script[data-gtm="${gtmId}"]`)) return true;

  const w = window as GtmWindow;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
  script.dataset.gtm = gtmId;
  document.head.appendChild(script);
  return true;
}
