import { useState } from "react";
import { Link } from "react-router-dom";
import { isPast, parseISO } from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { BookingModal, type SessionCategory } from "@/components/booking/BookingModal";
import { CompactSessionCard } from "@/components/dashboard/UpcomingSessions";
import { useAuth } from "@/contexts/AuthContext";
import { useAcuityAppointments, useAcuityAppointmentTypes } from "@/hooks/useAcuity";
import { useTherapistImages } from "@/hooks/useTherapistImages";
import { useNextAvailable, formatNextAvailable } from "@/hooks/useNextAvailable";
import {
  PSYCHIATRY_CONSULTATION_TYPE_ID,
  PSYCHIATRY_FREE_CALL_URL,
  PSYCHIATRY_LATER_STAGES,
  isPsychiatryAppointment,
} from "@/lib/psychiatry";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  Baby,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  CloudRain,
  ExternalLink,
  FileText,
  HeartPulse,
  Info,
  LifeBuoy,
  Lock,
  MessageSquare,
  Moon,
  Phone,
  Pill,
  ShieldCheck,
  Stethoscope,
  Video,
  X,
  Zap,
} from "lucide-react";

const CONDITIONS = [
  { name: "Depression", desc: "Starting, switching or safely tapering antidepressants.", icon: CloudRain },
  { name: "Anxiety", desc: "Medication for generalised anxiety, panic and social anxiety.", icon: Activity },
  { name: "Bipolar disorder", desc: "Mood stabilisers with the monitoring they need, alongside your GP.", icon: HeartPulse },
  { name: "ADHD", desc: "Stimulant and non-stimulant medication, in shared care with your GP.", icon: Zap },
  { name: "Sleep", desc: "Persistent insomnia, looking at what's driving it first.", icon: Moon },
  { name: "Perinatal", desc: "Medication decisions around conception, pregnancy and breastfeeding.", icon: Baby },
];

const CHECKLIST = [
  "Your diagnosis report or assessment letter",
  "Photo ID",
  "Your GP's details",
  "A list of your current medications and doses",
  "A quiet, private space with stable internet",
  "Any questions you'd like to ask",
];

const GOOD_FIT = [
  "You're 18 or over and based in Ireland",
  "You have a diagnosis from a GP, psychologist or psychiatrist",
  "You want to start, review or change medication",
  "You'd like a second opinion on your current treatment",
];

const OTHER_CARE = [
  "You don't have a diagnosis yet — start with an assessment",
  "You're under 18 (psychiatry is for adults only)",
  "You're in crisis, or experiencing acute psychosis",
  "You need eating disorder monitoring or an alcohol/benzodiazepine detox",
];

const FAQS = [
  {
    q: "Do I need a GP referral?",
    a: "No, you can book directly. It still helps to share your GP's details, as some medication is best managed in shared care with your GP.",
  },
  {
    q: "What happens in the initial consultation?",
    a: "It's a one-hour video call. Your psychiatrist reviews your diagnosis report and history, talks through medication options with you and agrees a plan together. A prescription is issued where clinically appropriate.",
  },
  {
    q: "Can a psychiatrist prescribe online?",
    a: "Yes, where it's clinically appropriate. Prescriptions are sent to your pharmacy. Some controlled medications need extra checks and shared care with your GP.",
  },
  {
    q: "Will I get a diagnosis?",
    a: "Our psychiatrists work from a diagnosis you already have, and may confirm or refine it in their letter. If you don't have one, or it's unclear, an assessment is the right first step.",
  },
  {
    q: "Do you assess ADHD or autism?",
    a: "Not through psychiatry. ADHD and autism assessments run with our partner services — you'll find them under Book New Session → Assessments.",
  },
  {
    q: "How are follow-ups and repeat prescriptions arranged?",
    a: "Your psychiatrist arranges them with you after your consultation: a follow-up review about a month later, and repeat prescriptions roughly every three months once your medication is settled.",
  },
  {
    q: "Can I claim on insurance or tax relief?",
    a: "Many Irish insurers, including VHI, Laya and Irish Life, accept receipts, and you may be able to claim 20% tax relief through Revenue's Med 1 form. Check your own policy and eligibility.",
  },
  {
    q: "Can I get a letter for work or college?",
    a: "Yes, where clinically appropriate, and a fee may apply. Court and medico-legal reports are arranged separately.",
  },
];

