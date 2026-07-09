import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

const STORAGE_KEY = "cf-edge-checklist-v1";
const ROUTES = ["50mmretina.com/*", "www.50mmretina.com/*"];
const DOMAINS = ["https://50mmretina.com", "https://www.50mmretina.com"];
const CF_DASH = "https://dash.cloudflare.com/?to=/:account/workers/services/view/seo-edge-injector/production/settings";

type StepKey = "open" | "route1" | "route2" | "envs" | "verify";

interface CheckResult {
  url: string;
  ok: boolean;
  header: string | null;
  status: number | null;
  error?: string;
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] tracking-[0.15em] uppercase border border-border hover:border-primary hover:text-primary transition-colors"
      style={headingFont}
      type="button"
    >
      <Copy className="h-3 w-3" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function CloudflareEdgeChecklist() {
  const [done, setDone] = useState<Record<StepKey, boolean>>({
    open: false,
    route1: false,
    route2: false,
    envs: false,
    verify: false,
  });
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<CheckResult[] | null>(null);

  // Load persisted progress
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDone((d) => ({ ...d, ...JSON.parse(raw) }));
    } catch {}
  }, []);

  const toggle = (k: StepKey) => {
    setDone((d) => {
      const next = { ...d, [k]: !d[k] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const runVerify = useCallback(async () => {
    setChecking(true);
    setResults(null);
    const out: CheckResult[] = [];
    for (const url of DOMAINS) {
      try {
        // Cache-bust to force a fresh edge hit
        const res = await fetch(`${url}/?_cf_check=${Date.now()}`, {
          method: "GET",
          mode: "cors",
          cache: "no-store",
        });
        const header = res.headers.get("x-seo-edge");
        out.push({ url, ok: !!header, header, status: res.status });
      } catch (e: any) {
        // CORS will usually block header reads — fall back to opaque check
        out.push({
          url,
          ok: false,
          header: null,
          status: null,
          error: e?.message || "Browser blocked the response (likely CORS). Use the curl command below instead.",
        });
      }
    }
    setResults(out);
    if (out.every((r) => r.ok)) {
      toggle("verify");
    }
    setChecking(false);
  }, []);

  const allOk = results && results.every((r) => r.ok);
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <div className="border border-primary/40 bg-primary/[0.03] p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm tracking-[0.2em] uppercase text-primary mb-1" style={headingFont}>
            Cloudflare Edge Setup Checklist
          </h3>
          <p className="text-xs text-muted-foreground max-w-2xl" style={bodyFont}>
            One-click guided flow to bind the <code>seo-edge-injector</code> Worker to both
            domains and verify the <code>x-seo-edge</code> header is being injected.
          </p>
        </div>
        <div
          className="text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 border border-primary/40 text-primary"
          style={headingFont}
        >
          {completed}/5 Complete
        </div>
      </div>

      {/* Step 1 */}
      <Step
        n={1}
        active={done.open}
        title="Open the Worker settings"
        onToggle={() => toggle("open")}
      >
        <a
          href={CF_DASH}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => !done.open && toggle("open")}
          className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-[11px] tracking-[0.15em] uppercase hover:opacity-90"
          style={headingFont}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open Cloudflare Dashboard
        </a>
        <p className="text-[11px] text-muted-foreground mt-2" style={bodyFont}>
          Navigate to <strong>Workers & Pages → seo-edge-injector → Settings → Domains & Routes</strong>.
        </p>
      </Step>

      {/* Steps 2 & 3 — routes */}
      {ROUTES.map((route, i) => {
        const key = (i === 0 ? "route1" : "route2") as StepKey;
        return (
          <Step
            key={route}
            n={2 + i}
            active={done[key]}
            title={`Add route: ${route}`}
            onToggle={() => toggle(key)}
          >
            <p className="text-[11px] text-muted-foreground mb-2" style={bodyFont}>
              Click <strong>+ Add → Route</strong>. Pick zone <code>50mmretina.com</code>, paste the route below, choose <strong>Fail open (proceed)</strong>, then save.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="px-2 py-1 bg-muted text-[11px]">{route}</code>
              <CopyBtn value={route} />
            </div>
          </Step>
        );
      })}

      {/* Step 4 — envs */}
      <Step
        n={4}
        active={done.envs}
        title="Confirm environment variables"
        onToggle={() => toggle("envs")}
      >
        <p className="text-[11px] text-muted-foreground mb-2" style={bodyFont}>
          Under <strong>Variables and Secrets</strong>, confirm these exist (start in observe mode):
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
          {[
            ["ORIGIN_HOST", "lens-lustre-learn-claude.pages.dev"],
            ["SUPABASE_PROJECT_REF", "jtdtehuqtinjxropkkcn"],
            ["ENABLE_REWRITE", "false"],
            ["METADATA_FUNCTION_URL", "https://jtdtehuqtinjxropkkcn.functions.supabase.co/seo-route-metadata"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 border border-border px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-foreground" style={headingFont}>{k}</div>
                <div className="text-muted-foreground truncate font-mono">{v}</div>
              </div>
              <CopyBtn value={v} />
            </div>
          ))}
        </div>
      </Step>

      {/* Step 5 — verify */}
      <Step
        n={5}
        active={done.verify}
        title="Verify the x-seo-edge header"
        onToggle={() => toggle("verify")}
      >
        <div className="space-y-3">
          <button
            onClick={runVerify}
            disabled={checking}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-[11px] tracking-[0.15em] uppercase hover:opacity-90 disabled:opacity-60"
            style={headingFont}
            type="button"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {checking ? "Checking…" : "Check both domains now"}
          </button>

          {results && (
            <div className="space-y-2">
              {results.map((r) => (
                <div
                  key={r.url}
                  className={`border px-3 py-2 text-[11px] ${
                    r.ok
                      ? "border-primary/50 bg-primary/5 text-primary"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}
                  style={bodyFont}
                >
                  <div className="flex items-start gap-2">
                    {r.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 break-all">
                      <div className="font-mono">{r.url}</div>
                      {r.ok ? (
                        <div className="mt-0.5">
                          <span className="opacity-70">x-seo-edge:</span> <strong>{r.header}</strong>
                        </div>
                      ) : (
                        <div className="mt-0.5 opacity-90">
                          {r.error || "Header not present — Worker is not running on this route yet."}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {allOk && (
                <p className="text-[11px] text-primary" style={bodyFont}>
                  ✓ Worker is live on both domains. Flip <code>ENABLE_REWRITE = true</code> when ready to inject SEO tags.
                </p>
              )}
            </div>
          )}

          <div className="border border-border p-3 space-y-2">
            <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
              Manual verify (curl / DevTools)
            </div>
            <div className="space-y-1.5">
              {DOMAINS.map((d) => {
                const cmd = `curl -sI ${d}/ | grep -i x-seo-edge`;
                return (
                  <div key={d} className="flex items-center gap-2 flex-wrap">
                    <code className="px-2 py-1 bg-muted text-[11px] flex-1 min-w-0 truncate">{cmd}</code>
                    <CopyBtn value={cmd} />
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground" style={bodyFont}>
              In DevTools: open the site → Network → Doc filter → click the root request →
              Response Headers → look for <code>x-seo-edge</code> (expected:{" "}
              <code>observe</code> or <code>injected:*</code>).
            </p>
          </div>
        </div>
      </Step>
    </div>
  );
}

function Step({
  n,
  title,
  active,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  active: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`border ${active ? "border-primary/50 bg-primary/5" : "border-border"} p-4`}>
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="mt-0.5 shrink-0 text-primary hover:opacity-80 transition-opacity"
          aria-label={active ? "Mark step as incomplete" : "Mark step as complete"}
          type="button"
        >
          {active ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
        </button>
        <div className="min-w-0 flex-1">
          <div
            className={`text-[11px] tracking-[0.2em] uppercase mb-2 ${active ? "text-primary line-through opacity-70" : "text-foreground"}`}
            style={headingFont}
          >
            Step {n} — {title}
          </div>
          <div className={active ? "opacity-70" : ""}>{children}</div>
        </div>
      </div>
    </div>
  );
}
