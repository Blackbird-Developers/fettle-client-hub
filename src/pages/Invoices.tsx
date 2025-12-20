import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  FileText, 
  Receipt, 
  ExternalLink, 
  Calendar,
  Euro,
  Loader2,
  RefreshCw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  description: string;
  therapist: string | null;
  datetime: string | null;
  receiptUrl: string | null;
}

export default function Invoices() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const fetchPayments = async (showRefreshState = false) => {
    if (showRefreshState) setRefreshing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('get-payment-history');
      
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      setPayments(data.payments || []);
    } catch (err) {
      console.error('Failed to fetch payments:', err);
      toast({
        title: 'Failed to load payments',
        description: err instanceof Error ? err.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <DashboardLayout>
      <div className="mb-8 animate-fade-in flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Payments & Receipts
          </h1>
          <p className="text-muted-foreground mt-1">
            View your payment history and download receipts
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => fetchPayments(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2 hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : payments.length > 0 ? (
        <div className="space-y-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {payments.map((payment) => (
            <Card key={payment.id} className="border-border/50 hover:border-border transition-colors">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-success/10 shrink-0">
                      <Receipt className="h-5 w-5 text-success" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-semibold text-foreground">
                        {payment.description}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(payment.created * 1000), 'MMM d, yyyy')}
                        </span>
                        {payment.therapist && (
                          <>
                            <span>•</span>
                            <span>{payment.therapist}</span>
                          </>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-xs bg-success/10 text-success border-0">
                        Paid
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 sm:gap-6">
                    <div className="text-right">
                      <p className="text-lg font-bold text-foreground">
                        {formatAmount(payment.amount, payment.currency)}
                      </p>
                    </div>
                    {payment.receiptUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="shrink-0"
                      >
                        <a 
                          href={payment.receiptUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Receipt
                          <ExternalLink className="h-3 w-3 ml-1.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted/50 mb-4">
              <Euro className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="font-heading text-lg font-semibold text-foreground mb-2">
              No payments yet
            </h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Your payment history will appear here after you book your first session.
            </p>
            <p className="text-muted-foreground text-center text-sm">
              Need help? Contact{" "}
              <a 
                href="mailto:operations@fettle.ie" 
                className="text-primary hover:underline font-medium"
              >
                operations@fettle.ie
              </a>
            </p>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
}
