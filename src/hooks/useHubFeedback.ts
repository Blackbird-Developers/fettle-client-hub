import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { FeedbackCategory } from "@/lib/hubFeedback";

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  rating: number | null;
  page: string | null;
}

// Sends feedback from the client's Feedback page. RLS only lets a client
// insert rows as themselves; sender name/email and status are set by the
// database. No .select() afterwards: clients can't read feedback back.
export function useSendFeedback() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: FeedbackInput) => {
      if (!user) throw new Error("Please log in to send feedback.");
      const { error } = await supabase.from("hub_feedback").insert({
        user_id: user.id,
        category: input.category,
        message: input.message.trim(),
        rating: input.rating,
        page: input.page,
      });
      if (error) throw error;
    },
  });
}
