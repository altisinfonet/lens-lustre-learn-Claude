-- Add thumbnail columns to competition_entries
ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS photo_thumbnails TEXT[];

-- Add thumbnail columns to posts
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_urls TEXT[];

-- Add thumbnail column to featured_photos
ALTER TABLE public.featured_photos
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add thumbnail column to photo_of_the_day
ALTER TABLE public.photo_of_the_day
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add thumbnail column to hero_banners
ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.competition_entries.photo_thumbnails IS '600px max-dimension WebP thumbnails, index-matched to photos[]';
COMMENT ON COLUMN public.posts.thumbnail_url IS '600px WebP thumbnail for primary image_url';
COMMENT ON COLUMN public.posts.thumbnail_urls IS '600px WebP thumbnails, index-matched to image_urls[]';
COMMENT ON COLUMN public.featured_photos.thumbnail_url IS '600px WebP thumbnail for image_url';
COMMENT ON COLUMN public.photo_of_the_day.thumbnail_url IS '600px WebP thumbnail for image_url';
COMMENT ON COLUMN public.hero_banners.thumbnail_url IS '600px WebP thumbnail for image_url';