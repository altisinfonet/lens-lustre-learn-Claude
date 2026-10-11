import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import puppeteer from "puppeteer-core";
const [,, S, KEY] = process.argv;
const html = `<!doctype html><script>window.rt = (key) => new Promise((res) => { let ws; try { ws = new WebSocket("wss://fpszggreishhuvdpkmdr.supabase.co/realtime/v1/websocket?apikey=" + key + "&vsn=1.0.0"); } catch (e) { return res("BLOCKED (" + e.name + ")"); }
 ws.onopen = () => { ws.close(); res("CONNECTED"); }; ws.onerror = () => res("BLOCKED/FAILED"); setTimeout(() => res("TIMEOUT"), 8000); });</script>`;
const serve = (csp) => async (route) => route.fulfill({ body: html, contentType: "text/html", headers: { "content-security-policy": csp } });
for (const which of ["old", "new"]) {
  const csp = readFileSync(`${S}/csp-rt-${which}.txt`, "utf8").trim();
  const line = [];
  for (const ch of ["chrome", "msedge"]) { const b = await chromium.launch({ channel: ch }); const p = await b.newPage(); await p.route("https://staging-csp-test.example/**", serve(csp)); await p.goto("https://staging-csp-test.example/"); line.push(`${ch}: ${await p.evaluate((k) => window.rt(k), KEY)}`); await b.close(); }
  console.log(which.toUpperCase().padEnd(4), "| realtime socket |", line.join(" | "));
}
