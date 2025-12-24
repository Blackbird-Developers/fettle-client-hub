-- Create table to track user package purchases
CREATE TABLE public.user_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  total_sessions INTEGER NOT NULL,
  remaining_sessions INTEGER NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL,
  stripe_session_id TEXT,
  purchased_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.user_packages ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own packages" 
ON public.user_packages 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own packages" 
ON public.user_packages 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own packages" 
ON public.user_packages 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_user_packages_updated_at
BEFORE UPDATE ON public.user_packages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_user_packages_user_id ON public.user_packages(user_id);
CREATE INDEX idx_user_packages_stripe_session ON public.user_packages(stripe_session_id);