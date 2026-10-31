
CREATE OR REPLACE FUNCTION public.approve_deposit(
  _admin_id uuid,
  _txn_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _txn record;
  _platform_admin_id uuid;
BEGIN
  -- Verify caller is admin
  IF NOT has_role(_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can approve deposits';
  END IF;

  -- Get pending transaction
  SELECT id, user_id, amount, description, metadata, status
  INTO _txn
  FROM public.wallet_transactions
  WHERE id = _txn_id;

  IF _txn IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF _txn.status != 'pending' THEN
    RAISE EXCEPTION 'Transaction is not pending';
  END IF;

  -- Credit user wallet
  PERFORM wallet_transaction(
    _txn.user_id,
    'deposit',
    _txn.amount,
    'Approved: ' || COALESCE(_txn.description, 'Manual deposit'),
    _txn_id,
    'deposit',
    _txn.metadata
  );

  -- Credit platform admin wallet
  SELECT ur.user_id INTO _platform_admin_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.created_at ASC
  LIMIT 1;

  IF _platform_admin_id IS NOT NULL THEN
    PERFORM wallet_transaction(
      _platform_admin_id,
      'platform_revenue',
      _txn.amount,
      'Platform deposit revenue: $' || _txn.amount::text || ' from user deposit',
      _txn_id,
      'deposit'
    );
  END IF;

  -- Mark original pending txn as approved
  UPDATE public.wallet_transactions
  SET status = 'approved'
  WHERE id = _txn_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', _txn.user_id,
    'amount', _txn.amount
  );
END;
$$;

-- Also update enroll_in_course to remove admin credit (admin already has money from deposit)
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

  -- 3. If paid course, deduct from student wallet only (admin already has money from deposit)
  IF NOT _course.is_free AND _course.price IS NOT NULL AND _course.price > 0 THEN
    PERFORM wallet_transaction(
      _user_id,
      'course_purchase',
      -(_course.price),
      'Enrollment: ' || _course.title,
      _course_id,
      'course'
    );
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
