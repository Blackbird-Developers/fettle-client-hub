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
import type {
  PsychiatryRow,
  PsychiatryStatus,
} from "../../../supabase/functions/admin-clinical/logic.ts";
import { FollowupActions } from "./FollowupActions";
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

type Tab = "due" | "not_due" | "booked" | "upcoming";

const TABS: { id: Tab; label: string }[] = [
  { id: "due", label: "Due a call" },
  { id: "not_due", label: "Not due yet" },
  { id: "booked", label: "Follow-up booked" },
  { id: "upcoming", label: "Consultation booked" },
];

const TAB_OF: Record<PsychiatryStatus, Tab> = {
  overdue: "due",
  due: "due",
  not_due: "not_due",
  booked: "booked",
  upcoming: "upcoming",
};

const STATUS_BADGES: Record<PsychiatryStatus, { label: string; tone: BadgeTone }> = {
  overdue: { label: "Overdue", tone: "red" },
  due: { label: "Due now", tone: "orange" },
  not_due: { label: "Not due yet", tone: "muted" },
  booked: { label: "Follow-up booked", tone: "green" },
  upcoming: { label: "Consultation booked", tone: "blue" },
};

function LastAppointmentCell({ row }: { row: PsychiatryRow }) {
  if (!row.lastAt) return <span className="text-xs text-muted-foreground">None yet</span>;
  return (
    <div className="space-y-0.5 whitespace-nowrap">
      <p>{formatDate(row.lastAt)}</p>
      <p className="text-xs text-muted-foreground">
        {daysAgoLabel(row.daysSinceLast ?? 0)}
        {row.psychiatrist && ` · ${row.psychiatrist}`}
      </p>
      {row.lastType && (
        <p className="max-w-[220px] whitespace-normal break-words text-xs leading-snug text-muted-foreground">
          {row.lastType}
        </p>
      )}
    </div>
  );
}

function StatusCell({ row }: { row: PsychiatryRow }) {
  const badge = STATUS_BADGES[row.status];
  return (
    <div className="space-y-1 whitespace-nowrap">
      <StatusBadge label={badge.label} tone={badge.tone} />
      {row.nextAt ? (
        <>
          <p className="text-xs text-muted-foreground">{formatDateTime(row.nextAt)}</p>
          {row.nextType && (
            <p className="max-w-[220px] whitespace-normal break-words text-xs leading-snug text-muted-foreground">
              {row.nextType}
            </p>
          )}
        </>
      ) : (
        row.contactOn && (
          <p className="text-xs text-muted-foreground">
            Call from {formatDate(row.contactOn)} · book by {formatDate(row.followUpBy)}
          </p>
        )
      )}
    </div>
  );
}

/** Admin Psychiatry: who is due a call to book their week-4 follow-up. */
export function PsychiatryFollowUps() {
  const { data, error, isLoading, isFetching, refetch } = useClinical();
  const { followups, unavailable, outcomesUnavailable } = useFollowupsForPage();
  const followupsByKey = useMemo(() => indexFollowups(followups ?? []), [followups]);

  const [tab, setTab] = useState<Tab>("due");
  const [calendar, setCalendar] = useState("all");
  // Opened from a sales task: start searched for that customer.
  const [search, setSearch] = useState(initialSearchFromUrl);

  const allRows = useMemo(() => data?.psychiatry.rows ?? [], [data]);
  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = { due: 0, not_due: 0, booked: 0, upcoming: 0 };
    for (const row of allRows) counts[TAB_OF[row.status]]++;
    return counts;
  }, [allRows]);
  const calendars = useMemo(() => uniqueCalendars(allRows.map((row) => row.psychiatrist)), [allRows]);

  const rows = useMemo(
    () =>
      allRows
        .filter((row) => TAB_OF[row.status] === tab)
        .filter((row) => calendar === "all" || row.psychiatrist === calendar)
        .filter((row) => matchesSearch(row, search)),
    [allRows, tab, calendar, search]
  );

  if (isLoading) return <InsightsLoading source="admin-clinical" />;
  if (error || !data) {
    return error ? <InsightsError error={error} onRetry={() => refetch()} /> : null;
  }

  const { totals } = data.psychiatry;
  const { contactAfterDays, followUpByDays } = data.psychiatryRule;
  const issues = data.dataIssues;

  return (
    <div className="space-y-6 animate-fade-in">
      <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Overdue" value={String(totals.overdue)} hint={`Past week ${followUpByDays / 7}, nothing booked`} />
        <StatTile label="Due a call now" value={String(totals.due)} hint={`${contactAfterDays}–${followUpByDays} days since`} />
        <StatTile label="Follow-up booked" value={String(totals.booked)} />
        <StatTile label="Consultation booked" value={String(totals.upcoming)} hint="First appointment coming up" />
      </div>

      <DataIssues
        items={[
          issues.incompleteDates.length > 0 &&
            `Acuity returned too many appointments to fetch completely on ${issues.incompleteDates.join(", ")}. Some clients may be missing.`,
          issues.psychiatryWithoutEmail > 0 &&
            `${issues.psychiatryWithoutEmail} client(s) have no email in Acuity, so their bookings may not all be linked together.`,
        ]}
      />

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">Psychiatry follow-ups</CardTitle>
            <CardDescription>
              Everyone with a psychiatry appointment in the last {data.lookbackDays} days or booked
              ahead. {contactAfterDays / 7} weeks after their latest appointment they're due a call to
              book a follow-up for week {followUpByDays / 7}. Any later psychiatry appointment in
              Acuity counts as the follow-up being booked.
            </CardDescription>
          </div>
          <TabToggle tabs={TABS} value={tab} counts={tabCounts} onChange={setTab} label="Follow-up status" />
          <SearchAndCalendarFilter
            search={search}
            onSearch={setSearch}
            calendar={calendar}
            onCalendar={setCalendar}
            calendars={calendars}
            allLabel="All psychiatrists"
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
                  <TableHead>Last appointment</TableHead>
                  <TableHead>Follow-up</TableHead>
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
                      <LastAppointmentCell row={row} />
                    </TableCell>
                    <TableCell>
                      <StatusCell row={row} />
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
              Showing {rows.length} of {tabCounts[tab]} clients
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
