import { useState } from "react";
import { Link } from "react-router-dom";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeBundleFunnel, readBundleFunnelIntent } from "@/lib/bundleFunnel";

interface BundleFunnelNoticeProps {
  mode: "login" | "signup" | "verify";
}

/**
 * Context on the sign-in pages for a client who came from a fettle.ie bundle
 * link, so they know why they're being asked to sign in and what happens next.
 */
export function BundleFunnelNotice({ mode }: BundleFunnelNoticeProps) {
  const [intent] = useState(() => readBundleFunnelIntent());
  if (!intent) return null;

  const description = describeBundleFunnel(intent);

  return (
    <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <Gift className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            Your {description}
          </p>
          <p className="text-muted-foreground mt-0.5">
            {mode === "login"
              ? "Sign in to continue, or create a free account if you're new to Fettle."
              : mode === "signup"
              ? "Create your free account to continue. Already registered? Sign in instead."
              : "Once you verify your email, you'll be taken straight to your bundle."}
          </p>
        </div>
      </div>
      {mode === "login" && (
        <Button asChild size="sm" variant="outline" className="mt-3 w-full bg-background/80">
          <Link to="/signup">I'm new to Fettle — create an account</Link>
        </Button>
      )}
    </div>
  );
}
