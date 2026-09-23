import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, CalendarPlus, Check, CheckCircle2, Gift, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useActivePackages } from "@/hooks/useUserPackages";
import { useAcuityAppointmentTypes } from "@/hooks/useAcuity";
import { getPackageCategory } from "@/lib/packageCategory";
import { getSessionBundle } from "@/lib/sessionBundles";
import {
  FUNNEL_THERAPIES,
  clearBundleFunnelIntent,
  describeBundleFunnel,
  markBundleFunnelActive,
  readBundleFunnelIntent,
} from "@/lib/bundleFunnel";
import { PackageBookingModal } from "@/components/booking/PackageBookingModal";
import { BookingModal } from "@/components/booking/BookingModal";

type StepState = "done" | "current" | "locked";

function Step({
  number,
  title,
  state,
  children,
}: {
  number: number;
  title: string;
  state: StepState;
  children?: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "border-border/50 transition-colors",
        state === "current" && "border-primary/40 shadow-soft",
        state === "locked" && "opacity-70"
      )}
    >
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              state === "done" && "bg-success text-success-foreground",
              state === "current" && "bg-primary text-primary-foreground",
              state === "locked" && "bg-muted text-muted-foreground"
            )}
          >
            {state === "done" ? (
              <Check className="h-4 w-4" />
            ) : state === "locked" ? (
              <Lock className="h-4 w-4" />
            ) : (
              number
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading font-semibold text-foreground text-base sm:text-lg">
              {title}
            </h2>
            {children && <div className="mt-2">{children}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Onboarding for clients arriving from a fettle.ie bundle link: account →
 * bundle (pre-selected) → first session (therapy pre-selected). Payments and
 * booking reuse the existing PackageBookingModal and BookingModal.
 */
export default function GetStarted() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  // Snapshot, so clearing the stored intent at the end doesn't unmount the page.
  const [funnel] = useState(() => readBundleFunnelIntent());
  const { packages: activePackages, isLoading: packagesLoading } = useActivePackages();
  const { types, loading: typesLoading } = useAcuityAppointmentTypes();
  const [bundleModal, setBundleModal] = useState({ open: false, preselect: true });
  const [bookingOpen, setBookingOpen] = useState(false);
  const [firstSessionBooked, setFirstSessionBooked] = useState(false);

  useEffect(() => {
    markBundleFunnelActive();
  }, []);

  const category = funnel?.category ?? "individual";

  // Credits this client can spend on the funnel's session type. Mirrors the
  // booking modal: bundles linked from a code with an unknown product ID are
  // usable for any therapy session.
  const creditsAvailable = useMemo(
    () =>
      activePackages
        .filter((pkg) => {
          const pkgCategory = getPackageCategory(pkg.package_id);
          return pkgCategory ? pkgCategory === category : true;
        })
        .reduce((sum, pkg) => sum + pkg.remaining_sessions, 0),
    [activePackages, category]
  );

  if (!funnel) return <Navigate to="/dashboard" replace />;

  const bundle = getSessionBundle(funnel.packageId);
  const therapy = funnel.therapy ? FUNNEL_THERAPIES[funnel.therapy] : undefined;
  // Only pre-select a type Acuity currently offers.
  const therapyTypeId =
    funnel.appointmentTypeId && types.some((type) => type.id === funnel.appointmentTypeId)
      ? funnel.appointmentTypeId
      : undefined;
  const hasCredits = creditsAvailable > 0;
  const firstName = profile?.first_name?.trim();

  const bundleState: StepState = hasCredits || firstSessionBooked ? "done" : "current";
  const sessionState: StepState = firstSessionBooked
    ? "done"
    : hasCredits
    ? "current"
    : "locked";

  const finish = () => {
    clearBundleFunnelIntent();
    navigate("/dashboard");
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 sm:mb-8 animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground">
              {firstName ? `Welcome, ${firstName}` : "Welcome to Fettle"}
            </h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            Let's get your {describeBundleFunnel(funnel)} set up. It only takes a few minutes.
          </p>
        </div>

        {firstSessionBooked ? (
          <Card className="border-success/30 bg-success/5 animate-fade-in">
            <CardContent className="p-6 sm:p-8 text-center space-y-4">
              <div className="mx-auto h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div className="space-y-1">
                <h2 className="font-heading text-xl font-semibold text-foreground">
                  You're all set
                </h2>
                <p className="text-sm text-muted-foreground">
                  Your first session is booked and a confirmation email is on its way. You can
                  book the rest of your sessions from the hub whenever suits you.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                <Button asChild className="gap-2">
                  <Link to="/dashboard">
                    Go to my dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/sessions">View my sessions</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4 animate-fade-in" style={{ animationDelay: "0.05s" }}>
            <Step number={1} title="Your account" state="done">
              <p className="text-sm text-muted-foreground">Signed in as {user?.email}</p>
            </Step>

            <Step
              number={2}
              title={bundle ? `Your ${bundle.sessions}-session bundle` : "Choose your bundle"}
              state={bundleState}
            >
              {packagesLoading ? (
                <Skeleton className="h-20 w-full rounded-xl" />
              ) : hasCredits ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    You have{" "}
                    <span className="font-semibold text-foreground">
                      {creditsAvailable} session credit{creditsAvailable === 1 ? "" : "s"}
                    </span>{" "}
                    ready to use.
                  </p>
                  {bundle && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => setBundleModal({ open: true, preselect: true })}
                    >
                      Buy the {bundle.sessions}-session bundle as well
                    </Button>
                  )}
                </div>
              ) : bundle ? (
                <div className="space-y-4">
                  <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{bundle.sessions} Sessions</p>
                        <p className="text-sm text-muted-foreground">
                          {bundle.sessions} × {bundle.sessionDuration} minute sessions
                        </p>
                      </div>
                      <Badge className="bg-success/10 text-success border-success/20 shrink-0">
                        Save €{bundle.savings}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-primary">€{bundle.price}</span>
                      <span className="text-sm text-muted-foreground line-through">
                        €{bundle.sessions * bundle.individualPrice}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · €{Math.round(bundle.price / bundle.sessions)} per session
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      className="flex-1 gap-2 shadow-soft"
                      onClick={() => setBundleModal({ open: true, preselect: true })}
                    >
                      <Gift className="h-4 w-4" />
                      Continue to payment
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setBundleModal({ open: true, preselect: false })}
                    >
                      Choose a different bundle
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {category === "couples"
                      ? "Couples bundles come in 3 or 5 sessions. Pick the one that suits you."
                      : "Pick the bundle that suits you."}
                  </p>
                  <Button
                    className="gap-2 shadow-soft"
                    onClick={() => setBundleModal({ open: true, preselect: false })}
                  >
                    <Gift className="h-4 w-4" />
                    Choose your bundle
                  </Button>
                </div>
              )}
            </Step>

            <Step number={3} title="Book your first session" state={sessionState}>
              {sessionState === "locked" ? (
                <p className="text-sm text-muted-foreground">
                  Available as soon as your bundle is ready.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {category === "couples"
                      ? "Choose your therapist and a time that suits you both."
                      : therapy && therapyTypeId
                      ? `We've selected ${therapy.topic} for you. Choose your therapist and a time.`
                      : "Choose the focus of your session, your therapist and a time."}{" "}
                    Your bundle credit is applied automatically.
                  </p>
                  <Button
                    className="gap-2 shadow-soft"
                    disabled={typesLoading}
                    onClick={() => setBookingOpen(true)}
                  >
                    <CalendarPlus className="h-4 w-4" />
                    Book your first session
                  </Button>
                </div>
              )}
            </Step>

            <div className="text-center pt-2">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={finish}>
                Skip for now
              </Button>
            </div>
          </div>
        )}
      </div>

      <PackageBookingModal
        open={bundleModal.open}
        onOpenChange={(open) => setBundleModal((prev) => ({ ...prev, open }))}
        initialCategory={category}
        initialPackageId={bundleModal.preselect ? funnel.packageId : null}
      />

      <BookingModal
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        sessionCategory={category === "couples" ? "couples" : "individual"}
        preselectedType={category === "couples" ? undefined : therapyTypeId}
        onBookingComplete={() => {
          setFirstSessionBooked(true);
          clearBundleFunnelIntent();
        }}
      />
    </DashboardLayout>
  );
}
