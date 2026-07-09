import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, Trash2, Power } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface TestAgentRun {
  id: string;
  run_id: string;
  trigger: string;
  commit_sha: string | null;
  branch: string | null;
  status: "passed" | "failed" | "partial";
  rpc_parity_pass: boolean | null;
  nr_drift_5min: number | null;
  dual_emit_status: string | null;
  tsc_pass: boolean | null;
  vitest_pass: boolean | null;
  eslint_pass: boolean | null;
  failures: Array<{ check: string; error: string }>;
  duration_ms: number | null;
  github_run_url: string | null;
  created_at: string;
}

interface HealthSnapshot {
  rpc_parity_pass: boolean;
  rpc_parity_sample_size: number;
  rpc_parity_mismatch_count: number;
  nr_drift_5min: number;
  nr_drift_24h: number;
  dual_emit_status: string;
  super_admin_email: string | null;
  checked_at: string;
}

interface AgentConfig {
  enabled: boolean;
  interval_minutes: number;
}

const INTERVAL_OPTIONS = [5, 15, 30, 60];

const StatusBadge = ({ status }: { status: string }) => {
  if (status === "passed")
    return <Badge variant="outline" className="border-green-500/50 text-green-400 bg-green-500/10"><CheckCircle2 className="h-3 w-3 mr-1" />passed</Badge>;
  if (status === "failed")
    return <Badge variant="outline" className="border-red-500/50 text-red-400 bg-red-500/10"><XCircle className="h-3 w-3 mr-1" />failed</Badge>;
  return <Badge variant="outline" className="border-yellow-500/50 text-yellow-400 bg-yellow-500/10"><AlertCircle className="h-3 w-3 mr-1" />{status}</Badge>;
};

const Bool = ({ v }: { v: boolean | null }) =>
  v === null ? <span className="text-muted-foreground">—</span>
    : v ? <span className="text-green-400">✓</span> : <span className="text-red-400">✗</span>;

