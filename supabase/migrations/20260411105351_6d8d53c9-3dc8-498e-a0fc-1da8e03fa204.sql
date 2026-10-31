
-- 1. Create site-assets bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-assets', 'site-assets', true)
ON CONFLICT (id) DO NOTHING;

-- 2. site-assets: public read
CREATE POLICY "site-assets: public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'site-assets');

-- 3. site-assets: admin insert
CREATE POLICY "site-assets: admin insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'site-assets'
  AND public.has_role(auth.uid(), 'admin')
);

-- 4. site-assets: admin update
CREATE POLICY "site-assets: admin update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'site-assets'
  AND public.has_role(auth.uid(), 'admin')
);

-- 5. site-assets: admin delete
CREATE POLICY "site-assets: admin delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'site-assets'
  AND public.has_role(auth.uid(), 'admin')
);

-- 6. email-assets: admin insert
CREATE POLICY "email-assets: admin insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'email-assets'
  AND public.has_role(auth.uid(), 'admin')
);

-- 7. email-assets: admin delete
CREATE POLICY "email-assets: admin delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'email-assets'
  AND public.has_role(auth.uid(), 'admin')
);

-- 8. portfolio-images: admin update (for upsert/replace)
CREATE POLICY "portfolio-images: admin update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'portfolio-images'
  AND public.has_role(auth.uid(), 'admin')
);

-- 9. competition-photos: admin update
CREATE POLICY "competition-photos: admin update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'competition-photos'
  AND public.has_role(auth.uid(), 'admin')
);

-- 10. journal-images: admin/editor update
CREATE POLICY "journal-images: admin or editor update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'journal-images'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'content_editor')
  )
);

-- 11. course-images: admin/editor update
CREATE POLICY "course-images: admin or editor update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'course-images'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'content_editor')
  )
);

-- 12. post-images: owner update
CREATE POLICY "post-images: owner update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'post-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
