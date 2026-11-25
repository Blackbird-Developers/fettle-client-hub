import { describe, expect, it } from "vitest";
import {
  type GoogleConfig,
  type MarketingRow,
  type MetaConfig,
  type TikTokConfig,
  HISTORY_START,
  accountIdsOf,
  channelConfig,
  currenciesOf,
  googleError,
  googleHeaders,
  googleQuery,
  googleTokenError,
  mergeRows,
  metaError,
  metaConversions,
  metaInsightsUrl,
  parseGoogleStream,
  parseMetaPage,
  parseTikTokCurrency,
  parseTikTokPage,
  rowsInRange,
  safeError,
  secretsOf,
  splitRange,
  syncPlan,
  tiktokError,
  tiktokReportUrl,
} from "./logic.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];

const META = channelConfig("meta", env({ META_ACCESS_TOKEN: "meta-token-123", META_AD_ACCOUNT_ID: "1234567" })) as MetaConfig;
const GOOGLE = channelConfig(
  "google",
  env({
    GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token-123",
    GOOGLE_ADS_CLIENT_ID: "client-id",
    GOOGLE_ADS_CLIENT_SECRET: "client-secret-123",
    GOOGLE_ADS_REFRESH_TOKEN: "refresh-token-123",
    GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
  })
) as GoogleConfig;
const TIKTOK = channelConfig("tiktok", env({ TIKTOK_ACCESS_TOKEN: "tt-token-123", TIKTOK_ADVERTISER_ID: "7000000001" })) as TikTokConfig;

describe("channelConfig", () => {
  it("is null when a required secret is missing, so the channel is skipped", () => {
    expect(channelConfig("meta", env({ META_ACCESS_TOKEN: "x" }))).toBeNull();
    expect(channelConfig("google", env({ GOOGLE_ADS_DEVELOPER_TOKEN: "x", GOOGLE_ADS_CUSTOMER_ID: "1" }))).toBeNull();
    expect(channelConfig("tiktok", env({ TIKTOK_ACCESS_TOKEN: " ", TIKTOK_ADVERTISER_ID: "1" }))).toBeNull();
  });

  it("tidies ids and fills in defaults", () => {
    expect(META).toMatchObject({ accountIds: ["act_1234567"], apiVersion: "v25.0" });
    expect(channelConfig("meta", env({ META_ACCESS_TOKEN: "t", META_AD_ACCOUNT_ID: "act_99" }))).toMatchObject({ accountIds: ["act_99"] });
    expect(GOOGLE).toMatchObject({ customerIds: ["1234567890"], loginCustomerId: null, apiVersion: "v26" });
    expect(TIKTOK).toMatchObject({
      advertiserId: "7000000001",
      conversionMetrics: ["complete_payment", "user_registration"],
      currency: null,
    });
  });

  it("takes several accounts, comma-separated, without blanks or repeats", () => {
    const google = channelConfig(
      "google",
      env({
        GOOGLE_ADS_DEVELOPER_TOKEN: "d",
        GOOGLE_ADS_CLIENT_ID: "c",
        GOOGLE_ADS_CLIENT_SECRET: "s",
        GOOGLE_ADS_REFRESH_TOKEN: "r",
        GOOGLE_ADS_CUSTOMER_ID: "123-456-7890, 222-333-4444,,1234567890 ,555 666 7777",
        GOOGLE_ADS_LOGIN_CUSTOMER_ID: "999-888-7777",
      })
    ) as GoogleConfig;
    expect(google.customerIds).toEqual(["1234567890", "2223334444", "5556667777"]);
    expect(google.loginCustomerId).toBe("9998887777");
    expect(accountIdsOf(google)).toEqual(google.customerIds);
    const meta = channelConfig("meta", env({ META_ACCESS_TOKEN: "t", META_AD_ACCOUNT_ID: "act_1, 2" })) as MetaConfig;
    expect(meta.accountIds).toEqual(["act_1", "act_2"]);
    expect(channelConfig("google", env({ GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_CLIENT_SECRET: "s", GOOGLE_ADS_REFRESH_TOKEN: "r", GOOGLE_ADS_CUSTOMER_ID: " , " }))).toBeNull();
    expect(accountIdsOf(TIKTOK)).toEqual(["7000000001"]);
  });

  it("takes overrides from the secrets", () => {
    const meta = channelConfig("meta", env({ META_ACCESS_TOKEN: "t", META_AD_ACCOUNT_ID: "1", META_API_VERSION: "v26.0" }));
    expect(meta).toMatchObject({ apiVersion: "v26.0" });
    const tiktok = channelConfig(
      "tiktok",
      env({ TIKTOK_ACCESS_TOKEN: "t", TIKTOK_ADVERTISER_ID: "1", TIKTOK_CURRENCY: "eur", TIKTOK_CONVERSION_METRIC: "conversion" })
    );
    expect(tiktok).toMatchObject({ currency: "EUR", conversionMetrics: ["conversion"] });
  });
});

