-- PROBE · S8 / F-REV4-1 · which Supabase edge functions does the DATABASE call?
-- Read-only. Names and counts only: the function name is cut out of the URL
-- by a regexp, so no header, token or other literal in a cron command or a
-- function body is ever printed.
-- Feed the output (CSV of edge_function,source,refs) to
--   node scripts/s8-functions-inventory.mjs --live live.json --db probe.csv
-- together with the live list from d1-deploy-functions.yml mode=list (or the
-- Management API /v1/projects/<ref>/functions JSON the supervisor holds).
-- Not a pass/fail PROBE: an inventory. Its one check row says whether any
-- DB-called name is missing from git (FAIL = a live caller of code git lacks).
BEGIN READ ONLY;

WITH git(name) AS (
  -- supabase/functions/* in git at the time of writing (73). The script
  -- re-reads the directory; this list only powers the in-SQL check row.
  VALUES ('ad-reward-credit'),('admin-export-db'),('admin-process-withdrawal'),('admin-secure-settings'),
    ('analyze-gallery-image'),('apply-scheduled-boosts'),('ask-anything'),('auth-email-hook'),
    ('autoscale-ad-traffic'),('backfill-image-dims'),('backfill-image-hashes'),('backfill-media-objects'),
    ('backfill-thumbnails'),('backup-reminder'),('brevo-webhook'),('cast-photo-vote'),('complete-round'),
    ('create-payment-session'),('dashboard-init'),('delete-my-account'),('delete-user'),('detect-ai-image'),
    ('detect-orphan-files'),('diagnose-brevo-key'),('entry-final-votes'),('evaluate-round2'),
    ('expire-gift-credits'),('fix-cache-headers'),('ga-report'),('get-payment-gateways-public'),
    ('get-wallet-summary'),('get-wallet-transactions'),('handle-email-suppression'),('handle-email-unsubscribe'),
    ('hard-delete-competition'),('judge-session-resume'),('judging-invariants-nightly'),('manage-notifications'),
    ('measure-post-media'),('media-register-upload'),('media-verify-upload'),('migrate-post-media'),
    ('migrate-storage'),('moderate-comment'),('paypal-capture-order'),('preview-transactional-email'),
    ('process-email-queue'),('publish-round'),('publish-scheduled-posts'),('purge-s3-orphans'),('rank-feed'),
    ('razorpay-verify-payment'),('s3-delete'),('s3-presign-upload'),('s3-signed-url'),('s3-upload'),
    ('send-broadcast-push'),('send-gift-credit'),('send-push'),('send-reengagement-emails'),
    ('send-transactional-email'),('seo-crawler-verify'),('seo-route-metadata'),('sitemap'),('submit-deposit'),
    ('submit-judge-comment'),('submit-judge-decision'),('submit-judge-score'),('submit-judge-tag'),
    ('test-smtp'),('translate-text'),('verify-email-provider'),('verify-image-hash')
),
from_cron AS (
  SELECT m[1] AS name, 'cron.job' AS source
    FROM cron.job j, LATERAL regexp_matches(j.command, '/functions/v1/([A-Za-z0-9_-]+)', 'g') AS m
),
from_sql AS (
  SELECT m[1] AS name, 'pg_proc' AS source
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN LATERAL regexp_matches(p.prosrc, '/functions/v1/([A-Za-z0-9_-]+)', 'g') AS m
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
),
refs AS (
  SELECT name, source, count(*) AS refs FROM (SELECT * FROM from_cron UNION ALL SELECT * FROM from_sql) x
   GROUP BY name, source
)
SELECT name AS edge_function, source, refs::text AS refs,
       CASE WHEN name IN (SELECT name FROM git) THEN 'in git' ELSE 'NOT IN GIT' END AS git
  FROM refs
UNION ALL
SELECT 'OVERALL', 'db-called names missing from git', (SELECT count(DISTINCT name) FROM refs WHERE name NOT IN (SELECT name FROM git))::text,
       CASE WHEN EXISTS (SELECT 1 FROM refs WHERE name NOT IN (SELECT name FROM git)) THEN 'FAIL' ELSE 'PASS' END
ORDER BY 1, 2;

ROLLBACK;
