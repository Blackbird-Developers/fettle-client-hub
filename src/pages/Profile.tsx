import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  User, Mail, Phone, MapPin, Bell, Shield, Download, Trash2, 
  Key, Smartphone, AlertTriangle, FileText, CheckCircle2 
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

interface ConsentRecord {
  consent_type: string;
  consented: boolean;
  consented_at: string | null;
}

export default function Profile() {
  const { user, profile, signOut } = useAuth();
  const { toast } = useToast();
  
  const [firstName, setFirstName] = useState(profile?.first_name || "");
  const [lastName, setLastName] = useState(profile?.last_name || "");
  const [email, setEmail] = useState(profile?.email || "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isEnabling2FA, setIsEnabling2FA] = useState(false);
  const [has2FAEnabled, setHas2FAEnabled] = useState(false);
  
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setEmail(profile.email || "");
    }
  }, [profile]);

  useEffect(() => {
    const fetchConsents = async () => {
      if (!user) return;
      
      const { data, error } = await supabase
        .from("user_consent")
        .select("consent_type, consented, consented_at")
        .eq("user_id", user.id);
      
      if (!error && data) {
        setConsents(data);
        const marketing = data.find(c => c.consent_type === "marketing");
        const analytics = data.find(c => c.consent_type === "analytics");
        setMarketingConsent(marketing?.consented || false);
        setAnalyticsConsent(analytics?.consented || false);
      }
    };

    const check2FAStatus = async () => {
      if (!user) return;
      const { data } = await supabase.auth.mfa.listFactors();
      setHas2FAEnabled(data?.totp?.length ? data.totp.some(f => f.status === "verified") : false);
    };

    fetchConsents();
    check2FAStatus();
  }, [user]);

  const handleUpdateProfile = async () => {
    if (!user) return;
    setIsUpdating(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
      })
      .eq("user_id", user.id);

    setIsUpdating(false);

    if (error) {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Profile updated",
        description: "Your profile has been saved successfully.",
      });
    }
  };

  const handleConsentChange = async (consentType: string, consented: boolean) => {
    if (!user) return;

    const { error } = await supabase
      .from("user_consent")
      .upsert({
        user_id: user.id,
        consent_type: consentType,
        consented,
        consented_at: consented ? new Date().toISOString() : null,
        ip_address: null, // Could be captured server-side
        user_agent: navigator.userAgent,
      }, {
        onConflict: "user_id,consent_type",
      });

    if (error) {
      toast({
        title: "Failed to update consent",
        description: error.message,
        variant: "destructive",
      });
    } else {
      if (consentType === "marketing") setMarketingConsent(consented);
      if (consentType === "analytics") setAnalyticsConsent(consented);
      
      toast({
        title: "Consent updated",
        description: `Your ${consentType} preference has been saved.`,
      });
    }
  };

  const handleExportData = async () => {
    setIsExporting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("export-user-data", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;

      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fettle-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Data exported",
        description: "Your personal data has been downloaded as a JSON file.",
      });
    } catch (error: unknown) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Failed to export data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE MY ACCOUNT") {
      toast({
        title: "Invalid confirmation",
        description: "Please type 'DELETE MY ACCOUNT' to confirm.",
        variant: "destructive",
      });
      return;
    }

    setIsDeleting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("delete-user-account", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: { confirmation: deleteConfirmation },
      });

      if (error) throw error;

      toast({
        title: "Account deleted",
        description: "Your account and all data have been permanently deleted.",
      });

      await signOut();
    } catch (error: unknown) {
      toast({
        title: "Deletion failed",
        description: error instanceof Error ? error.message : "Failed to delete account",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmation("");
    }
  };

  const handleEnable2FA = async () => {
    setIsEnabling2FA(true);

    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });

      if (error) throw error;

      // Open a new window/modal with QR code
      if (data.totp.qr_code) {
        const qrWindow = window.open("", "2FA Setup", "width=400,height=500");
        if (qrWindow) {
          qrWindow.document.write(`
            <html>
              <head><title>Set up Two-Factor Authentication</title></head>
              <body style="font-family: system-ui; padding: 20px; text-align: center;">
                <h2>Scan this QR code</h2>
                <p>Use your authenticator app (Google Authenticator, Authy, etc.)</p>
                <img src="${data.totp.qr_code}" alt="QR Code" style="margin: 20px 0;" />
                <p><strong>Secret:</strong> ${data.totp.secret}</p>
                <p style="color: #666; font-size: 14px;">After scanning, close this window and enter the code from your app to verify.</p>
              </body>
            </html>
          `);
        }

        toast({
          title: "2FA Setup Started",
          description: "Scan the QR code in your authenticator app, then verify with a code.",
        });
      }
    } catch (error: unknown) {
      toast({
        title: "2FA setup failed",
        description: error instanceof Error ? error.message : "Failed to enable 2FA",
        variant: "destructive",
      });
    } finally {
      setIsEnabling2FA(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mb-8 animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Profile
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your account settings, privacy, and data preferences
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Profile Info */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Personal Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input 
                    id="firstName" 
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input 
                    id="lastName" 
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="email" 
                    value={email}
                    disabled
                    className="pl-10 bg-muted"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Contact support to change your email address</p>
              </div>
              <div className="pt-2">
                <Button 
                  className="shadow-soft" 
                  onClick={handleUpdateProfile}
                  disabled={isUpdating}
                >
                  {isUpdating ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 2FA Section */}
              <div className="p-4 rounded-lg border border-border bg-card/50">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Smartphone className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <h4 className="font-medium">Two-Factor Authentication (2FA)</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Add an extra layer of security to your account using an authenticator app.
                      </p>
                      {has2FAEnabled && (
                        <div className="flex items-center gap-1 mt-2 text-sm text-green-600">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>2FA is enabled</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={has2FAEnabled ? "outline" : "default"}
                    size="sm"
                    onClick={handleEnable2FA}
                    disabled={isEnabling2FA}
                  >
                    {isEnabling2FA ? "Setting up..." : has2FAEnabled ? "Manage 2FA" : "Enable 2FA"}
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Password Change */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-muted-foreground" />
                  <h4 className="font-medium">Change Password</h4>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input id="currentPassword" type="password" placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input id="newPassword" type="password" placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <Input id="confirmPassword" type="password" placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" />
                  </div>
                </div>
                <Button variant="outline">Update Password</Button>
              </div>
            </CardContent>
          </Card>

          {/* GDPR Data Rights */}
          <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Your Data Rights (GDPR)
              </CardTitle>
              <CardDescription>
                Under GDPR and Irish Data Protection Act 2018, you have the right to access and control your personal data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium flex items-center gap-2">
                      <Download className="h-4 w-4" />
                      Export Your Data
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Download all your personal data in a portable JSON format (Article 20 - Right to Data Portability)
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleExportData}
                    disabled={isExporting}
                  >
                    {isExporting ? "Exporting..." : "Export Data"}
                  </Button>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>Your data export includes:</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Account information</li>
                  <li>Profile details</li>
                  <li>Session booking history</li>
                  <li>Consent records</li>
                </ul>
              </div>

              <div className="pt-2 flex flex-wrap gap-3">
                <Link to="/privacy" className="text-sm text-primary hover:underline">
                  Read our full Privacy Policy →
                </Link>
                <Link to="/terms" className="text-sm text-primary hover:underline">
                  Read our Terms & Conditions →
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Consent Management */}
          <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <CardHeader>
              <CardTitle className="font-heading text-base">Consent Preferences</CardTitle>
              <CardDescription className="text-xs">
                Manage how we use your data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="marketing"
                  checked={marketingConsent}
                  onCheckedChange={(checked) => handleConsentChange("marketing", !!checked)}
                />
                <div className="space-y-1">
                  <Label htmlFor="marketing" className="text-sm font-medium cursor-pointer">
                    Marketing Communications
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Receive emails about new services and offers
                  </p>
                </div>
              </div>

              <Separator />

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="analytics"
                  checked={analyticsConsent}
                  onCheckedChange={(checked) => handleConsentChange("analytics", !!checked)}
                />
                <div className="space-y-1">
                  <Label htmlFor="analytics" className="text-sm font-medium cursor-pointer">
                    Analytics & Improvements
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Help us improve by allowing usage analytics
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Session Reminders</p>
                  <p className="text-xs text-muted-foreground">24 hours before</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Email Updates</p>
                  <p className="text-xs text-muted-foreground">Weekly digest</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Invoice Alerts</p>
                  <p className="text-xs text-muted-foreground">When due</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/50 bg-destructive/5 animate-fade-in" style={{ animationDelay: "0.25s" }}>
            <CardHeader>
              <CardTitle className="font-heading text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Permanently delete your account and all associated data. This action cannot be undone (GDPR Article 17 - Right to Erasure).
              </p>
              
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="w-full">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Delete Your Account?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                      <p>
                        This will permanently delete your account and all associated data, including:
                      </p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        <li>Your profile information</li>
                        <li>Session booking history</li>
                        <li>All consent records</li>
                      </ul>
                      <p className="font-medium text-destructive">
                        This action cannot be undone.
                      </p>
                      <div className="pt-4">
                        <Label htmlFor="deleteConfirm" className="text-foreground">
                          Type <span className="font-mono font-bold">DELETE MY ACCOUNT</span> to confirm:
                        </Label>
                        <Input
                          id="deleteConfirm"
                          value={deleteConfirmation}
                          onChange={(e) => setDeleteConfirmation(e.target.value)}
                          placeholder="DELETE MY ACCOUNT"
                          className="mt-2"
                        />
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setDeleteConfirmation("")}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirmation !== "DELETE MY ACCOUNT" || isDeleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting ? "Deleting..." : "Delete My Account"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}



