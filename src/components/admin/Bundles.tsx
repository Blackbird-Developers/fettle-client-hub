import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlertTriangle, Package, Search } from "lucide-react";
import { useBundles, useContactOutcomesAvailable, useCustomerFollowups } from "@/hooks/useAdmin";
import { indexFollowups, isMissingTableError } from "@/lib/customerFollowups";
import { daysAgoLabel, formatDate, formatDateTime, matchesSearch } from "@/lib/customerInsights";
import {
  type BundleRow,
  type BundleSegment,
  SEGMENT_LABELS,
  SEGMENT_ORDER,
} from "../../../supabase/functions/admin-bundles/logic.ts";
import { FollowupActions } from "./FollowupActions";
import {
  CustomerCell,
  InsightsError,
  InsightsHeader,
  InsightsLoading,
  PortalStatusBadge,
  StatTile,
} from "./CustomerInsightsShared";

const SEGMENT_STYLES: Record<BundleSegment, string> = {
  expiring: "bg-red-50 text-red-700 border-red-200",
  not_started: "bg-orange-50 text-orange-700 border-orange-200",
  stalled: "bg-amber-50 text-amber-700 border-amber-200",
  nearly_done: "bg-violet-50 text-violet-700 border-violet-200",
  on_track: "bg-green-50 text-green-700 border-green-200",
  used_up: "bg-muted text-muted-foreground border-border",
  expired: "bg-muted text-muted-foreground border-border",
};

/**
 * Bundles page: every session bundle (Acuity certificate) with credits used
 * and left, split into segments by what needs doing. Utilisation alone is
 * misleading (a bundle bought last week is at 0%), so the tabs come first.
 */
