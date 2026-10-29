import { Link } from "react-router-dom";
import { AlertCircle, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAnalyticsCustomers } from "@/hooks/useAdmin";
import {
  SEGMENT_LABELS,
  customerHref,
  customersCsv,
  customersQuery,
  describeFilters,
  formatFullDay,
  formatRange,
} from "@/lib/adminAnalytics";
import {
  type Basis,
  type CustomerSegment,
  type CalendarOption,
  type DateRange,
  type SessionFilters,
  dublinDate,
} from "../../../../supabase/functions/admin-analytics/logic.ts";

export interface CustomerListRequest {
  segment: CustomerSegment;
  range: DateRange;
  basis: Basis;
  filters: SessionFilters;
  /** To name the calendar filter. */
  calendars: CalendarOption[];
}

const day = (iso: string | null) => (iso ? formatFullDay(dublinDate(Date.parse(iso))) : "–");

function downloadCsv(filename: string, csv: string) {
  // BOM so Excel reads names with accents correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** The customers behind one number on the Customers board, with CSV export. */
export function CustomerListDialog({
  request,
  onClose,
}: {
  request: CustomerListRequest | null;
  onClose: () => void;
}) {
  const query = request ? customersQuery(request.segment, request.range, request.basis, request.filters) : null;
  const { data, error, isPending, refetch } = useAnalyticsCustomers(query);
  const customers = data?.customers ?? [];
  const filterLabel = request ? describeFilters(request.filters, request.calendars) : null;

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden flex flex-col">
        {request && (
          <>
            <DialogHeader>
              <DialogTitle>{SEGMENT_LABELS[request.segment]}</DialogTitle>
              <DialogDescription>
                {formatRange(request.range)} · by {request.basis === "session" ? "session date" : "booking date"}
                {filterLabel && ` · ${filterLabel}`}
                {data && ` · ${customers.length} customer${customers.length === 1 ? "" : "s"}`}
              </DialogDescription>
            </DialogHeader>

            {isPending ? (
              <div className="space-y-2" aria-label="Loading customers">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>Couldn't load the customers. {error.message}</span>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            ) : customers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No customers for this number.</p>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadCsv(
                        `fettle-${request.segment.replace("_", "-")}-${request.range.from}-to-${request.range.to}.csv`,
                        customersCsv(customers)
                      )
                    }
                  >
                    <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                    Export CSV
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Name</TableHead>
                        <TableHead scope="col">Email</TableHead>
                        <TableHead scope="col">First session</TableHead>
                        <TableHead scope="col">Session type</TableHead>
                        <TableHead scope="col">Booked by</TableHead>
                        <TableHead scope="col">Hub account</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((customer) => {
                        const href = customerHref(customer);
                        const name = customer.name ?? "No name";
                        return (
                          <TableRow key={customer.customerKey}>
                            <TableCell className="font-medium">
                              {href ? (
                                <Link to={href} className="text-primary underline-offset-2 hover:underline">
                                  {name}
                                </Link>
                              ) : (
                                name
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{customer.email ?? customer.phone ?? "–"}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{day(customer.firstSessionAt)}</TableCell>
                            <TableCell className="text-sm">{customer.sessionType ?? "–"}</TableCell>
                            <TableCell className="text-sm">
                              {customer.bookedBy ?? <span className="text-muted-foreground">Not checked yet</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {customer.portalAccount === null ? "–" : customer.portalAccount ? "Yes" : "No"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  Names link to the Progression page that lists the client, when they've had a session in the last 30
                  days.
                </p>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
