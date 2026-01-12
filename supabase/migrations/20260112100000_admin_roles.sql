-- Create user_roles table for admin access control
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id, role)
);

-- Enable Row Level Security
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Only admins can view roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Only admins can insert new roles
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Only admins can delete roles (but not their own admin role)
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  AND NOT (user_id = auth.uid() AND role = 'admin')
);

-- Create index for faster lookups
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role ON public.user_roles(role);

-- Create secure function to check if user has a role
CREATE OR REPLACE FUNCTION public.has_role(check_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = check_role
  );
END;
$$;

-- Create function to get user roles
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE(role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ur.role FROM public.user_roles ur
  WHERE ur.user_id = auth.uid();
END;
$$;

-- Create admin stats view for dashboard metrics
-- This view aggregates data for admin dashboard
CREATE OR REPLACE VIEW public.admin_client_stats AS
SELECT
  p.id as user_id,
  p.email,
  p.first_name,
  p.last_name,
  p.created_at as joined_at,
  COALESCE(pkg.total_sessions_purchased, 0) as total_sessions_purchased,
  COALESCE(pkg.total_sessions_remaining, 0) as total_sessions_remaining,
  COALESCE(pkg.total_spent, 0) as total_spent,
  COALESCE(pkg.package_count, 0) as package_count
FROM public.profiles p
LEFT JOIN (
  SELECT
    user_id,
    SUM(total_sessions) as total_sessions_purchased,
    SUM(remaining_sessions) as total_sessions_remaining,
    SUM(amount_paid) as total_spent,
    COUNT(*) as package_count
  FROM public.user_packages
  GROUP BY user_id
) pkg ON pkg.user_id = p.id;

-- Grant access to the view for authenticated users (RLS will handle the rest)
GRANT SELECT ON public.admin_client_stats TO authenticated;

-- Create RLS policy for admin stats view
ALTER VIEW public.admin_client_stats SET (security_invoker = true);

-- Insert initial admin user (art@blackbird.marketing)
-- This will be executed when the user signs up
CREATE OR REPLACE FUNCTION public.auto_assign_admin_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if this is the designated admin email
  IF NEW.email = 'art@blackbird.marketing' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger to auto-assign admin role on profile creation
DROP TRIGGER IF EXISTS on_profile_created_assign_admin ON public.profiles;
CREATE TRIGGER on_profile_created_assign_admin
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_admin_role();

-- Also check existing profiles and assign admin role if needed
DO $$
DECLARE
  admin_user_id UUID;
BEGIN
  SELECT id INTO admin_user_id FROM public.profiles WHERE email = 'art@blackbird.marketing';
  IF admin_user_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (admin_user_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;
