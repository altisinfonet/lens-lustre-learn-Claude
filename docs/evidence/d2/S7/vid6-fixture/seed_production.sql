INSERT INTO auth.users VALUES ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
INSERT INTO public.profiles (id) VALUES ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
INSERT INTO public.user_roles VALUES ('22222222-2222-2222-2222-222222222222','admin');
-- real-looking data: a 400 MB video, a 300 MB source, an open uptime alarm, one real video waiting 9 h
WITH v AS (INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES ('11111111-1111-1111-1111-111111111111','post',gen_random_uuid()) RETURNING id)
INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio, rendition_bytes, renditions)
SELECT id, 1, repeat('b',64), 400000000, 200, false, '{"240p":400000000}', ARRAY['240p'] FROM v;
INSERT INTO public.video_sources (owner_id, purpose, idempotency_key, source_bytes) VALUES ('11111111-1111-1111-1111-111111111111','post',gen_random_uuid(),300000000);
INSERT INTO public.ops_alarms (alarm_key, summary) VALUES ('uptime:https://www.50mmretina.com/', '[production] down');
DO $$ DECLARE v uuid; BEGIN
 INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES ('22222222-2222-2222-2222-222222222222','post',gen_random_uuid()) RETURNING id INTO v;
 INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio, rendition_bytes, renditions) VALUES (v,1,repeat('c',64),5000,5,false,'{"240p":5000}',ARRAY['240p']);
 UPDATE public.videos SET state='checking' WHERE id=v;
 INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, checked_at) VALUES (v,1,'x',1,'pending',now()-interval '9 hours');
END $$;
