import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Mail } from "lucide-react";
import { usePortalEmailSends } from "@/hooks/useAdmin";
import { isMissingTableError } from "@/lib/customerFollowups";
import { formatDateTime } from "@/lib/customerInsights";
import {
  CAMPAIGN_LABELS,
  CAMPAIGN_ORDER,
  type SendStage,
  STAGE_LABELS,
  percentOf,
  recentSends,
  sendStage,
  summarizeSends,
} from "@/lib/portalEmails";

const RECENT_LIMIT = 20;

const STAGE_VARIANT: Record<SendStage, "default" | "secondary" | "outline" | "destructive"> = {
  signed_up: "default",
  clicked: "secondary",
  opened: "secondary",
  delivered: "outline",
  sent: "outline",
  bounced: "destructive",
  complained: "destructive",
};

// The two account set-up emails sent by the portal-adoption-emails function:
// a funnel per email (sent → delivered → opened → clicked → signed up) and
// the latest sends.
export function PortalEmailsPanel() {
  const { data, error, isLoading } = usePortalEmailSends();

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-heading">Account set-up emails</CardTitle>
        <CardDescription>
          Sent automatically on weekday mornings to customers without a portal account. Each email
          goes to a person once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading emails…</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            {isMissingTableError(error)
              ? "Not set up yet: the database update for these emails hasn't been applied."
              : "Couldn't load the email results. Try refreshing the page."}
          </p>
        ) : (
          <EmailResults sends={data!.sends} unsubscribed={data!.unsubscribed} />
        )}
      </CardContent>
    </Card>
  );
}

function EmailResults({
  sends,
  unsubscribed,
}: {
  sends: Parameters<typeof summarizeSends>[0];
  unsubscribed: number;
}) {
  const summary = summarizeSends(sends);
  const recent = recentSends(sends, RECENT_LIMIT);
  const totalSent = CAMPAIGN_ORDER.reduce((sum, campaign) => sum + summary[campaign].sent, 0);

  if (totalSent === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
        <Mail className="h-8 w-8" />
        <p className="text-sm">
          No emails sent yet. Sending stays in test mode until it's switched on.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Delivered</TableHead>
            <TableHead className="text-right">Opened</TableHead>
            <TableHead className="text-right">Clicked</TableHead>
            <TableHead className="text-right">Signed up</TableHead>
            <TableHead className="text-right">Bounced / spam</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CAMPAIGN_ORDER.map((campaign) => {
            const s = summary[campaign];
            return (
              <TableRow key={campaign}>
                <TableCell>
                  <p className="font-medium">{CAMPAIGN_LABELS[campaign].title}</p>
                  <p className="text-xs text-muted-foreground">{CAMPAIGN_LABELS[campaign].audience}</p>
                </TableCell>
                <TableCell className="text-right">{s.sent}</TableCell>
                <Metric value={s.delivered} of={s.sent} />
                <Metric value={s.opened} of={s.delivered} />
                <Metric value={s.clicked} of={s.delivered} />
                <Metric value={s.signedUp} of={s.sent} />
                <TableCell className="text-right">
                  {s.bounced} / {s.complained}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Opened and clicked are shares of delivered emails; signed up is a share of sent ones.
        Opens are approximate (some mail apps open every email automatically), so judge the emails
        on clicks and sign-ups. {unsubscribed} {unsubscribed === 1 ? "person has" : "people have"}{" "}
        unsubscribed.
      </p>

      <div>
        <h3 className="mb-2 text-sm font-medium">Latest sends</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((row) => {
              const stage = sendStage(row);
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <p>{row.customer_name ?? row.email}</p>
                    {row.customer_name && (
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    )}
                  </TableCell>
                  <TableCell>{row.campaign === "existing_clients" ? "Email 1" : "Email 2"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(row.sent_at!)}</TableCell>
                  <TableCell>
                    <Badge variant={STAGE_VARIANT[stage]}>{STAGE_LABELS[stage]}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function Metric({ value, of }: { value: number; of: number }) {
  return (
    <TableCell className="text-right whitespace-nowrap">
      {value} <span className="text-xs text-muted-foreground">{percentOf(value, of)}</span>
    </TableCell>
  );
}
