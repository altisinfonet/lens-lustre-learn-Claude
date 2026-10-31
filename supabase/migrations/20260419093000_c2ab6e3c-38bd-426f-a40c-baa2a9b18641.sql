-- B9 / FIX-5: Append-only RAW commitment ledger for non-repudiation.
-- Records every time a participant commits to deliver RAW for a photo,
-- and tracks eventual delivery + admin verification. Immutable history
-- powers Phase-4 admin shortlist gate.

CREATE TABLE public.raw_commitments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  competition_id  uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  photo_index     integer NOT NULL CHECK (photo_index >= 0),
  raw_required    boolean NOT NULL,
  source          text NOT NULL CHECK (source IN ('submit','admin_request','delivery','revoked')),
  committed_at    timestamptz NOT NULL DEFAULT now(),
  raw_delivered_at timestamptz,
  raw_file_url    text,
  admin_verified_by uuid,
  admin_verified_at timestamptz,
  notes           text
);

CREATE INDEX idx_raw_commitments_entry_photo ON public.raw_commitments(entry_id, photo_index);
CREATE INDEX idx_raw_commitments_user        ON public.raw_commitments(user_id);
CREATE INDEX idx_raw_commitments_competition ON public.raw_commitments(competition_id);

ALTER TABLE public.raw_commitments ENABLE ROW LEVEL SECURITY;

-- Owner can read their own commitments
CREATE POLICY "Owners can view their raw commitments"
ON public.raw_commitments FOR SELECT
USING (auth.uid() = user_id);

-- Admins can view all
CREATE POLICY "Admins can view all raw commitments"
ON public.raw_commitments FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Assigned judges can view commitments for entries in their competitions
CREATE POLICY "Judges can view commitments for their competitions"
ON public.raw_commitments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.competition_judges cj
    WHERE cj.competition_id = raw_commitments.competition_id
      AND cj.judge_id = auth.uid()
  )
);

-- INSERT only via SECURITY DEFINER trigger (no direct client insert).
-- Append-only: no UPDATE / DELETE policies → blocked by default RLS.

-- Trigger: append a row whenever photo_meta[i].raw_required is set/changed.
CREATE OR REPLACE FUNCTION public.log_raw_commitments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _meta_len integer := COALESCE(jsonb_array_length(NEW.photo_meta), 0);
  _i integer;
  _new_raw boolean;
  _old_raw boolean;
  _src text;
BEGIN
  IF _meta_len = 0 THEN RETURN NEW; END IF;

  FOR _i IN 0.._meta_len - 1 LOOP
    _new_raw := COALESCE((NEW.photo_meta -> _i ->> 'raw_required')::boolean, false);

    IF TG_OP = 'INSERT' THEN
      _old_raw := false;
      _src := 'submit';
    ELSE
      _old_raw := COALESCE((OLD.photo_meta -> _i ->> 'raw_required')::boolean, false);
      _src := CASE
        WHEN _new_raw AND NOT _old_raw THEN 'admin_request'
        WHEN NOT _new_raw AND _old_raw THEN 'revoked'
        ELSE NULL
      END;
    END IF;

    -- Only log on transition (or first submit when true)
    IF _src IS NOT NULL AND (TG_OP = 'INSERT' AND _new_raw OR _new_raw <> _old_raw) THEN
      INSERT INTO public.raw_commitments (
        entry_id, competition_id, user_id, photo_index, raw_required, source
      ) VALUES (
        NEW.id, NEW.competition_id, NEW.user_id, _i, _new_raw, _src
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_raw_commitments
AFTER INSERT OR UPDATE OF photo_meta ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.log_raw_commitments();