import { useMemo, useRef, useState } from "react";
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
import { paginate } from "@/lib/pagination";
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
import { PortalEmailsPanel } from "./PortalEmailsPanel";
import { TablePagination } from "./TablePagination";

type SortKey = "grade" | "name" | "lastSession";

/** Rows per page; matches the daily cap of the account set-up emails. */
const PAGE_SIZE = 25;

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
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const filtered = (data?.adoption.rows ?? []).filter((row) => matchesSearch(row, search));
    const compare = COMPARATORS[sort.key];
    return filtered.sort((a, b) => (sort.direction === "asc" ? compare(a, b) : compare(b, a)));
  }, [data, search, sort]);

  const shown = paginate(rows, page, PAGE_SIZE);

  // A new search or sort starts again from the first page.
  const onSort = (key: SortKey) => {
    setPage(1);
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  // The controls sit under the table, so bring its top back into view.
  const onPageChange = (next: number) => {
    setPage(next);
    const card = tableRef.current;
    if (card && card.getBoundingClientRect().top < 0) {
      card.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  };

  if (isLoading) return <InsightsLoading source="admin-customer-insights" />;
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

      <Card ref={tableRef} className="border-border/50">
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
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
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
                {shown.rows.map((row) => (
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
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {shown.start}–{shown.end} of {rows.length}
                {rows.length < data.adoption.rows.length
                  ? ` matching customers (${data.adoption.rows.length} in total)`
                  : " customers"}
              </p>
              <TablePagination page={shown.page} pageCount={shown.pageCount} onPageChange={onPageChange} />
            </div>
          )}
        </CardContent>
      </Card>

      <PortalEmailsPanel />
    </div>
  );
}
