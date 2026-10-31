-- U-2 fix: widen certificates.type CHECK to accept the per-round cert types
-- written by Certificates.tsx after the U-1 spec v3 §5 refactor.
-- Without this, every participant "Request Certificate" click 23514-fails.

ALTER TABLE public.certificates
  DROP CONSTRAINT IF EXISTS certificates_type_check;

ALTER TABLE public.certificates
  ADD CONSTRAINT certificates_type_check
  CHECK (type = ANY (ARRAY[
    'course_completion'::text,
    'competition_winner'::text,
    'winner'::text,
    'finalist'::text,
    'participation_r1'::text,
    'participation_r2'::text,
    'participation_r3'::text,
    'participation_r4'::text
  ]));