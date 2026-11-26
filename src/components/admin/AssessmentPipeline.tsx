import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useClinical, useFollowupsForPage } from "@/hooks/useAdmin";
import { type BadgeTone, uniqueCalendars } from "@/lib/clinicalDisplay";
import { indexFollowups } from "@/lib/customerFollowups";
import { daysAgoLabel, formatDate, formatDateTime, matchesSearch } from "@/lib/customerInsights";
import { initialSearchFromUrl } from "@/lib/salesTasks";
import {
  type AssessmentRow,
  type AssessmentStatus,
  type AssessmentStep,
  NEXT_STEP_LABELS,
} from "../../../supabase/functions/admin-clinical/logic.ts";
import { LIST_PRESETS, dayInRange, localDay, presetValue } from "@/lib/datePresets";
import { liveWindowStart } from "@/lib/adminWorklists";
import { DateRangePicker, type DateRangeValue } from "./DateRangePicker";
import { FollowupActions } from "./FollowupActions";
import { PeriodFigures } from "./PeriodFigures";
import {
  CustomerCell,
  InsightsError,
  InsightsHeader,
  InsightsLoading,
  StatTile,
} from "./CustomerInsightsShared";
import {
  DataIssues,
  EmptyRows,
  SearchAndCalendarFilter,
  StatusBadge,
  TabToggle,
} from "./ClinicalShared";

const TABS: { id: AssessmentStatus; label: string }[] = [
  { id: "needs_booking", label: "Needs booking" },
  { id: "booked", label: "Next step booked" },
  { id: "upcoming", label: "Assessment booked" },
  { id: "in_therapy", label: "In aftercare" },
];

const STEP_LABELS: Record<AssessmentStep, string> = {
  screening: "Consultation + screening",
  full: "Full clinical assessment",
  other: "Assessment",
};

const STATUS_BADGES: Record<AssessmentStatus, { label: string; tone: BadgeTone }> = {
  needs_booking: { label: "Not booked", tone: "red" },
  booked: { label: "Booked", tone: "green" },
  upcoming: { label: "Assessment booked", tone: "blue" },
  in_therapy: { label: "Aftercare started", tone: "muted" },
};

function LastStepCell({ row }: { row: AssessmentRow }) {
  if (!row.lastStep || !row.lastAt) return <span className="text-xs text-muted-foreground">None yet</span>;
  return (
    <div className="space-y-0.5 whitespace-nowrap">
      <p className="font-medium">{STEP_LABELS[row.lastStep]}</p>
      <p className="text-xs text-muted-foreground">
        {formatDate(row.lastAt)} · {daysAgoLabel(row.daysSinceLast ?? 0)}
        {row.clinician && ` · ${row.clinician}`}
      </p>
      {row.lastType && (
        <p className="max-w-[220px] whitespace-normal break-words text-xs leading-snug text-muted-foreground">
          {row.lastType}
        </p>
      )}
    </div>
  );
}

