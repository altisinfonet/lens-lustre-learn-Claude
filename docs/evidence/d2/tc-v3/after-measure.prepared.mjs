/**
 * TC-v3 · AFTER measurement · PREPARED, NOT RUN.
 *
 *   node docs/evidence/d2/tc-v3/after-measure.prepared.mjs
 *
 * One command once v3 has landed and the client change is on staging. Writes
 * JSON to stdout and PNGs beside itself. Read-only: it loads pages, it never
 * signs in, submits, or writes anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ CORRECTION TO THE EGRESS INSTRUCTION — read before running
 *
 * The Auditor's instruction of 2026-09-03 says to "use the container proxy the
 * way curl did (HTTPS_PROXY env into Playwright's launch proxy option) — that
 * was the configuration that returned 200."
 *
 * **That is not what returned 200.** The 200 was curl. Measured in this
 * container on 2026-09-03:
 *
 *   curl direct                          -> 403
 *   curl -x http://127.0.0.1:41787       -> 200
 *   Playwright, default egress                     09:19:36-09:20:14Z -> ERR_CONNECTION_RESET
 *   Playwright, proxy:{server:'http://127.0.0.1:41787'}, --ignore-certificate-errors
 *                                                  09:20:43-09:21:21Z -> ERR_CONNECTION_RESET
 *   Playwright, --proxy-server=…41787, --proxy-bypass-list=<-loopback>,
 *               ignoreHTTPSErrors, NODE_EXTRA_CA_CERTS ~09:22Z        -> ERR_CONNECTION_RESET
 *
 * The exact configuration the instruction names is attempt 2, and it failed.
 * The proxy serves curl and resets Chromium. This script is written to that
 * configuration anyway, as instructed, but it PREFLIGHTS the egress and exits
 * non-zero with a clear message rather than emitting empty geometry that would
 * read as a measurement. **If it aborts, run it from an environment that has
 * egress — CI, or the Owner's machine — not from this container.**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT PRODUCES
 *
 * Two runs per viewport, and the labels are not interchangeable:
 *   REAL         — staging's own data, untouched.
 *   SUBSTITUTED  — the profiles response is rewritten in flight so every
 *                  display name becomes the 21-character production name.
 *                  Nothing is written to any database. Auditor ruling, Rev 6.
 *
 * Staging's longest eligible name is 12 characters, shorter than the row §3.1
 * calls the tightest, so REAL alone cannot exercise the width risk. That is why
 * SUBSTITUTED exists, and why its numbers are never reported as staging's.
 *
 * ⚠ A SUBSTITUTED run proves the LAYOUT only. It says nothing about the data,
 * and it must never be cited for the §3.4 descending check.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);

// Global install in this container; plain 'playwright' elsewhere.
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = (await import('/home/claude/.npm-global/lib/node_modules/playwright/index.js')).default); }

/** Production's longest display name eligible for the card.
 *  Measured read-only on jtdtehuqtinjxropkkcn, 2026-09-03 09:18:25.228393Z. */
const SUBSTITUTED_LONGEST_NAME = 'Partha Sarathi Moulik'; // 21 chars

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || null;
const TARGET = process.env.TC_V3_URL || 'https://staging.50mmretina.com/';

const VIEWPORTS = [
  // The phone case §3.1 obligation 1 is about: does a taller row push
  // anything below it off-screen.
  { name: 'phone-360x800', width: 360, height: 800, dsr: 3, mobile: true },
  // Desktop, where the card is md:col-span-4 — its REAL width in the grid,
  // not the card measured in isolation.
  { name: 'desktop-1280x800', width: 1280, height: 800, dsr: 1, mobile: false },
];

// ── preflight ────────────────────────────────────────────────────────────────
// Prove egress before launching a browser, so a failure is diagnosed rather
// than reported as zero-width elements.
try {
  const args = PROXY ? ['-x', PROXY] : [];
  const code = execSync(
    `curl -s -o /dev/null -w '%{http_code}' -m 20 ${args.map(a => `'${a}'`).join(' ')} '${TARGET}'`,
    { encoding: 'utf8' }
  ).trim();
  if (code !== '200') throw new Error(`curl returned ${code}`);
  console.error(`preflight: curl -> 200 via ${PROXY ? PROXY : 'direct'}`);
} catch (e) {
  console.error(`ABORT — no egress to ${TARGET}: ${e.message}`);
  console.error('Run this from CI or a machine with network access. Emitting no numbers.');
  process.exit(2);
}

