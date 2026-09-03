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
// again here). Acuity's /certificates/check is asked with the caller's email,
// so an email-restricted certificate can only be linked by that email. A
// certificate already linked to another hub account is refused.

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
  email: string,
): Promise<{ cert?: AcuityCertificate; failure?: CheckFailure }> {
  const url =
    `${ACUITY_API_BASE}/certificates/check` +
    `?certificate=${encodeURIComponent(code)}` +
    `&appointmentTypeID=${encodeURIComponent(String(appointmentTypeID))}` +
    `&email=${encodeURIComponent(email)}`;
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

    let cert: AcuityCertificate | undefined;
    let applicable = false; // matched the requested appointment type
    const failures: CheckFailure[] = [];

    if (requestedTypeId !== null) {
      const first = await checkCertificate(acuityAuth, code, requestedTypeId, userEmail);
      if (first.cert) {
        cert = first.cert;
        applicable = true;
      } else if (first.failure) {
        failures.push(first.failure);
      }
    }

    if (!cert) {
      const types = await loadTherapyTypes();
      if (types.length === 0 && requestedTypeId === null) {
        return fail(
          "server_unavailable",
          `We couldn't reach the scheduling system to check that code. Please try again in a moment, or email ${SUPPORT_EMAIL}.`,
        );
      }
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
          batch.map((id) => checkCertificate(acuityAuth, code, id, userEmail)),
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

    if (!cert) {
      const { reason, message } = classifyFailures(failures);
      logStep("Acuity did not accept the code", { code, reason, tried: failures.length });
      return fail(reason, message);
    }

    logStep("Acuity certificate found", {
      certId: cert.id,
      type: cert.type,
      productID: cert.productID ?? null,
      email: cert.email ?? "",
      remainingCounts: cert.remainingCounts ?? null,
      remainingMinutes: cert.remainingMinutes ?? null,
      expiration: cert.expiration ?? null,
      applicable,
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
      return fail(
        "unsupported",
        `This code isn't a session bundle we can link automatically. Email ${SUPPORT_EMAIL} and we'll apply it for you.`,
      );
    }

    // Belt and braces — Acuity already applied these when we passed the email.
    if (cert.email && cert.email.trim().toLowerCase() !== userEmail.toLowerCase()) {
      return fail(
        "wrong_email",
        `This bundle is registered to a different email address. Sign in with that email, or email ${SUPPORT_EMAIL} and we'll move it for you.`,
      );
    }
    if (cert.expiration && new Date(cert.expiration).getTime() < Date.now()) {
      return fail("expired", `This bundle has expired. If you think that's wrong, email ${SUPPORT_EMAIL}.`);
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
      return fail(
        "used_up",
        `All the sessions on this bundle have already been used. Email ${SUPPORT_EMAIL} if that doesn't look right.`,
      );
    }

    // ── Link it to the account ────────────────────────────────────────────
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
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
      return fail(
        "claimed",
        `This bundle is already linked to another Fettle account. If it's yours, email ${SUPPORT_EMAIL} and we'll move it across.`,
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
    return new Response(
      JSON.stringify({ ok: false, reason: "server_error", message }),
      { headers: jsonHeaders, status: 500 },
    );
  }
});