const CRISIS_LINES = [
  { label: "Emergency: 112 or 999", detail: "If you or someone else is in danger", href: "tel:112", icon: Phone },
  { label: "Samaritans: 116 123", detail: "Free and confidential, 24/7", href: "tel:116123", icon: Phone },
  { label: "Text HELLO to 50808", detail: "Free crisis text line, 24/7", href: "sms:50808?body=HELLO", icon: MessageSquare },
];

interface BookingState {
  open: boolean;
  category: SessionCategory;
  typeId?: number;
  timeISO?: string;
}

function formatEuro(price: string): string {
  const value = parseFloat(price);
  if (Number.isNaN(value)) return "";
  return `€${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export default function Psychiatry() {
  const { user } = useAuth();
  const { types, loading: typesLoading } = useAcuityAppointmentTypes();
  const {
    appointments,
    loading: appointmentsLoading,
    error: appointmentsError,
    refetch,
  } = useAcuityAppointments(user?.email);
  const { images: therapistImages } = useTherapistImages();
  const { slot: nextSlot, loading: nextLoading } = useNextAvailable("psychiatry");
  const [booking, setBooking] = useState<BookingState>({
    open: false,
    category: "psychiatry",
  });

  // Live price/duration from Acuity (what the client is charged); fall back
  // to the website's published figures while loading.
  const consultationType = types.find((t) => t.id === PSYCHIATRY_CONSULTATION_TYPE_ID);
  const consultationPrice = consultationType ? formatEuro(consultationType.price) : "€450";
  const consultationDuration = consultationType?.duration ?? 60;
  const bookingUnavailable = !typesLoading && !consultationType;

  const psychiatryAppointments = appointments.filter(
    (apt) => !apt.canceled && isPsychiatryAppointment(apt)
  );
  const upcomingAppointments = psychiatryAppointments
    .filter((apt) => !isPast(parseISO(apt.datetime)))
    .sort((a, b) => parseISO(a.datetime).getTime() - parseISO(b.datetime).getTime());
  const hasPastAppointment = psychiatryAppointments.some((apt) =>
    isPast(parseISO(apt.datetime))
  );

  const openConsultation = (timeISO?: string) =>
    setBooking({
      open: true,
      category: "psychiatry",
      typeId: PSYCHIATRY_CONSULTATION_TYPE_ID,
      timeISO,
    });

  const openAssessments = () => setBooking({ open: true, category: "assessment" });

  const pathway = [
    {
      label: "Initial consultation",
      price: consultationPrice,
      note: `${consultationDuration} min video call: your diagnosis reviewed and a medication plan agreed.`,
    },
    ...PSYCHIATRY_LATER_STAGES,
  ];

  const facts = [
    { title: `${consultationPrice} · ${consultationDuration} min`, desc: "Initial video consultation", icon: Video },
    { title: "Registered psychiatrists", desc: "Medical Council of Ireland", icon: ShieldCheck },
    { title: "Often within 48 hours", desc: "Evening & weekend slots", icon: Clock },
  ];

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8 animate-fade-in">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Stethoscope className="h-6 w-6 text-primary" />
            </div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground">
              Psychiatry
            </h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            Online consultations with registered psychiatrists, for adults 18+ in Ireland.
          </p>
        </div>
        <Button
          onClick={() => openConsultation()}
          disabled={!consultationType}
          className="gap-2 shadow-soft shrink-0 w-full sm:w-auto"
        >
          <CalendarPlus className="h-4 w-4" />
          Book consultation
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        {/* Hero */}
        <Card
          className="lg:col-span-2 border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background animate-fade-in [overflow:clip] relative"
          style={{ animationDelay: "0.05s" }}
        >
          <div className="absolute top-0 right-0 w-24 h-24 sm:w-40 sm:h-40 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-16 h-16 sm:w-24 sm:h-24 bg-success/10 rounded-full translate-y-1/2 -translate-x-1/2" />

          <CardHeader className="pb-2 relative">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shrink-0">
                  <Pill className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="font-heading text-base sm:text-lg leading-tight">
                    Medication, reviewed and managed
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    For a condition you've already been diagnosed with
                  </p>
                </div>
              </div>
              <Badge className="bg-success text-success-foreground border-0 shadow-sm shrink-0 self-start sm:self-auto">
                <Check className="h-3 w-3 mr-1" />
                No GP referral needed
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 relative">
            <p className="text-sm text-muted-foreground">
              Your psychiatrist reviews your existing diagnosis, talks through medication
              options with you and agrees a plan — then follows up to make sure it's working.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {facts.map((fact) => (
                <div
                  key={fact.desc}
                  className="flex items-start gap-2.5 rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm p-3"
                >
                  <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                    <fact.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{fact.title}</p>
                    <p className="text-xs text-muted-foreground">{fact.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {nextSlot && consultationType ? (
              <button
                type="button"
                onClick={() => openConsultation(nextSlot.time)}
                className="w-full flex items-center gap-2 rounded-xl border border-primary/20 bg-background/80 px-4 py-3 text-left transition-colors hover:bg-primary/10"
              >
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium uppercase tracking-wide text-primary">
                    Earliest available
                  </span>
                  <span className="block text-sm font-medium text-card-foreground truncate">
                    {formatNextAvailable(nextSlot.time)}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-primary shrink-0" />
              </button>
            ) : nextLoading ? (
              <Skeleton className="h-[58px] w-full rounded-xl" />
            ) : null}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={() => openConsultation()}
                disabled={!consultationType}
                size="lg"
                className="flex-1 gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg"
              >
                <CalendarPlus className="h-4 w-4" />
                Book consultation · {consultationPrice}
              </Button>
              <Button asChild variant="outline" size="lg" className="flex-1 gap-2 bg-background/80">
                <a href={PSYCHIATRY_FREE_CALL_URL} target="_blank" rel="noopener noreferrer">
                  <Phone className="h-4 w-4" />
                  Free 20-min call first
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>

            {bookingUnavailable && (
              <p className="text-xs text-muted-foreground">
                Online booking is unavailable right now. Email{" "}
                <a href="mailto:hello@fettle.ie" className="text-primary hover:underline">
                  hello@fettle.ie
                </a>{" "}
                and we'll arrange your consultation.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Client's psychiatry appointments */}
        <Card className="border-border/50 animate-fade-in h-fit" style={{ animationDelay: "0.1s" }}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="font-heading text-lg">Your appointments</CardTitle>
              <Button variant="ghost" size="sm" asChild className="text-primary hover:text-primary/80 -mr-2">
                <Link to="/sessions" className="flex items-center gap-1">
                  All sessions
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {appointmentsLoading ? (
              <Skeleton className="h-20 w-full rounded-xl" />
            ) : appointmentsError ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Unable to load your appointments
              </p>
            ) : upcomingAppointments.length > 0 ? (
              <>
                {upcomingAppointments.map((appointment) => (
                  <CompactSessionCard
                    key={appointment.id}
                    appointment={appointment}
                    therapistImageUrl={therapistImages.get(appointment.calendarID)}
                  />
                ))}
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 flex items-start gap-2.5">
                  <FileText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Have your diagnosis report and a list of your current medications ready
                    for your call.
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <div className="p-3 rounded-full bg-muted/50 inline-block mb-3">
                  <Stethoscope className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="font-medium text-sm text-foreground mb-1">
                  No upcoming psychiatry appointments
                </p>
                <p className="text-xs text-muted-foreground">
                  {hasPastAppointment
                    ? "Your psychiatrist arranges follow-ups and repeat prescriptions. Email hello@fettle.ie if you're due one."
                    : "Book your initial consultation to get started."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pathway & pricing */}
      <Card className="border-border/50 animate-fade-in mb-6" style={{ animationDelay: "0.15s" }}>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Your psychiatry pathway</CardTitle>
          <p className="text-sm text-muted-foreground">
            Clear fees from the start. You book the initial consultation, and your psychiatrist
            arranges the rest with you.
          </p>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {pathway.map((stage, i) => (
              <li
                key={stage.label}
                className={cn(
                  "flex flex-col rounded-xl border p-4",
                  i === 0 ? "border-primary/30 bg-primary/5" : "border-border/50 bg-muted/30"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                      i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      "font-heading text-lg font-bold",
                      i === 0 ? "text-primary" : "text-foreground"
                    )}
                  >
                    {stage.price}
                  </span>
                </div>
                <p className="font-medium text-sm text-foreground">{stage.label}</p>
                <p className="text-xs text-muted-foreground mt-1 flex-1">{stage.note}</p>
                {i === 0 ? (
                  <Button
                    size="sm"
                    className="mt-3 w-full gap-1.5"
                    onClick={() => openConsultation()}
                    disabled={!consultationType}
                  >
                    Book now
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    Arranged by your psychiatrist
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground mt-4 flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Receipts can be submitted to VHI, Laya or Irish Life, and you may be able to claim 20%
            tax relief with Revenue's Med 1 form. Check your policy for eligibility.
          </p>
        </CardContent>
      </Card>

      {/* Conditions & preparation */}
      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2 border-border/50 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          <CardHeader>
            <CardTitle className="font-heading text-lg">What we can help with</CardTitle>
            <p className="text-sm text-muted-foreground">
              Starting, reviewing and managing medication for an existing diagnosis.
            </p>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            {CONDITIONS.map((condition) => (
              <div
                key={condition.name}
                className="flex items-start gap-3 p-3 rounded-xl border border-border/50"
              >
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <condition.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm text-foreground">{condition.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{condition.desc}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50 animate-fade-in h-fit" style={{ animationDelay: "0.25s" }}>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Before your consultation</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {CHECKLIST.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Suitability */}
      <Card className="border-border/50 animate-fade-in mb-6" style={{ animationDelay: "0.3s" }}>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Is online psychiatry right for you?</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl bg-success/5 border border-success/20 p-4">
            <p className="font-medium text-sm text-foreground mb-3">A good fit if</p>
            <ul className="space-y-2">
              {GOOD_FIT.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-warning/5 border border-warning/20 p-4">
            <p className="font-medium text-sm text-foreground mb-3">You'll need a different service if</p>
            <ul className="space-y-2">
              {OTHER_CARE.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <X className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 gap-1.5 bg-background/80 h-auto py-2 whitespace-normal text-left"
              onClick={openAssessments}
            >
              <ClipboardCheck className="h-4 w-4 shrink-0" />
              No diagnosis yet? Book an assessment
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* FAQs & crisis support */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border/50 animate-fade-in" style={{ animationDelay: "0.35s" }}>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Frequently asked questions</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {FAQS.map((faq, i) => (
                <AccordionItem key={faq.q} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left text-sm">{faq.q}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>

        <Card
          className="border-destructive/30 bg-destructive/5 animate-fade-in h-fit"
          style={{ animationDelay: "0.4s" }}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-destructive/10">
                <LifeBuoy className="h-4 w-4 text-destructive" />
              </div>
              <CardTitle className="font-heading text-lg">Need urgent help?</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Psychiatry at Fettle isn't an emergency service. If you're in immediate danger, call
              112 or 999 or go to your nearest emergency department.
            </p>
            <div className="space-y-2">
              {CRISIS_LINES.map((line) => (
                <a
                  key={line.label}
                  href={line.href}
                  className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/80 p-3 transition-colors hover:bg-background"
                >
                  <line.icon className="h-4 w-4 text-destructive shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{line.label}</span>
                    <span className="block text-xs text-muted-foreground">{line.detail}</span>
                  </span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <BookingModal
        open={booking.open}
        onOpenChange={(open) => setBooking((prev) => ({ ...prev, open }))}
        onBookingComplete={() => refetch()}
        sessionCategory={booking.category}
        preselectedType={booking.typeId}
        preselectedTimeISO={booking.timeISO}
      />
    </DashboardLayout>
  );
}
