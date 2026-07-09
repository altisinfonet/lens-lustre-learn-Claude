ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS privacy_settings jsonb NOT NULL DEFAULT '{
  "avatar": "public",
  "bio": "public",
  "phone": "only_me",
  "whatsapp": "only_me",
  "email": "only_me",
  "city_country": "public",
  "social_links": "public",
  "portfolio": "public",
  "interests": "public"
}'::jsonb;