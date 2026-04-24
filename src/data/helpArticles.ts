import {
  Compass,
  HeartHandshake,
  Users,
  CalendarCheck,
  CalendarClock,
  Video,
  Package,
  Tag,
  Gift,
  UserPlus,
  Heart,
  Receipt,
  Award,
  CreditCard,
  ShieldCheck,
  Shield,
  KeyRound,
  LineChart,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export type HelpCategory =
  | "getting-started"
  | "booking"
  | "packages"
  | "youth-couples"
  | "billing"
  | "privacy"
  | "progress";

export const CATEGORY_LABELS: Record<HelpCategory, string> = {
  "getting-started": "Getting Started",
  booking: "Booking & Sessions",
  packages: "Packages",
  "youth-couples": "Youth & Couples",
  billing: "Billing & Receipts",
  privacy: "Privacy & Account",
  progress: "Progress & Milestones",
};

export const CATEGORY_ORDER: HelpCategory[] = [
  "getting-started",
  "booking",
  "packages",
  "youth-couples",
  "billing",
  "privacy",
  "progress",
];

export interface ArticleSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
  note?: string;
}

export interface ArticleCta {
  label: string;
  href: string;
  external?: boolean;
}

export interface HelpArticle {
  slug: string;
  title: string;
  category: HelpCategory;
  icon: LucideIcon;
  summary: string;
  intro: string;
  sections: ArticleSection[];
  primaryCta: {
    loggedIn: ArticleCta;
    loggedOut: ArticleCta;
  };
  relatedSlugs: string[];
}

