import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, MailX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { decodeEmailParam } from "../../supabase/functions/_shared/unsubscribe.ts";

type State = "idle" | "saving" | "done" | "error";

// Landing page for the Unsubscribe link in marketing emails (the portal-
// adoption emails today). Nothing happens until the person clicks the button,
// because link scanners in inboxes open every link in an email.
export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const e = searchParams.get("e");
  const t = searchParams.get("t");
  const email = e ? decodeEmailParam(e) : null;
  const [state, setState] = useState<State>("idle");

  const unsubscribe = async () => {
    setState("saving");
    const { data, error } = await supabase.functions.invoke("email-unsubscribe", { body: { e, t } });
    setState(error || !data?.ok ? "error" : "done");
  };

  const linkBroken = !email || !t;

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
          {state === "done" ? (
            <CardContent className="pt-8 pb-8 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mb-4">
                <CheckCircle className="h-6 w-6 text-success" />
              </div>
              <h2 className="font-heading text-xl font-semibold mb-2">You're unsubscribed</h2>
              <p className="text-muted-foreground text-sm">
                We won't send <strong>{email}</strong> any more of these emails. You'll still get
                messages about your bookings and payments.
              </p>
            </CardContent>
          ) : (
            <>
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
                  <MailX className="h-6 w-6 text-muted-foreground" />
                </div>
                <CardTitle className="font-heading text-2xl">Unsubscribe</CardTitle>
                <CardDescription>
                  {linkBroken ? (
                    "This unsubscribe link isn't complete. Please use the link from the email again."
                  ) : (
                    <>
                      Stop sending emails about My Fettle to <strong>{email}</strong>?
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!linkBroken && (
                  <Button
                    className="w-full shadow-soft"
                    onClick={unsubscribe}
                    disabled={state === "saving"}
                  >
                    {state === "saving" ? "Unsubscribing..." : "Unsubscribe"}
                  </Button>
                )}
                {state === "error" && (
                  <p className="text-sm text-destructive text-center" role="alert">
                    We couldn't unsubscribe you. Please try again, or email{" "}
                    <a href="mailto:hello@fettle.ie" className="underline">hello@fettle.ie</a>.
                  </p>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
