// D1 · OFF-2 · self-test for scripts/db-off2-idempotency-check.mjs (C-34).
import { judge, OUTBOX_TABLES } from "./db-off2-idempotency-check.mjs";
let fail = 0;
const ok = (c, w) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${w}`); if (!c) fail = 1; };
const f = (name, text) => ({ name, text });
const base = Object.fromEntries(OUTBOX_TABLES.map((t) => [t, { kind: "natural", columns: ["a", "b"] }]));
const C = (extra = {}) => ({ tables: { ...base, post_comments: { kind: "key", owner: "user_id", unique: "post_comments_user_idempotency_key" }, ...extra } });
const PROBE = OUTBOX_TABLES.map((t) => `'${t}'`).join(" ");
const GOOD = f("m1", "ALTER TABLE public.post_comments ADD COLUMN IF NOT EXISTS idempotency_key text;\nALTER TABLE public.post_comments ADD CONSTRAINT post_comments_user_idempotency_key UNIQUE (user_id, idempotency_key);");
const hits = (contract, files, probe = PROBE) => judge(contract, files, probe);

console.log("must be RED");
ok(hits(C(), []).some((h) => h.startsWith("K2 post_comments: no applied migration adds")), "a key table with no column in git");
ok(hits(C(), [f("m1", "ALTER TABLE public.post_comments ADD COLUMN idempotency_key text;")]).some((h) => h.includes("creates UNIQUE")), "the column but no unique");
ok(hits(C(), [GOOD, f("m2", "ALTER TABLE public.post_comments DROP CONSTRAINT post_comments_user_idempotency_key;")]).length === 1, "a later migration drops the unique");
ok(hits(C(), [GOOD, f("m2", "ALTER TABLE public.post_comments DROP COLUMN idempotency_key;")]).length === 1, "a later migration drops the column");
ok(hits({ tables: { posts: base.posts } }, []).filter((h) => h.startsWith("K1")).length === OUTBOX_TABLES.length - 1, "outbox tables missing from the contract");
ok(hits(C({ reports: { kind: "maybe" } }), [GOOD]).some((h) => h.includes("unknown kind")), "an unknown kind");
ok(hits(C(), [GOOD], "'posts'").some((h) => h.startsWith("K3")), "a contract table the PROBE does not judge");
ok(hits(C(), [f("m1", "-- ALTER TABLE public.post_comments ADD COLUMN idempotency_key text;\n-- CONSTRAINT post_comments_user_idempotency_key UNIQUE (x)")]).length === 2, "commented-out SQL does not count");
console.log("must stay GREEN");
ok(hits(C(), [GOOD]).length === 0, "column + named UNIQUE constraint");
ok(hits(C({ posts: { kind: "key", owner: "user_id", unique: "posts_user_idempotency_key" } }),
  [GOOD, f("m0", "ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS idempotency_key text;\nCREATE UNIQUE INDEX IF NOT EXISTS posts_user_idempotency_key\n  ON public.posts (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;")]).length === 0, "posts' shape: a partial CREATE UNIQUE INDEX");
ok(hits(C(), [GOOD, f("m2", "ALTER TABLE public.post_comments DROP CONSTRAINT post_comments_user_idempotency_key;\nALTER TABLE public.post_comments ADD CONSTRAINT post_comments_user_idempotency_key UNIQUE (user_id, idempotency_key);")]).length === 0, "dropped and re-created in the same later file");
ok(hits(C(), [GOOD]).every((h) => !h.includes("post_reactions")), "natural entries are not judged in git");
console.log(fail ? "\nSOME CASES FAILED" : "\nALL CASES PASS"); process.exit(fail);
