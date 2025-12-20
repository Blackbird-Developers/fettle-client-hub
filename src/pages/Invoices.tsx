import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Eye, FileText } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: string;
  status: "paid" | "pending" | "overdue";
  description: string;
}

const invoices: Invoice[] = [
  {
    id: "1",
    number: "INV-2024-042",
    date: "Dec 15, 2025",
    amount: "€85.00",
    status: "paid",
    description: "Individual Therapy - Dr. Emma O'Brien",
  },
  {
    id: "2",
    number: "INV-2024-041",
    date: "Dec 8, 2025",
    amount: "€85.00",
    status: "paid",
    description: "Individual Therapy - Dr. Emma O'Brien",
  },
  {
    id: "3",
    number: "INV-2024-040",
    date: "Dec 1, 2025",
    amount: "€120.00",
    status: "pending",
    description: "Couples Therapy - Dr. Liam Walsh",
  },
  {
    id: "4",
    number: "INV-2024-039",
    date: "Nov 24, 2025",
    amount: "€85.00",
    status: "paid",
    description: "Individual Therapy - Dr. Emma O'Brien",
  },
];

const statusColors = {
  paid: "bg-success/10 text-success border-success/20",
  pending: "bg-warning/10 text-warning border-warning/20",
  overdue: "bg-destructive/10 text-destructive border-destructive/20",
};

export default function Invoices() {
  const totalPaid = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + parseFloat(inv.amount.replace("€", "")), 0);

  const totalPending = invoices
    .filter((inv) => inv.status === "pending" || inv.status === "overdue")
    .reduce((sum, inv) => sum + parseFloat(inv.amount.replace("€", "")), 0);

  return (
    <DashboardLayout>
      <div className="mb-8 animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Invoices
        </h1>
        <p className="text-muted-foreground mt-1">
          View and download your therapy invoices
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-success/10">
                <FileText className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-card-foreground">
                  €{totalPaid.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">Total Paid</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-warning/10">
                <FileText className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-card-foreground">
                  €{totalPending.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 sm:col-span-2 lg:col-span-1">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-card-foreground">
                  {invoices.length}
                </p>
                <p className="text-xs text-muted-foreground">Total Invoices</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices Table */}
      <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.number}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {invoice.date}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {invoice.description}
                  </TableCell>
                  <TableCell className="font-medium">{invoice.amount}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColors[invoice.status]}>
                      {invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
