import { useEffect, useState } from "react";
import { Star, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  submitTherapistReview,
  type TherapistReview,
} from "@/hooks/useTherapistReviews";

const RATING_LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

interface ReviewTherapistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string | number;
  therapistName: string;
  sessionLabel?: string;
  /** When present, the dialog is in edit mode and prefills from this review. */
  existingReview?: TherapistReview;
  /** Called after a successful submit so the parent can refetch reviews. */
  onSubmitted?: () => void;
}

export function ReviewTherapistDialog({
  open,
  onOpenChange,
  appointmentId,
  therapistName,
  sessionLabel,
  existingReview,
  onSubmitted,
}: ReviewTherapistDialogProps) {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [publicConsent, setPublicConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = !!existingReview;
  const firstName = therapistName?.split(" ")[0] || "your therapist";

  // Reset / prefill whenever the dialog opens (or the target review changes).
  useEffect(() => {
    if (open) {
      setRating(existingReview?.rating ?? 0);
      setComment(existingReview?.comment ?? "");
      setPublicConsent(existingReview?.public_consent ?? false);
      setHoverRating(0);
    }
  }, [open, existingReview]);

  const handleSubmit = async () => {
    if (rating < 1) {
      toast({
        title: "Please choose a rating",
        description: "Tap a star from 1 to 5 to rate your session.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      await submitTherapistReview({
        appointmentId,
        rating,
        comment: comment.trim() || null,
        publicConsent,
      });

      toast({
        title: isEditing ? "Review updated" : "Thanks for your review!",
        description: `Your feedback for ${firstName} has been saved.`,
      });
      onSubmitted?.();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't save review",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const activeRating = hoverRating || rating;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEditing ? "Edit your review" : `Review ${firstName}`}
          </DialogTitle>
          <DialogDescription>
            {sessionLabel
              ? `How was your session on ${sessionLabel}?`
              : `Share how your session with ${therapistName} went.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Star rating */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} star${value > 1 ? "s" : ""}`}
                  className="p-1 rounded-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onMouseEnter={() => setHoverRating(value)}
                  onMouseLeave={() => setHoverRating(0)}
                  onFocus={() => setHoverRating(value)}
                  onBlur={() => setHoverRating(0)}
                  onClick={() => setRating(value)}
                >
                  <Star
                    className={cn(
                      "h-8 w-8 transition-colors",
                      value <= activeRating
                        ? "fill-warning text-warning"
                        : "text-muted-foreground/40",
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-center text-sm font-medium text-muted-foreground h-5">
              {RATING_LABELS[activeRating] || "Tap to rate"}
            </p>
          </div>

          {/* Optional written feedback */}
          <div className="space-y-2">
            <Label htmlFor="review-comment">
              Comments <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="review-comment"
              placeholder={`What stood out about your session with ${firstName}?`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Public consent */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="review-consent"
              checked={publicConsent}
              onCheckedChange={(checked) => setPublicConsent(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="review-consent"
              className="text-sm font-normal text-muted-foreground leading-snug cursor-pointer"
            >
              Fettle can share this review publicly (e.g. on {firstName}'s profile).
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : isEditing ? (
              "Update review"
            ) : (
              "Submit review"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
