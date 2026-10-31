
-- Courses table
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  cover_image_url text,
  category text NOT NULL DEFAULT 'General',
  difficulty text NOT NULL DEFAULT 'Beginner',
  price numeric DEFAULT 0,
  is_free boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published courses"
  ON public.courses FOR SELECT
  USING (status = 'published' OR author_id = auth.uid());

CREATE POLICY "Admins can manage courses"
  ON public.courses FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Content editors can create courses"
  ON public.courses FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'content_editor') AND author_id = auth.uid());

CREATE POLICY "Content editors can update own courses"
  ON public.courses FOR UPDATE
  USING (public.has_role(auth.uid(), 'content_editor') AND author_id = auth.uid());

CREATE POLICY "Content editors can delete own courses"
  ON public.courses FOR DELETE
  USING (public.has_role(auth.uid(), 'content_editor') AND author_id = auth.uid());

-- Lessons table
CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  video_url text,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view lessons of published courses"
  ON public.lessons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.courses
      WHERE courses.id = lessons.course_id
      AND (courses.status = 'published' OR courses.author_id = auth.uid())
    )
  );

CREATE POLICY "Admins can manage lessons"
  ON public.lessons FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Content editors can manage own course lessons"
  ON public.lessons FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'content_editor')
    AND EXISTS (SELECT 1 FROM public.courses WHERE id = lessons.course_id AND author_id = auth.uid())
  );

CREATE POLICY "Content editors can update own course lessons"
  ON public.lessons FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'content_editor')
    AND EXISTS (SELECT 1 FROM public.courses WHERE id = lessons.course_id AND author_id = auth.uid())
  );

CREATE POLICY "Content editors can delete own course lessons"
  ON public.lessons FOR DELETE
  USING (
    public.has_role(auth.uid(), 'content_editor')
    AND EXISTS (SELECT 1 FROM public.courses WHERE id = lessons.course_id AND author_id = auth.uid())
  );

-- Course enrollments
CREATE TABLE public.course_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, course_id)
);

ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own enrollments"
  ON public.course_enrollments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can enroll themselves"
  ON public.course_enrollments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all enrollments"
  ON public.course_enrollments FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Lesson progress tracking
CREATE TABLE public.lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  UNIQUE(user_id, lesson_id)
);

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own progress"
  ON public.lesson_progress FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can track own progress"
  ON public.lesson_progress FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own progress"
  ON public.lesson_progress FOR UPDATE
  USING (user_id = auth.uid());

-- Storage bucket for course images
INSERT INTO storage.buckets (id, name, public) VALUES ('course-images', 'course-images', true);

CREATE POLICY "Anyone can view course images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'course-images');

CREATE POLICY "Editors can upload course images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'course-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_editor'))
  );
