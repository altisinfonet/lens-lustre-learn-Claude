# Smart Photo Plan — U6 competition full-size auto-delete (+ the one retire path)

Owner decision 5: keep a competition entry's full-size photo until judging +
results final + 30 days, then delete it automatically; the 2048 copy stays;
admin / judge download keeps working while the full size exists.

## "Results final" — measured from the live schema (2026-11-03)

Results are published **per round** (`competition_round_publish`, one row per
competition × round, `published_at`). Round **4** is the final result: the live
trigger `sync_competition_result_state_from_round_publish` sets the competition
to `phase = status = 'result'`, `judging_completed = true` exactly when the
round-4 row gets a `published_at`, and puts it back to judging when that is
cleared. So: **results final at = round-4 `published_at`, while it is set**
(`competition_results_final_at()`); due = that + 30 days. Staging: 2
competitions, round 1 published on one, none final. Production: no competition
visible to the anon read (the PROBE reports the real counts as the database).

## How it works

1. **Daily database job** `competition-fullsize-retire` (04:10 UTC) runs
   `competition_fullsize_mark(false)`. While the switch
   **`competition_fullsize_purge`** is not "All members" it changes nothing.
2. When on: each due **v2** entry photo (`…-l4f.webp`, whose credited 2048 copy
   `…-l4f-r2048.webp` the uploader stored first) is swapped in
   `competition_entries.photos[i]` to its 2048 copy (per entry, audited in
   `photo_retire`), then queued `due`. Any file still named in **any** public
   text / array / json column (a featured photo, a certificate, a post …) is
   `kept` with the place named. Old (pre-v2) entry photos have no 2048 copy and
   are **never** touched.
3. **`photo-retire.yml`** (05:10 UTC daily on production, kind `comp_full`
   only; by hand on either lane, dry-run by default) calls
   `/api/media/retire` with the converter account: claim (admin / converter
   only, rows marked in the last 24 h), a second key check
   (`src/lib/media/photoRetire.ts` — never a 2048/1080/600/320 copy), HEAD for
   bytes, delete, record. Dry run = count + bytes, nothing deleted.

The same list, route, tool and workflow serve U7 (kind `post_old`), which only
an Owner-gated migration can fill.

## Admin cards

Before U6 neither photo switch had a card on Admin (the page drops unknown
features), so the Owner could not click `photo_set_v2`. Added: **Admin → Photos
→ New Photos** (`photo_set_v2`) and **Admin → Photos → Competition Full Size**
(`competition_fullsize_purge`), admin-only.

## Safety

* Switch created Off; nothing is queued while it is off (PROBE B5, fixture).
* Rollback (`20261110_0103_photo_retire_ROLLBACK.sql`) puts every swapped entry
  photo back on its full size, removes job / functions / list / switch, and
  refuses once a file has been deleted (it cannot come back).
* Fixture `scripts/db-photo-retire-fixture.mjs` on both lane shapes (CI
  `d1-photo-retire-fixture.yml`).
