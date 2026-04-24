import { useState, useEffect } from "react";
import { ThumbsUp, ThumbsDown, CheckCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ArticleFeedbackProps {
  articleSlug: string;
}

function getOrCreateSessionId(): string {
  const key = "help_feedback_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export function ArticleFeedback({ articleSlug }: ArticleFeedbackProps) {
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    setHelpful(null);
    setComment("");
    setSubmitted(false);
    const voted = localStorage.getItem(`help_voted_${articleSlug}`);
    setAlreadyVoted(voted === "1");
  }, [articleSlug]);

  const submit = async (isHelpful: boolean, commentText: string | null) => {
    setSubmitting(true);
    try {
      const sessionId = user ? null : getOrCreateSessionId();
      const { error } = await supabase.from("help_article_feedback").insert({
        article_slug: articleSlug,
        helpful: isHelpful,
        comment: commentText,
        user_id: user?.id ?? null,
        session_id: sessionId,
      });
      if (error) throw error;
      localStorage.setItem(`help_voted_${articleSlug}`, "1");
      setSubmitted(true);
    } catch {
      toast({
        title: "Could not submit feedback",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
      setHelpful(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (isHelpful: boolean) => {
    if (submitting) return;
    setHelpful(isHelpful);
    if (isHelpful) {
      await submit(true, null);
    }
  };

  if (alreadyVoted || submitted) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-success shrink-0" />
          <p className="text-sm text-muted-foreground">
            Thanks for your feedback — it helps us improve these articles.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardContent className="p-6">
        <p className="font-medium text-foreground mb-3">
          Was this article helpful?
        </p>
        <div className="flex gap-2">
          <Button
            variant={helpful === true ? "default" : "outline"}
            size="sm"
            onClick={() => handleVote(true)}
            disabled={submitting}
          >
            <ThumbsUp className="h-4 w-4 mr-2" /> Yes
          </Button>
          <Button
            variant={helpful === false ? "default" : "outline"}
            size="sm"
            onClick={() => handleVote(false)}
            disabled={submitting}
          >
            <ThumbsDown className="h-4 w-4 mr-2" /> No
          </Button>
        </div>
        {helpful === false && !submitted && (
          <div className="mt-4 space-y-3 animate-fade-in">
            <Textarea
              placeholder="What were you looking for? (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
            <Button
              onClick={() => submit(false, comment.trim() || null)}
              disabled={submitting}
              size="sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit feedback"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
