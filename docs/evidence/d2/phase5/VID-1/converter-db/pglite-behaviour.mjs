// Behaviour test for 20261012_0002 (converter job queue) on PGlite (Postgres 16, in memory).
// Real objects from the migrations; only platform pieces (auth, cron, roles, flags, attestation) are stubbed.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const DIR = "D:/50mm Retina World/work/D1/supabase/migrations/";
const M = (f) => readFileSync(DIR + f, "utf8").replace(/\r\n/g, "\n");
const sect = (txt, a, b) => { const i = txt.indexOf(a); const j = txt.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error("section not found: " + a.slice(0, 50)); return txt.slice(i, j); };
const m5 = M("20261005_0005_vid2_videos.sql");
const tables5 = sect(m5, "CREATE TABLE public.music_library_tracks", "-- ── 5. RPCs");
const fns5 = sect(m5, "CREATE FUNCTION public.video_validate_version", "-- The owner (or an admin) deletes a video");
const m1 = M("20261012_0001_vid1_no_duration_cap.sql");
const validate1 = sect(m1, "CREATE OR REPLACE FUNCTION public.video_validate_version", "DO $post$");
const m7 = M("20261005_0007_vid2_upload_attest.sql");
const mark7 = sect(m7, "CREATE FUNCTION public.video_mark_uploaded", "-- ── 4. SEC-VID-4");
const conv = M(process.argv[2] ?? "20261012_0002_vid1_converter_sources.sql");

