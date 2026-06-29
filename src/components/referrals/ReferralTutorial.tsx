import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Gift,
  Link2,
  UserPlus,
  Coins,
  ArrowRight,
  X,
} from "lucide-react";
import { REFERRAL_REWARD } from "@/data/referrals";

const STORAGE_KEY = "fettle:referral-tutorial-seen";

const STEPS = [
  {
    icon: Gift,
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
    accentFrom: "from-primary/20",
    accentTo: "to-accent/10",
    badge: "Refer & Earn",
    title: `Give €${REFERRAL_REWARD}, get €${REFERRAL_REWARD}`,
    description:
      `Invite a friend to Fettle and you both earn €${REFERRAL_REWARD} credit toward any session or package — with no limit on how many times you can earn.`,
  },
  {
    icon: Link2,
    iconBg: "bg-info/10",
    iconColor: "text-info",
    accentFrom: "from-info/15",
    accentTo: "to-primary/5",
    badge: "Step 1",
    title: "Copy your link or code",
    description:
      "You have a unique referral code and link. Share either one — via WhatsApp, email, or however you like. Your friend just needs to sign up through your link.",
  },
  {
    icon: UserPlus,
    iconBg: "bg-warning/10",
    iconColor: "text-warning",
    accentFrom: "from-warning/15",
    accentTo: "to-accent/5",
    badge: "Step 2",
    title: "Your friend books a session",
    description:
      "Your friend signs up using your link and books their first paid session with Fettle. That's all they need to do — no extra steps.",
  },
  {
    icon: Coins,
    iconBg: "bg-success/10",
    iconColor: "text-success",
    accentFrom: "from-success/15",
    accentTo: "to-primary/5",
    badge: "Step 3",
    title: "You both earn credit",
    description:
      `Once their session is paid, €${REFERRAL_REWARD} credit lands in your account automatically — and in theirs too. Credit can be used at checkout on any session or package.`,
  },
];

export function ReferralTutorial() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== "true") {
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent
        className="max-w-sm sm:max-w-md p-0 gap-0 overflow-hidden border-border/60"
        hideCloseButton
      >
        {/* Gradient header area */}
        <div
          className={cn(
            "relative bg-gradient-to-br px-6 pt-8 pb-6 flex flex-col items-center text-center",
            current.accentFrom,
            current.accentTo
          )}
        >
          {/* Skip button */}
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors"
            aria-label="Skip tutorial"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Icon */}
          <div
            className={cn(
              "p-4 rounded-2xl mb-4 shadow-sm",
              current.iconBg
            )}
          >
            <current.icon className={cn("h-8 w-8", current.iconColor)} />
          </div>

          {/* Badge */}
          <span className="inline-flex items-center rounded-full border border-border/60 bg-background/70 backdrop-blur-sm px-3 py-0.5 text-xs font-semibold text-muted-foreground mb-3">
            {current.badge}
          </span>

          {/* Title */}
          <h2 className="font-heading text-xl sm:text-2xl font-bold text-foreground leading-tight">
            {current.title}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-6 space-y-6">
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            {current.description}
          </p>

          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={cn(
                  "rounded-full transition-all duration-300",
                  i === step
                    ? "w-5 h-2 bg-primary"
                    : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 text-muted-foreground"
              onClick={dismiss}
            >
              Skip
            </Button>
            <Button
              className="flex-1 gap-1.5 shadow-sm"
              onClick={next}
            >
              {isLast ? "Got it!" : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
