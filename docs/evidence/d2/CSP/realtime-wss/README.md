# CSP · Supabase Realtime socket blocked in Chrome/Edge (staging AND production)

**Found:** 2026-10-11 during the VID-1 cross-browser run. Real Chrome and Edge on https://staging.50mmretina.com/ and https://www.50mmretina.com/ both report:
```
connect-src → wss://<project>.supabase.co/realtime/v1/websocket?apikey=…
```
connect-src allowed https://*.supabase.co but not wss://*.supabase.co, so supabase-js Realtime (presence dots, live notifications/comments/counters, P3 subscriptions) could not open its socket. Firefox reported no violation (it matches wss: against the https: host source).

**Change:** connect-src + `wss://*.supabase.co wss://*.supabase.in` (same two hosts already allowed over https:). Nothing else.

**Proof** (rt-proof.mjs: page served with the staging policy, old = origin/staging, new = this PR; real Chrome + Edge open the staging Realtime socket with the public anon key):
```
OLD  | realtime socket | chrome: BLOCKED/FAILED | msedge: BLOCKED/FAILED
NEW  | realtime socket | chrome: CONNECTED | msedge: CONNECTED
```
Production check (edge-csp.mjs, SITE=https://www.50mmretina.com/): same connect-src violation for wss://jtdtehuqtinjxropkkcn.supabase.co in Chrome and Edge.

Also seen, NOT changed here (separate decision): Cloudflare Web Analytics beacon (static.cloudflareinsights.com) blocked by script-src on both lanes.
