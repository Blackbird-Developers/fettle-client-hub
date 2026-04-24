-- Feedback from Help Center articles ("Was this article helpful?")
-- Supports both authenticated users (user_id) and anonymous voters (session_id)
CREATE TABLE public.help_article_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  article_slug TEXT NOT NULL,
  helpful BOOLEAN NOT NULL,
  comment TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.help_article_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone (anonymous or authenticated) can submit feedback
CREATE POLICY "Anyone can submit help feedback"
ON public.help_article_feedback
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Only admins can read feedback
CREATE POLICY "Admins can view all help feedback"
ON public.help_article_feedback
FOR SELECT
USING (public.has_role('admin'));

-- Indexes for analytics queries
CREATE INDEX idx_help_feedback_slug ON public.help_article_feedback(article_slug);
CREATE INDEX idx_help_feedback_created ON public.help_article_feedback(created_at DESC);
CREATE INDEX idx_help_feedback_helpful ON public.help_article_feedback(article_slug, helpful);
