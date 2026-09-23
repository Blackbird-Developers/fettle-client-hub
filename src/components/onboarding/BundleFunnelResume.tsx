import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { readBundleFunnelIntent } from "@/lib/bundleFunnel";

// Pages that manage their own navigation during sign-in, or are the funnel itself.
const SKIP_PATHS = ["/get-started", "/packages", "/login", "/signup", "/reset-password"];

/**
 * Sends a client who arrived from a fettle.ie bundle link to /get-started as
 * soon as they're signed in — whether they logged in, verified their email
 * from the inbox link, or came back from Google. Only happens once: the
 * funnel page marks the intent active when it opens.
 */
export function BundleFunnelResume() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !user) return;
    if (SKIP_PATHS.includes(location.pathname)) return;
    // Never interrupt a payment redirect return.
    if (new URLSearchParams(location.search).has("payment_intent")) return;

    if (readBundleFunnelIntent()?.status === "pending-auth") {
      navigate("/get-started", { replace: true });
    }
  }, [user, loading, location.pathname, location.search, navigate]);

  return null;
}
