import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMonthDays, findEarliestSlot, findFirstOpenMonth, mapWithLimit, recheckSlot } from "./availability";

// Thursday 29 October 2026, 10:00 in Dublin.
const NOW = new Date("2026-10-29T10:00:00Z");
const SOURCE = { typeId: 56122573, calendarId: 4567890 };

type Handler = (params: URLSearchParams) => unknown;

function mockAcuity(handler: Handler) {
  const fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, "https://example.test").searchParams;
    const body = handler(params);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMonthDays", () => {
  it("loads each date's times, passes the calendar and cleans the result", async () => {
    const fetchMock = mockAcuity((p) => {
      if (p.get("action") === "get-availability") {
        return [{ date: "2026-10-28" }, { date: "2026-10-29" }, { date: "2026-10-30" }];
      }
      const date = p.get("date");
      if (date === "2026-10-29") return [{ time: "2026-10-29T10:15:00+0000" }, { time: "2026-10-29T15:00:00+0000" }];
      return [{ time: `${date}T09:00:00+0000` }];
    });

    const days = await fetchMonthDays(SOURCE, "2026-10", NOW);
    expect(days).toEqual([
      { date: "2026-10-29", times: ["2026-10-29T15:00:00+0000"] },
      { date: "2026-10-30", times: ["2026-10-30T09:00:00+0000"] },
    ]);
    // The past day (28th) never had its times fetched.
    const timeCalls = fetchMock.mock.calls.map(([u]) => new URL(u as string, "https://example.test").searchParams).filter((p) => p.get("action") === "get-times");
    expect(timeCalls.map((p) => p.get("date"))).toEqual(["2026-10-29", "2026-10-30"]);
    expect(timeCalls.every((p) => p.get("calendarId") === "4567890")).toBe(true);
  });

  it("throws when Acuity fails, so the wizard can offer Try again", async () => {
    mockAcuity(() => new Response("{}", { status: 500 }));
    await expect(fetchMonthDays(SOURCE, "2026-10", NOW)).rejects.toThrow();
    mockAcuity(() => ({ error: "Acuity API error" }));
    await expect(fetchMonthDays(SOURCE, "2026-10", NOW)).rejects.toThrow("Acuity API error");
  });
});

describe("findFirstOpenMonth", () => {
  it("walks forward to the first month with times", async () => {
    mockAcuity((p) => {
      if (p.get("action") === "get-availability") {
        return p.get("month") === "2026-12" ? [{ date: "2026-12-03" }] : [];
      }
      return [{ time: "2026-12-03T18:00:00+0000" }];
    });
    const first = await findFirstOpenMonth(SOURCE, NOW);
    expect(first?.month).toBe("2026-12");
    expect(await findEarliestSlot(SOURCE, NOW)).toEqual({ date: "2026-12-03", time: "2026-12-03T18:00:00+0000" });
  });

  it("gives up after 12 months", async () => {
    const fetchMock = mockAcuity(() => []);
    expect(await findFirstOpenMonth(SOURCE, NOW)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });
});

describe("recheckSlot", () => {
  it("checks the exact time on that day", async () => {
    mockAcuity(() => [{ time: "2026-11-02T09:00:00+0000" }]);
    expect(await recheckSlot(SOURCE, "2026-11-02T09:00:00+0000")).toBe(true);
    expect(await recheckSlot(SOURCE, "2026-11-02T10:00:00+0000")).toBe(false);
  });
});

describe("mapWithLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
