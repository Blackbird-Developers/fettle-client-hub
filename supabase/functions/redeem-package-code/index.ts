import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Link an Acuity session-bundle certificate code (e.g. "704E3907") to the
// signed-in client's hub account.
//
// Why this exists: bundles bought on fettle.ie / Acuity's store, or issued by
// the clinic in Acuity, produce a certificate code the client is told to use
// when booking. The hub only learns about certificates through
// sync-acuity-packages, which finds them by the client's email — and codes
// issued outside the hub frequently carry no email (or a different one), so
// they never appear as "Use Package Credit". Typing the code into the coupon
// field used to be rejected ("This is a session-package code…") with no way
// to redeem it. This function validates the code with Acuity and creates the
// same user_packages row the sync would have, after which the normal
// book-with-package path redeems it (and Acuity deducts the certificate).
//
// Security: caller must be signed in (JWT verified at the gateway and read
// again here). Acuity redeems a bundle by its code alone — the email on it
// only decides whose Acuity account lists it — so whoever holds the code may
// link it, as on Acuity's own checkout (Fettle, 2026-10-30). We ask Acuity
// with the caller's email first and without it only if the email was the
// sole objection. A certificate already linked to another hub account is
// refused, and staff are told about every refusal (admin_notifications).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";
const SUPPORT_EMAIL = "hello@fettle.ie";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[REDEEM-PACKAGE-CODE] ${step}${detailsStr}`);
};

type PackageCategory = "individual" | "youth" | "couples";

// Known hub bundles (Acuity product ID → details). Kept in sync with the
// PACKAGES array in PackageBookingModal.tsx and the *-package-* edge functions.
const PACKAGE_MAPPING: Record<
  string,
  { name: string; sessions: number; price: number; category: PackageCategory }
> = {
  "1122832": { name: "3 Session Bundle", sessions: 3, price: 271.5, category: "individual" },
  "996385": { name: "6 Session Bundle", sessions: 6, price: 528, category: "individual" },
  "1197875": { name: "9 Session Bundle", sessions: 9, price: 765, category: "individual" },
  "1370588": { name: "Youth Bundle 3 x 60min", sessions: 3, price: 325, category: "youth" },
  "1975510": { name: "Youth Bundle 5 x 60min", sessions: 5, price: 550, category: "youth" },
  "2000708": { name: "Couples 3 x 60 min", sessions: 3, price: 345, category: "couples" },
  "1967869": { name: "Couples 5 x 60 min", sessions: 5, price: 575, category: "couples" },
};

// Acuity appointment-type name prefixes per category. Mirrors the booking UI's
// category filter (see BookingModal "filteredAppointmentTypes").
const CATEGORY_NAME_PREFIX: Record<PackageCategory, string> = {
  individual: "Individual Therapy Session",
  youth: "Youth Therapy - Individual Session",
  couples: "Couple's Therapy Session",
};

// Minutes per session, used to turn a minutes-based certificate into sessions.
const SESSION_MINUTES: Record<PackageCategory, number> = {
  individual: 50,
  youth: 60,
  couples: 60,
};

const CATEGORY_LABEL: Record<PackageCategory, string> = {
  individual: "individual therapy",
  youth: "youth therapy",
  couples: "couples therapy",
};

// Shape of GET /certificates/check (and /certificates/{id}). `type` has been
// seen as "coupon" for discount codes; session bundles report "appointments"
// (docs) / "counts" (list endpoint) or "minutes". remainingCounts is a number
// on the list endpoint but may be a per-appointment-type map on /check.
interface AcuityCertificate {
  id: number;
  certificate: string;
  productID?: number | null;
  orderID?: number | null;
  name?: string;
  email?: string;
  type?: string;
  remainingCounts?: number | Record<string, number> | null;
  remainingMinutes?: number | null;
  remainingValue?: number | null;
  appointmentTypeIDs?: number[];
  createdDate?: string;
  expiration?: string | null;
}

interface AcuityAppointmentType {
  id: number;
  name: string;
  active?: boolean;
}

interface CheckFailure {
  status: number;
  code: string;
  message: string;
}

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function fail(reason: string, message: string, status = 200): Response {
  logStep("Refused", { reason, message });
  return new Response(JSON.stringify({ ok: false, reason, message }), { headers: jsonHeaders, status });
}

// Short labels for the admin notification title.
const REASON_LABEL: Record<string, string> = {
  wrong_email: "registered to a different email",
  used_up: "all sessions used",
  not_applicable: "for a different session type",
  expired: "bundle expired",
  invalid_code: "code not found",
  server_unavailable: "Acuity unavailable",
  server_error: "hub error",
  unsupported: "not a bundle the hub can link",
  claimed: "linked to another hub account",
};

// Staff who are emailed when a client can't use a bundle code (as well as the
// admin bell). Agreed with Fettle 2026-10-30.
const STAFF_ALERT_EMAILS = ["operations@fettle.ie", "alex@fettle.ie"];
const ADMIN_BUNDLES_URL = "https://my.fettle.ie/admin/bundles";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Labels for the facts staff need, in the order they're shown.
const DETAIL_LABELS: [string, string][] = [
  ["certificateEmail", "Bundle email in Acuity"],
  ["appointmentTypeID", "Acuity session type tried"],
  ["expiration", "Expires"],
  ["acuityErrors", "Acuity said"],
];

async function emailStaffAboutRefusal(
  n: RefusalNotice,
  who: string,
  title: string,
): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    logStep("RESEND_API_KEY not set — staff email skipped");
    return;
  }
  const rows: [string, string][] = [
    ["Client", who === n.userEmail ? n.userEmail : `${who} (${n.userEmail})`],
    ["Code", n.code],
    ["Problem", REASON_LABEL[n.reason] ?? n.reason],
    ["What the hub told them", n.message],
  ];
  for (const [key, label] of DETAIL_LABELS) {
    const value = n.details[key];
    if (value === null || value === undefined || value === "") continue;
    rows.push([label, Array.isArray(value) ? value.join(" · ") : String(value)]);
  }
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333; max-width: 600px;">
      <p>A client couldn't use their bundle code in the hub. This is the first time for this client and code.</p>
      <table style="border-collapse: collapse; width: 100%;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding: 6px 12px 6px 0; color: #6b7280; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td><td style="padding: 6px 0;">${escapeHtml(value)}</td></tr>`,
          )
          .join("")}
      </table>
      <p>It's also under the bell in the <a href="${ADMIN_BUNDLES_URL}">admin dashboard</a>.</p>
    </div>`;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Fettle Hub <noreply@notifications.fettle.ie>",
      to: STAFF_ALERT_EMAILS,
      reply_to: n.userEmail,
      subject: title,
      html,
    }),
  });
  if (!resp.ok) {
    logStep("Staff email failed", { status: resp.status, body: (await resp.text()).slice(0, 200) });
  }
}

interface RefusalNotice {
  supabaseAdmin: ReturnType<typeof createClient>;
  userId: string;
  userEmail: string;
  code: string;
  reason: string;
  message: string;
  details: Record<string, unknown>;
}

// Tell staff the first time a client can't use a bundle code: the admin
// notifications bell plus an email to STAFF_ALERT_EMAILS. One notification
// (and one email) per client and code, however many times they retry. Never
// lets a notification problem affect the client.
async function notifyAdminsOfRefusal(n: RefusalNotice): Promise<void> {
  try {
    const { data: profile } = await n.supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("user_id", n.userId)
      .maybeSingle();
    const p = profile as { first_name?: string | null; last_name?: string | null } | null;
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || null;
    const who = name || n.userEmail;
    const title = `${who} couldn't use bundle code ${n.code} (${REASON_LABEL[n.reason] ?? n.reason})`;
    const { data: inserted, error } = await n.supabaseAdmin
      .from("admin_notifications")
      .upsert(
        {
          kind: "bundle_code_refused",
          dedupe_key: `bundle_code_refused:${n.userId}:${n.code}`,
          user_id: n.userId,
          client_email: n.userEmail,
          client_name: name,
          title,
          body: `The hub told them: "${n.message}"`,
          details: { code: n.code, reason: n.reason, ...n.details },
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      // Without the saved row we can't tell a retry from a first time, so
      // don't email (it would repeat on every retry).
      logStep("Could not save admin notification", { error: error.message });
      return;
    }
    // A repeat for this client and code inserts nothing: no second email.
    if ((inserted ?? []).length === 0) return;
    await emailStaffAboutRefusal(n, who, title);
  } catch (e) {
    logStep("Could not save admin notification", { error: e instanceof Error ? e.message : String(e) });
  }
}