function NextStepCell({ row }: { row: AssessmentRow }) {
  const badge = STATUS_BADGES[row.status];
  return (
    <div className="space-y-1 whitespace-nowrap">
      {row.nextStep && <p className="font-medium">{NEXT_STEP_LABELS[row.nextStep]}</p>}
      <StatusBadge label={badge.label} tone={badge.tone} />
      {row.nextAt && (
        <>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(row.nextAt)}
            {row.status === "upcoming" && row.clinician && ` · ${row.clinician}`}
          </p>
          {row.nextType && (
            <p className="max-w-[220px] whitespace-normal break-words text-xs leading-snug text-muted-foreground">
              {row.nextType}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Admin Assessments: each client's last assessment step and what they still need booked. */
export function AssessmentPipeline() {
  const { data, error, isLoading, isFetching, refetch } = useClinical();
  const { followups, unavailable, outcomesUnavailable } = useFollowupsForPage();
  const followupsByKey = useMemo(() => indexFollowups(followups ?? []), [followups]);

  const [tab, setTab] = useState<AssessmentStatus>("needs_booking");
  const [calendar, setCalendar] = useState("all");
  // Opened from a sales task: start searched for that customer.
  const [search, setSearch] = useState(initialSearchFromUrl);
  // Clients whose last assessment step is in this period (first assessments
  // still to come always show); null = the whole live window.
  const [dates, setDates] = useState<DateRangeValue | null>(null);

  const allRows = useMemo(
    () =>
      (data?.assessments.rows ?? []).filter(
        (row) => !dates || row.lastAt === null || dayInRange(localDay(row.lastAt), dates.range)
      ),
    [data, dates]
  );
  const calendars = useMemo(() => uniqueCalendars(allRows.map((row) => row.clinician)), [allRows]);

  const rows = useMemo(
    () =>
      allRows
        .filter((row) => row.status === tab)
        .filter((row) => calendar === "all" || row.clinician === calendar)
        .filter((row) => matchesSearch(row, search)),
    [allRows, tab, calendar, search]
  );

  if (isLoading) return <InsightsLoading source="admin-clinical" />;
  if (error || !data) {
    return error ? <InsightsError error={error} onRetry={() => refetch()} /> : null;
  }

  const { totals } = data.assessments;
  const issues = data.dataIssues;
  // The figures at the top are as of now: the whole live list, not the period.
  const needsFull = data.assessments.rows.filter((row) => row.status === "needs_booking" && row.nextStep === "full").length;
  const tabCounts = Object.fromEntries(
    Object.keys(totals).map((status) => [status, allRows.filter((row) => row.status === status).length])
  ) as typeof totals;
  const needsTherapy = totals.needs_booking - needsFull;
  const today = localDay(new Date().toISOString());
  const windowStart = liveWindowStart(today, data.lookbackDays);
  const picked = dates ?? presetValue("last90", today, windowStart);

  return (
    <div className="space-y-6 animate-fade-in">
      <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />

      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker
          id="assessments-dates"
          value={picked}
          onChange={setDates}
          today={today}
          min={windowStart}
          compareMin="2010-01-01"
          presets={LIST_PRESETS}
        />
        <p className="text-xs text-muted-foreground">
          The dates narrow the list (last {data.lookbackDays} days, live from Acuity) by each client's latest step.
          The figures at the top are always as of now.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Need a full assessment booked" value={String(needsFull)} hint="Screening done" />
        <StatTile label="Need aftercare booked" value={String(needsTherapy)} hint="Assessment done" />
        <StatTile label="Next step booked" value={String(totals.booked)} />
        <StatTile label="Assessment booked" value={String(totals.upcoming)} hint="First assessment coming up" />
      </div>

      <PeriodFigures
        list="clinical"
        range={picked.range}
        compare={picked.compare}
        figures={(t, before) => [
          { label: "Screenings", current: t.screenings, previous: before?.screenings ?? null, kind: "count", detail: "Consultation + screening, completed" },
          { label: "Full assessments", current: t.fullAssessments, previous: before?.fullAssessments ?? null, kind: "count", detail: "Completed" },
          { label: "Other assessments", current: t.otherAssessments, previous: before?.otherAssessments ?? null, kind: "count", detail: "E.g. addiction, completed" },
          { label: "Clients assessed", current: t.assessmentClients, previous: before?.assessmentClients ?? null, kind: "count" },
        ]}
      />

      <DataIssues
        items={[
          issues.incompleteDates.length > 0 &&
            `Acuity returned too many appointments to fetch completely on ${issues.incompleteDates.join(", ")}. Some clients may be missing.`,
          issues.assessmentsWithoutEmail > 0 &&
            `${issues.assessmentsWithoutEmail} client(s) have no email in Acuity, so their bookings may not all be linked together.`,
        ]}
      />

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">Assessment next steps</CardTitle>
            <CardDescription>
              Everyone with an assessment in the last {data.lookbackDays} days or booked ahead
              (psychiatry is on its own page). After a consultation + screening the next step is a
              full clinical assessment; after a full or one-off assessment it's aftercare therapy.
              ADHD and Autism run through partners, so they aren't in Acuity.
            </CardDescription>
          </div>
          <TabToggle tabs={TABS} value={tab} counts={tabCounts} onChange={setTab} label="Assessment status" />
          <SearchAndCalendarFilter
            search={search}
            onSearch={setSearch}
            calendar={calendar}
            onCalendar={setCalendar}
            calendars={calendars}
            allLabel="All clinicians"
          />
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyRows filtered={!!search || calendar !== "all"} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Last step</TableHead>
                  <TableHead>Next step</TableHead>
                  <TableHead>Contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <CustomerCell name={row.name} email={row.email} phone={row.phone} />
                    </TableCell>
                    <TableCell>
                      <LastStepCell row={row} />
                    </TableCell>
                    <TableCell>
                      <NextStepCell row={row} />
                    </TableCell>
                    <TableCell>
                      <FollowupActions
                        customerKey={row.key}
                        customerName={row.name}
                        followup={followupsByKey.get(row.key)}
                        unavailable={unavailable}
                        outcomesUnavailable={outcomesUnavailable}
                        acuityBooked={row.status === "booked"}
                        customerPhone={row.phone}
                        source="followups"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {rows.length} of {totals[tab]} clients
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
