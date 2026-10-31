import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Mail, Eye, EyeOff, Save, TestTube, Send, CheckCircle, XCircle, ChevronDown, ChevronUp, ShieldCheck, ShieldX, ShieldQuestion, Info } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SmtpSettings, LogEntry, SettingsSectionProps } from "./SettingsTypes";
import { defaultSmtp, inputClass, labelClass } from "./SettingsTypes";
import type { EmailProvider } from "./SettingsTypes";

function LogIcon({ status }: { status: LogEntry["status"] }) {
  switch (status) {
    case "ok": return <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />;
    case "error": return <XCircle className="h-3 w-3 text-destructive shrink-0" />;
    case "warn": return <span className="h-3 w-3 text-yellow-500 shrink-0">⚠</span>;
    default: return <Info className="h-3 w-3 text-muted-foreground shrink-0" />;
  }
}

interface Props extends SettingsSectionProps {
  smtp: SmtpSettings;
  setSmtp: React.Dispatch<React.SetStateAction<SmtpSettings>>;
}

export default function EmailSettingsSection({ user, smtp, setSmtp }: Props) {
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testLogs, setTestLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<{ valid: boolean; message: string } | null>(null);
  const [verifyingKey, setVerifyingKey] = useState(false);

  const saveSmtp = async () => {
    if (!user) return;
    setSavingSmtp(true);
    const cleaned: SmtpSettings = {
      ...smtp,
      api_key: (smtp.api_key || "").trim(),
      from_email: (smtp.from_email || "").trim(),
      from_name: (smtp.from_name || "").trim(),
    };
    const { data, error } = await supabase.functions.invoke("admin-secure-settings", {
      body: { action: "write", key: "smtp_settings", value: cleaned },
    });
    setSavingSmtp(false);
    if (error || data?.error) {
      toast({ title: "Failed to save SMTP settings", description: error?.message || data?.error, variant: "destructive" });
    } else {
      setSmtp(cleaned);
      toast({ title: "SMTP settings saved" });
    }
  };

  const testSmtp = async () => {
    if (!testEmail.trim()) {
      toast({ title: "Enter a test email address", variant: "destructive" });
      return;
    }
    if (!smtp.host || !smtp.username || !smtp.password) {
      toast({ title: "Please fill in SMTP host, username, and password first", variant: "destructive" });
      return;
    }
    setTestingSmtp(true);
    setTestResult(null);
    setTestLogs([]);
    setShowLogs(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-smtp", {
        body: { to_email: testEmail.trim(), smtp_config: smtp },
      });
      if (error) throw error;
      if (data?.logs) setTestLogs(data.logs);
      if (data?.error) {
        setTestResult({ success: false, message: data.error });
        toast({ title: "SMTP test failed", description: data.error, variant: "destructive" });
      } else {
        setTestResult({ success: data?.success ?? false, message: data?.message || "Test completed" });
        if (data?.success) {
          toast({ title: "SMTP test completed" });
        } else {
          toast({ title: "SMTP test completed with warnings", variant: "destructive" });
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to reach test endpoint";
      setTestResult({ success: false, message });
      toast({ title: "SMTP test failed", description: message, variant: "destructive" });
    }
    setTestingSmtp(false);
  };

  const verifyApiKey = async () => {
    if (!smtp.api_key || smtp.provider === "smtp") return;
    setVerifyingKey(true);
    setApiKeyStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke("verify-email-provider", {
        body: { provider: smtp.provider, api_key: smtp.api_key },
      });
      if (error) throw error;
      setApiKeyStatus({ valid: data?.valid ?? false, message: data?.message || "Unknown" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Verification failed";
      setApiKeyStatus({ valid: false, message });
    }
    setVerifyingKey(false);
  };

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card/50">
        <Mail className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>Email Provider Settings</h3>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Email Provider</label>
            <select className={inputClass} value={smtp.provider} onChange={(e) => setSmtp({ ...smtp, provider: e.target.value as EmailProvider })}>
              <option value="brevo">Brevo (Sendinblue)</option>
              <option value="resend">Resend</option>
              <option value="sendgrid">SendGrid</option>
              <option value="smtp">Custom SMTP</option>
            </select>
          </div>
          {smtp.provider !== "smtp" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelClass + " mb-0"} style={{ fontFamily: "var(--font-heading)" }}>
                  {smtp.provider === "brevo" ? "Brevo" : smtp.provider === "resend" ? "Resend" : "SendGrid"} API Key
                </label>
                {apiKeyStatus && (
                  <span className={`inline-flex items-center gap-1 text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-sm ${apiKeyStatus.valid ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"}`} style={{ fontFamily: "var(--font-heading)" }}>
                    {apiKeyStatus.valid ? <ShieldCheck className="h-2.5 w-2.5" /> : <ShieldX className="h-2.5 w-2.5" />}
                    {apiKeyStatus.valid ? "Verified" : "Invalid"}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input className={inputClass + " pr-10"} type={showSmtpPass ? "text" : "password"} placeholder="Enter API key" value={smtp.api_key} onChange={(e) => { setSmtp({ ...smtp, api_key: e.target.value }); setApiKeyStatus(null); }} />
                  <button onClick={() => setShowSmtpPass(!showSmtpPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showSmtpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <button onClick={verifyApiKey} disabled={verifyingKey || !smtp.api_key}
                  className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2.5 border border-border bg-muted/30 text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 shrink-0 rounded-sm"
                  style={{ fontFamily: "var(--font-heading)" }}>
                  {verifyingKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldQuestion className="h-3 w-3" />}
                  Verify
                </button>
              </div>
              {apiKeyStatus && (
                <p className={`text-[10px] mt-1.5 ${apiKeyStatus.valid ? "text-green-600" : "text-destructive"}`} style={{ fontFamily: "var(--font-body)" }}>
                  {apiKeyStatus.message}
                </p>
              )}
            </div>
          )}
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>From Email</label>
            <input className={inputClass} placeholder="noreply@50mmretina.com" value={smtp.from_email} onChange={(e) => setSmtp({ ...smtp, from_email: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>From Name</label>
            <input className={inputClass} placeholder="50mm Retina" value={smtp.from_name} onChange={(e) => setSmtp({ ...smtp, from_name: e.target.value })} />
          </div>
          {smtp.provider === "smtp" && (
            <>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>SMTP Host</label>
                <input className={inputClass} placeholder="smtp.gmail.com" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Port</label>
                <input className={inputClass} placeholder="587" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Username / Email</label>
                <input className={inputClass} placeholder="noreply@example.com" value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Password</label>
                <div className="relative">
                  <input className={inputClass + " pr-10"} type={showSmtpPass ? "text" : "password"} placeholder="••••••••" value={smtp.password} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} />
                  <button onClick={() => setShowSmtpPass(!showSmtpPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showSmtpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Encryption</label>
                <select className={inputClass} value={smtp.encryption} onChange={(e) => setSmtp({ ...smtp, encryption: e.target.value as SmtpSettings["encryption"] })}>
                  <option value="tls">TLS</option>
                  <option value="ssl">SSL</option>
                  <option value="none">None</option>
                </select>
              </div>
            </>
          )}
        </div>
        {smtp.provider !== "smtp" && (
          <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            {smtp.provider === "brevo" && "Get your API key from Brevo Dashboard → SMTP & API → API Keys"}
            {smtp.provider === "resend" && "Get your API key from resend.com/api-keys"}
            {smtp.provider === "sendgrid" && "Get your API key from SendGrid → Settings → API Keys"}
          </p>
        )}
        {smtp.provider === "smtp" && (
          <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            ⚠️ Custom SMTP uses configuration validation only. For actual email delivery, use Brevo, Resend, or SendGrid.
          </p>
        )}
        <div className="flex items-center gap-3 pt-2">
          <button onClick={saveSmtp} disabled={savingSmtp}
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}>
            {savingSmtp ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save SMTP Settings
          </button>
        </div>

        {/* Test SMTP Section */}
        <div className="border-t border-border pt-5 mt-5">
          <div className="flex items-center gap-2 mb-3">
            <TestTube className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Test SMTP Connection</span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3" style={{ fontFamily: "var(--font-body)" }}>
            Run a diagnostic test on your SMTP configuration. Full log report will be generated.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input type="email" value={testEmail} onChange={(e) => { setTestEmail(e.target.value); setTestResult(null); setTestLogs([]); setShowLogs(false); }}
              placeholder="Enter test email address" className={inputClass + " sm:max-w-xs"} style={{ fontFamily: "var(--font-body)" }} />
            <button onClick={testSmtp} disabled={testingSmtp || !testEmail.trim()}
              className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
              style={{ fontFamily: "var(--font-heading)" }}>
              {testingSmtp ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send Test Email
            </button>
          </div>

          {testResult && (
            <div className={`mt-3 flex items-start gap-2 px-4 py-3 border rounded-sm text-xs ${testResult.success ? "border-primary/40 bg-primary/5 text-primary" : "border-destructive/40 bg-destructive/5 text-destructive"}`} style={{ fontFamily: "var(--font-body)" }}>
              {testResult.success ? <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span>{testResult.message}</span>
            </div>
          )}

          {testLogs.length > 0 && (
            <div className="mt-3">
              <button onClick={() => setShowLogs(!showLogs)}
                className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-4 py-2 border border-border bg-muted/30 text-foreground hover:bg-muted/60 transition-colors"
                style={{ fontFamily: "var(--font-heading)" }}>
                {showLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showLogs ? "Hide" : "Show"} Log Report ({testLogs.length} entries)
              </button>

              {showLogs && (
                <div className="mt-2 border border-border rounded-sm overflow-hidden bg-card">
                  <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                    <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>SMTP Test Log Report</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {testLogs.filter(l => l.status === "ok").length} ok · {testLogs.filter(l => l.status === "warn").length} warn · {testLogs.filter(l => l.status === "error").length} error
                    </span>
                  </div>
                  <ScrollArea className="max-h-72">
                    <div className="divide-y divide-border/50">
                      {testLogs.map((entry, i) => (
                        <div key={i} className="px-4 py-2 flex items-start gap-3 text-xs hover:bg-muted/20 transition-colors">
                          <LogIcon status={entry.status} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-medium text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{entry.step}</span>
                              <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${
                                entry.status === "ok" ? "bg-green-500/10 text-green-600" :
                                entry.status === "error" ? "bg-destructive/10 text-destructive" :
                                entry.status === "warn" ? "bg-yellow-500/10 text-yellow-600" :
                                "bg-muted text-muted-foreground"
                              }`} style={{ fontFamily: "var(--font-heading)" }}>{entry.status}</span>
                            </div>
                            <p className="text-muted-foreground break-all leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>{entry.detail}</p>
                          </div>
                          <span className="text-[9px] text-muted-foreground/60 font-mono shrink-0 hidden sm:block">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