// ── the in-page probe ────────────────────────────────────────────────────────
const probe = () => {
  const px = n => Math.round(n * 100) / 100;
  const h3 = [...document.querySelectorAll('h3')]
    .find(e => /top contributors/i.test(e.textContent || ''));
  if (!h3) return { error: 'card heading not found — did the card render?' };

  let card = h3;
  for (let i = 0; i < 6 && card.parentElement; i++) {
    card = card.parentElement;
    if (card.className && /rounded-xl/.test(String(card.className))) break;
  }
  const cardBox = card.getBoundingClientRect();

  const rows = [...card.querySelectorAll('div.rounded-lg')]
    .filter(d => /px-3/.test(String(d.className || '')) && d.querySelector('img, .uppercase'));

  const vh = window.innerHeight;
  return {
    cardHeight: px(cardBox.height),
    cardWidth: px(cardBox.width),
    cardBottomY: px(cardBox.bottom),
    viewportHeight: vh,
    // Obligation 1: do the taller rows push the card past the fold?
    cardExtendsBelowFold: cardBox.bottom > vh,
    rowCount: rows.length,
    rows: rows.map(r => {
      const nameEl = r.querySelector('.truncate');
      const cs = nameEl ? getComputedStyle(nameEl) : null;
      const spans = [...r.querySelectorAll('span, div')].map(s => (s.textContent || '').trim());
      const bar = r.querySelector('div[style*="width"]');
      return {
        rowHeight: px(r.getBoundingClientRect().height),
        name: nameEl ? (nameEl.textContent || '').trim() : null,
        nameChars: nameEl ? (nameEl.textContent || '').trim().length : null,
        nameBoxWidth: nameEl ? px(nameEl.getBoundingClientRect().width) : null,
        nameClientWidth: nameEl ? nameEl.clientWidth : null,
        nameScrollWidth: nameEl ? nameEl.scrollWidth : null,
        // The ellipsis question, answered by LAYOUT — which is why this runs in
        // a real engine and not in jsdom, where both widths are always 0.
        isTruncated: nameEl ? nameEl.scrollWidth > nameEl.clientWidth : null,
        textOverflow: cs ? cs.textOverflow : null,
        whiteSpace: cs ? cs.whiteSpace : null,
        overflow: cs ? cs.overflow : null,
        // Both figures, so the §3.4 descending check reads the PRIMARY one.
        primary30d: spans.find(t => /^✦/.test(t)) ?? null,
        lifetimeLine: spans.find(t => /^Lifetime\b/.test(t)) ?? null,
        tabularNumsCount: [...r.querySelectorAll('*')]
          .filter(e => /tabular-nums/.test(String(e.className || ''))).length,
        barWidthStyle: bar ? bar.style.width : null,
      };
    }),
  };
};

const toInt = s => (s ? Number(String(s).replace(/[^\d]/g, '')) : NaN);

// ── run ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
  args: ['--no-sandbox', '--ignore-certificate-errors'],
});

const results = [];
for (const v of VIEWPORTS) {
  for (const mode of ['REAL', 'SUBSTITUTED']) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.dsr,
      isMobile: v.mobile,
      hasTouch: v.mobile,
      ignoreHTTPSErrors: true,
      ...(v.mobile ? { userAgent:
        'Mozilla/5.0 (Linux; Android 13; moto g54 5G) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' } : {}),
    });
    const page = await ctx.newPage();

    if (mode === 'SUBSTITUTED') {
      // Rewrite display names in flight. Read path only — no write is issued,
      // and staging's stored data is not modified.
      await page.route('**/rest/v1/**', async route => {
        const res = await route.fetch();
        const ct = res.headers()['content-type'] || '';
        if (!/json/.test(ct)) return route.fulfill({ response: res });
        let body;
        try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
        const swap = o => (o && typeof o === 'object' && 'full_name' in o)
          ? { ...o, full_name: SUBSTITUTED_LONGEST_NAME } : o;
        const out = Array.isArray(body) ? body.map(swap) : swap(body);
        return route.fulfill({ response: res, body: JSON.stringify(out) });
      });
    }

    const rec = { viewport: v.name, mode, url: TARGET, measured_utc: new Date().toISOString() };
    try {
      await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
      // framer-motion uses whileInView with viewport={{once:true}}: the rows do
      // not animate in — and therefore do not lay out — until scrolled to.
      await page.evaluate(() => {
        const h = [...document.querySelectorAll('h3')]
          .find(e => /top contributors/i.test(e.textContent || ''));
        if (h) h.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(3000);
      Object.assign(rec, await page.evaluate(probe));

      const shot = path.join(HERE, `after-${v.name}-${mode}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      rec.screenshot = shot;

      // §3.4, the check that decides whether this worked. REAL runs only —
      // a SUBSTITUTED run has had its data rewritten and proves nothing here.
      if (mode === 'REAL' && rec.rows?.length) {
        const n = rec.rows.map(r => toInt(r.primary30d));
        rec.gate_3_4_displayed_numbers = n;
        rec.gate_3_4_descending =
          n.every(Number.isFinite) && n.every((x, i) => i === 0 || n[i - 1] >= x);
      }
    } catch (e) {
      rec.error = String(e).split('\n')[0];
    }
    results.push(rec);
    await ctx.close();
  }
}
await browser.close();

console.log(JSON.stringify({
  unit: 'OWNER-RULING-2026-09-03-02, client half',
  substituted_name: SUBSTITUTED_LONGEST_NAME,
  substituted_name_chars: SUBSTITUTED_LONGEST_NAME.length,
  note: 'SUBSTITUTED runs prove layout only. Never cite them for the §3.4 descending check.',
  results,
}, null, 2));

const gate = results.find(r => r.mode === 'REAL' && 'gate_3_4_descending' in r);
if (gate && gate.gate_3_4_descending === false) {
  console.error('\n§3.4 GATE FAILED: displayed numbers do not descend —', gate.gate_3_4_displayed_numbers);
  console.error('STOP and report. The ranking field and the displayed field still disagree.');
  process.exit(1);
}
