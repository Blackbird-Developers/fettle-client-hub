import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Shield,
  Users,
  FileText,
  Globe,
  Database,
  CreditCard,
  Clock,
  Cookie,
  Lock,
  Mail,
} from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="font-heading text-2xl font-bold text-primary">fettle</span>
            <span className="text-sm text-muted-foreground">.ie</span>
          </Link>
          <Link to="/login">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-4xl font-bold text-foreground mb-2">Privacy & Cookie Policy</h1>
          <p className="text-muted-foreground">
            Last updated: {new Date().toLocaleDateString("en-IE", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        <div className="space-y-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                About Fettle
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                Kerwex Human Resources Limited t/a Fettle is proper mental healthcare for employers and individuals
                who want to make a real impact on their lives and their organisation's performance.
              </p>
              <p>
                Combining a curated team of highly-qualified mental health professionals, personalised therapist
                matching by real humans, dedicated training and support for managers, and a hassle-free digital
                experience, Fettle is Ireland's and Europe's first mental healthcare solution that truly covers
                a broad spectrum of employee and individual mental health needs.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                What this notice is about
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                We want to be transparent about how we collect and use your personal data. This privacy notice
                exists to tell you exactly how we do this.
              </p>
              <p>
                Personal data is anything that could identify an individual, either on its own or combined with
                other factors that could lead to identifying an individual.
              </p>
              <p>
                Any time we make a decision on processing personal data, we do it according to this notice. In data
                protection law terms, this means we are acting as a Data Controller.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                The ways we process your data
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <h3>Companies partnering with Fettle</h3>
              <p>
                When your company starts working with us we collect regular feedback and usage data to better
                understand what your company needs from Fettle, and to tailor our service in line with this. The
                legal basis we rely on is Article 6(1)(f) of the GDPR - Legitimate Interests.
              </p>
              <h3>When your employees use Fettle</h3>
              <p>
                When employees use our digital platform, we store information about attendance, bookings, basic
                topics that come up in sessions, and clinical outcomes so they can track their progress with Fettle.
                This information is shared in an anonymous, aggregated form with the company benefits manager or
                relevant point of contact, and is never attributable to an employee personally. The legal basis we
                rely on is Article 6(1)(f) of the GDPR - Legitimate Interests.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                What personal data we collect and why
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                When an employee or individual signs up for therapy sessions with Fettle, we need basic information
                such as name and contact details so we can set up sessions. The legal basis is Article 6(1)(f) of the
                GDPR - Legitimate Interests.
              </p>
              <p>
                During therapy, therapists keep notes on anything shared about mental health, reasons for booking
                therapy, and therapy history. Only mental health professionals can view these notes. We only keep
                information that is willingly shared and relevant to therapy, relying on Article 9(2)(a) of the GDPR
                - Explicit Consent.
              </p>
              <p>
                After therapy sessions, we keep anonymous records of attendance, usage details, and clinical outcomes
                to improve our service and to allow your company to track Fettle's effectiveness. The legal basis is
                Article 6(1)(f) of the GDPR - Legitimate Interests.
              </p>
              <p>
                When an employee books a check-in session, we keep notes on anything shared so we can support them
                better in future sessions. Only our mental health professionals can see these notes. We rely on
                Article 9(2)(a) of the GDPR - Explicit Consent.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Where we store it
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                We use a tool called Victa for our therapists to take notes for employee therapy sessions. Victa
                stores data with Amazon Web Services, which is GDPR-ready and uses standard contractual clauses for
                international transfer of data to the US.
              </p>
              <p>
                We also use a booking tool for individual clients called Acuity which is integrated with Zoom for
                the delivery of online therapy sessions. Both Zoom and Acuity use standard contractual clauses for
                international transfer of data to the US.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Payment information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                After you place an order on our website you will need to make payment for the services you ordered.
                We use Stripe, a third-party payment processor. Stripe collects, uses, and processes your information,
                including payment information, in accordance with their privacy policies.
              </p>
              <p>
                Stripe's services in Europe are provided by Stripe Payments Europe Limited, an entity located in
                Ireland. In providing Stripe services, Stripe Payments Europe transfers personal data to Stripe, Inc.
                in the US. For further information about safeguards used when your information is transferred outside
                the European Economic Area, contact us.
              </p>
              <p>
                Stripe's privacy policy: <a href="https://stripe.com/ie/privacy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">https://stripe.com/ie/privacy</a>
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                How long we keep your information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                We only keep your personal data for as long as necessary in order to use it as described above for
                business or legal purposes. We retain personal data as long as needed to deal with queries and for
                as long as you might legally bring claims against us.
              </p>
              <p>
                All counselling records will be maintained as required by applicable legal and ethical standards of
                the country in which the therapist resides. Recording of sessions is prohibited.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                When your company has partnered with Fettle
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                We collect regular feedback and usage data to better understand what your company needs from Fettle
                and to tailor our service. We may ask your benefits manager or relevant point of contact for feedback
                via online surveys. The legal basis we rely on is Article 6(1)(f) of the GDPR - Legitimate Interests.
              </p>
              <p>
                We use a software called Typeform to get your feedback. Typeform is hosted in Spain. We also store
                information that your company provides us with on Google Applications. Google Cloud servers are
                located in the US and use EU Commission Standard Contractual Clauses for the transfer of data.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Cookie className="h-5 w-5 text-primary" />
                Cookies
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                Cookies are small files placed on your computer when you visit a website and saved in your browser
                history. They allow the website to recognise your device and store information about your preferences
                or past actions.
              </p>
              <p>When you use our website, there are two types of cookies that can be set:</p>
              <ul>
                <li><strong>First party cookies:</strong> Placed and read by Fettle directly while you use our website</li>
                <li><strong>Third party cookies:</strong> Set by third parties such as Google Analytics and Hotjar</li>
              </ul>
              <p>We use these categories of cookies:</p>
              <ul>
                <li><strong>Necessary cookies:</strong> Essential to the operation of our website</li>
                <li><strong>Analytics cookies:</strong> Anonymous statistics on how visitors use our website</li>
                <li><strong>Advertising cookies:</strong> Direct you to Fettle ads and track engagement</li>
              </ul>
              <p>
                You can choose not to store non-necessary cookies or adjust your browser settings to prevent cookies
                from being saved on your computer.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Security measures
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <ul>
                <li>Two-factor authentication for all tools we use, or SSO with Google</li>
                <li>Company-wide password manager with unique, strong passwords</li>
                <li>All laptops are encrypted</li>
                <li>Immediate installation of OS software updates</li>
                <li>Strict access controls with least-privilege access to tools</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border/50 border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                Your rights
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>Your personal data is yours, and your rights include:</p>
              <ul>
                <li>The right to be informed</li>
                <li>The right of access</li>
                <li>The right to rectification</li>
                <li>The right to erasure</li>
                <li>The right to restrict processing</li>
                <li>The right to data portability</li>
              </ul>
              <p>
                You do not have to pay anything to exercise your rights. Contact us at hello@fettle.ie or +353 (0)1
                912 0367. We will respond within 1 month.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Contact and complaints
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                Our Data Protection Officer is Brendan O'Reilly. You can contact Brendan@fettle.ie. For any concerns
                about our use of your personal information, write to us at hello@fettle.ie.
              </p>
              <p>
                If you are not satisfied with our response, or you are unhappy with how we have used your data, you
                can complain to the Data Protection Commission.
              </p>
              <p>
                Data Protection Commission website: <a href="https://www.dataprotection.ie" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">www.dataprotection.ie</a>
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            Questions about this policy? <a href="mailto:hello@fettle.ie" className="text-primary hover:underline">Contact us</a>
          </p>
        </div>
      </main>
    </div>
  );
}


