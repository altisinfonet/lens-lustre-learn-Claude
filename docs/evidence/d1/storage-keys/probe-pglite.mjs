// Behaviour test for supabase/migrations/PROBE_storage_key_prereqs.sql on PGlite
// (Postgres in memory, @electric-sql/pglite 0.5.8). Fake rows only.
//
// Run from a folder where @electric-sql/pglite@0.5.8 is installed:
//   node probe-pglite.mjs <path to PROBE_storage_key_prereqs.sql>
//
// Every fake value that must never be printed carries the marker SENTINEL (or
// is one of the fixed values in NEVER_PRINTED). After every scenario the
// harness checks every NOTICE and every error field for them: the PROBE must
// print counts and booleans only (booleans print as t / f, as in psql).
// Exit code 1 if any expectation fails.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const PROBE = readFileSync(process.argv[2], "utf8").replace(/\r\n/g, "\n");
const MARK = "SENTINEL";
const HEX = "0123456789abcdef0123456789abcdef";
const UID = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
const GOOD_ENDPOINT = `https://${HEX}.r2.cloudflarestorage.com`;
const NEVER_PRINTED = [MARK, MARK.toLowerCase(), HEX, "50mm-staging", "uploads/50mm-retina", UID];

let failed = 0;
const say = (s) => console.log(s);
const check = (ok, what) => {
  say(`    ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

const settings = (over = {}) => ({
  enabled: true,
  bucket_name: "50mm-staging",
  region: "auto",
  access_key_id: `${MARK}-access-key-id`,
  secret_access_key: `${MARK}-secret-access-key`,
  endpoint: GOOD_ENDPOINT,
  path_prefix: "",
  public_url: `https://cdn-${MARK.toLowerCase()}.example.com`,
  ...over,
});

async function freshDb({ tables = true, ticketsHaveAttachment = false } = {}) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.site_settings (key text PRIMARY KEY, value jsonb NOT NULL,
                   updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);`);
  if (!tables) return db;
  // Shapes as in the migrations (20260302111034, 20260302120246, 20260226105713,
  // 20260225060518): only ticket_replies has attachment_url.
  await db.exec(`
    CREATE TABLE public.support_tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      subject text NOT NULL, status text NOT NULL DEFAULT 'open'${ticketsHaveAttachment ? ", attachment_url text" : ""});
    CREATE TABLE public.ticket_replies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL,
      user_id uuid NOT NULL, message text NOT NULL, is_admin boolean NOT NULL DEFAULT false,
      attachment_url text, attachment_name text);
    CREATE TABLE public.hero_banners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, image_url text NOT NULL);
    CREATE TABLE public.portfolio_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL,
      image_url text NOT NULL, uploaded_by uuid NOT NULL DEFAULT gen_random_uuid());
  `);
  return db;
}

async function putSettings(db, value) {
  await db.query("INSERT INTO public.site_settings (key, value) VALUES ('s3_storage_settings', $1::jsonb)", [JSON.stringify(value)]);
}

async function putRows(db) {
  const T = "11111111-1111-4111-8111-111111111111";
  await db.query("INSERT INTO public.support_tickets (id, user_id, subject) VALUES ($1, $2, $3)", [T, UID, `${MARK} subject`]);
  const replies = [
    `support-attachments/${UID}/1728712345678-abc.pdf`,             // valid (storage mode S3)
    `${UID}/1728712345678-abc.pdf`,                                 // valid (bucket prefix added by the client)
    `https://cdn.example.com/${MARK}.pdf`,                          // a URL, not a key: skipped
    null,                                                           // no attachment: skipped
    `support-attachments/${UID}/${MARK} report.pdf`,                // whitespace: refused
    `${UID}/../${MARK}.pdf`,                                        // dot-dot segment: refused
    `support-attachments/${UID}/${MARK}%2e%2e.pdf`,                 // percent: refused
    `support-attachments/${UID}/${"x".repeat(600)}${MARK}.pdf`,     // over 512: refused
    `support-attachments/${UID}/café-${MARK}.pdf`,                  // non-ASCII: refused
  ];
  for (const a of replies) {
    await db.query("INSERT INTO public.ticket_replies (ticket_id, user_id, message, attachment_url) VALUES ($1, $2, $3, $4)",
      [T, UID, `${MARK} message`, a]);
  }
  const banners = [
    "https://cdn.example.com/portfolio-images/banners/1728712345678-abc.webp",   // valid
    `https://cdn.example.com/portfolio-images/banners/${MARK}%20x.webp`,         // percent
    `https://cdn.example.com/portfolio-images/banners/${MARK}-é.webp`,           // non-ASCII
    `https://cdn.example.com/portfolio-images/banners/${MARK}.webp?t=1`,         // "?" (refused by the grammar only)
    `https://other.example.com/${MARK}.webp`,                                    // no portfolio-images part: not counted
  ];
  for (const u of banners) await db.query("INSERT INTO public.hero_banners (title, image_url) VALUES ($1, $2)", [`${MARK} title`, u]);
  await db.query("INSERT INTO public.portfolio_images (title, image_url) VALUES ($1, $2)",
    [`${MARK} title`, "https://cdn.example.com/portfolio-images/gallery/gallery-1728712345678-0-abc.webp"]);
}

