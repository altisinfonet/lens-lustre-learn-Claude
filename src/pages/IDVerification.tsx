// Public staff ID verification.
//   /IDverification            → enter an ID number
//   /IDverification=<ID>       → shows the (public) staff record for that ID
// Lookup is via the verify_staff_id RPC (exact match only — the staff table
// itself is not publicly readable, so records can't be listed or enumerated).
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  BadgeCheck, ShieldAlert, ShieldX, Loader2, Search, Droplets, CalendarDays, CalendarX2, IdCard,
} from "lucide-react";

interface StaffRecord {
  id_number: string;
  full_name: string;
  designation: string;
  photo_url: string | null;
  blood_group: string;
  about: string;
  active_from: string | null;
  expires_on: string | null;
  job_status: "active" | "inactive";
}

/** Extract the ID from /IDverification=<ID> (also accepts /IDverification/<ID> and ?id=). */
export function extractIdFromLocation(pathname: string, search: string, param?: string): string | null {
  if (param) return decodeURIComponent(param);
  const m = pathname.match(/\/IDverification=(.+)$/i);
  if (m) return decodeURIComponent(m[1]);
  const qs = new URLSearchParams(search).get("id");
  return qs ? qs : null;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;

export default function IDVerification() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ idNumber?: string }>();

  const idFromUrl = useMemo(
    () => extractIdFromLocation(location.pathname, location.search, params.idNumber),
    [location.pathname, location.search, params.idNumber],
  );

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [staff, setStaff] = useState<StaffRecord | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStaff(null);
    setNotFound(false);
    if (!idFromUrl) return;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("verify_staff_id" as any, { _id_number: idFromUrl });
      if (cancelled) return;
      setLoading(false);
      const row = Array.isArray(data) ? (data[0] as StaffRecord | undefined) : (data as StaffRecord | null);
      if (error || !row) { setNotFound(true); return; }
      setStaff(row);
    })();
    return () => { cancelled = true; };
  }, [idFromUrl]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (!id) return;
    navigate(`/IDverification=${encodeURIComponent(id)}`);
  };

  const expired = staff?.expires_on ? new Date(staff.expires_on + "T23:59:59") < new Date() : false;
  const effectiveActive = staff?.job_status === "active" && !expired;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <IdCard className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">Staff ID Verification</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Verify the identity of 50mm Retina World office staff. Enter the ID number
          printed on the staff ID card, or scan its QR code.
        </p>
      </div>

      {/* Lookup form (always available) */}
      <form onSubmit={submit} className="mx-auto mb-10 flex max-w-md gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter staff ID number…"
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Staff ID number"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Verify
        </button>
      </form>

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && idFromUrl && notFound && (
        <div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
          <ShieldX className="mx-auto mb-2 h-8 w-8 text-red-500" />
          <h2 className="font-semibold text-red-700 dark:text-red-300">No matching staff ID</h2>
          <p className="mt-1 text-sm text-red-600/80 dark:text-red-300/80">
            <span className="font-mono">{idFromUrl}</span> is not a valid 50mm Retina World staff ID.
            Treat any ID card carrying it as unverified.
          </p>
        </div>
      )}

      {!loading && staff && (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-lg">
          {/* status banner */}
          <div
            className={
              effectiveActive
                ? "flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 py-2.5 text-sm font-semibold tracking-wide text-white"
                : "flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-2.5 text-sm font-semibold tracking-wide text-white"
            }
          >
            {effectiveActive ? <BadgeCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {effectiveActive
              ? "VERIFIED — ACTIVE STAFF MEMBER"
              : expired
                ? "ID EXPIRED — NO LONGER VALID"
                : "INACTIVE — NO LONGER A STAFF MEMBER"}
          </div>

          {/* identity header on a soft brand band, photo overlapping */}
          <div className="relative">
            <div className="h-20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent" />
            <div className="pointer-events-none absolute right-4 top-3 opacity-[0.07]">
              <IdCard className="h-16 w-16" />
            </div>
            <div className="-mt-14 flex flex-col items-center gap-4 px-6 pb-2 sm:flex-row sm:items-end sm:px-8">
              {staff.photo_url ? (
                <img
                  src={staff.photo_url}
                  alt={staff.full_name}
                  className="h-28 w-28 shrink-0 rounded-full border-4 border-card object-cover shadow-lg ring-2 ring-primary/20"
                />
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-4 border-card bg-muted text-3xl font-bold text-muted-foreground shadow-lg ring-2 ring-primary/20">
                  {staff.full_name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1 pb-1 text-center sm:text-left">
                <h2 className="text-xl font-bold leading-tight sm:text-2xl">{staff.full_name}</h2>
                {staff.designation && (
                  <p className="mt-0.5 text-sm font-medium text-primary/90">{staff.designation}</p>
                )}
              </div>
              <div className="shrink-0 pb-1">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 font-mono text-xs font-semibold tracking-wider">
                  <IdCard className="h-3.5 w-3.5" />
                  {staff.id_number}
                </span>
              </div>
            </div>
          </div>

          <div className="px-6 pb-6 pt-4 sm:px-8">
            {staff.about && (
              <p className="mx-auto max-w-prose text-center text-sm leading-relaxed text-muted-foreground sm:text-left">
                {staff.about}
              </p>
            )}

            {/* stat tiles: label row on top, value below — nothing competes for width */}
            <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {staff.blood_group && (
                <div className="flex flex-col items-center gap-1 rounded-xl border bg-muted/40 px-3 py-3.5 text-center">
                  <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Droplets className="h-3.5 w-3.5 text-red-500" /> Blood Group
                  </dt>
                  <dd className="text-base font-bold">{staff.blood_group}</dd>
                </div>
              )}
              {staff.active_from && (
                <div className="flex flex-col items-center gap-1 rounded-xl border bg-muted/40 px-3 py-3.5 text-center">
                  <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" /> Active From
                  </dt>
                  <dd className="text-base font-bold">{fmtDate(staff.active_from)}</dd>
                </div>
              )}
              {staff.expires_on && (
                <div className="flex flex-col items-center gap-1 rounded-xl border bg-muted/40 px-3 py-3.5 text-center">
                  <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <CalendarX2 className="h-3.5 w-3.5" /> Expiry
                  </dt>
                  <dd className={expired ? "text-base font-bold text-red-600" : "text-base font-bold"}>
                    {fmtDate(staff.expires_on)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="border-t bg-muted/40 px-6 py-3 text-center text-xs text-muted-foreground">
            This verification is provided by 50mm Retina World. If the details shown do not match
            the person or card in front of you, do not rely on the ID.
          </div>
        </div>
      )}
    </div>
  );
}
