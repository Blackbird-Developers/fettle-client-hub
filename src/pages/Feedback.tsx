import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Loader2, Star } from "lucide-react";
import { useSendFeedback } from "@/hooks/useHubFeedback";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  type FeedbackCategory,
  feedbackSourcePage,
} from "@/lib/hubFeedback";

const RATING_WORDS = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"];

export default function Feedback() {
  const location = useLocation();
  // Captured once, so it stays the page they came from.
  const [page] = useState(() => feedbackSourcePage(location.state));
  const sendFeedback = useSendFeedback();

  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = "Feedback | Fettle";
    return () => {
      document.title = "Fettle";
    };
  }, []);

  const categoryMissing = category === "";
  const messageMissing = message.trim().length === 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (categoryMissing || messageMissing) {
      setShowErrors(true);
      return;
    }
    sendFeedback.mutate(
      { category, message, rating, page },
      {
        onSuccess: () => {
          setSent(true);
          setCategory("");
          setRating(null);
          setMessage("");
          setShowErrors(false);
        },
      }
    );
  };

  return (
    <DashboardLayout>
      <div className="mb-8 animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">Feedback</h1>
        <p className="text-muted-foreground mt-1">
          Tell us what's working and what isn't. Our team reads every message.
        </p>
      </div>

      <Card className="max-w-2xl border-border/50 animate-fade-in">
        {sent ? (
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center" role="status">
            <CheckCircle2 className="h-10 w-10 text-success" aria-hidden="true" />
            <h2 className="font-heading text-xl font-semibold">Thanks, we got your feedback</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              We'll use it to improve My Fettle Hub. If you need help with something specific,
              please contact us directly so we can get back to you.
            </p>
            <Button variant="outline" className="mt-2" onClick={() => setSent(false)}>
              Send more feedback
            </Button>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <CardHeader>
              <CardTitle className="text-lg font-heading">Send us feedback</CardTitle>
              <CardDescription>
                This isn't monitored for urgent issues. If you're in crisis, call 112 or 999, or
                Samaritans on 116 123.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  What's it about? <span className="text-destructive">*</span>
                </legend>
                <RadioGroup
                  value={category}
                  onValueChange={(value) => setCategory(value as FeedbackCategory)}
                  className="grid gap-2 sm:grid-cols-2"
                  aria-invalid={showErrors && categoryMissing}
                  aria-describedby={showErrors && categoryMissing ? "category-error" : undefined}
                >
                  {FEEDBACK_CATEGORIES.map((option) => (
                    <Label
                      key={option.id}
                      htmlFor={`category-${option.id}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-muted/50",
                        category === option.id && "border-primary bg-primary/5"
                      )}
                    >
                      <RadioGroupItem id={`category-${option.id}`} value={option.id} />
                      {option.label}
                    </Label>
                  ))}
                </RadioGroup>
                {showErrors && categoryMissing && (
                  <p id="category-error" className="text-sm text-destructive">
                    Choose what your feedback is about.
                  </p>
                )}
              </fieldset>

              <RatingInput value={rating} onChange={setRating} />

              <div className="space-y-2">
                <Label htmlFor="feedback-message">
                  Your message <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                  rows={6}
                  placeholder="What did you like, or what could be better?"
                  aria-invalid={showErrors && messageMissing}
                  aria-describedby={showErrors && messageMissing ? "message-error" : "message-count"}
                />
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  {showErrors && messageMissing ? (
                    <p id="message-error" className="text-sm text-destructive">
                      Write a message before sending.
                    </p>
                  ) : (
                    <span />
                  )}
                  <span id="message-count">
                    {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
                  </span>
                </div>
              </div>

              {sendFeedback.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Your feedback couldn't be sent. Please try again in a moment.
                  </AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={sendFeedback.isPending}>
                {sendFeedback.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {sendFeedback.isPending ? "Sending…" : "Send feedback"}
              </Button>
            </CardContent>
          </form>
        )}
      </Card>
    </DashboardLayout>
  );
}

/** Optional 1–5 star rating. Clicking the selected star again clears it. */
function RatingInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        How would you rate it? <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = value !== null && n <= value;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(value === n ? null : n)}
              aria-pressed={value === n}
              aria-label={`${n} out of 5 – ${RATING_WORDS[n]}`}
              className="rounded-md p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={cn(
                  "h-7 w-7",
                  filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
        <span className="ml-2 text-sm text-muted-foreground" aria-live="polite">
          {value ? RATING_WORDS[value] : ""}
        </span>
        {value !== null && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>
    </fieldset>
  );
}
