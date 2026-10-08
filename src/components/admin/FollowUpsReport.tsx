import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlertCircle, CalendarCheck, Search } from "lucide-react";
import {
  useContactOutcomesAvailable,
  useCustomerFollowups,
  useCustomerInsights,
} from "@/hooks/useAdmin";
import { type CustomerFollowup, isMissingTableError } from "@/lib/customerFollowups";
import {
  FOLLOW_UP_AFTER_DAYS,
  NOT_CONTINUING_REASONS,
  contactFromKey,
  describeReasons,
  followUpLater,
  followUpTiming,
  followUpTimingLabel,
  reasonCounts,
} from "@/lib/contactOutcomes";
import { formatDate, matchesSearch } from "@/lib/customerInsights";
import type { NextSessionStatus } from "../../../supabase/functions/admin-customer-insights/logic.ts";
import { CustomerCell, StatTile } from "./CustomerInsightsShared";
import { FollowupActions } from "./FollowupActions";

type DueFilter = "now" | "week" | "all";

const TIMING_STYLES = {
  overdue: "text-red-700",
  today: "text-amber-700",
  soon: "text-amber-700",
  upcoming: "text-muted-foreground",
} as const;

interface ReportCustomer {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Their latest Progression row in Acuity, when the customer is still in it. */
  nextSessionStatus: NextSessionStatus | null;
  followup: CustomerFollowup;
}

/**
 * Follow-ups report: "Interested, but will continue later" customers to call
 * again 30 days on, and the reasons customers gave for not continuing.
 */
