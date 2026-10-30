-- FIXTURE · 20261102_0200 · public.feed_score_config as S12 (20261018_0002/0003)
-- creates it, with the live mix rows — read only by the PROBE's promise line.
CREATE TABLE public.feed_score_config (
  key   text PRIMARY KEY,
  value numeric NOT NULL,
  note  text
);
INSERT INTO public.feed_score_config (key, value, note) VALUES
  ('mix_circle', 6, 'fixture'), ('mix_suggested', 2, 'fixture'), ('mix_fair', 2, 'fixture');
