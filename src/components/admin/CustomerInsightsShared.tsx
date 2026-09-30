import { useState } from "react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableHead } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import type { ApiError } from "@/lib/api-errors";
import type { CustomerInsightsResponse } from "@/hooks/useAdmin";
import type {
  Grade,
  GradeDefinition,
  PortalStatus,
} from "../../../supabase/functions/admin-customer-insights/logic.ts";

const GRADE_STYLES: Record<Grade, string> = {
  A: "bg-red-100 text-red-700 border-red-200",
  B: "bg-orange-100 text-orange-700 border-orange-200",
  C: "bg-amber-100 text-amber-700 border-amber-200",
  D: "bg-blue-100 text-blue-700 border-blue-200",
  E: "bg-muted text-muted-foreground border-border",
};

export function GradeBadge({ grade, reason }: { grade: Grade | null; reason: string | null }) {
  if (!grade) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help font-mono text-muted-foreground">
            ?
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Not graded — first session couldn't be verified</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`cursor-help font-mono font-bold ${GRADE_STYLES[grade]}`}>
          {grade}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function GradeLegend({ legend }: { legend: GradeDefinition[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Priority (A = follow up first):</span>
      {legend.map((item) => (
        <span key={item.grade} className="flex items-center gap-1.5">
          <Badge variant="outline" className={`px-1.5 py-0 font-mono font-bold ${GRADE_STYLES[item.grade]}`}>
            {item.grade}
          </Badge>
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function PortalStatusBadge({ status }: { status: PortalStatus }) {
  switch (status) {
    case "has_account":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          Has account
        </Badge>
      );
    case "no_account":
      return <Badge variant="outline">No account</Badge>;
    default:
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="cursor-help bg-amber-50 text-amber-700 border-amber-200">
              Can't match
            </Badge>
          </TooltipTrigger>
          <TooltipContent>No email on the Acuity booking, so it can't be matched to a portal account</TooltipContent>
        </Tooltip>
      );
  }
}

/** Contact details stacked in one cell; missing values are flagged. */
export function CustomerCell({
  name,
  email,
  phone,
}: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  const missing = <span className="text-amber-600">missing</span>;
  return (
    <div className="min-w-[180px] space-y-0.5">
      <p className="font-medium">{name ?? <span className="text-amber-600">Name missing</span>}</p>
      <p className="text-xs text-muted-foreground break-all">Email: {email ?? missing}</p>
      <p className="text-xs text-muted-foreground">Phone: {phone ?? missing}</p>
    </div>
  );
}

export type SortDirection = "asc" | "desc";

export function SortableHead<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: K;
  sort: { key: K; direction: SortDirection };
  onSort: (key: K) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <p className="text-2xl font-heading font-bold text-card-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function InsightsHeader({
  data,
  isFetching,
  onRefresh,
}: {
  data?: CustomerInsightsResponse;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {data
          ? `Live from Acuity · updated ${formatDistanceToNowStrict(parseISO(data.generatedAt))} ago`
          : "Live from Acuity"}
      </span>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
        <RefreshCw className={`h-3 w-3 mr-2 ${isFetching ? "animate-spin" : ""}`} />
        {isFetching ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}

export function InsightsLoading() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Fetching appointments and customer history from Acuity — this can take up to a minute.
      </p>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function InsightsError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Couldn't load customer data</AlertTitle>
      <AlertDescription className="mt-2">
        <p>{error.message}</p>
        {error.retryable && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RefreshCw className="h-3 w-3 mr-2" />
            Try Again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Warnings about data that couldn't be fully used; hidden when there are none. */
export function DataIssuesPanel({ data }: { data: CustomerInsightsResponse }) {
  const [open, setOpen] = useState(false);
  const issues = data.dataIssues;
  const items: string[] = [];

  if (issues.incompleteDates.length > 0) {
    items.push(
      `Acuity returned too many appointments to fetch completely on: ${issues.incompleteDates.join(", ")}. Figures for those days may be incomplete.`
    );
  }
  if (issues.unverifiedHistory > 0) {
    items.push(
      `${issues.unverifiedHistory} customer(s) in Progression couldn't be confirmed as first-time (marked "Unable to verify" and not graded).`
    );
  }
  if (issues.customersWithoutEmail > 0) {
    items.push(
      `${issues.customersWithoutEmail} active customer(s) have no email on their Acuity booking, so they can't be matched to a portal account.`
    );
  }
  if (issues.customersWithoutPhone > 0) {
    items.push(`${issues.customersWithoutPhone} active customer(s) have no phone number in Acuity.`);
  }
  if (issues.unknownTypes.length > 0) {
    items.push(
      `Unrecognised appointment types were ignored: ${issues.unknownTypes
        .map((t) => `${t.type} (${t.count})`)
        .join(", ")}.`
    );
  }

  if (items.length === 0) return null;

  return (
    <Alert className="border-amber-200 bg-amber-50/50">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-left"
          aria-expanded={open}
        >
          {items.length} data issue{items.length === 1 ? "" : "s"} to be aware of
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </AlertTitle>
      {open && (
        <AlertDescription>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </AlertDescription>
      )}
    </Alert>
  );
}
