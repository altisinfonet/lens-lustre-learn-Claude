// Self-test for scripts/notif-guard-check.mjs (a check that could not fail is
// not evidence). Plants every stray shape it must catch, and every shape it
// must leave alone, then runs the real check on a planted tree and expects red.
// Run: node scripts/notif-guard-check.test.mjs   (exit 0 = all cases pass)
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sqlWriters, tsWrites, judge, collect } from "./notif-guard-check.mjs";

let fail = 0;
const ok = (cond, what) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) fail = 1; };
const fn = (name, body) => `CREATE OR REPLACE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$\n${body}\n$fn$;`;
const w = (...texts) => [...sqlWriters(texts.map((t, i) => ({ name: `m${i}.sql`, text: t }))).keys()];

console.log("SQL — must be a writer");
ok(w(fn("a1", "BEGIN INSERT INTO public.user_notifications(user_id) VALUES (NEW.id); RETURN NEW; END;")).includes("a1"), "INSERT INTO public.user_notifications");
ok(w(fn("a2", "BEGIN insert into admin_notifications (type) values ('x'); RETURN NEW; END;")).includes("a2"), "lower-case, unqualified admin_notifications");
ok(w(fn("a3", 'BEGIN INSERT INTO "public"."user_notifications" (user_id) VALUES (1); END;')).includes("a3"), "quoted identifiers");
ok(w("CREATE PROCEDURE public.a4() LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.admin_notifications(type) VALUES ('p'); END $$;").includes("a4"), "a procedure");
ok(w(fn("a5", "BEGIN RETURN NEW; END;"), fn("a5", "BEGIN INSERT INTO public.user_notifications(user_id) VALUES (1); END;")).includes("a5"), "a later definition that adds an insert");

console.log("SQL — must NOT be a writer");
ok(!w(fn("b1", "BEGIN -- INSERT INTO public.user_notifications would be wrong\n RETURN NEW; END;")).includes("b1"), "insert only in a -- comment");
ok(!w(fn("b2", "BEGIN /* INSERT INTO user_notifications */ RETURN NEW; END;")).includes("b2"), "insert only in a /* */ comment");
ok(!w(fn("b3", "BEGIN INSERT INTO public.user_notifications(user_id) VALUES (1); END;"), fn("b3", "BEGIN PERFORM public.notify(NEW.id); END;")).includes("b3"), "rewritten later without the insert (last definition wins)");
ok(!w(fn("b4", "BEGIN INSERT INTO public.user_notifications(user_id) VALUES (1); END;"), "DROP FUNCTION IF EXISTS public.b4();").includes("b4"), "dropped later");
ok(!w(fn("b5", "BEGIN INSERT INTO public.user_notifications_archive SELECT 1; END;")).includes("b5"), "a different table whose name starts the same");
ok(!w(fn("b6", "BEGIN DELETE FROM public.user_notifications WHERE id = 1; UPDATE public.admin_notifications SET is_read = true; END;")).includes("b6"), "delete / update only");

console.log("TS — must be a writer");
ok(tsWrites(`await supabase.from("user_notifications").insert({ user_id: x });`), "from(..).insert(");
ok(tsWrites(`await admin\n  .from('admin_notifications')\n  .upsert(rows);`), "multi-line .upsert(");
ok(tsWrites("const { error } = await db.from(`admin_notifications`).insert(notifRows);"), "template-literal table name");

console.log("TS — must NOT be a writer");
ok(!tsWrites(`await supabase.from("user_notifications").select("id").eq("user_id", u);`), "select");
ok(!tsWrites(`await supabase.from("user_notifications").delete().in("id", ids);`), "delete");
ok(!tsWrites(`await supabase.from("user_notifications").update({ is_read: true }).eq("id", 1);`), "update");
ok(!tsWrites(`// await supabase.from("user_notifications").insert({})`), "commented-out insert");
ok(!tsWrites(`await supabase.from("user_notifications").select("id");\nawait supabase.from("posts").insert({});`), "insert on another table in the next statement");

console.log("judge");
const j = judge([{ key: "sql:a" }, { key: "file:x.ts" }], { "sql:a": "today", "sql:gone": "old", "file:y.ts": "" });
ok(j.strays.length === 1 && j.strays[0].key === "file:x.ts", "a writer not on the list is a stray");
ok(j.stale.includes("sql:gone") && j.stale.includes("file:y.ts"), "an entry that matches nothing is stale");
ok(j.empty.includes("file:y.ts"), "an entry with no reason is an error");

console.log("the real check on a planted tree");
const repo = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "notif-guard-"));
try {
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  mkdirSync(join(tmp, "supabase/migrations"), { recursive: true });
  mkdirSync(join(tmp, "supabase/functions/x"), { recursive: true });
  mkdirSync(join(tmp, "src"), { recursive: true });
  cpSync(join(repo, "scripts/notif-guard-check.mjs"), join(tmp, "scripts/notif-guard-check.mjs"));
  writeFileSync(join(tmp, "supabase/migrations/20990101_0001_ok.sql"), fn("allowed_maker", "BEGIN INSERT INTO public.user_notifications(user_id) VALUES (1); END;"));
  writeFileSync(join(tmp, "scripts/notif-guard-allow.json"), JSON.stringify({ "sql:allowed_maker": "test" }));
  const run = () => spawnSync(process.execPath, [join(tmp, "scripts/notif-guard-check.mjs"), tmp], { encoding: "utf8" });
  ok(run().status === 0, "clean tree → exit 0");
  writeFileSync(join(tmp, "supabase/migrations/20990102_0001_stray.sql"), fn("stray_maker", "BEGIN INSERT INTO public.admin_notifications(type) VALUES ('x'); END;"));
  let r = run();
  ok(r.status === 1 && /STRAY notification writer sql:stray_maker/.test(r.stdout), "planted SQL stray → exit 1, named");
  rmSync(join(tmp, "supabase/migrations/20990102_0001_stray.sql"));
  writeFileSync(join(tmp, "supabase/functions/x/index.ts"), `await admin.from("user_notifications").insert({ user_id: u });`);
  r = run();
  ok(r.status === 1 && /file:supabase\/functions\/x\/index\.ts/.test(r.stdout), "planted edge-function stray → exit 1, named");
  rmSync(join(tmp, "supabase/functions/x/index.ts"));
  writeFileSync(join(tmp, "supabase/migrations/20990103_0001_moved.sql"), fn("allowed_maker", "BEGIN PERFORM 1; END;"));
  r = run();
  ok(r.status === 1 && /STALE allow-list entry sql:allowed_maker/.test(r.stdout), "maker moved off direct inserts but left on the list → exit 1 (stale)");
  ok(collect(tmp).length === 0, "collect() sees no writer once it moved");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fail) { console.log("\nSELF-TEST FAILED"); process.exit(1); }
console.log("\nself-test: all cases pass");
