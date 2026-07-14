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
  d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;

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
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* status banner */}
          <div
            className={
              effectiveActive
                ? "flex items-center justify-center gap-2 bg-emerald-600 py-2.5 text-sm font-semibold text-white"
                : "flex items-center justify-center gap-2 bg-red-600 py-2.5 text-sm font-semibold text-white"
            }
          >
            {effectiveActive ? <BadgeCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {effectiveActive
              ? "VERIFIED — ACTIVE STAFF MEMBER"
              : expired
                ? "ID EXPIRED — NO LONGER VALID"
                : "INACTIVE — NO LONGER A STAFF MEMBER"}
          </div>

          <div className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-start sm:p-8">
            {staff.photo_url ? (
              <img
                src={staff.photo_url}
                alt={staff.full_name}
                className="h-32 w-32 shrink-0 rounded-full border-4 border-background object-cover shadow-md"
              />
            ) : (
              <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-muted text-3xl font-bold text-muted-foreground">
                {staff.full_name.slice(0, 2).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h2 className="text-xl font-bold">{staff.full_name}</h2>
              {staff.designation && <p className="text-sm text-muted-foreground">{staff.designation}</p>}
              <p className="mt-1 font-mono text-sm">
                ID: <span className="font-semibold">{staff.id_number}</span>
              </p>

              {staff.about && (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{staff.about}</p>
              )}

              <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                {staff.blood_group && (
                  <div className="flex items-center justify-center gap-1.5 rounded-md bg-muted/60 px-3 py-2 sm:justify-start">
                    <Droplets className="h-4 w-4 text-red-500" />
                    <span className="text-muted-foreground">Blood</span>
                    <span className="font-semibold">{staff.blood_group}</span>
                  </div>
                )}
                {staff.active_from && (
                  <div className="flex items-center justify-center gap-1.5 rounded-md bg-muted/60 px-3 py-2 sm:justify-start">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">From</span>
                    <span className="font-semibold">{fmtDate(staff.active_from)}</span>
                  </div>
                )}
                {staff.expires_on && (
                  <div className="flex items-center justify-center gap-1.5 rounded-md bg-muted/60 px-3 py-2 sm:justify-start">
                    <CalendarX2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Expiry</span>
                    <span className={expired ? "font-semibold text-red-600" : "font-semibold"}>{fmtDate(staff.expires_on)}</span>
                  </div>
                )}
              </dl>
            </div>
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
