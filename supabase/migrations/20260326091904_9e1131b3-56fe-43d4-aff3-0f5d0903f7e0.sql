
-- Table for judge entry locks (session locking)
CREATE TABLE public.judge_entry_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  photo_index integer NOT NULL DEFAULT 0,
  locked_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '5 minutes'),
  UNIQUE (entry_id, photo_index)
);

-- Enable RLS
ALTER TABLE public.judge_entry_locks ENABLE ROW LEVEL SECURITY;

-- Judges and admins can view all locks
CREATE POLICY "Judges can view locks"
  ON public.judge_entry_locks FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'judge'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Judges can create locks
CREATE POLICY "Judges can create locks"
  ON public.judge_entry_locks FOR INSERT
  TO authenticated
  WITH CHECK (judge_id = auth.uid() AND has_role(auth.uid(), 'judge'::app_role));

-- Judges can update own locks (heartbeat)
CREATE POLICY "Judges can update own locks"
  ON public.judge_entry_locks FOR UPDATE
  TO authenticated
  USING (judge_id = auth.uid());

-- Judges can delete own locks or expired locks
CREATE POLICY "Judges can release locks"
  ON public.judge_entry_locks FOR DELETE
  TO authenticated
  USING (judge_id = auth.uid() OR expires_at < now());

-- Admins can manage all locks
CREATE POLICY "Admins can manage locks"
  ON public.judge_entry_locks FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to acquire a lock (atomic: clear expired + insert)
CREATE OR REPLACE FUNCTION public.acquire_judge_lock(
  _entry_id uuid,
  _photo_index integer,
  _judge_id uuid,
  _ttl_minutes integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing record;
  _result jsonb;
BEGIN
  -- Clear expired locks for this entry+photo
  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND expires_at < now();

  -- Check if lock exists
  SELECT * INTO _existing FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index;

  IF _existing IS NOT NULL THEN
    IF _existing.judge_id = _judge_id THEN
      -- Extend own lock
      UPDATE judge_entry_locks
      SET expires_at = now() + (_ttl_minutes || ' minutes')::interval,
          locked_at = now()
      WHERE id = _existing.id;
      RETURN jsonb_build_object('acquired', true, 'lock_id', _existing.id);
    ELSE
      -- Locked by another judge
      RETURN jsonb_build_object(
        'acquired', false,
        'locked_by', _existing.judge_id,
        'expires_at', _existing.expires_at
      );
    END IF;
  END IF;

  -- No lock exists, create one
  INSERT INTO judge_entry_locks (entry_id, photo_index, judge_id, expires_at)
  VALUES (_entry_id, _photo_index, _judge_id, now() + (_ttl_minutes || ' minutes')::interval)
  RETURNING id INTO _existing;

  RETURN jsonb_build_object('acquired', true, 'lock_id', _existing.id);
END;
$$;

-- Function to release a lock
CREATE OR REPLACE FUNCTION public.release_judge_lock(
  _entry_id uuid,
  _photo_index integer,
  _judge_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$$;

-- Function to heartbeat (extend) a lock
CREATE OR REPLACE FUNCTION public.heartbeat_judge_lock(
  _entry_id uuid,
  _photo_index integer,
  _judge_id uuid,
  _ttl_minutes integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE judge_entry_locks
  SET expires_at = now() + (_ttl_minutes || ' minutes')::interval
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$$;
