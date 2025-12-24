import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, Lock, User, ArrowRight, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export default function Signup() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signUp, user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  const recordConsent = async (userId: string) => {
    const consents = [
      {
        user_id: userId,
        consent_type: "privacy_policy",
        consented: true,
        consented_at: new Date().toISOString(),
        user_agent: navigator.userAgent,
      },
      {
        user_id: userId,
        consent_type: "terms_of_service",
        consented: true,
        consented_at: new Date().toISOString(),
        user_agent: navigator.userAgent,
      },
    ];

    if (marketingConsent) {
      consents.push({
        user_id: userId,
        consent_type: "marketing",
        consented: true,
        consented_at: new Date().toISOString(),
        user_agent: navigator.userAgent,
      });
    }

    // Insert consent records
    const { error } = await supabase.from("user_consent").insert(consents);
    if (error) {
      console.error("Failed to record consent:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!privacyConsent) {
      toast({
        title: "Consent required",
        description: "You must agree to the Privacy Policy and Terms of Service to create an account.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: "Password too short",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    const { error } = await signUp(email, password, firstName, lastName);
    
    if (error) {
      setIsLoading(false);
      toast({
        title: "Sign up failed",
        description: error.message.includes("already registered")
          ? "An account with this email already exists."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    // Show email verification message
    setIsLoading(false);
    setEmailSent(true);
    
    toast({
      title: "Verification email sent!",
      description: "Please check your inbox and click the link to verify your email.",
    });
  };

  // Show email verification success screen
  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md animate-fade-in">
          <div className="text-center mb-8">
            <Link to="/" className="inline-block">
              <span className="font-heading text-4xl font-bold text-primary">fettle</span>
              <span className="text-sm text-muted-foreground">.ie</span>
            </Link>
          </div>

          <Card className="border-border/50 shadow-elevated">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="font-heading text-2xl">Check your email</CardTitle>
              <CardDescription className="text-base">
                We've sent a verification link to
              </CardDescription>
              <p className="font-medium text-foreground mt-1">{email}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                <p className="mb-2">
                  Click the link in the email to verify your account and complete your registration.
                </p>
                <p>
                  If you don't see the email, check your spam folder.
                </p>
              </div>
              
              <div className="text-center space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => setEmailSent(false)}
                >
                  Use a different email
                </Button>
                <Link to="/login">
                  <Button variant="ghost" className="w-full">
                    Back to login
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <span className="font-heading text-4xl font-bold text-primary">fettle</span>
            <span className="text-sm text-muted-foreground">.ie</span>
          </Link>
          <p className="mt-2 text-muted-foreground">Start your therapy journey</p>
        </div>

        <Card className="border-border/50 shadow-elevated">
          <CardHeader className="text-center">
            <CardTitle className="font-heading text-2xl">Create an account</CardTitle>
            <CardDescription>Enter your details to get started</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="firstName"
                      placeholder="Sarah"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Murphy"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Must be at least 8 characters
                </p>
              </div>

              {/* Consent Checkboxes */}
              <div className="space-y-3 pt-2">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="privacy"
                    checked={privacyConsent}
                    onCheckedChange={(checked) => setPrivacyConsent(!!checked)}
                    required
                  />
                  <div className="space-y-1">
                    <Label htmlFor="privacy" className="text-sm font-normal cursor-pointer leading-tight">
                      I agree to the{" "}
                      <Link to="/privacy" className="text-primary hover:underline" target="_blank">
                        Privacy Policy
                      </Link>{" "}
                      and{" "}
                      <Link to="/terms" className="text-primary hover:underline" target="_blank">
                        Terms of Service
                      </Link>
                      <span className="text-destructive"> *</span>
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Required to create an account
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="marketing"
                    checked={marketingConsent}
                    onCheckedChange={(checked) => setMarketingConsent(!!checked)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="marketing" className="text-sm font-normal cursor-pointer leading-tight">
                      Send me updates about new services and promotions
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Optional - you can change this anytime
                    </p>
                  </div>
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full gap-2 shadow-soft" 
                disabled={isLoading || !privacyConsent}
              >
                {isLoading ? "Creating account..." : "Create account"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <p className="mt-4 text-xs text-center text-muted-foreground">
              Your data is protected under GDPR and Irish Data Protection Act 2018.
              Read our{" "}
              <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
              {" "}for details.
            </p>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
