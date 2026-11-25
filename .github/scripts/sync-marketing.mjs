// Keeps marketing_daily (the admin Overview's Marketing tab) up to date by
// calling the marketing-sync edge function once per channel (see its
// index.ts). A channel without its secrets set comes back "skipped"; one whose
// platform call fails comes back "error" and fails this run, after the other
// channels have had their turn.
//
// Run by .github/workflows/marketing-sync.yml with FUNCTION_URL and
// CRON_SECRET set. Responses carry only counts, dates and short error
// messages (scrubbed of tokens by the function); this script prints those.

const FUNCTION_URL = process.env.FUNCTION_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const CHANNELS = ["meta", "google", "tiktok"];
/** Longer than Supabase lets the function run, so its own error comes back. */
const CALL_TIMEOUT_MS = 170_000;
const ATTEMPTS = 2;

if (!FUNCTION_URL || !CRON_SECRET) {
  console.error("FUNCTION_URL and CRON_SECRET must be set");
  process.exit(1);
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

// One channel. Gateway errors and timeouts are retried once; the function's
// own answers (ok / skipped / error) are not.
async function syncChannel(channel) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let status = "no response";
    try {
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "x-cron-secret": CRON_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      status = `HTTP ${response.status}`;
      if (response.ok) return { ...(await response.json()), seconds: seconds(Date.now() - started) };
      if (response.status >= 400 && response.status < 500) {
        let message = "";
        try {
          message = (await response.json()).error ?? "";
        } catch {
          // not JSON
        }
        return { channel, status: "error", error: `${status} ${String(message).slice(0, 200)}`.trim() };
      }
    } catch (error) {
      status = error.name === "TimeoutError" ? "timed out" : `no response (${error.message})`;
    }
    console.log(`${channel}: attempt ${attempt} failed after ${seconds(Date.now() - started)} — ${status}`);
    if (attempt >= ATTEMPTS) return { channel, status: "error", error: status };
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

let failed = 0;
for (const channel of CHANNELS) {
  const result = await syncChannel(channel);
  if (result.status === "skipped") {
    console.log(`${channel}: skipped (secrets not set)`);
  } else if (result.status === "ok") {
    const history = result.backfill ? `, history ${result.backfill.from} to ${result.backfill.to}: ${result.backfilled} rows` : "";
    console.log(
      `${channel}: ok in ${result.seconds} — ${result.refresh.from} to ${result.refresh.to}: ${result.refreshed} rows${history}; copied from ${result.historyFrom}`
    );
  } else {
    failed++;
    console.log(`${channel}: FAILED — ${result.error}`);
  }
}

if (failed > 0) {
  console.error(`${failed} channel(s) failed`);
  process.exit(1);
}