export default function AdminTestAgent() {
  const [runs, setRuns] = useState<TestAgentRun[]>([]);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const [runsRes, healthRes, cfgRes] = await Promise.all([
      supabase.from("test_agent_runs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.rpc("get_test_agent_health_admin"),
      supabase.from("test_agent_config").select("enabled, interval_minutes").eq("id", true).maybeSingle(),
    ]);
    if (runsRes.data) setRuns(runsRes.data as unknown as TestAgentRun[]);
    if (healthRes.data && Array.isArray(healthRes.data) && healthRes.data[0])
      setHealth(healthRes.data[0] as HealthSnapshot);
    if (cfgRes.data) setConfig(cfgRes.data as AgentConfig);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  const updateConfig = async (patch: Partial<AgentConfig>) => {
    if (!config) return;
    setSavingConfig(true);
    const next = { ...config, ...patch };
    setConfig(next);
    const { error } = await supabase
      .from("test_agent_config")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", true);
    setSavingConfig(false);
    if (error) {
      toast.error(`Failed to save: ${error.message}`);
      load();
    } else {
      toast.success(patch.enabled !== undefined ? `Test Agent ${patch.enabled ? "enabled" : "disabled"}` : `Interval set to ${patch.interval_minutes} min`);
    }
  };

  const toggleSelect = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  const toggleSelectAll = () => {
    if (selected.size === runs.length) setSelected(new Set());
    else setSelected(new Set(runs.map(r => r.id)));
  };

  const bulkDelete = async (mode: "selected" | "all") => {
    setDeleting(true);
    let q = supabase.from("test_agent_runs").delete();
    if (mode === "selected") {
      q = q.in("id", Array.from(selected));
    } else {
      q = q.gte("created_at", "1970-01-01");
    }
    const { error } = await q;
    setDeleting(false);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
    } else {
      toast.success(mode === "all" ? "All logs cleared" : `Deleted ${selected.size} log(s)`);
      setSelected(new Set());
      load();
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const last = runs[0];
  const last24hPassed = runs.filter(r => new Date(r.created_at) > new Date(Date.now() - 24*3600*1000) && r.status === "passed").length;
  const last24hFailed = runs.filter(r => new Date(r.created_at) > new Date(Date.now() - 24*3600*1000) && r.status === "failed").length;

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Test Agent</h1>
          <p className="text-sm text-muted-foreground mt-1">Admin-controlled CI runs. Triggered on every push and on the configured schedule.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Admin Controls */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Power className="h-4 w-4" /> Agent Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-6 items-start md:items-end">
          <div className="flex items-center gap-3">
            <Switch
              id="agent-enabled"
              checked={config?.enabled ?? false}
              onCheckedChange={(v) => updateConfig({ enabled: v })}
              disabled={savingConfig}
            />
            <Label htmlFor="agent-enabled" className="text-sm">
              {config?.enabled ? <span className="text-green-400">ON</span> : <span className="text-red-400">OFF</span>}
            </Label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Run interval</Label>
            <Select
              value={String(config?.interval_minutes ?? 5)}
              onValueChange={(v) => updateConfig({ interval_minutes: Number(v) })}
              disabled={savingConfig || !config?.enabled}
            >
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map(m => (
                  <SelectItem key={m} value={String(m)}>
                    Every {m === 60 ? "1 hour" : `${m} minutes`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground md:ml-auto max-w-sm">
            Push events always trigger the agent (when ON). Scheduled runs respect the interval above.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Last Run</CardTitle></CardHeader>
          <CardContent>
            {last ? (
              <div>
                <StatusBadge status={last.status} />
                <p className="text-xs text-muted-foreground mt-2">
                  {formatDistanceToNow(new Date(last.created_at), { addSuffix: true })}
                </p>
              </div>
            ) : <p className="text-sm text-muted-foreground">No runs yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">24h Passed</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-green-400">{last24hPassed}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">24h Failed</CardTitle></CardHeader>
          <CardContent><p className={`text-2xl font-semibold ${last24hFailed ? 'text-red-400' : 'text-muted-foreground'}`}>{last24hFailed}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">NR Drift (24h)</CardTitle></CardHeader>
          <CardContent><p className={`text-2xl font-semibold ${(health?.nr_drift_24h ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>{health?.nr_drift_24h ?? '—'}</p></CardContent>
        </Card>
      </div>

      {health && (
        <Card>
          <CardHeader><CardTitle className="text-base">Live Health Snapshot</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-muted-foreground text-xs">RPC parity</div><div><Bool v={health.rpc_parity_pass} /> {health.dual_emit_status}</div></div>
            <div><div className="text-muted-foreground text-xs">Sample size</div><div>{health.rpc_parity_sample_size}</div></div>
            <div><div className="text-muted-foreground text-xs">Mismatches</div><div className={health.rpc_parity_mismatch_count > 0 ? 'text-red-400' : ''}>{health.rpc_parity_mismatch_count}</div></div>
            <div><div className="text-muted-foreground text-xs">NR drift 5min</div><div className={(health.nr_drift_5min ?? 0) > 0 ? 'text-red-400' : ''}>{health.nr_drift_5min}</div></div>
            <div className="col-span-full text-xs text-muted-foreground">Alert recipient: {health.super_admin_email ?? '(none configured)'}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent Runs ({runs.length})</CardTitle>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deleting}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete {selected.size} selected
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selected.size} log(s)?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes the selected Test Agent run records. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => bulkDelete("selected")} className="bg-destructive hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {runs.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={deleting}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Clear all logs
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear ALL Test Agent logs?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes every Test Agent run record in the database.
                      The agent will continue running and creating new logs.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => bulkDelete("all")} className="bg-destructive hover:bg-destructive/90">
                      Delete all
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border/50">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 w-8">
                    <Checkbox
                      checked={runs.length > 0 && selected.size === runs.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Trigger</th>
                  <th className="px-3 py-2">Commit</th>
                  <th className="px-3 py-2 text-center">tsc</th>
                  <th className="px-3 py-2 text-center">vitest</th>
                  <th className="px-3 py-2 text-center">eslint</th>
                  <th className="px-3 py-2 text-center">parity</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Run</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">No runs yet. Push a commit or wait for the configured interval.</td></tr>
                )}
                {runs.map(r => (
                  <tr key={r.id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="px-3 py-1.5">
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggleSelect(r.id)}
                        aria-label={`Select run ${r.run_id}`}
                      />
                    </td>
                    <td className="px-3 py-1.5">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.trigger}</td>
                    <td className="px-3 py-1.5 font-mono">{r.commit_sha?.slice(0,7) ?? '—'}</td>
                    <td className="px-3 py-1.5 text-center"><Bool v={r.tsc_pass} /></td>
                    <td className="px-3 py-1.5 text-center"><Bool v={r.vitest_pass} /></td>
                    <td className="px-3 py-1.5 text-center"><Bool v={r.eslint_pass} /></td>
                    <td className="px-3 py-1.5 text-center"><Bool v={r.rpc_parity_pass} /></td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.duration_ms ? `${(r.duration_ms/1000).toFixed(1)}s` : '—'}</td>
                    <td className="px-3 py-1.5">{r.github_run_url ? <a href={r.github_run_url} target="_blank" rel="noopener" className="text-primary hover:underline">↗</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Where to find proof</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>Every run produces 4 sources of truth:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>This dashboard</strong> — live, queryable, sortable, bulk-deletable.</li>
            <li><code className="text-xs">.lovable/test-reports/latest.md</code> + <code className="text-xs">history/</code> — committed back to the repo.</li>
            <li><strong>GitHub Actions</strong> tab — Job Summary + downloadable artifact (90-day retention).</li>
            <li><strong>Email + GitHub issue</strong> on failure (auto-closes when the next run is green).</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
