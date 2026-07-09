
-- Create a security definer function to safely check album ownership
CREATE OR REPLACE FUNCTION public.owns_album(_album_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.photo_albums
    WHERE id = _album_id AND user_id = _user_id
  )
$$;

-- Drop existing INSERT policy and recreate with security definer function
DROP POLICY IF EXISTS "Users can add photos to own albums" ON public.album_photos;
CREATE POLICY "Users can add photos to own albums"
  ON public.album_photos FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_album(album_id, auth.uid()));

-- Also fix UPDATE and DELETE to use security definer
DROP POLICY IF EXISTS "Users can update own album photos" ON public.album_photos;
CREATE POLICY "Users can update own album photos"
  ON public.album_photos FOR UPDATE
  TO authenticated
  USING (public.owns_album(album_id, auth.uid()));

DROP POLICY IF EXISTS "Users can delete own album photos" ON public.album_photos;
CREATE POLICY "Users can delete own album photos"
  ON public.album_photos FOR DELETE
  TO authenticated
  USING (public.owns_album(album_id, auth.uid()));
