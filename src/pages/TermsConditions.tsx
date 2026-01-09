import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Shield,
  AlertTriangle,
  Calendar,
  CreditCard,
  Gavel,
  FileText,
  Users,
} from "lucide-react";

export default function TermsConditions() {
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
          <h1 className="font-heading text-4xl font-bold text-foreground mb-2">Terms of Use, Security & Confidentiality</h1>
          <p className="text-muted-foreground">
            Last updated: {new Date().toLocaleDateString("en-IE", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        <div className="space-y-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Security & Confidentiality
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                We at Kerwex Human Resources Limited trading as www.fettle.ie aim to provide a secure and confidential
                service. We ensure that our computers are regularly updated with antivirus software.
              </p>
              <p>
                Clients are responsible for maintaining and protecting their own computers and for regularly updating
                their security software. Clients are also responsible for ensuring confidentiality from their end
                during sessions and afterwards where computers may be shared.
              </p>
              <p>
                Clients accept that there are limits to confidentiality. While the content of sessions and the
                client's identity is treated with the strictest confidence, this may cease should the client be at
                risk to themselves or others, or if there is a risk of harm to children and vulnerable adults. Clients
                accept that therapists are required to attend regular supervision and that identity will remain
                confidential.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-primary" />
                Disclaimer
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                Our services are intended to foster enhanced communications and coordination between users and
                service providers, including mental healthcare professionals. Kerwex Human Resources Limited does
                not provide professional medical advice, diagnosis, or treatment.
              </p>
              <p>
                We are not responsible for health-related information provided through service providers, and we do
                not recommend or endorse any specific providers, tests, procedures, opinions, or information that may
                appear through the services. Any dispute between you and a service provider must be addressed
                directly with the service provider. If you rely on any information provided through the services, you
                do so solely at your own risk.
              </p>
              <p>
                By accepting these terms, clients agree to release and indemnify Kerwex Human Resources Limited from
                all actions, suits, lawsuits, and claims howsoever caused originating from counselling and
                psychotherapy as provided by the service providers listed on www.fettle.ie.
              </p>
              <p>
                Service providers and users accept full responsibility for their own telephone or computer systems
                and any technical difficulties occurring in connection with www.fettle.ie.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>Clients accept that therapy may involve unpleasant and upsetting emotions. This is not a free service and all sessions are subject to a fee.</p>
              <p>
                Sessions are 50 minutes. Clients are responsible for being available to start on time. Sessions that
                do not begin on time will be reduced but are subject to the full 50 minute fee.
              </p>
              <p>
                Sessions affected by technical difficulties or cancellations on behalf of the therapist will be
                subject to a full refund or rescheduled session.
              </p>
              <p>
                Upon booking a session, the client acknowledges that to ensure effectiveness it is imperative to
                attend each session in a quiet and safe space, free from disturbances or distractions. If the
                therapist determines the area to be unsuitable, the therapist may cancel or reschedule the
                appointment for the benefit of the client's therapeutic experience. In this instance, the full
                session fee will be applied.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Cancellations
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                48 hours notice should be given for all cancellations by clients. Sessions missed or cancelled with
                less than 48 hours notice will incur the full cost of the session.
              </p>
              <p>
                Cancellations by therapists will result in a full refund or a rescheduled session as per the client's
                request. A EUR 20 cancellation fee will be incurred for any cancelled appointments regardless of it
                being greater than 48 hours notice.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Conduct
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                Therapists will not accept threatening or abusive behaviour. Such behaviour may result in the
                session ending and the client being liable for the full session cost.
              </p>
              <p>
                Clients and users of www.fettle.ie are not permitted to attempt to damage the site through the
                introduction of viruses, trojans, trolls, or any form of malicious or harmful technology. Details of
                any breach will be forwarded to the relevant authorities.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Payment
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>All payment is through Stripe. Stripe accepts all major credit cards.</p>
              <ul>
                <li>All payments are upfront prior to the time of the session</li>
                <li>Monthly memberships are debited automatically each month</li>
                <li>Pre-scheduled sessions are processed up to one week in advance</li>
                <li>Card details are securely stored to process these transactions</li>
              </ul>
              <p>To remove or update payment details, contact hello@fettle.ie.</p>
              <p>For information on cancellations please refer to the cancellations section.</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Gavel className="h-5 w-5 text-primary" />
                Agreement
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <ul>
                <li>Clients must be over 18 years of age</li>
                <li>Clients accept responsibility for checking that laws in their country permit use of this service</li>
                <li>Clients have read the policy on confidentiality, security, and the terms of use</li>
                <li>The service is for counselling and not part of any academic study</li>
                <li>Publication of details pertaining to therapy sessions requires prior written consent of the therapist</li>
                <li>Contact between client and therapist takes place within sessions, except for cancellation or rescheduling</li>
                <li>Clients agree to disclose honestly their medical history and all current medications</li>
                <li>Clients understand that this is not a free service and sessions are subject to payment in advance</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