async function runProbe(db) {
  const notices = [];
  let error = null;
  try {
    await db.exec(PROBE, { onNotice: (n) => notices.push(n.message) });
  } catch (e) {
    error = e;
  }
  // Everything the database said, for the never-printed check.
  const errorText = error
    ? Object.values(error).filter((x) => typeof x === "string").concat([String(error.message)]).join("\n")
    : "";
  return { notices, error, all: notices.join("\n") + "\n" + errorText };
}

async function scenario(name, setup, expect) {
  say(`\n== ${name}`);
  const db = await setup();
  const res = await runProbe(db);
  for (const n of res.notices) say(`    NOTICE: ${n.replace(/\n/g, "\n            ")}`);
  if (res.error) say(`    ERROR:  ${String(res.error.message).replace(/\n/g, "\n            ")}`);
  expect(res);
  const leaked = NEVER_PRINTED.filter((m) => res.all.includes(m));
  check(leaked.length === 0, `no settings / attachment / image value printed${leaked.length ? ` (leaked: ${leaked.length} marker(s))` : ""}`);
  // The PROBE ends its transaction itself on PASS; on FAIL the client rolls back.
  if (res.error) await db.exec("ROLLBACK");
  const after = await db.query("SELECT count(*)::int AS n FROM public.site_settings");
  check(after.rows[0].n === (name.includes("absent settings") ? 0 : 1), "nothing written (settings row count unchanged)");
  await db.close();
}

const pass = (res) => check(!res.error && res.notices.some((n) => n.startsWith("PROBE PASS storage-keys")), "PROBE PASS");
const failWith = (...codes) => (res) => {
  check(!!res.error && String(res.error.message).startsWith("PROBE FAIL storage-keys"), "PROBE FAIL raised");
  for (const c of codes) check(String(res.error?.message ?? "").includes(c), `reason ${c}`);
};
const reportHas = (...lines) => (res) => {
  const report = res.notices.find((n) => n.startsWith("PROBE REPORT")) ?? "";
  for (const l of lines) check(report.includes(l), `report: ${l}`);
};
const both = (...fns) => (res) => fns.forEach((f) => f(res));

// ── PASS ────────────────────────────────────────────────────────────────────
await scenario("PASS · valid settings, mixed rows",
  async () => { const db = await freshDb(); await putSettings(db, settings()); await putRows(db); return db; },
  both(pass,
    reportHas("R1 support_tickets.attachment_url: absent on this lane",
              "R1 ticket_replies.attachment_url: 5 of 7 stored keys would be refused",
              "R2 hero_banners.image_url: 2 of 4 portfolio-images paths contain % or non-ASCII; 3 would be refused",
              "R2 portfolio_images.image_url: 0 of 1 portfolio-images paths contain % or non-ASCII; 0 would be refused"),
    (res) => check(res.notices.some((n) => n.includes("path_prefix set: f, endpoint set: t")), "booleans: path_prefix unset, endpoint set")));

await scenario("PASS · prefix with trailing slash, endpoint with trailing slash",
  async () => { const db = await freshDb(); await putSettings(db, settings({ path_prefix: "uploads/50mm-retina/", endpoint: `${GOOD_ENDPOINT}/` })); return db; },
  both(pass, (res) => check(res.notices.some((n) => n.includes("path_prefix set: t, endpoint set: t")), "booleans: both set")));

await scenario("PASS · no endpoint (virtual-host style), null prefix",
  async () => { const db = await freshDb(); const v = settings({ path_prefix: null }); delete v.endpoint; await putSettings(db, v); return db; },
  pass);

