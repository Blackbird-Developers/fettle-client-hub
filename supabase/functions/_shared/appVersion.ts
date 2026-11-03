// Lets an old build of the MyFettle app be told to update when a shared
// function has to change shape.
//
// The app sends `x-app-version: <semver>` (e.g. 1.4.0) on every call. The
// website never sends it, so the website is never blocked. When the header is
// present and lower than the MIN_APP_VERSION secret, the function answers 426
// with code "app_update_required" before doing anything; the app shows its
// "please update" screen on that code. With MIN_APP_VERSION unset nothing is
// blocked.
//
// To force an update: supabase secrets set MIN_APP_VERSION=1.4.0

function parse(v: string): number[] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

// Negative when a < b, 0 when equal, positive when a > b.
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

export function isAppVersionTooOld(appVersion: string | null, minVersion: string | undefined): boolean {
  if (!appVersion || !minVersion) return false;
  if (!parse(appVersion) || !parse(minVersion)) return false;
  return compareVersions(appVersion, minVersion) < 0;
}

// Returns the 426 response to send, or null to carry on.
export function requireSupportedAppVersion(
  req: Request,
  corsHeaders: Record<string, string>,
): Response | null {
  const minVersion = Deno.env.get("MIN_APP_VERSION");
  const appVersion = req.headers.get("x-app-version");
  if (!isAppVersionTooOld(appVersion, minVersion)) return null;
  return new Response(
    JSON.stringify({
      error: "Please update the MyFettle app to keep using it.",
      code: "app_update_required",
      minVersion,
    }),
    { status: 426, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
