import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Save, UserPlus, Shield, DollarSign, AlertTriangle, Users, CheckCircle, XCircle } from "lucide-react";
import { User } from "@supabase/supabase-js";

interface ReferralSettings {
  enabled: boolean;
  referrer_amount: number;
  referee_bonus: number;
  min_qualifying_amount: number;
  monthly_cap: number;
  fraud_detection: boolean;
  manual_approval: boolean;
}

interface ReferralRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  status: string;
  reward_amount: number;
  created_at: string;
  rewarded_at: string | null;
  referrer_name?: string;
  referred_name?: string;
}

const defaults: ReferralSettings = {
  enabled: true,
  referrer_amount: 1.0,
  referee_bonus: 0.5,
  min_qualifying_amount: 0,
  monthly_cap: 10,
  fraud_detection: false,
  manual_approval: false,
};

const AdminReferrals = ({ user }: { user: User | null }) => {
  const qc = useQueryClient();
  const [settings, setSettings] = useState<ReferralSettings>(defaults);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: "approve" | "reject" } | null>(null);

  useEffect(() => {
    const load = async () => {
      const [settingsRes, referralsRes] = await Promise.all([
        supabase.from("site_settings").select("value").eq("key", "referral_reward").maybeSingle(),
        (supabase.from("referrals" as any).select("*").order("created_at", { ascending: false }).limit(50) as any),
      ]);

      if (settingsRes.data?.value) {
        const v = settingsRes.data.value as any;
        setSettings({
          enabled: v.enabled ?? defaults.enabled,
          referrer_amount: v.referrer_amount ?? v.amount ?? defaults.referrer_amount,
          referee_bonus: v.referee_bonus ?? defaults.referee_bonus,
          min_qualifying_amount: v.min_qualifying_amount ?? defaults.min_qualifying_amount,
          monthly_cap: v.monthly_cap ?? defaults.monthly_cap,
          fraud_detection: v.fraud_detection ?? defaults.fraud_detection,
          manual_approval: v.manual_approval ?? defaults.manual_approval,
        });
      }

      if (referralsRes.data && referralsRes.data.length > 0) {
        const allIds = [...new Set([
          ...referralsRes.data.map((r: any) => r.referrer_id),
          ...referralsRes.data.map((r: any) => r.referred_id),
        ])];
        const nameMap = await cachedFetchProfilesByIds(allIds);
        setReferrals(
          referralsRes.data.map((r: any) => ({
            ...r,
            referrer_name: nameMap.get(r.referrer_id) || "Unknown",
            referred_name: nameMap.get(r.referred_id) || "Unknown",
          }))
        );
      }

      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "referral_reward",
      value: settings as any,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Referral settings saved" });
    }
  };

  const handleApprove = async (id: string) => {
    const ref = referrals.find((r) => r.id === id);
    if (!ref) return;
    try {
      const { error } = await (supabase.rpc("process_referral_reward" as any, {
        _referred_user_id: ref.referred_id,
        _activity_type: "manual approval",
      }) as any);
      if (error) {
        toast({ title: "Reward failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Reward processed" });
        setReferrals((prev) => prev.map((r) => r.id === id ? { ...r, status: "rewarded", rewarded_at: new Date().toISOString() } : r));
      }
    } catch (err: unknown) {
      toast({ title: "Reward failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
    setConfirmAction(null);
  };

  const handleReject = async (id: string) => {
    try {
      const { error } = await (supabase.from("referrals" as any).update({ status: "rejected" } as any).eq("id", id) as any);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Referral rejected" });
        setReferrals((prev) => prev.map((r) => r.id === id ? { ...r, status: "rejected" } : r));
      }
    } catch (err: unknown) {
      toast({ title: "Reject failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
    setConfirmAction(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const pendingReferrals = referrals.filter((r) => r.status === "pending");
  const totalRewarded = referrals.filter((r) => r.status === "rewarded").reduce((s, r) => s + (r.reward_amount || 0), 0);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-light mb-1" style={{ fontFamily: "var(--font-display)" }}>
          Referral <em className="italic text-primary">Program</em>
        </h2>
        <p className="text-sm text-muted-foreground">Configure referral rewards, caps, and fraud controls.</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Referrals", value: referrals.length, icon: Users },
          { label: "Pending", value: pendingReferrals.length, icon: AlertTriangle },
          { label: "Rewarded", value: referrals.filter((r) => r.status === "rewarded").length, icon: CheckCircle },
          { label: "Total Paid Out", value: formatUSDFixed(totalRewarded), icon: DollarSign },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5 pb-4 text-center">
              <s.icon className="h-5 w-5 mx-auto mb-1.5 text-primary/50" />
              <div className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{s.value}</div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5" style={{ fontFamily: "var(--font-heading)" }}>{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Program Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm tracking-[0.15em] uppercase flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <UserPlus className="h-4 w-4 text-primary" />
            Program Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Enable Referral Program</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Toggle the entire referral system on or off</p>
            </div>
            <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))} />
          </div>

          <Separator />

          {/* Reward Amounts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Referrer Reward ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settings.referrer_amount}
                onChange={(e) => setSettings((s) => ({ ...s, referrer_amount: Math.min(100, parseFloat(e.target.value) || 0) }))}
              />
              <p className="text-[10px] text-muted-foreground">Amount credited to the user who invited the friend</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Referee Welcome Bonus ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settings.referee_bonus}
                onChange={(e) => setSettings((s) => ({ ...s, referee_bonus: Math.min(100, parseFloat(e.target.value) || 0) }))}
              />
              <p className="text-[10px] text-muted-foreground">Bonus credited to the new user who signed up via referral</p>
            </div>
          </div>

          <Separator />

          {/* Qualifying & Caps */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Min Qualifying Transaction ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={settings.min_qualifying_amount}
                onChange={(e) => setSettings((s) => ({ ...s, min_qualifying_amount: parseFloat(e.target.value) || 0 }))}
              />
              <p className="text-[10px] text-muted-foreground">Referee's first paid transaction must be at least this amount to trigger reward. Set 0 for any amount.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Monthly Referral Cap</Label>
              <Input
                type="number"
                min="1"
                value={settings.monthly_cap}
                onChange={(e) => setSettings((s) => ({ ...s, monthly_cap: parseInt(e.target.value) || 1 }))}
              />
              <p className="text-[10px] text-muted-foreground">Max number of referral rewards a user can earn per month</p>
            </div>
          </div>

          <Separator />

          {/* Security Controls */}
          <div className="space-y-4">
            <h4 className="text-xs tracking-[0.15em] uppercase font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
              <Shield className="h-3.5 w-3.5 text-primary" />
              Security Controls
            </h4>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Fraud Detection</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Flag referrals from same IP, device, or rapid sign-ups</p>
              </div>
              <Switch checked={settings.fraud_detection} onCheckedChange={(v) => setSettings((s) => ({ ...s, fraud_detection: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Manual Approval</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Require admin approval before rewards are distributed</p>
              </div>
              <Switch checked={settings.manual_approval} onCheckedChange={(v) => setSettings((s) => ({ ...s, manual_approval: v }))} />
            </div>
          </div>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span className="text-xs uppercase tracking-wider">Save Settings</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pending Approvals (visible when manual approval is on) */}
      {settings.manual_approval && pendingReferrals.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm tracking-[0.15em] uppercase flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Pending Approvals
              <Badge variant="secondary" className="ml-auto text-[9px]">{pendingReferrals.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] uppercase tracking-wider">Referrer</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Referred</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingReferrals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{r.referrer_name}</TableCell>
                    <TableCell className="text-sm">{r.referred_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1.5 justify-end">
                        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => setConfirmAction({ id: r.id, type: "approve" })}>
                          <CheckCircle className="h-3 w-3" /> Approve
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 text-destructive" onClick={() => setConfirmAction({ id: r.id, type: "reject" })}>
                          <XCircle className="h-3 w-3" /> Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Referrals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm tracking-[0.15em] uppercase flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <Users className="h-4 w-4 text-primary" />
            All Referrals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No referrals yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] uppercase tracking-wider">Referrer</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Referred</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Reward</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{r.referrer_name}</TableCell>
                    <TableCell className="text-sm">{r.referred_name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={r.status === "rewarded" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}
                        className="text-[9px] uppercase tracking-wider"
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {r.status === "rewarded" ? formatUSDFixed(r.reward_amount || 0) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.type === "approve" ? "Approve Referral Reward" : "Reject Referral"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "approve"
                ? "This will process the referral reward and credit the referrer's wallet. This action is logged."
                : "This will reject the referral. No reward will be issued."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction?.type === "approve" ? handleApprove(confirmAction.id) : handleReject(confirmAction!.id)}
              className={confirmAction?.type === "reject" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {confirmAction?.type === "approve" ? "Approve" : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminReferrals;