await scenario("PASS · absent settings row",
  async () => freshDb(),
  both(pass, (res) => check(res.notices.some((n) => n.includes("settings row present: f")), "reports the row as absent")));

await scenario("PASS · optional tables missing on this lane",
  async () => { const db = await freshDb({ tables: false }); await putSettings(db, settings()); return db; },
  both(pass, reportHas("R1 ticket_replies.attachment_url: absent on this lane", "R2 hero_banners.image_url: absent on this lane",
                       "R2 portfolio_images.image_url: absent on this lane")));

await scenario("PASS · support_tickets carries attachment_url (column added outside the migrations)",
  async () => {
    const db = await freshDb({ ticketsHaveAttachment: true }); await putSettings(db, settings());
    await db.query("INSERT INTO public.support_tickets (user_id, subject, attachment_url) VALUES ($1, 's', $2), ($1, 's', $3)",
      [UID, `support-attachments/${UID}/a.pdf`, `${UID}/./${MARK}.pdf`]);
    return db;
  },
  both(pass, reportHas("R1 support_tickets.attachment_url: 1 of 2 stored keys would be refused")));

// ── FAIL ────────────────────────────────────────────────────────────────────
const failCase = (name, over, ...codes) => scenario(name,
  async () => { const db = await freshDb(); await putSettings(db, settings(over)); await putRows(db); return db; },
  both(failWith(...codes), reportHas("R1 ticket_replies.attachment_url: 5 of 7")));

await failCase("FAIL · path_prefix with a leading slash", { path_prefix: `/${MARK}` }, "K2 path_prefix is outside the key grammar");
await failCase("FAIL · path_prefix with a dot-dot segment", { path_prefix: `${MARK}/../x` }, 'K2 path_prefix has a "." or ".." segment');
await failCase("FAIL · path_prefix with a dot segment", { path_prefix: `${MARK}/./x/` }, 'K2 path_prefix has a "." or ".." segment');
await failCase("FAIL · path_prefix with whitespace", { path_prefix: `${MARK} x` }, "K2 path_prefix is outside the key grammar");
await failCase("FAIL · path_prefix with a percent sign", { path_prefix: `${MARK}%2e` }, "K2 path_prefix is outside the key grammar");
await failCase("FAIL · path_prefix that is not a string", { path_prefix: 5 }, "K2 path_prefix is not a string");
await failCase("FAIL · path_prefix over 512 characters", { path_prefix: `${MARK}${"x".repeat(600)}` }, "K2 path_prefix is longer than 512 characters");
await failCase("FAIL · endpoint with a path", { endpoint: `${GOOD_ENDPOINT}/${MARK}` }, "K3 endpoint is not a bare");
await failCase("FAIL · endpoint with a query", { endpoint: `${GOOD_ENDPOINT}/?${MARK}=1` }, "K3 endpoint is not a bare");
await failCase("FAIL · endpoint with whitespace", { endpoint: `${GOOD_ENDPOINT} ` }, "K3 endpoint is not a bare");
await failCase("FAIL · endpoint on another host", { endpoint: `https://${MARK.toLowerCase()}.example.com` }, "K3 endpoint is not a bare");
await failCase("FAIL · endpoint over http", { endpoint: GOOD_ENDPOINT.replace("https:", "http:") }, "K3 endpoint is not a bare");
await failCase("FAIL · endpoint with uppercase account id", { endpoint: GOOD_ENDPOINT.toUpperCase().replace("HTTPS://", "https://") }, "K3 endpoint is not a bare");
await failCase("FAIL · endpoint that is not a string", { endpoint: { host: MARK } }, "K3 endpoint is not a string");
await failCase("FAIL · bucket_name built from two names", { bucket_name: `50mm-staging/../${MARK}` }, "K1 bucket_name is not a plain bucket name");
await failCase("FAIL · bucket_name names the video lane", { bucket_name: `${MARK.toLowerCase()}-video` }, "K1 bucket_name names a video bucket");
await failCase("FAIL · bucket_name missing", { bucket_name: undefined }, "K1 bucket_name is missing or not a string");
await failCase("FAIL · all three at once", { bucket_name: `${MARK}`, path_prefix: `/${MARK}`, endpoint: `${GOOD_ENDPOINT}/${MARK}` },
  "K1 bucket_name is not a plain bucket name", "K2 path_prefix is outside the key grammar", "K3 endpoint is not a bare");

say(`\n${failed === 0 ? "ALL EXPECTATIONS MET" : `${failed} EXPECTATION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
