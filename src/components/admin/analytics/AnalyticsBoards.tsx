import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, Info, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAdminAnalytics } from "@/hooks/useAdmin";
import {
  type BoardSettings,
  type RangePreset,
  CATEGORY_LABELS,
  RANGE_PRESETS,
  describeFilters,
  analyticsQuery,
  boardSettingsToSearch,
  formatFullDay,
  formatRange,
  presetRange,
  readBoardSettings,
  todayInDublin,
} from "@/lib/adminAnalytics";
import {
  type DateRange,
  type SessionCategory,
  MAX_RANGE_DAYS,
  SESSION_CATEGORIES,
  daysInRange,
  defaultGroupBy,
  isDate,
} from "../../../../supabase/functions/admin-analytics/logic.ts";
import { CustomersBoard } from "./CustomersBoard";
import { ProgressionBoard } from "./ProgressionBoard";

const SETTINGS_KEYS = ["range", "from", "to", "group", "compare", "window", "basis", "type", "calendar"];
const ALL = "all";

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", {
    timeZone: "Europe/Dublin",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

/** Custom from/to dates; applied once both are valid. */
function CustomRange({ range, onApply }: { range: DateRange; onApply: (range: DateRange) => void }) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const valid = isDate(from) && isDate(to) && from <= to && daysInRange({ from, to }) <= MAX_RANGE_DAYS;
  const changed = from !== range.from || to !== range.to;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="analytics-from" className="text-xs">
          From
        </Label>
        <Input id="analytics-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="analytics-to" className="text-xs">
          To
        </Label>
        <Input id="analytics-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
      </div>
      <Button size="sm" className="h-9" disabled={!valid || !changed} onClick={() => onApply({ from, to })}>
        Apply
      </Button>
      {!valid && <p className="w-full text-xs text-destructive">Pick a start before the end, at most three years apart.</p>}
    </div>
  );
}

function BoardsSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading analytics">
      {[1, 2].map((board) => (
        <Card key={board} className="border-border/50">
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-5 w-48" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** The Overview's analytics: shared controls, then the Progression and Customers boards. */
export function AnalyticsBoards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayInDublin();
  const settings = useMemo(() => readBoardSettings(searchParams, today), [searchParams, today]);
  const { data, error, isPending, isFetching, refetch } = useAdminAnalytics(analyticsQuery(settings));
  const calendars = [...(data?.data.calendars ?? [])];
  // A calendar from a shared link that the list no longer has still shows.
  if (settings.filters.calendarId !== null && !calendars.some((c) => c.id === settings.filters.calendarId)) {
    calendars.push({ id: settings.filters.calendarId, name: `Calendar ${settings.filters.calendarId}` });
  }

  const update = (patch: Partial<BoardSettings>) => {
    const next = { ...settings, ...patch };
    if (patch.range && !next.groupByChosen) next.groupBy = defaultGroupBy(next.range);
    const search = new URLSearchParams(searchParams);
    SETTINGS_KEYS.forEach((key) => search.delete(key));
    boardSettingsToSearch(next).forEach((value, key) => search.set(key, value));
    setSearchParams(search, { replace: true });
  };

  const choosePreset = (preset: RangePreset) => {
    // Custom starts from the dates on screen.
    update({ preset, range: presetRange(preset, today) ?? settings.range });
  };

  return (
    <section aria-labelledby="analytics-title" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 id="analytics-title" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Analytics
          </h3>
          <p className="text-sm text-foreground">{formatRange(settings.range)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="analytics-range" className="text-xs">
              Date range
            </Label>
            <Select value={settings.preset} onValueChange={(value) => choosePreset(value as RangePreset)}>
              <SelectTrigger id="analytics-range" className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span id="analytics-group" className="block text-xs font-medium">
              Group by
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={settings.groupBy}
              onValueChange={(value) => value && update({ groupBy: value as BoardSettings["groupBy"], groupByChosen: true })}
              aria-labelledby="analytics-group"
            >
              <ToggleGroupItem value="week" className="h-9 text-xs">
                Week
              </ToggleGroupItem>
              <ToggleGroupItem value="month" className="h-9 text-xs">
                Month
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-type" className="text-xs">
              Session type
            </Label>
            <Select
              value={settings.filters.category ?? ALL}
              onValueChange={(value) =>
                update({
                  filters: { ...settings.filters, category: value === ALL ? null : (value as SessionCategory) },
                })
              }
            >
              <SelectTrigger id="analytics-type" className="h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {SESSION_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-calendar" className="text-xs">
              Calendar
            </Label>
            <Select
              value={settings.filters.calendarId === null ? ALL : String(settings.filters.calendarId)}
              onValueChange={(value) =>
                update({ filters: { ...settings.filters, calendarId: value === ALL ? null : Number(value) } })
              }
              disabled={!data && settings.filters.calendarId === null}
            >
              <SelectTrigger id="analytics-calendar" className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All calendars</SelectItem>
                {calendars.map((calendar) => (
                  <SelectItem key={calendar.id} value={String(calendar.id)}>
                    {calendar.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-compare" className="text-xs">
              Compare to
            </Label>
            <Select
              value={settings.compareTo}
              onValueChange={(value) => update({ compareTo: value as BoardSettings["compareTo"] })}
            >
              <SelectTrigger id="analytics-compare" className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="previous">Previous period</SelectItem>
                <SelectItem value="year">Same period last year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {settings.preset === "custom" && (
        <CustomRange key={`${settings.range.from}-${settings.range.to}`} range={settings.range} onApply={(range) => update({ range })} />
      )}

      {isPending ? (
        <BoardsSkeleton />
      ) : error && !data ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn't load the analytics</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p>{error.message}</p>
            {error.retryable && (
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-3 w-3" />
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
            <span>Data last updated: {formatUpdated(data.data.lastRefreshedAt)}</span>
            <span>
              Compared with {formatRange(data.params.compareRange)}
            </span>
            {describeFilters(data.params.filters, calendars) && (
              <span>Only {describeFilters(data.params.filters, calendars)} sessions</span>
            )}
            {isFetching && (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Updating…
              </span>
            )}
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Couldn't load the new settings, so these are the previous numbers. {error.message}
              </AlertDescription>
            </Alert>
          )}
          {!data.data.historyComplete && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Still copying older appointments from Acuity</AlertTitle>
              <AlertDescription>
                History is in from {data.data.historyFrom ? formatFullDay(data.data.historyFrom) : "the last 60 days"}{" "}
                onwards. Until the rest arrives, some returning clients look new and some session numbers are too low.
              </AlertDescription>
            </Alert>
          )}
          <ProgressionBoard data={data} onWindowChange={(windowDays) => update({ windowDays })} />
          <CustomersBoard data={data} onBasisChange={(basis) => update({ basis })} />
        </div>
      ) : null}
    </section>
  );
}
