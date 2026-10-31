
-- Drop policies that reference app_role enum on user_roles
DROP POLICY IF EXISTS "Anyone can view admin and judge roles" ON public.user_roles;
DROP POLICY IF EXISTS "Anyone can view registered_photographer roles" ON public.user_roles;
DROP POLICY IF EXISTS "Anyone can view student roles" ON public.user_roles;

-- Now alter column type
ALTER TABLE public.user_roles ALTER COLUMN role TYPE text USING role::text;

-- Recreate policies using text comparisons
CREATE POLICY "Anyone can view admin and judge roles" ON public.user_roles
  FOR SELECT TO public
  USING (role IN ('admin', 'judge'));

CREATE POLICY "Anyone can view registered_photographer roles" ON public.user_roles
  FOR SELECT TO public
  USING (role = 'registered_photographer');

CREATE POLICY "Anyone can view student roles" ON public.user_roles
  FOR SELECT TO public
  USING (role = 'student');

-- Add a broader policy so any custom role assigned to a user is visible publicly
CREATE POLICY "Anyone can view all assigned roles" ON public.user_roles
  FOR SELECT TO public
  USING (true);

-- Update has_role to accept text
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Keep enum overload for existing RLS policies on other tables
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role::text
  )
$$;