describe("safeError", () => {
  it("hides secrets and URL tokens and keeps messages short", () => {
    const message = safeError(
      "Failed at https://graph.facebook.com/x?access_token=EAAB123&after=c with meta-token-123",
      secretsOf(META)
    );
    expect(message).not.toContain("EAAB123");
    expect(message).not.toContain("meta-token-123");
    expect(safeError("x".repeat(400), [])).toHaveLength(300);
  });
});

describe("syncPlan", () => {
  it("first run: the last 28 days, then the 90 days before them", () => {
    expect(syncPlan("2026-11-25", null)).toEqual({
      refresh: { from: "2026-10-29", to: "2026-11-25" },
      backfill: { from: "2026-07-31", to: "2026-10-28" },
      historyFrom: "2026-07-31",
    });
  });

  it("later runs carry on backwards from the earliest day copied", () => {
    expect(syncPlan("2026-11-26", "2026-07-31")).toEqual({
      refresh: { from: "2026-10-30", to: "2026-11-26" },
      backfill: { from: "2026-05-02", to: "2026-07-30" },
      historyFrom: "2026-05-02",
    });
  });

  it("stops at HISTORY_START", () => {
    expect(syncPlan("2026-11-26", "2025-08-01").backfill).toEqual({ from: HISTORY_START, to: "2025-07-31" });
    expect(syncPlan("2026-11-26", HISTORY_START)).toMatchObject({ backfill: null, historyFrom: HISTORY_START });
  });
});

describe("splitRange", () => {
  it("splits into pieces of at most N days, oldest first", () => {
    expect(splitRange({ from: "2026-07-31", to: "2026-10-28" }, 30)).toEqual([
      { from: "2026-07-31", to: "2026-08-29" },
      { from: "2026-08-30", to: "2026-09-28" },
      { from: "2026-09-29", to: "2026-10-28" },
    ]);
    expect(splitRange({ from: "2026-11-01", to: "2026-11-01" }, 30)).toEqual([{ from: "2026-11-01", to: "2026-11-01" }]);
  });
});

