
CREATE OR REPLACE FUNCTION public.enroll_in_course(
  _user_id uuid,
  _course_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _course record;
  _already_enrolled boolean;
  _admin_id uuid;
  _txn_id uuid;
BEGIN
  -- 1. Validate course exists and is published
  SELECT id, title, is_free, price, status
  INTO _course
  FROM public.courses
  WHERE id = _course_id;

  IF _course IS NULL THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  IF _course.status != 'published' THEN
    RAISE EXCEPTION 'Course is not available';
  END IF;

  -- 2. Check not already enrolled
  SELECT EXISTS (
    SELECT 1 FROM public.course_enrollments
    WHERE user_id = _user_id AND course_id = _course_id
  ) INTO _already_enrolled;

  IF _already_enrolled THEN
    RAISE EXCEPTION 'Already enrolled in this course';
  END IF;

  -- 3. If paid course, handle wallet transactions
  IF NOT _course.is_free AND _course.price IS NOT NULL AND _course.price > 0 THEN
    -- Deduct from student wallet (will raise if insufficient balance)
    PERFORM wallet_transaction(
      _user_id,
      'course_purchase',
      -(_course.price),
      'Enrollment: ' || _course.title,
      _course_id,
      'course'
    );

    -- Credit admin/platform wallet
    SELECT ur.user_id INTO _admin_id
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at ASC
    LIMIT 1;

    IF _admin_id IS NOT NULL THEN
      PERFORM wallet_transaction(
        _admin_id,
        'course_revenue',
        _course.price,
        'Course sale: ' || _course.title,
        _course_id,
        'course'
      );
    END IF;
  END IF;

  -- 4. Create enrollment
  INSERT INTO public.course_enrollments (user_id, course_id)
  VALUES (_user_id, _course_id);

  -- 5. Assign student role (ignore if already exists)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'student')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 6. Process referral reward for paid courses
  IF _course.price IS NOT NULL AND _course.price > 0 THEN
    BEGIN
      PERFORM process_referral_reward(_user_id, 'course purchase', _course.price);
    EXCEPTION WHEN OTHERS THEN
      -- Referral failure should not block enrollment
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'course_title', _course.title,
    'amount_charged', CASE WHEN _course.is_free THEN 0 ELSE COALESCE(_course.price, 0) END
  );
END;
$$;