function categoryOfTypeName(name: string | undefined): PackageCategory | undefined {
  const trimmed = (name ?? "").trim();
  for (const [category, prefix] of Object.entries(CATEGORY_NAME_PREFIX)) {
    if (trimmed.startsWith(prefix)) return category as PackageCategory;
  }
  return undefined;
}

async function fetchTherapyTypes(authHeader: string): Promise<AcuityAppointmentType[]> {
  const resp = await fetch(`${ACUITY_API_BASE}/appointment-types`, {
    headers: { Authorization: `Basic ${authHeader}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    logStep("Could not fetch appointment types", { status: resp.status });
    return [];
  }
  const types = (await resp.json()) as AcuityAppointmentType[];
  return types.filter((t) => t.active !== false && categoryOfTypeName(t.name) !== undefined);
}

async function checkCertificate(
  authHeader: string,
  code: string,
  appointmentTypeID: number,
  email: string | null,
): Promise<{ cert?: AcuityCertificate; failure?: CheckFailure }> {
  const url =
    `${ACUITY_API_BASE}/certificates/check` +
    `?certificate=${encodeURIComponent(code)}` +
    `&appointmentTypeID=${encodeURIComponent(String(appointmentTypeID))}` +
    (email ? `&email=${encodeURIComponent(email)}` : "");
  const resp = await fetch(url, {
    headers: { Authorization: `Basic ${authHeader}`, "Content-Type": "application/json" },
  });
  const text = await resp.text();
  if (resp.ok) {
    try {
      return { cert: JSON.parse(text) as AcuityCertificate };
    } catch {
      return { failure: { status: resp.status, code: "bad_json", message: text.slice(0, 200) } };
    }
  }
  let code_ = "";
  let message = text.slice(0, 200);
  try {
    const parsed = JSON.parse(text);
    code_ = String(parsed?.error ?? "");
    message = String(parsed?.message ?? message);
  } catch {
    // non-JSON error body — keep raw text
  }
  return { failure: { status: resp.status, code: code_, message } };
}

// Turn the Acuity rejections collected across the appointment types we tried
// into one user-facing reason. Most specific first.
function classifyFailures(failures: CheckFailure[]): { reason: string; message: string } {
  const texts = failures.map((f) => `${f.code} ${f.message}`.toLowerCase());
  const has = (re: RegExp) => texts.some((t) => re.test(t));

  if (failures.some((f) => f.status === 401 || f.status === 403 || f.status >= 500)) {
    return {
      reason: "server_unavailable",
      message: `We couldn't check that code right now. Please try again in a moment, or email ${SUPPORT_EMAIL}.`,
    };
  }
  if (has(/expired/)) {
    return {
      reason: "expired",
      message: `This bundle has expired. If you think that's wrong, email ${SUPPORT_EMAIL} and we'll take a look.`,
    };
  }
  if (has(/no (remaining|more)|used up|fully used|already (been )?(used|redeemed)|certificate_uses/)) {
    return {
      reason: "used_up",
      message: `All the sessions on this bundle have already been used. Email ${SUPPORT_EMAIL} if that doesn't look right.`,
    };
  }
  if (has(/email/)) {
    return {
      reason: "wrong_email",
      message: `This bundle is registered to a different email address. Sign in with that email, or email ${SUPPORT_EMAIL} and we'll move it for you.`,
    };
  }
  if (has(/appointment type|not valid for|not available for/)) {
    return {
      reason: "not_applicable",
      message: "This bundle can't be used for this session type. Choose a matching session type (for example, a youth bundle for youth therapy).",
    };
  }
  return {
    reason: "invalid_code",
    message: `We couldn't find a bundle with that code. Check it's typed exactly as shown, or email ${SUPPORT_EMAIL} and we'll sort it out.`,
  };
}

function remainingSessionsFor(
  cert: AcuityCertificate,
  category: PackageCategory | undefined,
  requestedTypeId: number | null,
  known: { sessions: number } | undefined,
): number {
  const type = String(cert.type ?? "").toLowerCase();
  if (type === "minutes") {
    const minutes = Number(cert.remainingMinutes ?? 0);
    const perSession = SESSION_MINUTES[category ?? "individual"];
    return Number.isFinite(minutes) ? Math.floor(minutes / perSession) : 0;
  }
  const rc = cert.remainingCounts;
  if (typeof rc === "number") return rc;
  if (rc && typeof rc === "object") {
    if (requestedTypeId !== null && typeof rc[String(requestedTypeId)] === "number") {
      return rc[String(requestedTypeId)];
    }
    const values = Object.values(rc).map(Number).filter((n) => Number.isFinite(n));
    return values.length > 0 ? Math.max(...values) : 0;
  }
  return known?.sessions ?? 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Set once we know who is linking which code, so an unexpected error can
  // still be reported to staff.
  let notifyServerError: ((message: string) => Promise<void>) | null = null;

  try {
    logStep("Function started");

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!acuityUserId || !acuityApiKey || !supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error(`Our booking system is temporarily unavailable. Please contact ${SUPPORT_EMAIL} for support.`);
    }

    // ── Who is linking? ───────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return fail("not_signed_in", "Please sign in to link a bundle code.", 401);
    }
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    const token = authHeader.replace("Bearer ", "").trim();
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData.user) {
      return fail("not_signed_in", "Your session has expired. Please sign in again and retry.", 401);
    }
    const userId = userData.user.id;
    const userEmail = (userData.user.email ?? "").trim();
    if (!userEmail) {
      return fail("not_signed_in", `We couldn't read the email on your account. Please email ${SUPPORT_EMAIL}.`);
    }
    logStep("User authenticated", { userId, email: userEmail });

    // ── Input ─────────────────────────────────────────────────────────────
    let body: { code?: unknown; appointmentTypeID?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      // empty body handled below
    }
    const code = String(body.code ?? "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
      return fail("invalid_code", "That doesn't look like a bundle code. Check it and try again.");
    }
    const requestedTypeId =
      body.appointmentTypeID !== undefined && body.appointmentTypeID !== null && body.appointmentTypeID !== ""
        ? Number(body.appointmentTypeID)
        : null;
    if (requestedTypeId !== null && !Number.isFinite(requestedTypeId)) {
      return fail("invalid_code", "Invalid session type.");
    }
    logStep("Linking code", { code, requestedTypeId });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    // Refuse the code and tell staff (first time per client and code).
    const refuse = async (reason: string, message: string, extra: Record<string, unknown> = {}) => {
      await notifyAdminsOfRefusal({
        supabaseAdmin,
        userId,
        userEmail,
        code,
        reason,
        message,
        details: { appointmentTypeID: requestedTypeId, ...extra },
      });
      return fail(reason, message);
    };
    notifyServerError = (message) =>
      notifyAdminsOfRefusal({
        supabaseAdmin,
        userId,
        userEmail,
        code,
        reason: "server_error",
        message,
        details: { appointmentTypeID: requestedTypeId },
      });

    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);

    // ── Ask Acuity ────────────────────────────────────────────────────────
    // /certificates/check needs an appointmentTypeID. When the booking modal
    // calls us we try that type first (and remember whether it matched). If it
    // doesn't match, or no type was given (Packages screen), we scan the live
    // therapy types — one per category first, then the rest — so a bundle that
    // is restricted to another category (e.g. a youth code typed on an
    // individual booking) is still linked, just flagged as not applicable.
    let therapyTypes: AcuityAppointmentType[] | null = null;
    const loadTherapyTypes = async () => {
      if (therapyTypes === null) therapyTypes = await fetchTherapyTypes(acuityAuth);
      return therapyTypes;
    };

    // One pass over the appointment types, asking Acuity with `email` (or
    // without one). Returns null when the therapy types couldn't be loaded.
    const scan = async (email: string | null) => {
      let cert: AcuityCertificate | undefined;
      let applicable = false; // matched the requested appointment type
      const failures: CheckFailure[] = [];

      if (requestedTypeId !== null) {
        const first = await checkCertificate(acuityAuth, code, requestedTypeId, email);
        if (first.cert) {
          cert = first.cert;
          applicable = true;
        } else if (first.failure) {
          failures.push(first.failure);
        }
      }

      if (!cert) {
        const types = await loadTherapyTypes();
        if (types.length === 0 && requestedTypeId === null) return null;
        const seen = new Set<number>(requestedTypeId !== null ? [requestedTypeId] : []);
        const firstPerCategory: number[] = [];
        const rest: number[] = [];
        const usedCategory = new Set<PackageCategory>();
        for (const t of types) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          const cat = categoryOfTypeName(t.name)!;
          if (!usedCategory.has(cat)) {
            usedCategory.add(cat);
            firstPerCategory.push(t.id);
          } else {
            rest.push(t.id);
          }
        }
        const batches: number[][] = [];
        if (firstPerCategory.length > 0) batches.push(firstPerCategory);
        for (let i = 0; i < rest.length; i += 8) batches.push(rest.slice(i, i + 8));

        for (const batch of batches) {
          const results = await Promise.all(
            batch.map((id) => checkCertificate(acuityAuth, code, id, email)),
          );
          const hit = results.find((r) => r.cert);
          if (hit?.cert) {
            cert = hit.cert;
            break;
          }
          for (const r of results) if (r.failure) failures.push(r.failure);
          // A definitive verdict (expired / used up / unknown code) is the same
          // for every type — no point scanning further.
          const verdict = classifyFailures(failures).reason;
          if (verdict === "expired" || verdict === "used_up" || verdict === "server_unavailable") break;
        }
      }
      return { cert, applicable, failures };
    }

    const unreachable = () =>
      refuse(
        "server_unavailable",
        `We couldn't reach the scheduling system to check that code. Please try again in a moment, or email ${SUPPORT_EMAIL}.`,
      );

    let found = await scan(userEmail);
    if (!found) return unreachable();
    // Acuity redeems a bundle by its code alone; the email on it only decides
    // whose account lists it (Fettle, 2026-10-30). So if the only objection
    // is the email, ask again without one and let the code holder link it.
    let linkedFromOtherEmail = false;
    if (!found.cert && classifyFailures(found.failures).reason === "wrong_email") {
      logStep("Code is tied to another email — checking it without one", { code });
      const retry = await scan(null);
      if (!retry) return unreachable();
      if (retry.cert) {
        found = retry;
        linkedFromOtherEmail = true;
      } else {
        // Keep both sets of answers: the retry's (e.g. "used up") is more
        // specific than the email objection.
        found = { ...retry, failures: [...retry.failures, ...found.failures] };
      }
    }
    const { cert, applicable, failures } = found;

    if (!cert) {
      const { reason, message } = classifyFailures(failures);
      logStep("Acuity did not accept the code", { code, reason, tried: failures.length });
      // Acuity's own wording, so staff can see exactly why (first few only).
      const acuityErrors = [...new Set(failures.map((f) => `${f.status} ${f.code} ${f.message}`.trim()))].slice(0, 5);
      return refuse(reason, message, { acuityErrors, typesTried: failures.length });
    }

    const certDetails = {
      certificateId: cert.id,
      certificateEmail: cert.email ?? null,
      certificateType: cert.type ?? null,
      productID: cert.productID ?? null,
      expiration: cert.expiration ?? null,
    };

    logStep("Acuity certificate found", {
      certId: cert.id,
      type: cert.type,
      productID: cert.productID ?? null,
      email: cert.email ?? "",
      remainingCounts: cert.remainingCounts ?? null,
      remainingMinutes: cert.remainingMinutes ?? null,
      expiration: cert.expiration ?? null,
      applicable,
      linkedFromOtherEmail,
    });

    // ── Is it a session bundle? ───────────────────────────────────────────
    const certType = String(cert.type ?? "").toLowerCase();
    if (certType === "coupon" || certType === "coupons") {
      return fail(
        "discount_code",
        "That's a discount code rather than a session bundle. Enter it in the coupon box when paying for a session and the discount is applied there.",
      );
    }
    const isMinutes = certType === "minutes";
    const isCounts = certType === "appointments" || certType === "counts";
    if (!isMinutes && !isCounts) {
      return refuse(
        "unsupported",
        `This code isn't a session bundle we can link automatically. Email ${SUPPORT_EMAIL} and we'll apply it for you.`,
        certDetails,
      );
    }

    // A bundle bought under another email is still the code holder's to use
    // (Acuity doesn't lock codes to an email), so it is linked — just logged.
    if (cert.email && cert.email.trim().toLowerCase() !== userEmail.toLowerCase()) {
      linkedFromOtherEmail = true;
      logStep("Linking a bundle registered to another email", { certEmail: cert.email, userEmail });
    }
    if (cert.expiration && new Date(cert.expiration).getTime() < Date.now()) {
      return refuse("expired", `This bundle has expired. If you think that's wrong, email ${SUPPORT_EMAIL}.`, certDetails);
    }

    // ── Which bundle / category is it? ────────────────────────────────────
    const productIdStr = cert.productID ? String(cert.productID) : "";
    const known = productIdStr ? PACKAGE_MAPPING[productIdStr] : undefined;
    let category: PackageCategory | undefined = known?.category;
    if (!category && Array.isArray(cert.appointmentTypeIDs) && cert.appointmentTypeIDs.length > 0) {
      const types = await loadTherapyTypes();
      const cats = new Set<PackageCategory>();
      for (const id of cert.appointmentTypeIDs) {
        const t = types.find((x) => x.id === id);
        const c = categoryOfTypeName(t?.name);
        if (c) cats.add(c);
      }
      if (cats.size === 1) category = [...cats][0];
    }

    const remainingSessions = remainingSessionsFor(cert, category, requestedTypeId, known);
    if (remainingSessions <= 0) {
      return refuse(
        "used_up",
        `All the sessions on this bundle have already been used. Email ${SUPPORT_EMAIL} if that doesn't look right.`,
        certDetails,
      );
    }

    // ── Link it to the account ────────────────────────────────────────────
    const acuityCertId = `acuity-cert-${cert.id}`; // same key sync-acuity-packages uses
    // Hub-created certificates carry the CLIENT's name in `name`, so it is not
    // a usable package label — fall back to a category-based one instead.
    const packageName =
      known?.name ||
      (category === "youth"
        ? "Youth Session Bundle"
        : category === "couples"
          ? "Couples Session Bundle"
          : "Session Bundle");
    const totalSessions = Math.max(known?.sessions ?? 0, remainingSessions);
    const expiresAt = cert.expiration || null;

    const respond = (pkg: Record<string, unknown>, alreadyLinked: boolean) =>
      new Response(
        JSON.stringify({
          ok: true,
          alreadyLinked,
          applicable,
          package: pkg,
          packageName,
          remainingSessions,
          totalSessions,
          expiresAt,
          linkedFromOtherEmail,
          category: category ?? null,
          categoryLabel: category ? CATEGORY_LABEL[category] : null,
        }),
        { headers: jsonHeaders, status: 200 },
      );

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("user_packages")
      .select("*")
      .eq("stripe_session_id", acuityCertId);
    if (existingError) throw new Error(`Package lookup failed: ${existingError.message}`);

    const mine = (existingRows ?? []).find((r: { user_id: string }) => r.user_id === userId);
    if (mine) {
      // Already on this account — refresh the balance from Acuity and say so.
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("user_packages")
        .update({
          remaining_sessions: remainingSessions,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", mine.id)
        .select("*")
        .single();
      if (updateError) logStep("Could not refresh linked package", { error: updateError.message });
      logStep("Code already linked to this account", { packageRowId: mine.id, remainingSessions });
      return respond(updated ?? mine, true);
    }
    if ((existingRows ?? []).length > 0) {
      logStep("Code linked to a different account — refusing", { certId: cert.id });
      return refuse(
        "claimed",
        `This bundle is already linked to another Fettle account. If it's yours, email ${SUPPORT_EMAIL} and we'll move it across.`,
        { ...certDetails, linkedToUserIds: (existingRows ?? []).map((r: { user_id: string }) => r.user_id) },
      );
    }

    const insertRow: Record<string, unknown> = {
      user_id: userId,
      package_id: productIdStr || "0",
      package_name: packageName,
      total_sessions: totalSessions,
      remaining_sessions: remainingSessions,
      amount_paid: known?.price ?? 0,
      stripe_session_id: acuityCertId,
      expires_at: expiresAt,
    };
    if (cert.createdDate) insertRow.purchased_at = cert.createdDate;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("user_packages")
      .insert(insertRow)
      .select("*")
      .single();

    if (insertError) {
      // 23505 = unique (user_id, stripe_session_id): a concurrent link won the
      // race. Treat as already linked rather than failing the user.
      if (insertError.code === "23505") {
        const { data: raced } = await supabaseAdmin
          .from("user_packages")
          .select("*")
          .eq("stripe_session_id", acuityCertId)
          .eq("user_id", userId)
          .maybeSingle();
        if (raced) return respond(raced, true);
      }
      throw new Error(`Could not save the bundle to your account: ${insertError.message}`);
    }

    logStep("Bundle linked", {
      packageRowId: inserted.id,
      certId: cert.id,
      packageName,
      remainingSessions,
      category: category ?? null,
      applicable,
    });
    return respond(inserted, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    if (notifyServerError) await notifyServerError(message);
    return new Response(
      JSON.stringify({ ok: false, reason: "server_error", message }),
      { headers: jsonHeaders, status: 500 },
    );
  }
});
