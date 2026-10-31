import { useState, useEffect, useRef, useCallback } from "react";
import { Gift, Loader2, Users, Mail, UserCheck, UserPlus, Calendar, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { formatUSDFixed } from "@/lib/currencyFormat";
import type { User } from "@supabase/supabase-js";
import { useT } from "@/i18n/I18nContext";

interface Props {
  user: User | null;
}

type TargetType = "email" | "role" | "all" | "new_registration";

interface UserSuggestion {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

const roleOptions = [
  { value: "user", label: "All Users" },
  { value: "registered_photographer", label: "Registered Photographers" },
  { value: "student", label: "Students" },
  { value: "judge", label: "Judges" },
  { value: "content_editor", label: "Content Editors" },
];

const AdminGiftCredit = ({ user }: Props) => {
  const t = useT();
  const [targetType, setTargetType] = useState<TargetType>("all");
  const [email, setEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState("user");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [autoApplyFuture, setAutoApplyFuture] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [processing, setProcessing] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [activeAutoGift, setActiveAutoGift] = useState<any>(null);
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  
  // Email autocomplete state
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSuggestion | null>(null);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search users by email
  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    setSearchingUsers(true);
    try {
      const { data } = await supabase.rpc("admin_search_users", {
        search_query: query,
        search_by: "email",
      });
      const mapped: UserSuggestion[] = (data || []).map((u: any) => ({
        id: u.id,
        email: u.email || "",
        full_name: u.full_name,
        avatar_url: u.avatar_url,
      }));
      setSuggestions(mapped);
      setShowSuggestions(mapped.length > 0);
    } catch { setSuggestions([]); }
    setSearchingUsers(false);
  }, []);

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setSelectedUser(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchUsers(value), 300);
  };

  const selectUser = (u: UserSuggestion) => {
    setEmail(u.email);
    setSelectedUser(u);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const clearSelectedUser = () => {
    setEmail("");
    setSelectedUser(null);
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    fetchHistory();
    fetchAutoGift();
  }, []);

  const fetchHistory = async () => {
    const { data } = await supabase
      .from("gift_credits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory(data || []);
  };

  const fetchAutoGift = async () => {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "new_registration_gift")
      .maybeSingle();
    if (data?.value) setActiveAutoGift(data.value);
  };

  const handleSendGift = async () => {
    if (!user) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast({ title: t("wal.enterValidAmount"), variant: "destructive" }); return; }
    if (!reason.trim()) { toast({ title: t("dash.provideReason"), variant: "destructive" }); return; }

    const expiresAt = hasExpiry && expiryDate ? new Date(expiryDate + "T23:59:59.999Z").toISOString() : null;

    setProcessing(true);

    try {
      let targetUserIds: string[] = [];
      let targetValue = "";

      if (targetType === "email") {
        if (!email.trim()) { toast({ title: t("gc.enterEmail"), variant: "destructive" }); setProcessing(false); return; }
        targetValue = email.trim();
      } else if (targetType === "role") {
        const { data: roleUsers } = await supabase.from("user_roles").select("user_id").eq("role", selectedRole as any);
        targetUserIds = roleUsers?.map(r => r.user_id) || [];
        targetValue = selectedRole;
      } else if (targetType === "all") {
        const { data: allProfiles } = await supabase.from("profiles").select("id").limit(1000);
        targetUserIds = allProfiles?.map(p => p.id) || [];
        targetValue = "all";
      } else if (targetType === "new_registration") {
        if (autoApplyFuture) {
          await supabase.from("site_settings").upsert({
            key: "new_registration_gift",
            value: { amount: amt, reason: reason.trim(), active: true, expires_days: hasExpiry && expiryDate ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86400000) : null },
            updated_at: new Date().toISOString(),
            updated_by: user.id,
          });
          setActiveAutoGift({ amount: amt, reason: reason.trim(), active: true });
          toast({ title: t("gc.autoActivated") });
          setProcessing(false);
          fetchHistory();
          return;
        }
        if (!dateFrom || !dateTo) { toast({ title: t("gc.selectDateRange"), variant: "destructive" }); setProcessing(false); return; }
        const { data: newUsers } = await supabase.from("profiles").select("id")
          .gte("created_at", new Date(dateFrom).toISOString())
          .lte("created_at", new Date(dateTo + "T23:59:59").toISOString());
        targetUserIds = newUsers?.map(p => p.id) || [];
        targetValue = JSON.stringify({ from: dateFrom, to: dateTo });
      }

      if (targetType === "email") {
        const { data, error } = await supabase.functions.invoke("send-gift-credit", {
          body: {
            admin_id: user.id,
            target_type: "email",
            target_email: email.trim(),
            amount: amt,
            reason: reason.trim(),
            expires_at: expiresAt,
          },
        });
        if (error) throw error;
        toast({ title: `${t("gc.giftSent")} · $${amt} → ${email.trim()}` });
      } else {
        if (targetUserIds.length === 0) {
          toast({ title: t("au.noUsersFound"), variant: "destructive" });
          setProcessing(false);
          return;
        }

        const { data: giftCredit, error: gcError } = await supabase
          .from("gift_credits")
          .insert({
            admin_id: user.id,
            amount: amt,
            reason: reason.trim(),
            target_type: targetType,
            target_value: targetValue,
            recipients_count: targetUserIds.length,
            expires_at: expiresAt,
          })
          .select("id")
          .single();

        if (gcError) throw gcError;

        for (const uid of targetUserIds) {
          await supabase.rpc("admin_wallet_credit", {
            _admin_id: user.id,
            _target_user_id: uid,
            _amount: amt,
            _type: "gift",
            _description: reason.trim(),
            _reference_id: giftCredit.id,
            _reference_type: "gift_credit",
            _metadata: expiresAt ? { expires_at: expiresAt } : null,
          });

          await supabase.from("gift_announcements").insert({
            user_id: uid,
            gift_credit_id: giftCredit.id,
            amount: amt,
            reason: reason.trim(),
            expires_at: expiresAt,
          });
        }

        await supabase.functions.invoke("send-gift-credit", {
          body: {
            admin_id: user.id,
            target_type: targetType,
            user_ids: targetUserIds,
            amount: amt,
            reason: reason.trim(),
            gift_credit_id: giftCredit.id,
            expires_at: expiresAt,
          },
        });

        toast({ title: `🎁 ${t("gc.giftSent")} · ${targetUserIds.length}` });
      }

      setAmount("");
      setReason("");
      setEmail("");
      setHasExpiry(false);
      setExpiryDate("");
      fetchHistory();
    } catch (err: any) {
      toast({ title: "Gift failed", description: err.message, variant: "destructive" });
    }

    setProcessing(false);
  };

  const disableAutoGift = async () => {
    await supabase.from("site_settings").upsert({
      key: "new_registration_gift",
      value: { ...activeAutoGift, active: false },
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    });
    setActiveAutoGift(null);
    toast({ title: "Auto-gift disabled" });
  };

  const targetTypeOptions: { value: TargetType; label: string; icon: any }[] = [
    { value: "email", label: t("gc.byEmail"), icon: Mail },
    { value: "role", label: t("gc.byRole"), icon: UserCheck },
    { value: "all", label: t("gc.allUsers"), icon: Users },
    { value: "new_registration", label: t("gc.newRegistrations"), icon: UserPlus },
  ];

  return (
    <div className="space-y-6">
      {/* Active Auto-Gift Banner */}
      {activeAutoGift?.active && (
        <div className="border border-primary/40 bg-primary/5 p-4 rounded-sm flex items-center justify-between flex-wrap gap-3">
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase text-primary block mb-1" style={{ fontFamily: "var(--font-heading)" }}>
              {t("gc.autoGiftActive")}
            </span>
            <p className="text-xs text-muted-foreground">
              {t("gc.everyNewUser")} <strong>${activeAutoGift.amount}</strong> — "{activeAutoGift.reason}"
            </p>
          </div>
          <button onClick={disableAutoGift}
            className="px-3 py-1.5 border border-destructive text-destructive text-[10px] tracking-[0.15em] uppercase hover:bg-destructive hover:text-destructive-foreground transition-all rounded-sm"
            style={{ fontFamily: "var(--font-heading)" }}>
            {t("gc.disable")}
          </button>
        </div>
      )}

      {/* Gift Credit Form */}
      <div className="border border-border p-5 rounded-sm space-y-4">
        <span className="text-[10px] tracking-[0.2em] uppercase text-primary block" style={{ fontFamily: "var(--font-heading)" }}>
          <Gift className="h-3.5 w-3.5 inline mr-2" />Bulk Gift Credit
        </span>

        {/* Target Type */}
        <div className="flex flex-wrap gap-2">
          {targetTypeOptions.map(opt => (
            <button key={opt.value} onClick={() => setTargetType(opt.value)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase border transition-all rounded-sm ${
                targetType === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-foreground/50"
              }`} style={{ fontFamily: "var(--font-heading)" }}>
              <opt.icon className="h-3 w-3" /> {opt.label}
            </button>
          ))}
        </div>

        {/* Target-specific */}
        {targetType === "email" && (
          <div className="space-y-2">
            {/* Selected user preview */}
            {selectedUser ? (
              <div className="flex items-center gap-3 border border-primary/40 bg-primary/5 rounded-sm px-3 py-2.5">
                {selectedUser.avatar_url ? (
                  <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={selectedUser.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover border border-border" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase">
                    {(selectedUser.full_name || selectedUser.email)?.[0] || "?"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-heading)" }}>
                    {selectedUser.full_name || t("gc.noName")}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{selectedUser.email}</p>
                </div>
                <button onClick={clearSelectedUser} className="p-1 hover:bg-muted rounded-sm transition-colors">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="relative" ref={suggestionsRef}>
                <input
                  type="email"
                  value={email}
                  onChange={e => handleEmailChange(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  placeholder={t("gc.phEmailSearch")}
                  className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary"
                />
                {searchingUsers && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-border bg-background rounded-sm shadow-lg max-h-48 overflow-y-auto">
                    {suggestions.map(u => (
                      <button
                        key={u.id}
                        onClick={() => selectUser(u)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left"
                      >
                        {u.avatar_url ? (
                          <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={u.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-border" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground uppercase">
                            {(u.full_name || u.email)?.[0] || "?"}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{u.full_name || "No Name"}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {targetType === "role" && (
          <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
            className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer">
            {roleOptions.map(r => <option key={r.value} value={r.value}>{r.value === "user" ? t("gc.allUsers") : r.value === "registered_photographer" ? t("gc.regPhotographers") : r.value === "student" ? t("gc.students") : r.value === "judge" ? t("cm.thJudges") : r.value === "content_editor" ? t("gc.contentEditors") : r.label}</option>)}
          </select>
        )}
        {targetType === "new_registration" && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={autoApplyFuture} onChange={e => setAutoApplyFuture(e.target.checked)} className="accent-primary" />
              {t("gc.autoApply")}
            </label>
            {!autoApplyFuture && (
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From"
                  className="bg-transparent border border-border rounded-sm px-3 py-2 text-xs outline-none focus:border-primary" />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To"
                  className="bg-transparent border border-border rounded-sm px-3 py-2 text-xs outline-none focus:border-primary" />
              </div>
            )}
          </div>
        )}

        {/* Amount, Reason, Expiry */}
        <div className="grid md:grid-cols-2 gap-3">
          <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder={t("aw.amountUsd")}
            className="bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary" />
          <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder={t("gc.phReason")}
            className="bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>

        {/* Expiry Option */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={hasExpiry} onChange={e => setHasExpiry(e.target.checked)} className="accent-primary" />
            {t("gc.setExpiry")}
          </label>
          {hasExpiry && (
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            </div>
          )}
          {!hasExpiry && (
            <span className="text-[10px] text-muted-foreground italic">{t("gc.noExpiryPermanent")}</span>
          )}
        </div>

        <button onClick={handleSendGift} disabled={processing}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-[10px] tracking-[0.2em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50 rounded-sm"
          style={{ fontFamily: "var(--font-heading)" }}>
          {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />}
          {t("gc.sendGift")}
        </button>
      </div>

      {/* Gift History */}
      {history.length > 0 && (
        <div>
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>
            {t("gc.giftHistory")} ({history.length})
          </span>
          <div className="border border-border rounded-sm divide-y divide-border">
            {history.map((g: any) => (
              <div key={g.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                      {formatUSDFixed(Number(g.amount))}
                    </span>
                    <span className="text-[10px] text-muted-foreground">→</span>
                    <span className="text-[10px] text-muted-foreground">
                      {g.target_type === "all" ? t("gc.allUsers") : g.target_type === "role" ? `${t("gc.roleLabel")} ${g.target_value}` : g.target_type === "email" ? g.target_value : t("gc.newRegistrations")}
                    </span>
                    <span className="text-[8px] px-1.5 py-0.5 border border-primary/30 text-primary rounded-sm uppercase tracking-wider">{g.status}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    <span>"{g.reason}"</span>
                    <span>·</span>
                    <span>{g.recipients_count} recipient(s)</span>
                    <span>·</span>
                    <span>{new Date(g.created_at).toLocaleDateString()}</span>
                    {g.expires_at ? (
                      <>
                        <span>·</span>
                        <span className="text-yellow-600">Expires: {new Date(g.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      </>
                    ) : (
                      <>
                        <span>·</span>
                        <span className="text-primary">{t("wal.noExpiry")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminGiftCredit;