export const helpArticles: HelpArticle[] = [
  // ---------- Getting Started ----------
  {
    slug: "getting-started-with-fettle",
    title: "Getting started with Fettle",
    category: "getting-started",
    icon: Compass,
    summary:
      "What Fettle is, what signing up gives you, and how to take your first step.",
    intro:
      "Fettle is an Irish therapy service that connects you with accredited therapists for online and in-person sessions. Whether you're trying therapy for the first time or returning after a break, here's what to expect when you sign up.",
    sections: [
      {
        heading: "What is Fettle?",
        paragraphs: [
          "Fettle is a mental healthcare platform offering therapy to individuals across Ireland. We work with a curated team of qualified, accredited therapists who support a wide range of concerns — anxiety, low mood, relationships, burnout, and more. You can book privately, or through your employer if your company partners with us.",
        ],
      },
      {
        heading: "What signing up gives you",
        paragraphs: [
          "Creating an account takes about a minute and gives you:",
        ],
        items: [
          "A personal dashboard to book, reschedule, and join sessions",
          "Access to every therapist in our network — with profiles, specialties, and live availability",
          "Progress tracking, reminders, and receipts kept in one place",
          "The option to buy session packages at a discount",
        ],
        note: "Signing up is free. You only pay when you book.",
      },
      {
        heading: "What happens after you sign up",
        items: [
          "You'll land on your dashboard. Take a minute to browse our therapists — each profile shows their accreditation and specialties.",
          "When you're ready, click **Book Session**. We'll walk you through picking a therapy type, a therapist, and a time that works.",
          "You'll get a confirmation email with everything you need to join your session.",
        ],
      },
      {
        heading: "Is Fettle private?",
        paragraphs: [
          "Yes. If you sign up as an individual, your sessions stay between you and your therapist — Fettle never sees the content. If you access Fettle through your employer, only anonymous, aggregated data is shared — never anything that could identify you.",
        ],
      },
      {
        heading: "A gentle note",
        paragraphs: [
          "Booking your first session can feel like a big step, and it's fine to take your time. Most clients tell us the hardest part was deciding to start.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Dashboard", href: "/dashboard" },
      loggedOut: { label: "Create Your Free Account", href: "/signup" },
    },
    relatedSlugs: [
      "choosing-the-right-therapy-type",
      "finding-and-picking-a-therapist",
      "how-to-book-a-session",
    ],
  },
  {
    slug: "choosing-the-right-therapy-type",
    title: "Choosing the right therapy type",
    category: "getting-started",
    icon: HeartHandshake,
    summary:
      "Fettle offers four kinds of sessions. Here's how to know which fits you.",
    intro:
      "When you book with Fettle, you'll be asked to pick a session type. The right choice depends on who the therapy is for and what you want to work on. Here's a quick guide.",
    sections: [
      {
        heading: "Individual Therapy — €85 per 50-minute session",
        paragraphs: [
          "One-on-one sessions for adults (18+). This is the most common starting point. You'll talk with a qualified therapist about whatever is on your mind — anxiety, stress, relationships, work, past experiences, big life changes. No topic is off the table, and your therapist will work at your pace.",
        ],
        note: "**Best if:** You want support for yourself and flexibility in what you talk about.",
      },
      {
        heading: "Couples Therapy",
        paragraphs: [
          "For two people in a relationship who want to work on it together — romantic partners, long-term couples, or spouses. You'll both attend the session. We'll ask for your partner's name and pronouns at booking.",
        ],
        note: "**Best if:** You and your partner want a neutral space to talk through challenges together.",
      },
      {
        heading: "Youth Therapy",
        paragraphs: [
          "For young people under 18. Because the client is a minor, a parent or guardian needs to complete our youth consent form before the first session.",
        ],
        note: "**Best if:** You're a parent booking for your child, or a young person whose parent has given consent.",
      },
      {
        heading: "Check-in Sessions",
        paragraphs: [
          "Shorter, lighter follow-ups for clients who are already working with a Fettle therapist and want a quick touch-point between regular sessions.",
        ],
        note: "**Best if:** You've had at least one session and want a brief check-in rather than a full 50-minute session.",
      },
      {
        heading: "Not sure which fits?",
        paragraphs: [
          "Start with an Individual Session. Your therapist will help you figure out what's useful, and you can adjust direction in later sessions.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Book a Session", href: "/sessions" },
      loggedOut: { label: "Log in to Book", href: "/sessions" },
    },
    relatedSlugs: [
      "getting-started-with-fettle",
      "finding-and-picking-a-therapist",
      "youth-therapy-consent",
    ],
  },
  {
    slug: "finding-and-picking-a-therapist",
    title: "Finding and picking a therapist",
    category: "getting-started",
    icon: Users,
    summary:
      "Every therapist on Fettle is accredited and experienced. Here's how to find the one who's right for you.",
    intro:
      "Fettle works with a curated team of licensed therapists across Ireland. You're free to choose any of them when you book. This guide explains how to read therapist profiles, what the accreditations mean, and how to pick someone who fits what you need.",
    sections: [
      {
        heading: "How therapist matching works",
        paragraphs: [
          "When you book, you'll see every therapist who offers the session type you chose. Each profile shows their name, photo, accreditation, and a short list of specialties. You can click **View Profile** to read a fuller bio on fettle.ie.",
        ],
      },
      {
        heading: "Understanding accreditations",
        paragraphs: [
          "Every Fettle therapist is accredited or registered with an Irish professional body:",
        ],
        items: [
          "**IACP** — Irish Association for Counselling and Psychotherapy",
          "**IAHIP** — Irish Association of Humanistic and Integrative Psychotherapy",
          "**ICP** — Irish Council for Psychotherapy",
        ],
        note: '"Accredited," "Pre-Accredited," or "Registered" next to a name means they have met these bodies\' standards for training, supervision, and ethics.',
      },
      {
        heading: "What the specialty tags mean",
        paragraphs: ["Therapist profiles show tags like:"],
        items: [
          "**Approach** — CBT, DBT, EMDR, ACT (therapeutic methods, each suited to different things)",
          "**Focus areas** — Anxiety, Depression, Trauma, Relationships, ADHD, LGBTQ+, OCD, PTSD",
        ],
        note: "Pick someone whose tags line up with what you want to work on. Don't overthink it — most therapists work across many areas, and you can switch if the first match isn't right.",
      },
      {
        heading: "Booking with a therapist you've seen before",
        paragraphs: [
          "If you've had a session with a Fettle therapist before, they'll appear at the top of the list with a **Previous** badge and a star when you book again. Tap their card to rebook — it saves a step.",
        ],
      },
      {
        heading: "What if I want to try someone new?",
        paragraphs: [
          "You can choose any available therapist at any time. Switching is common and never held against you — what matters is finding the right fit.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Book a Session", href: "/sessions" },
      loggedOut: {
        label: "Browse Our Therapists",
        href: "https://fettle.ie/our-therapists",
        external: true,
      },
    },
    relatedSlugs: [
      "getting-started-with-fettle",
      "choosing-the-right-therapy-type",
      "how-to-book-a-session",
    ],
  },

  // ---------- Booking & Sessions ----------
  {
    slug: "how-to-book-a-session",
    title: "How to book a session",
    category: "booking",
    icon: CalendarCheck,
    summary:
      "A step-by-step walk-through of the booking flow, from picking a session type to confirmation.",
    intro:
      "Booking a session with Fettle takes about two minutes. Here's exactly what happens at each step, so there are no surprises.",
    sections: [
      {
        heading: "Step 1 — Choose your session type",
        paragraphs: [
          "Pick Individual, Couples, or Youth. If you're not sure, start with Individual — you can always explore other options later.",
        ],
      },
      {
        heading: "Step 2 — Pick your therapist",
        paragraphs: [
          "You'll see every therapist who offers that session type. Each card shows their accreditation, specialties, and a profile link. If you've seen someone at Fettle before, they'll appear at the top with a **Previous** badge so you can rebook in one tap.",
        ],
      },
      {
        heading: "Step 3 — Pick a date",
        paragraphs: [
          "The calendar greys out days that have no availability. You can look up to three months ahead.",
        ],
      },
      {
        heading: "Step 4 — Pick a time",
        paragraphs: [
          "Times are shown in your local timezone. Individual and Couples sessions are 50 minutes unless stated otherwise.",
        ],
      },
      {
        heading: "Step 5 — Your details",
        paragraphs: [
          "Enter your name, email, and (optionally) phone and notes. Notes go to your therapist — anything you'd like them to know before the session. You'll tick a few required confirmations (over 18, contact consent, terms). Couples sessions ask for your partner's name and pronouns.",
        ],
      },
      {
        heading: "Step 6 — Review and choose how to pay",
        paragraphs: [
          "Confirm the details. If you have package credits available, we'll offer to use one — no payment needed. Otherwise, enter a coupon code if you have one and continue to payment.",
        ],
      },
      {
        heading: "Step 7 — Pay and confirm",
        paragraphs: [
          "Pay by card via Stripe. Once the payment clears, you'll get a confirmation email with everything you need to join your session.",
        ],
        note: "You can close the booking window any time before payment — nothing is charged or booked until the final step.",
      },
    ],
    primaryCta: {
      loggedIn: { label: "Book a Session", href: "/sessions" },
      loggedOut: { label: "Log in to Book", href: "/sessions" },
    },
    relatedSlugs: [
      "choosing-the-right-therapy-type",
      "finding-and-picking-a-therapist",
      "rescheduling-and-cancellations",
    ],
  },
  {
    slug: "rescheduling-and-cancellations",
    title: "Rescheduling and cancellations",
    category: "booking",
    icon: CalendarClock,
    summary:
      "How to change or cancel a session, and how refunds work.",
    intro:
      "Life happens. Every Fettle session can be rescheduled or cancelled from the My Sessions page. Here's what to expect.",
    sections: [
      {
        heading: "How to reschedule",
        paragraphs: [
          "Go to **My Sessions**, find the upcoming session, and click **Reschedule**. This opens your therapist's scheduler where you can pick a new time. Your existing booking is updated — no extra charge.",
        ],
      },
      {
        heading: "How to cancel",
        paragraphs: [
          "On the session card, click **Cancel**. You'll be asked to confirm. Once cancelled, the session is marked as Cancelled and can't be restored.",
        ],
      },
      {
        heading: "Refunds",
        paragraphs: [
          "When you cancel a paid session, we issue a full refund to your original payment method. Refunds usually appear within 5–10 business days depending on your bank. If you booked using a package credit, the credit is returned to your package.",
        ],
      },
      {
        heading: "Cancelling at short notice",
        paragraphs: [
          "We try to be flexible. If you need to cancel close to your session, please still cancel through the app so your therapist knows — then email hello@fettle.ie if you run into any trouble with the refund.",
        ],
      },
      {
        heading: "If something goes wrong",
        paragraphs: [
          "If the Cancel or Reschedule buttons aren't responding, contact hello@fettle.ie and we'll handle it for you.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to My Sessions", href: "/sessions" },
      loggedOut: { label: "Log in to My Sessions", href: "/sessions" },
    },
    relatedSlugs: [
      "how-to-book-a-session",
      "joining-a-video-session",
      "tracking-package-credits",
    ],
  },
  {
    slug: "joining-a-video-session",
    title: "Joining a video session",
    category: "booking",
    icon: Video,
    summary:
      "How to join your session on time, and what to do if the video link isn't working.",
    intro:
      "Most Fettle sessions are delivered over video. Joining is quick, but a few tips will make sure you don't have to troubleshoot in the moment.",
    sections: [
      {
        heading: "How to join",
        paragraphs: [
          "On the day of your session, go to **My Sessions** and click **Join Session** on the upcoming appointment card. The video link opens in a new tab.",
        ],
      },
      {
        heading: "When the link is available",
        paragraphs: [
          "The Join link is ready as soon as your therapist has set it up — usually right after booking, sometimes closer to the session time. If it's not available yet, the button will let you know.",
        ],
      },
      {
        heading: "Be ready a few minutes early",
        paragraphs: [
          "Open the link 2–3 minutes before your scheduled time. Test your camera and mic with the platform's pre-call check if it offers one. Close other apps that might hog bandwidth.",
        ],
      },
      {
        heading: "If the video link won't open",
        items: [
          "Refresh the page and try again",
          "Try a different browser — Chrome and Safari tend to be most reliable",
          "Check that your browser has permission to use your camera and microphone",
          "If it still doesn't work, email hello@fettle.ie and your therapist will reach out",
        ],
      },
      {
        heading: "What you need",
        paragraphs: [
          "A stable internet connection, a quiet private space, and headphones if you can. Your therapist will have their camera on; you're welcome to keep yours off if that helps you feel more comfortable.",
        ],
        note: "Sessions stay private between you and your therapist. Fettle doesn't record, watch, or access session video.",
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to My Sessions", href: "/sessions" },
      loggedOut: { label: "Log in to My Sessions", href: "/sessions" },
    },
    relatedSlugs: [
      "how-to-book-a-session",
      "rescheduling-and-cancellations",
      "how-your-data-is-protected",
    ],
  },

  // ---------- Packages ----------
  {
    slug: "how-packages-work",
    title: "How packages work",
    category: "packages",
    icon: Package,
    summary:
      "Packages let you buy several sessions at once and save up to 19%.",
    intro:
      "If you plan to have more than one or two sessions, buying a package upfront is cheaper than paying per session. Here's exactly how they work.",
    sections: [
      {
        heading: "The three package sizes",
        paragraphs: ["Fettle offers three bundles:"],
        items: [
          "**3 sessions — €241.50** (€80.50 per session, save 6%)",
          "**6 sessions — €468** (€78 per session, save 13%)",
          "**9 sessions — €675** (€75 per session, save 19%)",
        ],
      },
      {
        heading: "How you pay",
        paragraphs: [
          "You pay for the full package upfront, once, via Stripe. Each session you book from the package comes out of your credit count — no payment needed at the time of booking.",
        ],
      },
      {
        heading: "Using your credits",
        paragraphs: [
          "When you book a session and have credits available, we automatically suggest using one. You can switch to paying per-session if you'd rather save the credit for later.",
        ],
      },
      {
        heading: "Do credits expire?",
        paragraphs: [
          "Yes. Packages have an expiration date shown on your Dashboard. If credits expire before you use them, they can't be refunded — so choose your package size based on how often you realistically plan to attend.",
        ],
      },
      {
        heading: "What counts toward a package credit",
        paragraphs: [
          "Individual Therapy sessions. Couples and Youth sessions are booked separately and priced individually.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "View Packages", href: "/packages" },
      loggedOut: { label: "View Packages", href: "/packages" },
    },
    relatedSlugs: [
      "package-vs-pay-per-session",
      "tracking-package-credits",
      "how-to-book-a-session",
    ],
  },
  {
    slug: "package-vs-pay-per-session",
    title: "When to buy a package vs. pay per session",
    category: "packages",
    icon: Tag,
    summary:
      "Packages save you money if you're planning 3+ sessions. Here's when to choose which.",
    intro:
      "Deciding between a package and single sessions comes down to one thing: how many sessions you realistically plan to have. Here's a quick way to think about it.",
    sections: [
      {
        heading: "If you're not sure yet — start with one session",
        paragraphs: [
          "First time with a therapist? Pay for a single session, see how it feels, and decide from there. There's no pressure to commit.",
        ],
      },
      {
        heading: "Planning weekly or fortnightly sessions — get a package",
        paragraphs: [
          "If you're going to attend consistently for a month or more, the 3-session package is cheaper than three singles. The 6 and 9 packages save you significantly more per session.",
        ],
      },
      {
        heading: "The quick math (per Individual Therapy session)",
        items: [
          "Pay-as-you-go: **€85** per session",
          "3-pack: **€80.50** per session (save €13.50 total)",
          "6-pack: **€78** per session (save €42 total)",
          "9-pack: **€75** per session (save €90 total)",
        ],
      },
      {
        heading: "When packages might not be right",
        paragraphs: [
          "If you prefer to book month-to-month based on how you're feeling, pay-as-you-go gives you total flexibility. Packages save money, but credits can expire — so don't buy more than you'll realistically use.",
        ],
      },
      {
        heading: "Still not sure?",
        paragraphs: [
          "Email hello@fettle.ie. We'll help you pick the right option for your situation.",
        ],
        note: "You can start with pay-per-session and upgrade to a package any time — all your previous sessions still count toward milestones and rewards.",
      },
    ],
    primaryCta: {
      loggedIn: { label: "View Packages", href: "/packages" },
      loggedOut: { label: "View Packages", href: "/packages" },
    },
    relatedSlugs: [
      "how-packages-work",
      "tracking-package-credits",
      "using-loyalty-coupons",
    ],
  },
  {
    slug: "tracking-package-credits",
    title: "Tracking and using package credits",
    category: "packages",
    icon: Gift,
    summary:
      "Your dashboard shows how many credits you have left. Here's how to use them and when they expire.",
    intro:
      "Once you've bought a package, using your credits is automatic — but it's worth knowing where to find them and what happens as they run down.",
    sections: [
      {
        heading: "Where to see your credits",
        paragraphs: [
          "Your Dashboard shows a package counter with the number of remaining credits and an expiration date.",
        ],
      },
      {
        heading: "Using a credit when you book",
        paragraphs: [
          "At the **Confirm** step of the booking flow, if you have credits available, we'll show a **Use Package Credit** option and select it automatically. You can switch to paying per-session if you'd rather save the credit for later.",
        ],
      },
      {
        heading: "When credits run low",
        paragraphs: [
          "If you're down to your last credit, you can still book normally — we'll prompt you to pay per-session (or buy a new package) for future bookings.",
        ],
      },
      {
        heading: "When credits expire",
        paragraphs: [
          "Each package has an expiration date. After that date, unused credits are no longer usable and can't be refunded. Your dashboard will show an alert in the weeks leading up to expiration.",
        ],
      },
      {
        heading: "If something looks wrong with your credit count",
        paragraphs: [
          "Sometimes the scheduler takes a few minutes to update after a booking. If the count still looks off after a refresh, email hello@fettle.ie.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "View My Packages", href: "/packages" },
      loggedOut: { label: "View Packages", href: "/packages" },
    },
    relatedSlugs: [
      "how-packages-work",
      "package-vs-pay-per-session",
      "how-to-book-a-session",
    ],
  },

  // ---------- Youth & Couples ----------
  {
    slug: "youth-therapy-consent",
    title: "Youth therapy consent requirements",
    category: "youth-couples",
    icon: UserPlus,
    summary:
      "What parents and guardians need to complete before booking youth therapy.",
    intro:
      "Therapy for anyone under 18 requires a few extra steps to make sure everyone is informed and consenting. Here's what to expect if you're booking on behalf of a young person.",
    sections: [
      {
        heading: "Who books, who attends",
        paragraphs: [
          "A parent or legal guardian books the session and provides consent. The young person attends the session themselves.",
        ],
      },
      {
        heading: "What the consent form covers",
        paragraphs: ["Our Youth Therapy Consent form confirms:"],
        items: [
          "You are the parent or legal guardian of the young person",
          "You consent to them attending therapy sessions",
          "You understand how your child's personal information is handled",
          "You've discussed therapy with your child where appropriate for their age",
        ],
      },
      {
        heading: "When you complete it",
        paragraphs: [
          "The consent form must be completed **before** the first session. During booking, you'll tick a box acknowledging that you've already completed it. If you haven't, pause the booking and email hello@fettle.ie — we'll send you the form.",
        ],
      },
      {
        heading: "Confidentiality with young people",
        paragraphs: [
          "Youth therapy sessions are private to the young person and their therapist. Our therapists may share broad themes or concerns with you when clinically appropriate, but not the specific content of what's discussed. Your therapist will explain this at the first appointment.",
        ],
      },
      {
        heading: "If you have questions",
        paragraphs: [
          "We're happy to talk you through anything before you book. Email hello@fettle.ie and we'll arrange a call.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Contact Us", href: "mailto:hello@fettle.ie", external: true },
      loggedOut: { label: "Contact Us", href: "mailto:hello@fettle.ie", external: true },
    },
    relatedSlugs: [
      "choosing-the-right-therapy-type",
      "how-to-book-a-session",
      "how-your-data-is-protected",
    ],
  },
  {
    slug: "couples-first-session",
    title: "What to expect in your first couples session",
    category: "youth-couples",
    icon: Heart,
    summary:
      "A gentle guide to what happens in a first couples therapy session at Fettle.",
    intro:
      "Booking couples therapy can feel like a bigger step than individual therapy. Here's what typically happens in the first session, so you and your partner know what to expect.",
    sections: [
      {
        heading: "Who attends",
        paragraphs: [
          "Both of you, together, in the same session. Couples sessions are 50 minutes and delivered over video or in person.",
        ],
      },
      {
        heading: "What your therapist will ask",
        paragraphs: [
          "The first session is mostly about context: how long you've been together, what brought you in, and what each of you would like to get from therapy. Your therapist will usually ask each of you to speak in turn.",
        ],
      },
      {
        heading: "You don't have to agree on why you're there",
        paragraphs: [
          "It's fine to show up with different reasons or different hopes. Your therapist will help you find common ground without pressuring either of you to give up your own perspective.",
        ],
      },
      {
        heading: "Ground rules",
        paragraphs: [
          "Couples therapy works best when both people feel safe speaking honestly. Your therapist will set a few simple ground rules at the start — no interrupting, no blame-setting — to keep the space balanced.",
        ],
      },
      {
        heading: "What happens after the first session",
        paragraphs: [
          "Most couples benefit from a series of sessions (typically weekly or fortnightly). Your therapist will suggest a rough plan at the end of the first session. You're free to continue, pause, or change direction at any point.",
        ],
        note: "Before you book, we'll ask for your partner's name and pronouns so your therapist knows who to expect.",
      },
    ],
    primaryCta: {
      loggedIn: { label: "Book a Couples Session", href: "/sessions" },
      loggedOut: { label: "Log in to Book", href: "/sessions" },
    },
    relatedSlugs: [
      "choosing-the-right-therapy-type",
      "finding-and-picking-a-therapist",
      "how-to-book-a-session",
    ],
  },

  // ---------- Billing & Receipts ----------
  {
    slug: "reading-invoices-and-receipts",
    title: "Reading your invoices and receipts",
    category: "billing",
    icon: Receipt,
    summary:
      "Where to find your payment history, how to download receipts, and what the details mean.",
    intro:
      "Every Fettle payment generates a receipt you can view, download, or forward for reimbursement. Here's how to find yours.",
    sections: [
      {
        heading: "Where to find your receipts",
        paragraphs: [
          "Go to the **Invoices** tab in the sidebar. You'll see every session payment you've made, newest first. Each entry shows the session description, date, therapist, amount, and status.",
        ],
      },
      {
        heading: "Downloading a receipt",
        paragraphs: [
          "Click **Receipt** on any payment. This opens a Stripe-hosted receipt you can save as a PDF, print, or forward to your insurer or employer for reimbursement.",
        ],
      },
      {
        heading: "What the receipt includes",
        paragraphs: [
          "Your name, session description, amount paid, payment date, and Fettle's business details. This is what most insurers ask for.",
        ],
      },
      {
        heading: "Package payments",
        paragraphs: [
          "When you buy a package, you'll see one receipt for the whole package. Individual sessions booked with package credits don't generate new receipts — they're covered by the original package payment.",
        ],
      },
      {
        heading: "If a payment is missing",
        paragraphs: [
          "The Invoices page refreshes each time you open it. If a recent payment isn't showing, click **Refresh** in the top-right. If it still doesn't appear after a few minutes, email hello@fettle.ie.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Invoices", href: "/invoices" },
      loggedOut: { label: "Log in to View Invoices", href: "/invoices" },
    },
    relatedSlugs: [
      "updating-payment-method",
      "using-loyalty-coupons",
      "how-packages-work",
    ],
  },
  {
    slug: "using-loyalty-coupons",
    title: "Using loyalty coupons and discount codes",
    category: "billing",
    icon: Award,
    summary:
      "How to earn and redeem discount codes as you progress through your therapy journey.",
    intro:
      "Fettle rewards consistent clients with discount codes tied to session milestones. Here's how they work.",
    sections: [
      {
        heading: "Milestones that unlock a reward",
        paragraphs: ["Every completed session gets you closer to the next milestone:"],
        items: [
          "**3 sessions — Getting Started** — 4% off (code: FETTLELOYALTY4)",
          "**5 sessions — Committed** — 5% off (code: FETTLELOYALTY5)",
          "**10 sessions — Consistent** — 8% off plus priority booking (code: FETTLELOYALTY8)",
          "**20 sessions — Wellness Champion** — 10% off (code: FETTLELOYALTY10)",
        ],
      },
      {
        heading: "Where to find your codes",
        paragraphs: [
          "When you unlock a reward, it appears on your Dashboard under **Loyalty Rewards**. Each card has a copy-to-clipboard button.",
        ],
      },
      {
        heading: "How to redeem a code",
        paragraphs: [
          "On the **Confirm** step of booking (when you're paying per-session), enter your code in the Coupon Code field before continuing to payment. The discount is applied immediately.",
        ],
      },
      {
        heading: "Restrictions",
        paragraphs: [
          "Coupons apply to pay-per-session bookings only, not to package purchases (packages are already discounted). One code per booking.",
        ],
      },
      {
        heading: "If a code isn't working",
        paragraphs: [
          "Make sure you're entering it exactly as shown (all caps, no spaces). If it still doesn't apply, email hello@fettle.ie and we'll sort it out.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Dashboard", href: "/dashboard" },
      loggedOut: { label: "Log in to Dashboard", href: "/dashboard" },
    },
    relatedSlugs: [
      "milestones-and-achievements",
      "how-packages-work",
      "package-vs-pay-per-session",
    ],
  },
  {
    slug: "updating-payment-method",
    title: "Updating your payment method",
    category: "billing",
    icon: CreditCard,
    summary:
      "How to add or change the card on file for future bookings.",
    intro:
      "Fettle doesn't store card details inside your account — cards are entered at the time of booking and saved securely by Stripe for future use if you choose.",
    sections: [
      {
        heading: "Adding a new card",
        paragraphs: [
          "The easiest way is at booking. On the **Payment** step, enter your new card details. Stripe will save them if you tick the option to save for future bookings.",
        ],
      },
      {
        heading: "Using a different card on the day",
        paragraphs: [
          "You can always enter a different card than the one saved — just type it in at the Payment step and complete checkout normally.",
        ],
      },
      {
        heading: "Removing a saved card",
        paragraphs: [
          "For now, removing a saved card isn't self-service. Email hello@fettle.ie with your request and we'll remove it from our records.",
        ],
      },
      {
        heading: "Cards and packages",
        paragraphs: [
          "When you buy a package, the card you use is remembered for that purchase only. Future bookings inside the package don't require a card — they use credits.",
        ],
      },
      {
        heading: "Stripe security",
        paragraphs: [
          "Fettle doesn't see or store your full card number. All card processing runs through Stripe, which is PCI-DSS certified — the same security standard used by major banks.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Contact Support", href: "mailto:hello@fettle.ie", external: true },
      loggedOut: { label: "Contact Support", href: "mailto:hello@fettle.ie", external: true },
    },
    relatedSlugs: [
      "reading-invoices-and-receipts",
      "how-packages-work",
      "how-your-data-is-protected",
    ],
  },

  // ---------- Privacy & Account ----------
  {
    slug: "how-your-data-is-protected",
    title: "How your data is protected",
    category: "privacy",
    icon: ShieldCheck,
    summary:
      "What Fettle collects, who sees it, and your rights under Irish and EU law.",
    intro:
      "Fettle is built on the principle that therapy works best when you trust the space you're in. Your data is handled accordingly — here's exactly how.",
    sections: [
      {
        heading: "What Fettle collects",
        paragraphs: [
          "Account details (name, email), session history (dates, therapist, appointment type), payment records (via Stripe, not stored directly by Fettle), and any notes you provide at booking. We don't see the content of your sessions.",
        ],
      },
      {
        heading: "What your therapist sees",
        paragraphs: [
          "Your name, contact details, and any notes you added during booking. Your therapist keeps their own session notes for clinical continuity — those are stored by the therapist, not by Fettle.",
        ],
      },
      {
        heading: "What employers see (if you're on a corporate plan)",
        paragraphs: [
          'Only anonymised, aggregated data — for example, "X employees booked sessions this quarter." Nothing personal, nothing identifying, nothing that could be traced back to you.',
        ],
      },
      {
        heading: "Your rights under GDPR",
        items: [
          "**Article 20 (data portability)** — request a copy of your data at any time",
          "**Article 17 (right to erasure)** — delete your account and data",
          "Both are self-service in your Profile.",
        ],
      },
      {
        heading: "How long we keep data",
        paragraphs: [
          "As long as your account is active. After you delete your account, we retain only the minimum required by Irish law for health records, then delete the rest.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Profile", href: "/profile" },
      loggedOut: { label: "Log in to Profile", href: "/profile" },
    },
    relatedSlugs: [
      "managing-consent-preferences",
      "enabling-2fa-and-exporting-data",
      "youth-therapy-consent",
    ],
  },
  {
    slug: "managing-consent-preferences",
    title: "Managing your consent preferences",
    category: "privacy",
    icon: Shield,
    summary:
      "Control what we use your data for — separately from your account and session records.",
    intro:
      "Your core account data is only used to run your therapy — booking, payments, reminders. Anything beyond that (marketing, analytics) requires your explicit consent, which you can turn on or off any time.",
    sections: [
      {
        heading: "Where to find consent settings",
        paragraphs: ["**Profile → Consent Preferences**."],
      },
      {
        heading: "What you can control",
        paragraphs: ["Two opt-ins, both off by default unless you turn them on:"],
        items: [
          "**Marketing** — Occasional emails about new therapist specialties, service updates, or relevant wellness content. Never about your actual sessions — those are essential and aren't opt-in.",
          "**Analytics** — Anonymised usage data that helps us improve the hub (e.g. which pages clients visit most). We never connect this data to who you are.",
        ],
      },
      {
        heading: "What stays on regardless",
        paragraphs: [
          "Essential communication (session reminders, payment receipts, account security alerts) and booking data itself. These are required to provide the service.",
        ],
      },
      {
        heading: "Changing your mind",
        paragraphs: [
          "Toggle either option any time. Changes take effect immediately — you don't need to resubscribe or contact us.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Profile", href: "/profile" },
      loggedOut: { label: "Log in to Profile", href: "/profile" },
    },
    relatedSlugs: [
      "how-your-data-is-protected",
      "enabling-2fa-and-exporting-data",
    ],
  },
  {
    slug: "enabling-2fa-and-exporting-data",
    title: "Enabling 2FA and exporting your data",
    category: "privacy",
    icon: KeyRound,
    summary:
      "Extra security for your account, and how to download everything Fettle has about you.",
    intro:
      "Two features in your Profile give you more control over your account — two-factor authentication (for security) and data export (for your records or GDPR requests).",
    sections: [
      {
        heading: "Enabling 2FA (Authenticator app)",
        paragraphs: [
          "Go to **Profile → Security → Two-Factor Authentication**. Scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password) and enter the 6-digit code to confirm. After that, you'll enter a code from your app each time you sign in.",
        ],
      },
      {
        heading: "Why turn on 2FA?",
        paragraphs: [
          "Therapy records are sensitive. Even though Fettle never sees session content, your account history and personal details are better protected with 2FA than with a password alone.",
        ],
      },
      {
        heading: "If you lose your authenticator device",
        paragraphs: [
          "Email hello@fettle.ie to reset 2FA. We'll verify your identity before disabling it.",
        ],
      },
      {
        heading: "Exporting your data",
        paragraphs: [
          "**Profile → Data Export → Download my data.** You'll get a JSON file containing your account info, session history, consent records, and profile updates. You can open it in any text editor or spreadsheet tool.",
        ],
      },
      {
        heading: "What data export is for",
        paragraphs: [
          "Keeping a personal record, filing an insurance claim, moving to another therapist or service, or exercising your GDPR right to data portability.",
        ],
      },
      {
        heading: "Deleting your account",
        paragraphs: [
          'Also in Profile. Typing "DELETE MY ACCOUNT" and confirming will permanently delete your account and data (except what we must retain by Irish law).',
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Profile", href: "/profile" },
      loggedOut: { label: "Log in to Profile", href: "/profile" },
    },
    relatedSlugs: [
      "how-your-data-is-protected",
      "managing-consent-preferences",
    ],
  },

  // ---------- Progress & Milestones ----------
  {
    slug: "understanding-progress-dashboard",
    title: "Understanding the progress dashboard",
    category: "progress",
    icon: LineChart,
    summary:
      "What each number on your dashboard actually means.",
    intro:
      "Your dashboard is designed to give you a quick sense of where you are without being noisy. Here's what each stat tracks.",
    sections: [
      {
        heading: "Sessions This Month",
        paragraphs: [
          "The number of completed sessions during the current calendar month. It resets on the 1st.",
        ],
      },
      {
        heading: "Total Hours",
        paragraphs: [
          "The total hours you've spent in therapy at Fettle since you started. It adds up as each session completes.",
        ],
      },
      {
        heading: "Week Streak",
        paragraphs: [
          "The number of consecutive weeks in which you've had at least one completed session. Miss a week and the streak resets to zero.",
        ],
      },
      {
        heading: "Upcoming",
        paragraphs: [
          "The total number of future sessions you have booked right now, across all session types.",
        ],
      },
      {
        heading: "Why streaks, why milestones",
        paragraphs: [
          "Consistency matters in therapy. These numbers aren't there to pressure you — they're there to gently reflect what you've already done, which is often more than clients give themselves credit for.",
        ],
        note: "Only completed sessions count toward stats. Cancelled or missed sessions don't reduce your total hours or break your streak (a full week with no completed session will).",
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Dashboard", href: "/dashboard" },
      loggedOut: { label: "Log in to Dashboard", href: "/dashboard" },
    },
    relatedSlugs: [
      "milestones-and-achievements",
      "how-to-book-a-session",
      "how-packages-work",
    ],
  },
  {
    slug: "milestones-and-achievements",
    title: "Milestones and achievements explained",
    category: "progress",
    icon: Trophy,
    summary:
      "The five milestones on your Fettle journey, what they mean, and what they unlock.",
    intro:
      "As you complete sessions, you'll unlock five milestones. Some are purely a moment to pause and acknowledge progress; others also unlock a small loyalty reward. Here's the full list.",
    sections: [
      {
        heading: "The five milestones",
        items: [
          "**1 session — First Step** — A recognition badge. No discount — just a nod for the hardest session of them all.",
          "**3 sessions — Getting Started** — Unlocks a 4% off coupon (FETTLELOYALTY4).",
          "**5 sessions — Committed** — Unlocks 5% off (FETTLELOYALTY5).",
          "**10 sessions — Consistent** — Unlocks 8% off plus priority booking (FETTLELOYALTY8).",
          "**20 sessions — Wellness Champion** — Unlocks 10% off (FETTLELOYALTY10) and the top badge.",
        ],
      },
      {
        heading: "How milestones count",
        paragraphs: [
          "Only completed sessions count. Cancelled or rescheduled sessions don't. Any session type counts — individual, couples, or youth.",
        ],
      },
      {
        heading: "Where to find your badges and codes",
        paragraphs: [
          "**Dashboard → Loyalty Rewards**. Each badge shows when you earned it and, if there's a code attached, a copy button.",
        ],
      },
      {
        heading: "A note on pressure",
        paragraphs: [
          "Hitting a milestone doesn't change your service — we don't bump prices or remove anything. It's our way of thanking clients who stick with therapy, because we know how much it takes.",
        ],
      },
    ],
    primaryCta: {
      loggedIn: { label: "Go to Dashboard", href: "/dashboard" },
      loggedOut: { label: "Log in to Dashboard", href: "/dashboard" },
    },
    relatedSlugs: [
      "understanding-progress-dashboard",
      "using-loyalty-coupons",
      "how-to-book-a-session",
    ],
  },
];

export const getArticleBySlug = (slug: string): HelpArticle | undefined =>
  helpArticles.find((a) => a.slug === slug);

export const getRelatedArticles = (article: HelpArticle): HelpArticle[] =>
  article.relatedSlugs
    .map((slug) => helpArticles.find((a) => a.slug === slug))
    .filter((a): a is HelpArticle => a !== undefined);

export const getAvailableCategories = (): HelpCategory[] => {
  const set = new Set(helpArticles.map((a) => a.category));
  return CATEGORY_ORDER.filter((c) => set.has(c));
};
