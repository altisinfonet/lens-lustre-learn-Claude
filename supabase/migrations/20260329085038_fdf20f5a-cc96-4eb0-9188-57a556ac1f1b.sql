ALTER TABLE public.certificates
ADD CONSTRAINT unique_user_course_certificate
UNIQUE (user_id, reference_id, type);