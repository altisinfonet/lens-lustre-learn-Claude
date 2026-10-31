DROP POLICY IF EXISTS "Users can upload post images" ON storage.objects;

CREATE POLICY "Users can upload post images"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'post-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);