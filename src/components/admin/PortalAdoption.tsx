import { useMemo, useState } from "react";
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
import { Search, UserX } from "lucide-react";
import { useCustomerInsights } from "@/hooks/useAdmin";
import { daysAgoLabel, formatDate, formatDateTime, matchesSearch } from "@/lib/customerInsights";
import {
  type AdoptionRow,
  GRADE_ORDER,
} from "../../../supabase/functions/admin-customer-insights/logic.ts";
import {
  CustomerCell,
  DataIssuesPanel,
  GradeBadge,
  GradeLegend,
  InsightsError,
  InsightsHeader,
  InsightsLoading,
  PortalStatusBadge,
  SortableHead,
  type SortDirection,
  StatTile,
} from "./CustomerInsightsShared";

type SortKey = "grade" | "name" | "lastSession";

const COMPARATORS: Record<SortKey, (a: AdoptionRow, b: AdoptionRow) => number> = {
  grade: (a, b) =>
    GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] ||
    a.daysSinceLastSession - b.daysSinceLastSession,
  name: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""),
  lastSession: (a, b) => a.daysSinceLastSession - b.daysSinceLastSession,
};

export function PortalAdoption() {
  const { data, error, isLoading, isFetching, refetch } = useCustomerInsights();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "grade",
    direction: "asc",
  });

  const rows = useMemo(() => {
    const filtered = (data?.adoption.rows ?? []).filter((row) => matchesSearch(row, search));
    const compare = COMPARATORS[sort.key];
    return filtered.sort((a, b) => (sort.direction === "asc" ? compare(a, b) : compare(b, a)));
  }, [data, search, sort]);

  const onSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));

  if (isLoading) return <InsightsLoading />;
  if (error || !data) {
    return error ? <InsightsError error={error} onRetry={() => refetch()} /> : null;
  }

  const { totals } = data.adoption;
  const matchable = totals.withAccount + totals.withoutAccount;
  const adoptionRate = matchable > 0 ? Math.round((totals.withAccount / matchable) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`Active customers (last ${data.activeWindowDays} days)`}
          value={String(totals.activeCustomers)}
        />
        <StatTile
          label="Portal adoption"
          value={`${adoptionRate}%`}
          hint={`${totals.withAccount} of ${matchable} with an email`}
        />
        <StatTile label="Without a portal account" value={String(totals.withoutAccount)} />
        <StatTile label="Can't match (no email)" value={String(totals.noEmail)} />
      </div>

      <DataIssuesPanel data={data} />

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">Customers without a portal account</CardTitle>
            <CardDescription>
              Completed a session in the last {data.activeWindowDays} days but have no My Fettle Hub
              account with the same email.
            </CardDescription>
          </div>
          <GradeLegend legend={data.adoption.legend} />
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
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <UserX className="h-8 w-8" />
              <p className="text-sm">
                {search
                  ? "No customers match your search."
                  : "Every recently active customer has a portal account."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Priority" sortKey="grade" sort={sort} onSort={onSort} />
                  <SortableHead label="Customer" sortKey="name" sort={sort} onSort={onSort} />
                  <SortableHead label="Last session" sortKey="lastSession" sort={sort} onSort={onSort} />
                  <TableHead>Next booked</TableHead>
                  <TableHead>Portal account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <GradeBadge grade={row.grade} reason={row.gradeReason} />
                    </TableCell>
                    <TableCell>
                      <CustomerCell name={row.name} email={row.email} phone={row.phone} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p>{formatDate(row.lastSessionAt)}</p>
                      <p className="text-xs text-muted-foreground">
                        {daysAgoLabel(row.daysSinceLastSession)}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.nextSessionAt ? (
                        formatDateTime(row.nextSessionAt)
                      ) : (
                        <span className="text-muted-foreground">Nothing booked</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <PortalStatusBadge status={row.portalStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {rows.length} of {data.adoption.rows.length} customers
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