describe("Meta", () => {
  it("asks for daily campaign insights with the token as a parameter", () => {
    const url = new URL(metaInsightsUrl(META, "act_1234567", { from: "2026-11-01", to: "2026-11-25" }));
    expect(url.pathname).toBe("/v25.0/act_1234567/insights");
    expect(url.searchParams.get("level")).toBe("campaign");
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({ since: "2026-11-01", until: "2026-11-25" });
    expect(url.searchParams.get("fields")).toContain("outbound_clicks");
    expect(url.searchParams.get("access_token")).toBe("meta-token-123");
  });

  it("reads a page of insights", () => {
    const page = parseMetaPage(
      {
        data: [
          {
            campaign_id: "120200000001",
            campaign_name: "Therapy - Dublin",
            account_currency: "EUR",
            spend: "123.456",
            impressions: "15000",
            clicks: "310",
            outbound_clicks: [{ action_type: "outbound_click", value: "180" }],
            actions: [
              { action_type: "link_click", value: "250" },
              { action_type: "purchase", value: "4" },
              { action_type: "offsite_conversion.fb_pixel_purchase", value: "4" },
              { action_type: "lead", value: "3" },
              { action_type: "offsite_conversion.fb_pixel_lead", value: "3" },
            ],
            action_values: [
              { action_type: "purchase", value: "360.00" },
              { action_type: "offsite_conversion.fb_pixel_purchase", value: "360.00" },
            ],
            date_start: "2026-11-10",
            date_stop: "2026-11-10",
          },
          // No clicks or conversions: Meta leaves the lists out.
          { campaign_id: "120200000002", campaign_name: "Awareness", account_currency: "EUR", spend: "5", impressions: "900", clicks: "0", date_start: "2026-11-10" },
          { campaign_id: "x", account_currency: "EUR", date_start: "bad" },
        ],
        paging: { cursors: { after: "abc" }, next: "https://graph.facebook.com/v25.0/act_1/insights?after=abc" },
      },
      "act_1234567"
    );
    expect(page.next).toContain("after=abc");
    expect(page.rows).toEqual([
      {
        channel: "meta",
        account_id: "act_1234567",
        campaign_id: "120200000001",
        campaign_name: "Therapy - Dublin",
        day: "2026-11-10",
        currency: "EUR",
        spend: 123.46,
        impressions: 15000,
        clicks: 310,
        outbound_clicks: 180,
        // 4 purchases + 3 leads; the pixel's copies aren't counted again.
        conversions: 7,
        conversion_value: 360,
      },
      {
        channel: "meta",
        account_id: "act_1234567",
        campaign_id: "120200000002",
        campaign_name: "Awareness",
        day: "2026-11-10",
        currency: "EUR",
        spend: 5,
        impressions: 900,
        clicks: 0,
        outbound_clicks: 0,
        conversions: 0,
        conversion_value: null,
      },
    ]);
  });

  it("counts purchases + leads once each, falling back to the pixel's action type", () => {
    const a = (action_type: string, value: string) => ({ action_type, value });
    // Only the pixel types reported.
    expect(metaConversions([a("offsite_conversion.fb_pixel_purchase", "2"), a("offsite_conversion.fb_pixel_lead", "5")])).toBe(7);
    // Combined type wins over the pixel one (it already includes it).
    expect(metaConversions([a("purchase", "3"), a("offsite_conversion.fb_pixel_purchase", "2")])).toBe(3);
    // Leads only; other actions ignored.
    expect(metaConversions([a("lead", "4"), a("link_click", "100"), a("complete_registration", "9")])).toBe(4);
    expect(metaConversions(undefined)).toBe(0);
  });

  it("knows the last page and reads errors", () => {
    expect(parseMetaPage({ data: [], paging: {} }, "act_1234567")).toEqual({ rows: [], next: null });
    expect(metaError({ error: { message: "Invalid OAuth access token.", code: 190 } })).toBe("Meta: Invalid OAuth access token. (code 190)");
    expect(metaError({ data: [] })).toBeNull();
  });
});

describe("Google Ads", () => {
  it("builds the query and headers", () => {
    expect(googleQuery({ from: "2026-11-01", to: "2026-11-25" })).toContain("WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-25'");
    expect(googleHeaders(GOOGLE, "access")).toEqual({
      Authorization: "Bearer access",
      "developer-token": "dev-token-123",
      "Content-Type": "application/json",
    });
    const viaManager = { ...GOOGLE, loginCustomerId: "9998887777" };
    expect(googleHeaders(viaManager, "access")["login-customer-id"]).toBe("9998887777");
  });

  it("reads searchStream batches, with micros, string int64s and missing zeros", () => {
    const rows = parseGoogleStream(
      [
        {
          results: [
            {
              campaign: { resourceName: "customers/1234567890/campaigns/111", id: "111", name: "Search - Therapy" },
              customer: { resourceName: "customers/1234567890", currencyCode: "EUR" },
              segments: { date: "2026-11-10" },
              metrics: { costMicros: "45670000", impressions: "1200", clicks: "85", conversions: 2.5, conversionsValue: 225 },
            },
            {
              campaign: { id: "222", name: "Brand" },
              customer: { currencyCode: "EUR" },
              segments: { date: "2026-11-10" },
              metrics: { impressions: "40" },
            },
          ],
          fieldMask: "campaign.id,campaign.name",
        },
      ],
      "1234567890"
    );
    expect(rows).toEqual([
      {
        channel: "google",
        account_id: "1234567890",
        campaign_id: "111",
        campaign_name: "Search - Therapy",
        day: "2026-11-10",
        currency: "EUR",
        spend: 45.67,
        impressions: 1200,
        clicks: 85,
        outbound_clicks: null,
        conversions: 2.5,
        conversion_value: 225,
      },
      expect.objectContaining({ campaign_id: "222", spend: 0, clicks: 0, impressions: 40, conversions: 0 }),
    ]);
  });

  it("reads errors, preferring the detailed reason", () => {
    expect(
      googleError([
        {
          error: {
            code: 403,
            message: "The caller does not have permission",
            status: "PERMISSION_DENIED",
            details: [{ errors: [{ message: "The developer token is only approved for use with test accounts." }] }],
          },
        },
      ])
    ).toBe("Google Ads: The developer token is only approved for use with test accounts. (PERMISSION_DENIED)");
    expect(googleError([{ results: [] }])).toBeNull();
    expect(googleTokenError({ error: "invalid_grant", error_description: "Token has been expired or revoked." })).toBe(
      "Google sign-in: Token has been expired or revoked."
    );
  });
});