export function FollowUpsReport() {
  const followups = useCustomerFollowups();
  const outcomesCheck = useContactOutcomesAvailable();
  // Optional extras (contact details, Acuity booking hint); the report works without them.
  const insights = useCustomerInsights();
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [search, setSearch] = useState("");

  // Contact details from the most recent Progression view each customer is in.
  const detailsByKey = useMemo(() => {
    const map = new Map<
      string,
      { name: string | null; email: string | null; phone: string | null; next: NextSessionStatus }
    >();
    for (const view of [...(insights.data?.progression ?? [])].sort(
      (a, b) => a.fromSession - b.fromSession
    )) {
      for (const row of view.rows) {
        map.set(row.key, {
          name: row.name,
          email: row.email,
          phone: row.phone,
          next: row.nextSessionStatus,
        });
      }
    }
    return map;
  }, [insights.data]);

  const toCustomer = (followup: CustomerFollowup): ReportCustomer => {
    const details = detailsByKey.get(followup.customer_key);
    const fromKey = contactFromKey(followup.customer_key);
    return {
      key: followup.customer_key,
      name: details?.name ?? followup.customer_name,
      email: details?.email ?? fromKey.email,
      phone: details?.phone ?? fromKey.phone,
      nextSessionStatus: details?.next ?? null,
      followup,
    };
  };

  const rows = followups.data ?? [];
  const later = followUpLater(rows).map(toCustomer);
  const notContinuing = rows
    .filter((row) => row.outcome === "not_continuing")
    .sort((a, b) => (b.outcome_at ?? "").localeCompare(a.outcome_at ?? ""))
    .map(toCustomer);

  const timingOf = (c: ReportCustomer) => followUpTiming(c.followup.follow_up_due!);
  const dueNow = later.filter((c) => ["overdue", "today"].includes(timingOf(c).kind));
  const dueWeek = later.filter((c) => timingOf(c).kind === "soon");

  const shownLater = (
    dueFilter === "now" ? dueNow : dueFilter === "week" ? [...dueNow, ...dueWeek] : later
  ).filter((c) => matchesSearch(c, search));
  const shownNotContinuing = notContinuing.filter((c) => matchesSearch(c, search));
  const counts = reasonCounts(rows);

  const unavailable = followups.isError
    ? isMissingTableError(followups.error)
      ? "Available once the follow-ups database update is deployed."
      : "Couldn't load follow-ups. Refresh the page to try again."
    : null;
  const outcomesUnavailable = outcomesCheck.isPending
    ? "Loading…"
    : outcomesCheck.isError
      ? isMissingTableError(outcomesCheck.error)
        ? "Available once the contact-outcomes database update is deployed"
        : "Couldn't load contact outcomes. Refresh the page to try again."
      : null;

  if (followups.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (unavailable || outcomesCheck.isError) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{unavailable ?? `${outcomesUnavailable}.`}</AlertDescription>
      </Alert>
    );
  }

  const actionsCell = (c: ReportCustomer) => (
    <FollowupActions
      customerKey={c.key}
      customerName={c.name}
      followup={c.followup}
      unavailable={null}
      outcomesUnavailable={outcomesUnavailable}
      acuityBooked={c.nextSessionStatus !== null && c.nextSessionStatus !== "none"}
    />
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label="To call now" value={String(dueNow.length)} hint="Due today or overdue" />
        <StatTile label="Due in the next 7 days" value={String(dueWeek.length)} />
        <StatTile label="Continue later (all)" value={String(later.length)} />
        <StatTile label="Not continuing" value={String(notContinuing.length)} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or phone"
          className="pl-8"
          aria-label="Search customers"
        />
      </div>

      <Tabs defaultValue="later">
        <TabsList>
          <TabsTrigger value="later">Continue later ({later.length})</TabsTrigger>
          <TabsTrigger value="not-continuing">Not continuing ({notContinuing.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="later">
          <Card className="border-border/50">
            <CardHeader className="space-y-3">
              <div>
                <CardTitle className="text-lg font-heading">
                  Interested, but will continue later
                </CardTitle>
                <CardDescription>
                  Customers to contact again {FOLLOW_UP_AFTER_DAYS} days after they said they'd
                  continue later, most overdue first. Recording any other outcome takes them off
                  this list.
                </CardDescription>
              </div>
              <ToggleGroup
                type="single"
                value={dueFilter}
                onValueChange={(value) => value && setDueFilter(value as DueFilter)}
                className="justify-start"
                aria-label="Show follow-ups"
              >
                <ToggleGroupItem value="now" variant="outline" size="sm">
                  To call now ({dueNow.length})
                </ToggleGroupItem>
                <ToggleGroupItem value="week" variant="outline" size="sm">
                  Next 7 days ({dueNow.length + dueWeek.length})
                </ToggleGroupItem>
                <ToggleGroupItem value="all" variant="outline" size="sm">
                  All ({later.length})
                </ToggleGroupItem>
              </ToggleGroup>
            </CardHeader>
            <CardContent>
              {shownLater.length === 0 ? (
                <EmptyState
                  text={
                    search
                      ? "No customers match your search."
                      : later.length === 0
                        ? "No one is marked as continuing later."
                        : "No follow-ups due in this period."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Said they'd continue later</TableHead>
                      <TableHead>Follow up</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Follow-up</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownLater.map((c) => {
                      const timing = timingOf(c);
                      return (
                        <TableRow key={c.key}>
                          <TableCell>
                            <CustomerCell name={c.name} email={c.email} phone={c.phone} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <p>{formatDate(c.followup.outcome_at)}</p>
                            {c.followup.outcome_by_email && (
                              <p className="text-xs text-muted-foreground">
                                by {c.followup.outcome_by_email}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <p>{formatDate(c.followup.follow_up_due)}</p>
                            <p className={`text-xs font-medium ${TIMING_STYLES[timing.kind]}`}>
                              {followUpTimingLabel(timing)}
                            </p>
                          </TableCell>
                          <TableCell>
                            <NoteSnippet note={c.followup.note} />
                          </TableCell>
                          <TableCell>{actionsCell(c)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="not-continuing" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg font-heading">Reasons for not continuing</CardTitle>
              <CardDescription>
                From customers currently marked as not continuing. One customer can give several
                reasons.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReasonBreakdown counts={counts} total={notContinuing.length} />
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-6">
              {shownNotContinuing.length === 0 ? (
                <EmptyState
                  text={
                    search
                      ? "No customers match your search."
                      : "No one is marked as not continuing."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Follow-up</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownNotContinuing.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>
                          <CustomerCell name={c.name} email={c.email} phone={c.phone} />
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          {describeReasons(
                            c.followup.not_continuing_reasons,
                            c.followup.not_continuing_other
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <p>{formatDate(c.followup.outcome_at)}</p>
                          {c.followup.outcome_by_email && (
                            <p className="text-xs text-muted-foreground">
                              by {c.followup.outcome_by_email}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>{actionsCell(c)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
      <CalendarCheck className="h-8 w-8" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

function NoteSnippet({ note }: { note: string | null }) {
  if (!note) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <p
      className="max-w-[220px] whitespace-pre-line text-xs text-muted-foreground line-clamp-3"
      title={note}
    >
      {note}
    </p>
  );
}

function ReasonBreakdown({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No reasons recorded yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {NOT_CONTINUING_REASONS.map((reason) => {
        const count = counts[reason.id] ?? 0;
        const percent = Math.round((count / total) * 100);
        return (
          <li
            key={reason.id}
            className="grid grid-cols-[140px_1fr_60px] items-center gap-3 text-sm"
          >
            <span>{reason.label}</span>
            <span className="h-2 rounded-full bg-muted" aria-hidden>
              <span
                className="block h-2 rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {count} <span className="sr-only">of {total} customers</span>({percent}%)
            </span>
          </li>
        );
      })}
    </ul>
  );
}
