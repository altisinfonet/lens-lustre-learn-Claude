ALTER TABLE courses
ADD COLUMN admin_students integer DEFAULT 0,
ADD COLUMN admin_rating numeric DEFAULT 0,
ADD COLUMN admin_rating_count integer DEFAULT 0,
ADD COLUMN reviews_enabled boolean DEFAULT false;