export function Bundles() {
  const { data, error, isLoading, isFetching, refetch } = useBundles();
  const followups = useCustomerFollowups();
  const followupsByKey = useMemo(() => indexFollowups(followups.data ?? []), [followups.data]);
  const followupsUnavailable = followups.isPending
    ? "Loading follow-ups…"
    : followups.isError
      ? isMissingTableError(followups.error)
        ? "Available once the follow-ups database update is deployed"
        : "Couldn't load follow-ups. Refresh the page to try again."
      : null;
  const outcomesCheck = useContactOutcomesAvailable();
  const outcomesUnavailable = outcomesCheck.isPending
    ? "Loading…"
    : outcomesCheck.isError
      ? isMissingTableError(outcomesCheck.error)
        ? "Outcomes are available once the contact-outcomes database update is deployed"
        : "Couldn't load contact outcomes. Refresh the page to try again."
      : null;

  const [segment, setSegment] = useState<BundleSegment>("expiring");
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () =>
      (data?.bundles.rows ?? [])
        .filter((row) => row.segment === segment)
        .filter((row) => matchesSearch(row, search) || row.code.toLowerCase().includes(search.trim().toLowerCase())),
    [data, segment, search]
  );

  if (isLoading) return <InsightsLoading />;
  if (error || !data) {
    return error ? <InsightsError error={error} onRetry={() => refetch()} /> : null;
  }

  const { totals, counts, skipped } = data.bundles;
  const issues = data.dataIssues;
  const notes: string[] = [];
  if (issues.incompleteDates.length > 0) {
    notes.push(
      `Acuity returned too many appointments to fetch completely on ${issues.incompleteDates.join(", ")}. Last and next sessions may be missing for those days.`
    );
  }
  if (skipped.unknownProducts > 0) {
    notes.push(
      `${skipped.unknownProducts} bundle(s) aren't one of the known 3/5/6/9-session products, so their total (and utilisation) is unknown; only credits left are shown.`
    );
  }
  if (issues.matchedByEmailOnly > 0) {
    notes.push(
      `${issues.matchedByEmailOnly} bundle(s) had no sessions booked with their code, so their sessions come from the customer's email instead.`
    );
  }
  if (issues.bundlesWithoutEmail > 0) {
    notes.push(`${issues.bundlesWithoutEmail} bundle(s) have no email, so they can't be matched to a customer or a portal account.`);
  }

  const meta = SEGMENT_LABELS[segment];

  return (
    <div className="space-y-6 animate-fade-in">
      <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatTile label="Active bundles" value={String(totals.activeBundles)} hint="Credits left, not expired" />
        <StatTile label="Unused sessions" value={String(totals.unusedCredits)} hint="Across active bundles" />
        <StatTile label="Expiring within 30 days" value={String(totals.expiringSoon)} />
        <StatTile label="Stalled" value={String(totals.stalled)} hint="No session in 30+ days" />
        <StatTile
          label="Average utilisation"
          value={totals.averageUtilisation === null ? "–" : `${totals.averageUtilisation}%`}
          hint="Of active bundles with a known size"
        />
      </div>

      {notes.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50/50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>Data to be aware of</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">Session bundles</CardTitle>
            <CardDescription>
              Every bundle in Acuity, whether or not the customer has a hub account. Sessions are the
              ones booked with the bundle's code over the last {Math.round(data.lookbackDays / 30)} months.
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={segment}
            onValueChange={(value) => value && setSegment(value as BundleSegment)}
            className="flex-wrap justify-start"
            aria-label="Bundle segment"
          >
            {SEGMENT_ORDER.map((id) => (
              <ToggleGroupItem key={id} value={id} variant="outline" size="sm">
                {SEGMENT_LABELS[id].label} ({counts[id]})
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{meta.rule}.</span> Suggested: {meta.action}.
          </p>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone or code"
              className="pl-8"
              aria-label="Search bundles"
            />
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Package className="h-8 w-8" />
              <p className="text-sm">{search ? "No bundles match your search." : "No bundles in this group."}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Bundle</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Bought · expires</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead>Portal account</TableHead>
                  <TableHead>Follow-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <CustomerCell name={row.name} email={row.email} phone={row.phone} />
                      {row.otherBundles > 0 && (
                        <Badge variant="outline" className="mt-1 text-[11px] font-normal">
                          {row.otherBundles + 1} bundles
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <BundleCell row={row} />
                    </TableCell>
                    <TableCell>
                      <CreditsCell row={row} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DatesCell row={row} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <SessionsCell row={row} />
                    </TableCell>
                    <TableCell>
                      <PortalStatusBadge status={row.portalStatus} />
                    </TableCell>
                    <TableCell>
                      <FollowupActions
                        customerKey={row.key}
                        customerName={row.name}
                        followup={followupsByKey.get(row.key)}
                        unavailable={followupsUnavailable}
                        outcomesUnavailable={outcomesUnavailable}
                        acuityBooked={row.nextSessionAt !== null}
                        customerPhone={row.phone}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {rows.length} of {counts[segment]} bundles
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Not shown: {skipped.notSessionBundles} discount or gift codes, {skipped.oldUsedUp} bundles used up
        more than 90 days ago, and {skipped.oldExpired} that expired more than 180 days ago.
      </p>
    </div>
  );
}

function BundleCell({ row }: { row: BundleRow }) {
  return (
    <div className="space-y-1">
      <p className={row.knownProduct ? "font-medium" : "font-medium text-amber-700"}>{row.bundleName}</p>
      <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
      <Badge variant="outline" className={`text-[11px] ${SEGMENT_STYLES[row.segment]}`}>
        {SEGMENT_LABELS[row.segment].label}
      </Badge>
    </div>
  );
}

function CreditsCell({ row }: { row: BundleRow }) {
  if (row.totalCredits === null) {
    return (
      <div className="space-y-0.5">
        <p>{row.remainingCredits} left</p>
        <p className="text-xs text-muted-foreground">Total unknown</p>
      </div>
    );
  }
  return (
    <div className="min-w-[140px] space-y-1">
      <div
        className="h-2 w-full rounded-full bg-muted"
        role="img"
        aria-label={`${row.usedCredits} of ${row.totalCredits} used`}
      >
        <div className="h-2 rounded-full bg-primary" style={{ width: `${row.utilisation}%` }} />
      </div>
      <p className="text-sm">
        {row.usedCredits} of {row.totalCredits} used · <span className="font-medium">{row.remainingCredits} left</span>
      </p>
      <p className="text-xs text-muted-foreground">{row.utilisation}% used</p>
    </div>
  );
}

function DatesCell({ row }: { row: BundleRow }) {
  const expiryLabel =
    row.daysToExpiry === null
      ? "No expiry"
      : row.daysToExpiry < 0
        ? `Expired ${daysAgoLabel(-row.daysToExpiry)}`
        : row.daysToExpiry === 0
          ? "Expires today"
          : `${row.daysToExpiry} day${row.daysToExpiry === 1 ? "" : "s"} left`;
  return (
    <div className="space-y-0.5">
      <p>
        {row.purchasedAt ? formatDate(row.purchasedAt) : <span className="text-muted-foreground">Unknown</span>}
        {row.purchasedSource === "first_session" && (
          <span className="text-xs text-muted-foreground"> (first session)</span>
        )}
      </p>
      <p className={`text-xs ${row.daysToExpiry !== null && row.daysToExpiry <= 30 ? "font-medium text-red-700" : "text-muted-foreground"}`}>
        {row.expiresAt ? `${formatDate(row.expiresAt)} · ` : ""}
        {expiryLabel}
      </p>
    </div>
  );
}

function SessionsCell({ row }: { row: BundleRow }) {
  return (
    <div className="space-y-0.5">
      <p>
        Last:{" "}
        {row.lastSessionAt ? (
          <>
            {formatDate(row.lastSessionAt)}
            <span className="text-xs text-muted-foreground"> · {daysAgoLabel(row.daysSinceLastSession!)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        Next: {row.nextSessionAt ? formatDateTime(row.nextSessionAt) : "nothing booked"}
      </p>
      {row.sessionsMatchedBy === "email" && (
        <p className="text-xs text-amber-700">From their email, not the bundle code</p>
      )}
    </div>
  );
}