describe("TikTok", () => {
  it("asks for a daily campaign report", () => {
    const url = new URL(tiktokReportUrl(TIKTOK, { from: "2026-11-01", to: "2026-11-25" }, 2));
    expect(url.pathname).toBe("/open_api/v1.3/report/integrated/get/");
    expect(url.searchParams.get("data_level")).toBe("AUCTION_CAMPAIGN");
    expect(JSON.parse(url.searchParams.get("dimensions")!)).toEqual(["campaign_id", "stat_time_day"]);
    expect(JSON.parse(url.searchParams.get("metrics")!)).toEqual(
      expect.arrayContaining(["spend", "complete_payment", "user_registration"])
    );
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("access_token")).toBe(false);
  });

  it("reads a report page and the account currency", () => {
    const page = parseTikTokPage(
      {
        code: 0,
        message: "OK",
        data: {
          list: [
            {
              dimensions: { campaign_id: "1790000000001", stat_time_day: "2026-11-10 00:00:00" },
              metrics: {
                campaign_name: "Spark - Therapy",
                spend: "30.10",
                impressions: "20000",
                clicks: "150",
                complete_payment: "1",
                user_registration: "2",
              },
            },
            { dimensions: { campaign_id: "", stat_time_day: "2026-11-10 00:00:00" }, metrics: {} },
          ],
          page_info: { page: 1, page_size: 1000, total_number: 2, total_page: 3 },
        },
      },
      TIKTOK,
      "EUR"
    );
    expect(page.totalPages).toBe(3);
    expect(page.rows).toEqual([
      {
        channel: "tiktok",
        account_id: "7000000001",
        campaign_id: "1790000000001",
        campaign_name: "Spark - Therapy",
        day: "2026-11-10",
        currency: "EUR",
        spend: 30.1,
        impressions: 20000,
        clicks: 150,
        outbound_clicks: null,
        conversions: 3, // 1 payment + 2 registrations
        conversion_value: null,
      },
    ]);
    expect(parseTikTokCurrency({ code: 0, data: { list: [{ currency: "EUR" }] } })).toBe("EUR");
  });

  it("treats a non-zero code as an error", () => {
    expect(tiktokError({ code: 40105, message: "Access token is incorrect or has been revoked." })).toBe(
      "TikTok: Access token is incorrect or has been revoked. (code 40105)"
    );
    expect(tiktokError({ code: 0, message: "OK" })).toBeNull();
  });
});

describe("rows", () => {
  const row = (over: Partial<MarketingRow>): MarketingRow => ({
    channel: "meta",
    account_id: "act_1",
    campaign_id: "1",
    campaign_name: "A",
    day: "2026-11-10",
    currency: "EUR",
    spend: 10,
    impressions: 100,
    clicks: 5,
    outbound_clicks: 3,
    conversions: 1,
    conversion_value: null,
    ...over,
  });

  it("adds up the same campaign and day", () => {
    expect(mergeRows([row({}), row({ spend: 2.5, conversion_value: 40 }), row({ day: "2026-11-11" })])).toEqual([
      row({ spend: 12.5, impressions: 200, clicks: 10, outbound_clicks: 6, conversions: 2, conversion_value: 40 }),
      row({ day: "2026-11-11" }),
    ]);
  });

  it("drops days outside the range and lists currencies", () => {
    expect(rowsInRange([row({ day: "2026-10-31" }), row({})], { from: "2026-11-01", to: "2026-11-30" })).toHaveLength(1);
    expect(currenciesOf([row({}), row({ currency: "USD" }), row({})])).toEqual(["EUR", "USD"]);
  });
});
