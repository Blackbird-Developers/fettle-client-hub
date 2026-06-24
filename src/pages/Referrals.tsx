import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
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
  ArrowRight,
} from "lucide-react";
import {
  REFERRAL_REWARD,
  DUMMY_REFERRALS,
  STATUS_META,
  buildReferralCode,
  buildReferralLink,
  type ReferralStatus,
} from "@/data/referrals";

const STATUS_BADGE: Record<ReferralStatus, string> = {
  booked: "bg-success/10 text-success border-success/20",
  joined: "bg-info/10 text-info border-info/20",
  pending: "bg-warning/10 text-warning border-warning/20",
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Referrals() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  // Seed from a stable id so the code is random-looking but never changes
  // for a given user (and reveals nothing about their name/email).
  const seed = profile?.id ?? profile?.user_id ?? profile?.email ?? null;
  const code = useMemo(() => buildReferralCode(seed), [seed]);
  const link = useMemo(() => buildReferralLink(code), [code]);

  // Derived dummy stats
  const friendsJoined = DUMMY_REFERRALS.filter(
    (r) => r.status === "booked" || r.status === "joined"
  ).length;
  const pending = DUMMY_REFERRALS.filter((r) => r.status === "pending").length;
  const totalEarned = DUMMY_REFERRALS.reduce(
    (sum, r) => sum + r.creditEarned,
    0
  );
  // Dummy: assume none spent yet, so available == earned.
  const availableBalance = totalEarned;

  const shareMessage = `I've been using Fettle for therapy and thought you might like it too 💛 Use my link to get €${REFERRAL_REWARD} off your first session: ${link}`;

  const copy = async (value: string, which: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      toast({
        title: which === "code" ? "Code copied" : "Link copied",
        description: "Share it with a friend to give them €20 off.",
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
    const subject = encodeURIComponent("€20 off your first Fettle session");
    const body = encodeURIComponent(shareMessage);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Fettle — €20 off your first session",
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
    {
      label: "Friends joined",
      value: friendsJoined,
      icon: Users,
      color: "text-info",
      bg: "bg-info/10",
    },
    {
      label: "Total earned",
      value: `€${totalEarned}`,
      icon: Coins,
      color: "text-success",
      bg: "bg-success/10",
    },
    {
      label: "Available credit",
      value: `€${availableBalance}`,
      icon: Wallet,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Pending invites",
      value: pending,
      icon: UserPlus,
      color: "text-warning",
      bg: "bg-warning/10",
    },
  ];

  const steps = [
    {
      icon: Share2,
      title: "Share your link",
      desc: "Send your unique code or link to friends and family.",
    },
    {
      icon: UserPlus,
      title: "They join & book",
      desc: `Your friend gets €${REFERRAL_REWARD} off their first therapy session.`,
    },
    {
      icon: CalendarCheck,
      title: "You both win",
      desc: `You earn €${REFERRAL_REWARD} credit once they book. No limit on referrals.`,
    },
  ];

  return (
    <DashboardLayout>
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

      {/* Hero / share card */}
      <Card
        className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background animate-fade-in overflow-hidden relative mb-6"
        style={{ animationDelay: "0.05s" }}
      >
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-success/10 rounded-full translate-y-1/2 -translate-x-1/2" />

        <CardHeader className="pb-2 relative">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shrink-0">
                <Gift className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <CardTitle className="font-heading text-lg break-words">
                  Give €{REFERRAL_REWARD}, get €{REFERRAL_REWARD}
                </CardTitle>
                <p className="text-xs text-muted-foreground break-words">
                  Spend your credit on any session or package
                </p>
              </div>
            </div>
            <Badge className="bg-success text-success-foreground border-0 shadow-sm shrink-0 self-start sm:self-auto">
              <Sparkles className="h-3 w-3 mr-1" />
              No limit
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 relative">
          {/* Code */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Your referral code
            </label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm px-4 py-3 font-heading text-lg font-bold tracking-wider text-foreground">
                {code}
              </div>
              <Button
                variant="outline"
                className="shrink-0 gap-2 bg-background/80"
                onClick={() => copy(code, "code")}
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
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Your referral link
            </label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={link}
                className="flex-1 bg-background/80 text-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                className="shrink-0 gap-2 bg-background/80"
                onClick={() => copy(link, "link")}
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
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Button
              onClick={shareWhatsApp}
              className="flex-1 gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg"
            >
              <MessageCircle className="h-4 w-4" />
              Share on WhatsApp
            </Button>
            <Button
              variant="outline"
              onClick={shareEmail}
              className="flex-1 gap-2 bg-background/80"
            >
              <Mail className="h-4 w-4" />
              Email
            </Button>
            <Button
              variant="outline"
              onClick={nativeShare}
              className="gap-2 bg-background/80 sm:w-auto"
            >
              <Share2 className="h-4 w-4" />
              <span className="sm:hidden">More ways to share</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
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
              <p className="text-xl sm:text-2xl font-bold text-foreground">
                {stat.value}
              </p>
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
                  €{availableBalance} credit
                </span>{" "}
                ready to use. It applies automatically at checkout for sessions
                and packages.
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
                {DUMMY_REFERRALS.length} total
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {DUMMY_REFERRALS.map((friend) => (
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
                    {friend.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {friend.maskedEmail}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge
                    variant="outline"
                    className={cn("text-xs", STATUS_BADGE[friend.status])}
                  >
                    {STATUS_META[friend.status].label}
                  </Badge>
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      friend.creditEarned > 0
                        ? "text-success"
                        : "text-muted-foreground"
                    )}
                  >
                    {friend.creditEarned > 0
                      ? `+€${friend.creditEarned}`
                      : "Pending"}
                  </span>
                </div>
              </div>
            ))}

            <Separator className="my-1" />
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-muted-foreground">
                Total credit earned
              </span>
              <span className="font-heading text-lg font-bold text-success">
                €{totalEarned}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
