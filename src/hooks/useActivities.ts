import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Json } from "@/integrations/supabase/types";

export type ActivityType = 
  | "session_booked" 
  | "session_completed" 
  | "session_cancelled" 
  | "profile_updated";

export interface Activity {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  title: string;
  description: string | null;
  metadata: Json;
  created_at: string;
}

export function useActivities(limit = 5) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["activities", user?.id, limit],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_activities")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as Activity[];
    },
    enabled: !!user,
  });
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      activity_type,
      title,
      description,
      metadata = {},
    }: {
      activity_type: ActivityType;
      title: string;
      description?: string;
      metadata?: Json;
    }) => {
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("user_activities")
        .insert([{
          user_id: user.id,
          activity_type,
          title,
          description,
          metadata,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}
