import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Check, Users, Gift, Share2, Link as LinkIcon, Loader2, UserPlus, DollarSign, Mail, Send } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
};

interface Referral {
  id: string;
  referred_id: string;
  status: string;
  reward_amount: number;
  created_at: string;
  rewarded_at: string | null;
  referred_name?: string;
}

const Referrals = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);

  const generateCode = useCallback(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }, []);

  const fetchData = useCallback(async () => {
    if (!user) return;

    // Fetch or create referral code
    const { data: codeData } = await (supabase
      .from("referral_codes" as any)
      .select("code")
      .eq("user_id", user.id)
      .maybeSingle() as any);

    if (codeData) {
      setReferralCode(codeData.code);
    } else {
      // Auto-generate code
      setGenerating(true);
      const code = generateCode();
      const { error } = await (supabase.from("referral_codes" as any).insert({
        user_id: user.id,
        code,
      } as any) as any);
      if (!error) {
        setReferralCode(code);
      }
      setGenerating(false);
    }

    // Fetch referrals
    const { data: refs } = await (supabase
      .from("referrals" as any)
      .select("id, referred_id, status, reward_amount, created_at, rewarded_at")
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false }) as any);

    if (refs && refs.length > 0) {
      const userIds = refs.map((r) => r.referred_id);
      const { data: profiles } = await supabase
        .from("profiles_public")
        .select("id, full_name")
        .in("id", userIds);
      const nameMap = new Map(profiles?.map((p) => [p.id, p.full_name]) || []);
      setReferrals(refs.map((r) => ({ ...r, referred_name: nameMap.get(r.referred_id) || "Photographer" })));
    } else {
      setReferrals([]);
    }

    setLoading(false);
  }, [user, generateCode]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/login"); return; }
    if (isAdmin) { navigate("/admin"); return; }
    fetchData();
  }, [user, authLoading, isAdmin, navigate, fetchData]);

  const referralLink = referralCode
    ? `${window.location.origin}/signup?ref=${referralCode}`
    : "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({ title: "Referral link copied!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({
        title: "Join me on 50mm Retina World!",
        text: "Sign up using my referral link and we both earn rewards!",
        url: referralLink,
      });
    } else {
      handleCopy();
    }
  };

  const handleEmailInvite = () => {
    if (!inviteEmail.trim() || !referralLink) return;
    const emails = inviteEmail.split(",").map(e => e.trim()).filter(Boolean);
    const invalidEmails = emails.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (invalidEmails.length > 0) {
      toast({ title: "Invalid email(s)", description: invalidEmails.join(", "), variant: "destructive" });
      return;
    }
    const subject = encodeURIComponent("Join me on 50mm Retina World!");
    const body = encodeURIComponent(
      `Hey!\n\nI'd love for you to join 50mm Retina World — a photography community where you can showcase your work, enter competitions, and learn from others.\n\nSign up using my referral link and we both earn rewards:\n${referralLink}\n\nSee you there!`
    );
    const mailto = `mailto:${emails.join(",")}?subject=${subject}&body=${body}`;
    window.open(mailto, "_blank");
    toast({ title: "Email client opened!", description: `Invitation ready for ${emails.length} friend(s).` });
    setInviteEmail("");
  };

  const totalRewards = referrals.filter(r => r.status === "rewarded").reduce((sum, r) => sum + (r.reward_amount || 0), 0);
  const pendingCount = referrals.filter(r => r.status === "pending").length;
  const rewardedCount = referrals.filter(r => r.status === "rewarded").length;

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto py-3 md:py-10">
<motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
          <h1 className="text-xl md:text-4xl font-light mt-3 md:mt-6 mb-1 md:mb-2" style={{ fontFamily: "var(--font-display)" }}>
            Invite <em className="italic text-primary">Friends</em>
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mb-4 md:mb-8">
            Share your referral link and earn wallet rewards when your friends make their first paid activity.
          </p>
        </motion.div>

        {/* Referral Link Card */}
        <motion.div initial="hidden" animate="visible" custom={1} variants={fadeUp}>
          <Card className="mb-4 md:mb-8 border-primary/20 rounded-xl md:rounded-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm tracking-[0.15em] uppercase flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
                <LinkIcon className="h-4 w-4 text-primary" />
                Your Referral Link
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 bg-muted/50 border border-border rounded-md px-4 py-3 text-sm font-mono truncate select-all">
                  {generating ? "Generating..." : referralLink}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy} disabled={!referralCode}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1.5 text-xs uppercase tracking-wider">{copied ? "Copied" : "Copy"}</span>
                  </Button>
                  <Button size="sm" onClick={handleShare} disabled={!referralCode}>
                    <Share2 className="h-4 w-4" />
                    <span className="ml-1.5 text-xs uppercase tracking-wider">Share</span>
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                Your code: <span className="font-mono font-bold text-primary">{referralCode || "..."}</span>
              </p>

              <Separator className="my-5" />

              {/* Invite by Email */}
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                  <Mail className="h-3.5 w-3.5" />
                  Invite Friends via Email
                </Label>
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <Input
                    type="email"
                    placeholder="friend@example.com (comma-separated for multiple)"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleEmailInvite()}
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleEmailInvite} disabled={!inviteEmail.trim() || !referralCode || sendingInvite} className="gap-1.5">
                    <Send className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wider">Send Invite</span>
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Enter one or more email addresses separated by commas. Opens your email client with a pre-filled invitation.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Stats */}
        <motion.div initial="hidden" animate="visible" custom={2} variants={fadeUp} className="grid grid-cols-3 gap-2 md:gap-4 mb-4 md:mb-8">
          <Card className="rounded-xl md:rounded-lg">
            <CardContent className="pt-4 md:pt-6 text-center px-2 md:px-6">
              <UserPlus className="h-5 w-5 md:h-8 md:w-8 mx-auto mb-1 md:mb-2 text-primary/60" />
              <div className="text-lg md:text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{referrals.length}</div>
              <p className="text-[9px] md:text-xs text-muted-foreground uppercase tracking-wider mt-0.5 md:mt-1" style={{ fontFamily: "var(--font-heading)" }}>
                Invites
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl md:rounded-lg">
            <CardContent className="pt-4 md:pt-6 text-center px-2 md:px-6">
              <Gift className="h-5 w-5 md:h-8 md:w-8 mx-auto mb-1 md:mb-2 text-primary/60" />
              <div className="text-lg md:text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{rewardedCount}</div>
              <p className="text-[9px] md:text-xs text-muted-foreground uppercase tracking-wider mt-0.5 md:mt-1" style={{ fontFamily: "var(--font-heading)" }}>
                Rewards
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl md:rounded-lg">
            <CardContent className="pt-4 md:pt-6 text-center px-2 md:px-6">
              <DollarSign className="h-5 w-5 md:h-8 md:w-8 mx-auto mb-1 md:mb-2 text-primary/60" />
              <div className="text-lg md:text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{formatUSDFixed(totalRewards)}</div>
              <p className="text-[9px] md:text-xs text-muted-foreground uppercase tracking-wider mt-0.5 md:mt-1" style={{ fontFamily: "var(--font-heading)" }}>
                Earned
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Referrals Table */}
        <motion.div initial="hidden" animate="visible" custom={3} variants={fadeUp}>
          <Card className="rounded-xl md:rounded-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm tracking-[0.15em] uppercase flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
                <Users className="h-4 w-4 text-primary" />
                Invited Friends
              </CardTitle>
            </CardHeader>
            <CardContent>
              {referrals.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No referrals yet. Share your link to start earning!</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase tracking-wider">Friend</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Reward</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrals.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{r.referred_name}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "rewarded" ? "default" : "secondary"} className="text-[9px] uppercase tracking-wider">
                            {r.status === "rewarded" ? "Rewarded" : "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {r.status === "rewarded" ? formatUSDFixed(r.reward_amount) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* How it works */}
        <motion.div initial="hidden" animate="visible" custom={4} variants={fadeUp} className="mt-4 md:mt-8">
          <Card className="bg-muted/30 rounded-xl md:rounded-lg">
            <CardContent className="pt-6">
              <h3 className="text-xs tracking-[0.2em] uppercase font-semibold mb-4" style={{ fontFamily: "var(--font-heading)" }}>
                How It Works
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm text-muted-foreground">
                <div className="flex gap-3">
                  <span className="text-2xl font-bold text-primary/30" style={{ fontFamily: "var(--font-display)" }}>1</span>
                  <p>Share your unique referral link with friends</p>
                </div>
                <div className="flex gap-3">
                  <span className="text-2xl font-bold text-primary/30" style={{ fontFamily: "var(--font-display)" }}>2</span>
                  <p>They sign up using your link</p>
                </div>
                <div className="flex gap-3">
                  <span className="text-2xl font-bold text-primary/30" style={{ fontFamily: "var(--font-display)" }}>3</span>
                  <p>You earn a wallet reward when they complete a paid activity</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </main>
  );
};

export default Referrals;
