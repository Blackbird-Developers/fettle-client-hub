import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Gift,
  Copy,
  Check,
  Users,
  Wallet,
  Sparkles,
  Share2,
  Mail,
  MessageCircle,
  UserPlus,
  CalendarCheck,
  Coins,
  AlertCircle,
} from "lucide-react";
import { REFERRAL_REWARD } from "@/data/referrals";
import {
  useReferrals,
  formatEuros,
  type ReferralFriendStatus,
} from "@/hooks/useReferrals";
import { ReferralTutorial } from "@/components/referrals/ReferralTutorial";
import { ReferralTour } from "@/components/referrals/ReferralTour";

const STATUS_BADGE: Record<
  ReferralFriendStatus,
  { label: string; className: string }
> = {
  rewarded: { label: "Joined", className: "bg-success/10 text-success border-success/20" },
  pending: { label: "Invited", className: "bg-warning/10 text-warning border-warning/20" },
};

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Referrals() {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useReferrals();
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [tourActive, setTourActive] = useState(false);

  const code = data?.code ?? "";
  const link = useMemo(
    () => (code ? `${window.location.origin}/signup?ref=${code}` : ""),
    [code]
  );

  const balance = data?.balance_cents ?? 0;
  const friendsJoined = data?.friends_joined ?? 0;
  const pending = data?.pending ?? 0;
  const totalEarned = data?.total_earned_cents ?? 0;
  const friends = data?.friends ?? [];

  const shareMessage = `I've been using Fettle for therapy and thought you might like it too 💛 Use my link to get €${REFERRAL_REWARD} off your first session: ${link}`;

  const copy = async (value: string, which: "code" | "link") => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      toast({
        title: which === "code" ? "Code copied" : "Link copied",
        description: `Share it with a friend to give them €${REFERRAL_REWARD} off.`,
      });
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Please copy it manually.",
        variant: "destructive",
      });
    }
  };

  const shareWhatsApp = () =>
    window.open(
      `https://wa.me/?text=${encodeURIComponent(shareMessage)}`,
      "_blank",
      "noopener,noreferrer"
    );

  const shareEmail = () => {
    const subject = encodeURIComponent(
      `€${REFERRAL_REWARD} off your first Fettle session`
    );
    const body = encodeURIComponent(shareMessage);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const nativeShare = async () => {
    if (navigator.share && link) {
      try {
        await navigator.share({
          title: `Fettle — €${REFERRAL_REWARD} off your first session`,
          text: shareMessage,
          url: link,
        });
      } catch {
        /* user dismissed — no-op */
      }
    } else {
      copy(link, "link");
    }
  };

  const stats = [
    { label: "Friends joined", value: friendsJoined, icon: Users, color: "text-info", bg: "bg-info/10" },
    { label: "Total earned", value: formatEuros(totalEarned), icon: Coins, color: "text-success", bg: "bg-success/10" },
    { label: "Available credit", value: formatEuros(balance), icon: Wallet, color: "text-primary", bg: "bg-primary/10" },
    { label: "Pending invites", value: pending, icon: UserPlus, color: "text-warning", bg: "bg-warning/10" },
  ];

  const steps = [
    { icon: Share2, title: "Share your link", desc: "Send your unique code or link to friends and family." },
    { icon: UserPlus, title: "They book & pay", desc: "Your friend signs up and pays for their first session." },
    { icon: CalendarCheck, title: "You both earn €" + REFERRAL_REWARD, desc: `Once they pay, you each get €${REFERRAL_REWARD} credit for any session or package. No limit.` },
  ];

  const validityDays = data?.validity_days ?? 45;

  return (
    <DashboardLayout>
      <ReferralTutorial onStartTour={() => setTourActive(true)} />
      {tourActive && <ReferralTour onClose={() => setTourActive(false)} />}
      {/* Header */}
      <div className="mb-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Gift className="h-6 w-6 text-primary" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Refer &amp; Earn
          </h1>
        </div>
        <p className="text-muted-foreground">
          Give €{REFERRAL_REWARD}, get €{REFERRAL_REWARD} — there's no limit on
          how much you can earn.
        </p>
      </div>

      {isError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">
              We couldn't load your referrals. Please try again.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Hero / share card */}
          <Card
            className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background animate-fade-in [overflow:clip] relative mb-6"
            style={{ animationDelay: "0.05s" }}
          >
            <div className="absolute top-0 right-0 w-24 h-24 sm:w-40 sm:h-40 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-16 h-16 sm:w-24 sm:h-24 bg-success/10 rounded-full translate-y-1/2 -translate-x-1/2" />

            <CardHeader className="pb-2 relative">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shrink-0">
                    <Gift className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="font-heading text-base sm:text-lg leading-tight">
                      Give €{REFERRAL_REWARD}, get €{REFERRAL_REWARD}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Spend your credit on any session or package
                    </p>
                  </div>
                </div>
                <Badge className="bg-success text-success-foreground border-0 shadow-sm shrink-0">
                  <Sparkles className="h-3 w-3 mr-1" />
                  No limit
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 relative">
              {/* Code */}
              <div className="space-y-1.5" data-tour="referral-code">
                <label className="text-xs font-medium text-muted-foreground">
                  Your referral code
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm px-4 py-3 font-heading text-lg font-bold tracking-wider text-foreground min-h-[52px]">
                    {isLoading ? (
                      <Skeleton className="h-6 w-32" />
                    ) : (
                      code
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0 gap-2 bg-background/80"
                    onClick={() => copy(code, "code")}
                    disabled={isLoading || !code}
                  >
                    {copied === "code" ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">
                      {copied === "code" ? "Copied" : "Copy"}
                    </span>
                  </Button>
                </div>
              </div>

              {/* Link */}
              <div className="space-y-1.5" data-tour="referral-link">
                <label className="text-xs font-medium text-muted-foreground">
                  Your referral link
                </label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={isLoading ? "Loading…" : link}
                    className="flex-1 bg-background/80 text-sm"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="outline"
                    className="shrink-0 gap-2 bg-background/80"
                    onClick={() => copy(link, "link")}
                    disabled={isLoading || !link}
                  >
                    {copied === "link" ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">
                      {copied === "link" ? "Copied" : "Copy"}
                    </span>
                  </Button>
                </div>
              </div>

              {/* Share buttons */}
              <div className="space-y-2 pt-1" data-tour="share-buttons">
                <Button
                  onClick={shareWhatsApp}
                  disabled={isLoading || !link}
                  className="w-full gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg"
                >
                  <MessageCircle className="h-4 w-4" />
                  Share on WhatsApp
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={shareEmail}
                    disabled={isLoading || !link}
                    className="gap-2 bg-background/80"
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </Button>
                  <Button
                    variant="outline"
                    onClick={nativeShare}
                    disabled={isLoading || !link}
                    className="gap-2 bg-background/80"
                  >
                    <Share2 className="h-4 w-4" />
                    More options
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6" data-tour="stats">
            {stats.map((stat, i) => (
              <Card
                key={stat.label}
                className="border-border/50 hover:shadow-soft transition-all animate-fade-in"
                style={{ animationDelay: `${0.1 + i * 0.05}s` }}
              >
                <CardContent className="p-4 sm:p-5">
                  <div className={cn("inline-flex p-2 rounded-lg mb-3", stat.bg)}>
                    <stat.icon className={cn("h-4 w-4 sm:h-5 sm:w-5", stat.color)} />
                  </div>
                  {isLoading ? (
                    <Skeleton className="h-7 w-16 mb-1" />
                  ) : (
                    <p className="text-xl sm:text-2xl font-bold text-foreground">
                      {stat.value}
                    </p>
                  )}
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    {stat.label}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* How it works */}
            <Card
              className="border-border/50 animate-fade-in lg:col-span-1 h-fit"
              style={{ animationDelay: "0.3s" }}
            >
              <CardHeader>
                <CardTitle className="font-heading text-lg">How it works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {steps.map((step, i) => (
                  <div key={step.title} className="flex gap-3">
                    <div className="relative flex flex-col items-center">
                      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                        <step.icon className="h-4 w-4 text-primary" />
                      </div>
                      {i < steps.length - 1 && (
                        <div className="w-px flex-1 bg-border my-1" />
                      )}
                    </div>
                    <div className="pb-1">
                      <p className="font-medium text-sm text-foreground">
                        {step.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {step.desc}
                      </p>
                    </div>
                  </div>
                ))}
                <Separator />
                <div className="rounded-xl bg-success/5 border border-success/20 p-3 flex items-start gap-2.5">
                  <Wallet className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    You have{" "}
                    <span className="font-semibold text-foreground">
                      {formatEuros(balance)} credit
                    </span>{" "}
                    ready to use at checkout for sessions and packages. Credits
                    expire {validityDays} days after you earn them.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Your referrals */}
            <Card
              className="border-border/50 animate-fade-in lg:col-span-2 h-fit"
              style={{ animationDelay: "0.35s" }}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="font-heading text-lg">
                    Your referrals
                  </CardTitle>
                  <Badge variant="secondary" className="font-medium">
                    {friends.length} total
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 p-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-5 w-16" />
                    </div>
                  ))
                ) : friends.length === 0 ? (
                  <div className="text-center py-10">
                    <div className="p-3 rounded-full bg-muted/50 inline-block mb-3">
                      <UserPlus className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <p className="font-medium text-foreground mb-1">
                      No referrals yet
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Share your link above to start earning €{REFERRAL_REWARD}{" "}
                      for every friend who joins.
                    </p>
                  </div>
                ) : (
                  <>
                    {friends.map((friend) => {
                      const meta = STATUS_BADGE[friend.status];
                      return (
                        <div
                          key={friend.id}
                          className="flex items-center gap-3 p-3 rounded-xl border border-border/50 hover:bg-muted/40 transition-colors"
                        >
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-sm font-semibold text-primary">
                              {initials(friend.name)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground truncate">
                              {friend.name || "New friend"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {friend.masked_email || "—"}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <Badge
                              variant="outline"
                              className={cn("text-xs", meta.className)}
                            >
                              {meta.label}
                            </Badge>
                            <span
                              className={cn(
                                "text-xs font-semibold",
                                friend.credit_cents > 0
                                  ? "text-success"
                                  : "text-muted-foreground"
                              )}
                            >
                              {friend.credit_cents > 0
                                ? `+${formatEuros(friend.credit_cents)}`
                                : "Pending"}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    <Separator className="my-1" />
                    <div className="flex items-center justify-between px-1">
                      <span className="text-sm text-muted-foreground">
                        Total credit earned
                      </span>
                      <span className="font-heading text-lg font-bold text-success">
                        {formatEuros(totalEarned)}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
