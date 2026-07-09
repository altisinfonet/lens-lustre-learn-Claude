
-- STEP 1 — CREATE TABLE
CREATE TABLE IF NOT EXISTS course_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order int DEFAULT 0,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_modules_course_id ON course_modules(course_id);

-- STEP 2 — ADD COLUMN TO LESSONS
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS module_id uuid REFERENCES course_modules(id) ON DELETE SET NULL;

-- STEP 3 — ENABLE RLS
ALTER TABLE course_modules ENABLE ROW LEVEL SECURITY;

-- STEP 4 — RLS POLICIES
DROP POLICY IF EXISTS "Public can view modules" ON course_modules;
CREATE POLICY "Public can view modules" ON course_modules FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage modules" ON course_modules;
CREATE POLICY "Admins manage modules" ON course_modules FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- STEP 5 — SAFE MIGRATION
INSERT INTO course_modules (course_id, title, sort_order)
SELECT c.id, 'General', 0 FROM courses c
WHERE NOT EXISTS (SELECT 1 FROM course_modules cm WHERE cm.course_id = c.id);

UPDATE lessons l SET module_id = cm.id
FROM course_modules cm
WHERE l.course_id = cm.course_id AND l.module_id IS NULL;
