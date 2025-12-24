import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, FileText, Users, Lock, Globe, Mail } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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
          <h1 className="font-heading text-4xl font-bold text-foreground mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground">
            Last updated: {new Date().toLocaleDateString("en-IE", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        <div className="space-y-6">
          {/* Introduction */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Our Commitment to Your Privacy
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                Fettle Therapy Services ("we", "our", or "us") is committed to protecting your personal data 
                and respecting your privacy in accordance with the General Data Protection Regulation (GDPR) 
                and the Irish Data Protection Act 2018.
              </p>
              <p>
                This privacy policy explains how we collect, use, store, and protect your personal information 
                when you use our therapy booking platform at fettle.ie.
              </p>
            </CardContent>
          </Card>

          {/* Data Controller */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Data Controller
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                <strong>Fettle Therapy Services</strong><br />
                Dublin, Ireland<br />
                Email: privacy@fettle.ie
              </p>
              <p>
                We are the data controller for the personal data you provide through our platform, 
                meaning we determine why and how your personal data is processed.
              </p>
            </CardContent>
          </Card>

          {/* Data We Collect */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Personal Data We Collect
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>We collect and process the following categories of personal data:</p>
              <ul>
                <li><strong>Account Information:</strong> Email address, first name, last name, password (encrypted)</li>
                <li><strong>Booking Information:</strong> Session dates, times, therapist preferences, appointment history</li>
                <li><strong>Payment Information:</strong> Payment method details (processed securely via Stripe)</li>
                <li><strong>Activity Data:</strong> Login history, booking actions, platform usage</li>
                <li><strong>Consent Records:</strong> Records of your consent for data processing, marketing preferences</li>
                <li><strong>Technical Data:</strong> IP address, browser type, device information (for security and analytics)</li>
              </ul>
            </CardContent>
          </Card>

          {/* Legal Basis */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Legal Basis for Processing
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>We process your personal data based on the following legal grounds:</p>
              <ul>
                <li><strong>Contract:</strong> To provide our therapy booking services as per our agreement with you</li>
                <li><strong>Consent:</strong> For marketing communications and optional data processing (you can withdraw at any time)</li>
                <li><strong>Legitimate Interest:</strong> To improve our services, prevent fraud, and ensure platform security</li>
                <li><strong>Legal Obligation:</strong> To comply with applicable laws and regulations</li>
              </ul>
            </CardContent>
          </Card>

          {/* Your Rights */}
          <Card className="border-border/50 border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                Your GDPR Rights
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>Under GDPR and Irish data protection law, you have the following rights:</p>
              <ul>
                <li><strong>Right of Access (Article 15):</strong> Request a copy of your personal data</li>
                <li><strong>Right to Rectification (Article 16):</strong> Correct inaccurate personal data</li>
                <li><strong>Right to Erasure (Article 17):</strong> Request deletion of your personal data ("right to be forgotten")</li>
                <li><strong>Right to Data Portability (Article 20):</strong> Receive your data in a machine-readable format</li>
                <li><strong>Right to Restrict Processing (Article 18):</strong> Limit how we use your data</li>
                <li><strong>Right to Object (Article 21):</strong> Object to processing based on legitimate interests</li>
                <li><strong>Right to Withdraw Consent:</strong> Withdraw your consent at any time</li>
              </ul>
              <p className="mt-4 font-medium text-foreground">
                You can exercise these rights through your Profile settings or by contacting us at privacy@fettle.ie. 
                We will respond to your request within 30 days.
              </p>
            </CardContent>
          </Card>

          {/* Data Retention */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading">Data Retention</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>We retain your personal data only as long as necessary:</p>
              <ul>
                <li><strong>Account data:</strong> Until you delete your account</li>
                <li><strong>Booking history:</strong> 7 years (for legal and accounting requirements)</li>
                <li><strong>Consent records:</strong> Until you withdraw consent + 3 years for legal compliance</li>
                <li><strong>Technical logs:</strong> 90 days</li>
              </ul>
              <p>When you delete your account, all personal data is permanently removed except where legal retention is required.</p>
            </CardContent>
          </Card>

          {/* Data Security */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading">Data Security</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>We implement appropriate technical and organizational measures to protect your data:</p>
              <ul>
                <li>Encryption of data in transit (TLS/SSL) and at rest</li>
                <li>Two-factor authentication (2FA) available for account security</li>
                <li>Regular security audits and vulnerability assessments</li>
                <li>Access controls and employee training on data protection</li>
                <li>Secure payment processing through PCI-DSS compliant providers (Stripe)</li>
              </ul>
            </CardContent>
          </Card>

          {/* Third Parties */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading">Third-Party Services</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>We share your data with the following trusted third parties:</p>
              <ul>
                <li><strong>Stripe:</strong> Payment processing (PCI-DSS compliant)</li>
                <li><strong>Acuity Scheduling:</strong> Appointment management</li>
                <li><strong>Resend:</strong> Email communications</li>
              </ul>
              <p>All third-party providers are bound by data processing agreements and are GDPR compliant.</p>
            </CardContent>
          </Card>

          {/* Contact & Complaints */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Contact & Complaints
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <p>For any privacy-related questions or to exercise your rights, contact us:</p>
              <p>
                <strong>Email:</strong> privacy@fettle.ie<br />
                <strong>Address:</strong> Fettle Therapy Services, Dublin, Ireland
              </p>
              <p className="mt-4">
                If you are not satisfied with our response, you have the right to lodge a complaint with the 
                Irish Data Protection Commission:
              </p>
              <p>
                <strong>Data Protection Commission</strong><br />
                21 Fitzwilliam Square South, Dublin 2, D02 RD28<br />
                Website: <a href="https://www.dataprotection.ie" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">www.dataprotection.ie</a>
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            Questions about this policy? <a href="mailto:privacy@fettle.ie" className="text-primary hover:underline">Contact our Data Protection Officer</a>
          </p>
        </div>
      </main>
    </div>
  );
}