const U = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`.slice(0, 36);
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222",
      ADM = "33333333-3333-4333-8333-333333333333", CONV = "44444444-4444-4444-8444-444444444444",
      BAN = "55555555-5555-4555-8555-555555555555", OFF = "66666666-6666-4666-8666-666666666666";
const db = new PGlite();
await db.exec(`
CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES ($1, $2, $3) RETURNING jobid::bigint $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_banned(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = $1) $$;
CREATE TABLE public.feature_off (feature text NOT NULL, user_id uuid);
CREATE FUNCTION public.feature_allowed(_feature text, _uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.feature_off WHERE feature = _feature AND (user_id = _uid OR user_id IS NULL)) $$;
CREATE FUNCTION public.feature_allowed_me(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.feature_allowed($1, (SELECT auth.uid())) $$;
CREATE FUNCTION public.account_is_live() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.posts (id uuid PRIMARY KEY, user_id uuid, categories text[]);
CREATE TABLE public.ad_creatives (id uuid PRIMARY KEY);
CREATE TABLE public.site_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
CREATE FUNCTION public.video_attest_verify(_video_id uuid, _version_no integer, _audio_sha256 text, _issued_at bigint, _attest text)
  RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$ BEGIN IF _attest IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'VID-MU-005: bad attestation'; END IF; END $$;
INSERT INTO public.feature_off VALUES ('copyright_music_check', NULL), ('video_posts', '${OFF}');
INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${ADM}'), ('${CONV}'), ('${BAN}'), ('${OFF}');
INSERT INTO public.profiles SELECT id FROM auth.users;
INSERT INTO public.user_roles VALUES ('${ADM}', 'admin');
INSERT INTO public.banned VALUES ('${BAN}');
`);
await db.exec(tables5);
await db.exec(fns5);
await db.exec(sect(m5, "CREATE FUNCTION public.video_delete", "-- Hourly:")); // the real 0005 delete
await db.exec("REVOKE ALL ON FUNCTION public.video_delete(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.video_delete(uuid) TO authenticated;");
await db.exec(validate1);
await db.exec("DROP FUNCTION IF EXISTS public.video_mark_uploaded(uuid, integer, text, bigint, text);");
await db.exec(mark7);
await db.exec(`REVOKE ALL ON FUNCTION public.video_begin_upload(text, text, bigint, numeric, boolean, uuid, jsonb) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.video_begin_upload(text, text, bigint, numeric, boolean, uuid, jsonb) TO authenticated; REVOKE ALL ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) TO authenticated; REVOKE ALL ON FUNCTION public.video_validate_version(text, text, bigint, numeric, boolean, jsonb) FROM PUBLIC, anon, authenticated;`); // 0005/0007 grants
await db.exec("SET p32.lane = 'staging';");
let migErr = null;
try { await db.exec(conv); } catch (e) { migErr = e.message; }

let pass = 0, fail = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); c ? pass++ : fail++; };
ok(!migErr, "0 the migration applies on top of 0005/0001/0007 " + (migErr ?? ""));
if (migErr) { console.log(`\n${pass} pass, ${fail} fail`); process.exit(1); }

async function as(uid, sql, params = []) {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
}
const su = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await su(sql, params))[0];
const errIs = (r, code) => !!r.error && r.error.includes(code);
const SHA = (c) => c.repeat(64);
const REND = { "240p": 20000000, "audio": 1000000, "other": 100000 };
const TOTAL = 21100000;
const k = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const begin = (uid, key, purpose = "post", bytes = 100000000) => as(uid, "select public.video_source_begin($1,$2,$3) r", [purpose, bytes, key]);
const uploaded = (uid, sid, etag = "abc123etag") => as(uid, "select public.video_source_uploaded($1,$2) r", [sid, etag]);
const claim = async () => { const r = await as(CONV, "select public.video_source_claim() r"); return { ...r, c: r.rows?.[0]?.r }; };
const bv = (sid, tok, sha = SHA("a")) => as(CONV, "select public.video_converter_begin_version($1,$2,$3,$4,$5,$6,$7) r", [sid, tok, sha, TOTAL, 448, true, JSON.stringify(REND)]);
const mark = (uid, vid) => as(uid, "select public.video_mark_uploaded($1,1,$2,$3,'ok') r", [vid, SHA("b"), Math.floor(Date.now() / 1000)]);
const failJ = (sid, tok, code, detail = null) => as(CONV, "select public.video_source_fail($1,$2,$3,$4) r", [sid, tok, code, detail]);
const done = (sid, tok) => as(CONV, "select public.video_source_done($1,$2) r", [sid, tok]);
const status = async (sid) => one("select status, video_id, attempts, error from public.video_sources where id=$1", [sid]);
const dayCount = async (uid) => Number((await one("select public.video_day_count($1) n", [uid])).n);
const openCount = async (uid) => Number((await one("select public.video_open_count($1,'post') n", [uid])).n);
const resetMember = async (uid) => { // a fresh day for a member (test helper)
  await db.exec(`ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch;
    UPDATE public.video_sources SET created_at = now() - interval '2 days', status = CASE WHEN status IN ('awaiting_upload','queued','converting') THEN 'cancelled' ELSE status END,
      claim_token = NULL, lease_until = NULL WHERE owner_id = '${uid}';
    ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;
    ALTER TABLE public.videos DISABLE TRIGGER tg_videos_state_guard;
    UPDATE public.videos SET created_at = now() - interval '2 days' WHERE owner_id = '${uid}';
    ALTER TABLE public.videos ENABLE TRIGGER tg_videos_state_guard;`);
};
/** begin + upload + claim, for one member: returns { sid, tok } */
const job = async (uid, key) => {
  const r = await begin(uid, key); const sid = r.rows?.[0]?.r?.source_id;
  if (!sid) throw new Error("begin failed: " + r.error);
  await uploaded(uid, sid);
  const c = await claim();
  if (c.c?.source_id !== sid) throw new Error("claim got " + JSON.stringify(c.c ?? c.error));
  return { sid, tok: c.c.claim_token };
};

// ── converter identity
ok(errIs(await claim(), "VID-CONV-001"), "1 no converter account yet → every converter function refuses");
await su(`INSERT INTO public.video_converter_accounts (user_id, note) VALUES ('${CONV}', 'test converter')`);

// ── server mode enforced in the database [R7]
ok(errIs(await begin(A, k(1)), "VID-SRC-001"), "2 site setting 'device' → video_source_begin refuses");
await su(`UPDATE public.site_settings SET value = '"server"' WHERE key = 'video_conversion'`);

// ── begin, replay, who may
let r = await begin(A, k(1)); const s1 = r.rows?.[0]?.r?.source_id;
ok(!!s1 && r.rows[0].r.status === "awaiting_upload", "3 a member starts a server conversion " + (r.error ?? ""));
r = await begin(A, k(1));
ok(r.rows?.[0]?.r?.source_id === s1 && r.rows[0].r.replayed === true, "4 same idempotency key → same job (replayed)");
ok(errIs(await begin(OFF, k(2)), "VID-UP-003"), "5 video posts off for the member → refused");
ok(errIs(await begin(BAN, k(3)), "VID-UP-003"), "6 banned member → refused");
ok(errIs(await begin(CONV, k(4)), "VID-SRC-002"), "7 the converter account cannot start a source");
r = await as(CONV, "select public.video_begin_upload('post',$1,$2,448,true,$3,$4) r", [SHA("c"), TOTAL, k(5), JSON.stringify(REND)]);
ok(errIs(r, "VID-SRC-002"), "8 … nor use the device path (review #416 finding 4)");
ok(errIs(await begin(A, k(6), "ad"), "VID-UP-003"), "9 a non-admin cannot start an ad conversion");
ok(errIs(await begin(A, k(7), "post", 524288001), "VID-LIM-002"), "10 500 MB + 1 byte → refused");

// ── 2 open sources; caps shared with the device path
r = await begin(A, k(8)); const s2 = r.rows?.[0]?.r?.source_id;
ok(!!s2, "11 a second open source is allowed " + (r.error ?? ""));
ok(errIs(await begin(A, k(9)), "VID-SRC-003"), "12 a third open source → refused");
r = await as(A, "select public.video_begin_upload('post',$1,$2,448,true,$3,$4) r", [SHA("c"), TOTAL, k(10), JSON.stringify(REND)]);
const deviceVideo = r.rows?.[0]?.r?.video_id;
ok(!!deviceVideo, "13 a device upload still fits (2 sources + 1 video = 3) " + (r.error ?? ""));
r = await as(A, "select public.video_begin_upload('post',$1,$2,448,true,$3,$4) r", [SHA("d"), TOTAL, k(11), JSON.stringify(REND)]);
ok(errIs(r, "VID-LIM-004"), "14 a 4th upload of any kind → VID-LIM-004");

// ── uploaded → queued; privacy of the row
ok(errIs(await uploaded(B, s1), "VID-SRC-004"), "15 another member cannot queue someone else's source");
ok(errIs(await uploaded(A, s1, 'bad etag"'), "VID-SRC-005"), "16 a malformed ETag is refused");
r = await uploaded(A, s1);
ok(r.rows?.[0]?.r?.status === "queued", "17 the owner queues it " + (r.error ?? ""));
ok(/permission denied/.test((await as(A, "select claim_token from public.video_sources")).error ?? ""), "18 the owner cannot read the claim token");
ok(/permission denied/.test((await as(A, "select claimed_at from public.video_sources")).error ?? ""), "19 … nor when it was claimed");
ok((await as(A, "select id from public.video_sources")).rows?.length === 2, "20 the owner reads their own jobs");
ok((await as(B, "select id from public.video_sources")).rows?.length === 0, "21 another member reads none of them");
ok(errIs(await as(A, "select public.video_source_claim() r"), "VID-CONV-001"), "22 a member cannot claim jobs");

// ── fairness + one claim at a time
await uploaded(A, s2);
r = await begin(B, k(12)); const sB = r.rows?.[0]?.r?.source_id; await uploaded(B, sB);
let c = await claim(); const T1 = c.c?.claim_token;
ok(c.c?.source_id === s1 && T1, "23 first claim: the oldest job (A's) " + (c.error ?? ""));
ok(errIs(await claim(), "VID-CONV-007"), "24 a second claim while one is live → refused (one job at a time; review #416 finding 5)");

// ── begin_version: token-bound, owner from the source
ok(errIs(await bv(s1, k(99)), "VID-CONV-002"), "25 wrong claim token → refused");
r = await bv(s1, T1); const v1 = r.rows?.[0]?.r?.video_id;
ok(!!v1 && !r.rows[0].r.replayed, "26 the converter declares the package " + (r.error ?? ""));
let vrow = await one("select owner_id, purpose, idempotency_key, converted_from from public.videos where id = $1", [v1]);
ok(vrow.owner_id === A && vrow.purpose === "post" && vrow.idempotency_key === T1 && vrow.converted_from === s1,
   "27 the video belongs to the source's owner, purpose from the source, key = the attempt's token, marked converted_from");
ok(/permission denied/.test((await as(A, "select converted_from from public.videos")).error ?? ""), "28 converted_from is not readable by members");
r = await bv(s1, T1);
ok(r.rows?.[0]?.r?.video_id === v1 && r.rows[0].r.replayed === true, "29 a retry in the same attempt gets the same video");
ok(errIs(await bv(s1, T1, SHA("e")), "VID-CONV-003"), "30 a different package in the same attempt → refused");
ok(await openCount(A) === 3, "31 the open count is still 3 for A: the source counts once, its video is not counted again (" + await openCount(A) + ")");

// ── converter_version
r = await as(CONV, "select * from public.video_converter_version($1, 1, $2)", [v1, T1]);
ok(r.rows?.length === 1 && r.rows[0].owner_id === A && r.rows[0].lease_until instanceof Date && r.rows[0].lease_until > new Date(), "32 converter_version gives the claimed video's facts, with the lease end (URLs never outlive the claim) " + (r.error ?? ""));
ok((await as(CONV, "select * from public.video_converter_version($1, 1, $2)", [v1, k(98)])).rows?.length === 0, "33 … nothing with a wrong token");
ok((await as(CONV, "select * from public.video_converter_version($1, 1, $2)", [deviceVideo, T1])).rows?.length === 0, "34 … nothing for a member's device video");
ok((await as(A, "select * from public.video_converter_version($1, 1, $2)", [v1, T1])).rows?.length === 0, "35 … nothing for a member, even with the token");

// ── heartbeat (+ 6 h ceiling)
ok(!!(await as(CONV, "select public.video_source_heartbeat($1,$2) r", [s1, T1])).rows?.[0]?.r, "36 heartbeat extends a held lease");
ok(errIs(await as(CONV, "select public.video_source_heartbeat($1,$2) r", [s1, k(97)]), "VID-CONV-002"), "37 heartbeat with a wrong token → refused");
await db.exec(`ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch; UPDATE public.video_sources SET claimed_at = now() - interval '7 hours' WHERE id = '${s1}'; ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;`);
r = await as(CONV, "select public.video_source_heartbeat($1,$2) r", [s1, T1]);
const capped = r.rows?.[0]?.r;
ok(capped instanceof Date && capped < new Date() && errIs(await as(CONV, "select public.video_source_heartbeat($1,$2) r", [s1, T1]), "VID-CONV-002"),
   "38 a claim older than 6 h cannot be kept alive: the lease is capped at claimed_at + 6 h, then the claim is dead (review #416 finding 10)");
await db.exec(`ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch; UPDATE public.video_sources SET claimed_at = now(), lease_until = now() + interval '30 minutes' WHERE id = '${s1}'; ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;`);

// ── mark: converter only for its own job [R3]
ok(errIs(await mark(CONV, deviceVideo), "VID-MU-001"), "39 the converter cannot mark a member's device video");
ok(errIs(await mark(B, v1), "VID-MU-001"), "40 another member cannot mark it");
r = await mark(CONV, v1);
ok(r.rows?.[0]?.r?.state === "ready", "41 the converter marks the video it is converting " + (r.error ?? ""));
r = await done(s1, T1);
ok(r.rows?.[0]?.r?.state === "ready" && (await status(s1)).status === "done", "42 done → the job is done " + (r.error ?? ""));
ok(errIs(await mark(CONV, v1), "VID-MU-001"), "43 after done, the converter cannot touch that video");

// ── round robin: B before A's second
c = await claim(); const TB = c.c?.claim_token;
ok(c.c?.source_id === sB, "44 next claim: B's job before A's second (A was served last) — round-robin by member");

// ── the OWNER's switch at mark time [R3]
r = await bv(sB, TB); const vB = r.rows?.[0]?.r?.video_id;
await su(`INSERT INTO public.feature_off VALUES ('video_posts', '${B}')`);
ok(errIs(await mark(CONV, vB), "VID-UP-003"), "45 the owner's video posts switched off → the converter's mark is refused");
await su(`DELETE FROM public.feature_off WHERE feature = 'video_posts' AND user_id = '${B}'`);

// ── lease runs out before upload → requeued, the half-made video deleted and unlinked
await su("UPDATE public.video_sources SET lease_until = now() - interval '1 minute' WHERE id = $1", [sB]);
c = await claim(); // expires B's, then hands out the next (fairness: A's second or B's again)
ok((await one("select state from public.videos where id=$1", [vB])).state === "deleted", "46 the run-out attempt's half-made video is deleted");
let sBrow = await status(sB);
ok(sBrow.video_id === null && (sBrow.status === "queued" || sBrow.status === "converting"), "47 B's job is back in the queue with no stale link");
// finish whichever job we got, then get B's back
if (c.c?.source_id !== sB) { await failJ(c.c.source_id, c.c.claim_token, "unsupported_format", "test"); c = await claim(); }
ok(c.c?.source_id === sB && (await status(sB)).attempts === 2, "48 B's job is claimed again: attempt 2");
r = await bv(sB, c.c.claim_token); const vB2 = r.rows?.[0]?.r?.video_id;
ok(!!vB2 && vB2 !== vB, "49 the new attempt makes a fresh video " + (r.error ?? ""));
ok(await dayCount(B) === 1, "50 B's three tries at one upload count ONCE for the day (review #416 finding 2) — " + await dayCount(B));

// ── lease runs out AFTER upload → done
ok((await mark(CONV, vB2)).rows?.[0]?.r?.state === "ready", "51 attempt 2 uploaded");
await su("UPDATE public.video_sources SET lease_until = now() - interval '1 minute' WHERE id = $1", [sB]);
await su("SELECT public.video_source_housekeeping()");
sBrow = await status(sB);
ok(sBrow.status === "done" && sBrow.video_id === vB2, "52 a lease that runs out after the upload → done, the video kept");

// ── fail: codes; fixed member text; after complete → done (finding 6)
const s2row = await status(s2);
ok(s2row.status === "failed" && s2row.error === "This file's format can't be converted. Try exporting it as MP4 and upload again.",
   "53 a final failure shows the fixed text for its code, not the converter's words");
const ev = await one("select detail from public.video_source_events where source_id = $1 and event = 'failed'", [s2]);
ok(ev?.detail === "unsupported_format: test", "54 the converter's own words are kept in the audit trail only");
await resetMember(A);
let j = await job(A, k(20));
ok(errIs(await failJ(j.sid, j.tok, "Visit http://evil.example"), "VID-CONV-005"), "55 free text instead of a code → refused (no phishing text for members)");
await db.exec(`ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch; UPDATE public.video_sources SET queued_at = now() - interval '47 hours' WHERE id = '${j.sid}'; ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;`);
ok((await failJ(j.sid, j.tok, "internal", "blip")).rows?.[0]?.r === "queued"
   && (await one("select now() - queued_at < interval '1 minute' fresh from public.video_sources where id=$1", [j.sid])).fresh === true,
   "56 'internal' → back to the queue, and its wait starts again (it is not timed out by the old queued_at; re-review NIT 3)");
c = await claim(); r = await bv(j.sid, c.c.claim_token); await mark(CONV, r.rows?.[0]?.r?.video_id);
ok((await failJ(j.sid, c.c.claim_token, "internal", "after upload")).rows?.[0]?.r === "done" && (await status(j.sid)).status === "done",
   "57 a failure reported after the upload went through ends the job as done (review #416 finding 6)");

// ── claim never hands out a job whose owner may no longer make videos (finding 5)
await resetMember(B);
r = await begin(B, k(30)); const sOff = r.rows?.[0]?.r?.source_id; await uploaded(B, sOff);
await su(`INSERT INTO public.feature_off VALUES ('video_posts', '${B}')`);
c = await claim();
ok(c.c === null && (await status(sOff)).status === "queued", "58 the owner was switched off while queued → the job is NOT handed out (its original is not read) and WAITS — a temporary Off does not fail it (re-review NIT 2)");
await db.exec(`ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch; UPDATE public.video_sources SET queued_at = now() - interval '49 hours' WHERE id = '${sOff}'; ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;`);
await su("SELECT public.video_source_housekeeping()");
const offRow = await status(sOff);
ok(offRow.status === "failed" && /switched off/.test(offRow.error), "58b still switched off after 48 h → failed, telling the member uploads are switched off for them");
await su(`DELETE FROM public.feature_off WHERE feature = 'video_posts' AND user_id = '${B}'`);

// ── cancel never frees the day (finding 1)
await resetMember(A);
let cancels = 0;
for (let n = 0; n < 12; n++) {
  r = await begin(A, k(100 + n));
  if (r.error) { ok(errIs(r, "VID-LIM-003") && n === 10, "59 the 11th start after 10 cancels → VID-LIM-003 (cancelling does not free the day; review #416 finding 1) " + r.error); break; }
  const sid = r.rows[0].r.source_id; await uploaded(A, sid);
  await as(A, "select public.video_source_cancel($1)", [sid]); cancels++;
}
ok(cancels === 10 && await dayCount(A) === 10, "60 ten started-and-cancelled sources count ten for the day (" + await dayCount(A) + ")");

// ── open count holds when the member deletes the half-made video (finding 3)
await resetMember(A);
j = await job(A, k(200));
r = await bv(j.sid, j.tok); const vH = r.rows?.[0]?.r?.video_id;
const openBefore = await openCount(A);
await as(A, "select public.video_delete($1)", [vH]);
ok((await one("select state from public.videos where id=$1", [vH])).state === "deleted" && await openCount(A) === openBefore && openBefore >= 1,
   "61 the member deleted the half-made video mid-conversion: the source still counts (open count unchanged: " + openBefore + " → " + await openCount(A) + ")");
await failJ(j.sid, j.tok, "damaged");

// ── cancel mid-conversion
await resetMember(A);
j = await job(A, k(300));
r = await bv(j.sid, j.tok); const v3 = r.rows?.[0]?.r?.video_id;
ok(errIs(await as(B, "select public.video_source_cancel($1) r", [j.sid]), "VID-SRC-004"), "62 another member cannot cancel it");
r = await as(A, "select public.video_source_cancel($1) r", [j.sid]);
ok(r.rows?.[0]?.r === "cancelled" && (await one("select state from public.videos where id=$1", [v3])).state === "deleted", "63 the owner cancels mid-conversion: job cancelled, half-made video deleted");
ok(errIs(await bv(j.sid, j.tok), "VID-CONV-002"), "64 the converter's claim on a cancelled job is dead");

// ── a claim that used its whole 6 h ends the job (final), never retried (re-review LOW 1)
await resetMember(A);
j = await job(A, k(350));
await db.exec(`ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch; UPDATE public.video_sources SET claimed_at = now() - interval '6 hours 5 minutes', lease_until = now() - interval '5 minutes' WHERE id = '${j.sid}'; ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;`);
await su("SELECT public.video_source_housekeeping()");
const ceil = await status(j.sid);
ok(ceil.status === "failed" && ceil.attempts === 1 && /too long/.test(ceil.error), "63b a claim that hit the 6 h ceiling → failed as too long after ONE attempt (the VM is not held 3 × 6 h)");

// ── audit trail append-only
const evts = Number((await one("select count(*) n from public.video_source_events")).n);
ok(evts >= 30, "65 the audit trail recorded the story (" + evts + " events)");
let e1 = null; try { await su("UPDATE public.video_source_events SET detail = 'x'"); } catch (e) { e1 = e.message; }
let e2 = null; try { await su("DELETE FROM public.video_source_events"); } catch (e) { e2 = e.message; }
ok(e1?.includes("VID-SRC-EVT-001") && e2?.includes("VID-SRC-EVT-001"), "66 audit rows cannot be changed or deleted");

// ── housekeeping + health
await su(`INSERT INTO public.video_sources (owner_id, purpose, idempotency_key, source_bytes, created_at) VALUES ('${ADM}', 'post', '${k(400)}', 10, now() - interval '25 hours')`);
r = await begin(ADM, k(401)); const sQ = r.rows?.[0]?.r?.source_id; await uploaded(ADM, sQ);
await db.exec(`ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch;
  UPDATE public.video_sources SET queued_at = now() - interval '49 hours' WHERE id = '${sQ}';
  UPDATE public.video_sources SET updated_at = now() - interval '3 days' WHERE id = '${s2}';
  ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;`);
const hk = (await one("select public.video_source_housekeeping() r")).r;
ok(hk.upload_abandoned === 1 && hk.queue_timed_out === 1 && hk.purged >= 1,
   "67 housekeeping: unfinished upload → failed; queued 49 h → failed (review #416 finding 10); ended 3 days ago → purged " + JSON.stringify(hk));
ok(/not available/.test((await status(sQ)).error), "68 the timed-out job tells the member the converter was not available");
r = await begin(B, k(402)); await uploaded(B, r.rows?.[0]?.r?.source_id);
await db.exec("ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch; UPDATE public.video_sources SET queued_at = now() - interval '40 minutes' WHERE status = 'queued'; ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;");
const h = (await one("select public.video_converter_health() r")).r;
ok(h.alert === true && h.queued >= 1 && h.oldest_queued_s >= 2400, "69 health: a job waiting 40 min raises the alert " + JSON.stringify(h));
await db.exec("SET ROLE service_role;"); let hs = null; try { hs = (await db.query("select public.video_converter_health() r")).rows[0].r; } catch (e) { hs = e.message; } await db.exec("RESET ROLE;");
ok(typeof hs === "object", "70 the service role (health check) can read it " + (typeof hs === "string" ? hs : ""));

// ── device path unchanged
r = await mark(A, deviceVideo);
ok(r.rows?.[0]?.r?.state === "ready", "71 the owner still marks their own device video " + (r.error ?? ""));

// ── grants
ok(/permission denied/.test((await as(A, "select public.video_source_held($1,$2)", [s1, T1])).error ?? ""), "72 internal functions are not callable by members");
ok(/permission denied/.test((await as(A, "select public.video_converter_health()")).error ?? ""), "73 health is not callable by members");
await db.exec("SET ROLE anon;"); let anonErr = null; try { await db.query("select public.video_source_claim()"); } catch (e) { anonErr = e.message; } await db.exec("RESET ROLE;");
ok(/permission denied/.test(anonErr ?? ""), "74 anon cannot call converter functions");
ok(/permission denied/.test((await as(A, "insert into public.video_sources (owner_id, purpose, idempotency_key, source_bytes) values ($1,'post',$2,1)", [A, k(500)])).error ?? ""), "75 members cannot write video_sources directly");

// ── PROBE, then planted faults
const probe = readFileSync("D:/50mm Retina World/work/D1/supabase/migrations/PROBE_vid1_converter_sources.sql", "utf8").replace(/\r\n/g, "\n");
const runProbe = async () => { try { await db.exec(probe); return null; } catch (e) { await db.exec("ROLLBACK"); return e.message; } };
let pErr = await runProbe();
ok(!pErr, "76 PROBE PASS on the applied schema " + (pErr ?? ""));
const planted = [
  ["GRANT SELECT (claim_token) ON public.video_sources TO authenticated;", "REVOKE SELECT (claim_token) ON public.video_sources FROM authenticated;", "C2", "claim_token readable"],
  ["GRANT EXECUTE ON FUNCTION public.video_mark_uploaded(uuid,integer,text,bigint,text) TO anon;", "REVOKE EXECUTE ON FUNCTION public.video_mark_uploaded(uuid,integer,text,bigint,text) FROM anon;", "C3", "anon EXECUTE on video_mark_uploaded"],
  ["ALTER TABLE public.video_sources DROP CONSTRAINT video_sources_done_has_video;", "ALTER TABLE public.video_sources ADD CONSTRAINT video_sources_done_has_video CHECK (status <> 'done' OR video_id IS NOT NULL);", "C1", "done_has_video dropped"],
  ["UPDATE cron.job SET command = 'SELECT 1' WHERE jobname = 'video-source-housekeeping';", "UPDATE cron.job SET command = 'SELECT public.video_source_housekeeping();' WHERE jobname = 'video-source-housekeeping';", "C6", "cron command replaced"],
  ["REVOKE EXECUTE ON FUNCTION public.video_converter_health() FROM service_role;", "GRANT EXECUTE ON FUNCTION public.video_converter_health() TO service_role;", "C6", "health not readable by service_role"],
  [`INSERT INTO public.user_roles VALUES ('${CONV}', 'admin');`, `DELETE FROM public.user_roles WHERE user_id = '${CONV}';`, "C5", "converter holds a role"],
];
let n = 77;
for (const [plant, undo, code, what] of planted) {
  await db.exec(plant); pErr = await runProbe(); await db.exec(undo);
  ok(!!pErr && pErr.includes(code), `${n++} PROBE catches: ${what}`);
}

// ── rollback round trip
const rb = readFileSync("D:/50mm Retina World/work/D1/supabase/rollback/20261012_0002_vid1_converter_sources_ROLLBACK.sql", "utf8").replace(/\r\n/g, "\n");
let rbErr = null; try { await db.exec(rb); } catch (e) { rbErr = e.message; }
ok(!rbErr, `${n++} the rollback runs and its own post-checks pass ` + (rbErr ?? ""));
r = await as(B, "select public.video_begin_upload('post',$1,$2,448,true,$3,$4) r", [SHA("f"), TOTAL, k(600), JSON.stringify(REND)]);
ok(!r.error || r.error.includes("VID-LIM"), `${n++} after rollback the device path still works (0005 body) ` + (r.error ?? ""));
let reErr = null; try { await db.exec("SET p32.lane = 'staging';"); await db.exec(conv); } catch (e) { reErr = e.message; }
ok(!reErr, `${n++} the migration applies again after the rollback (clean round trip) ` + (reErr ?? ""));
await db.exec("CREATE OR REPLACE FUNCTION public.video_begin_upload(_purpose text, _manifest_sha256 text, _total_bytes bigint, _declared_duration_s numeric, _has_audio boolean, _idempotency_key uuid, _rendition_bytes jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;");
rbErr = null; try { await db.exec(rb); } catch (e) { rbErr = e.message; await db.exec("ROLLBACK"); }
ok(rbErr?.includes("VID-CONV-RB-PRE-002"), `${n++} the rollback refuses to overwrite a later body (review #416 finding 9)`);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
