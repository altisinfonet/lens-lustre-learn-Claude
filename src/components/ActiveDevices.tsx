import { useState } from "react";
import { Monitor, Smartphone, Tablet, LogOut, Loader2, Clock, Shield } from "lucide-react";
import { useUserDevices, useRemoveDevice, type UserDevice } from "@/hooks/profile/useUserDevices";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/core/use-toast";
import { formatDistanceToNow } from "date-fns";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

function DeviceIcon({ type }: { type: string | null }) {
  if (type === "mobile") return <Smartphone className="h-8 w-8 text-primary" />;
  if (type === "tablet") return <Tablet className="h-8 w-8 text-primary" />;
  return <Monitor className="h-8 w-8 text-primary" />;
}

function DeviceCard({
  device,
  onRemove,
  removing,
}: {
  device: UserDevice;
  onRemove: () => void;
  removing: boolean;
}) {
  const lastActive = formatDistanceToNow(new Date(device.last_active_at), { addSuffix: true });
  const firstSeen = formatDistanceToNow(new Date(device.created_at), { addSuffix: true });

  return (
    <div
      className={`border rounded-sm p-4 flex items-start gap-4 transition-colors ${
        device.is_current
          ? "border-primary/50 bg-primary/5"
          : "border-border bg-muted/10 hover:border-border/80"
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        <DeviceIcon type={device.device_type} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-foreground truncate" style={bodyFont}>
            {device.browser || "Unknown Browser"}
          </span>
          {device.is_current && (
            <span
              className="text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 rounded-sm"
              style={headingFont}
            >
              This Device
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground" style={bodyFont}>
          {device.os || "Unknown OS"} · {device.device_type || "desktop"}
        </p>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1" style={bodyFont}>
            <Clock className="h-2.5 w-2.5" /> Last active {lastActive}
          </span>
        </div>
        <span className="text-[9px] text-muted-foreground/50" style={bodyFont}>
          First seen {firstSeen}
        </span>
      </div>
      {!device.is_current && (
        <button
          onClick={onRemove}
          disabled={removing}
          className="flex-shrink-0 inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase px-2.5 py-1.5 border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
          style={headingFont}
        >
          {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
          Remove
        </button>
      )}
    </div>
  );
}

export default function ActiveDevices({ userId }: { userId: string }) {
  const { data: devices, isLoading } = useUserDevices(userId);
  const removeMutation = useRemoveDevice();
  const [signingOutAll, setSigningOutAll] = useState(false);
  const navigate = useNavigate();

  const handleSignOutAll = async () => {
    setSigningOutAll(true);
    try {
      // Remove all device records except current
      const currentDevice = devices?.find((d) => d.is_current);
      if (devices) {
        for (const d of devices) {
          if (!d.is_current) {
            await (supabase.from("user_devices" as any).delete().eq("id", d.id) as any);
          }
        }
      }
      // Global sign out
      await supabase.auth.signOut({ scope: "global" });
      navigate("/login", { replace: true });
    } catch {
      toast({ title: "Failed to sign out", variant: "destructive" });
      setSigningOutAll(false);
    }
  };

  if (isLoading) {
    return (
      <div className="border border-border p-4 md:p-5">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-3" style={headingFont}>
          <Shield className="h-3 w-3 inline mr-1.5" />Active Devices
        </span>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground flex items-center gap-1.5" style={headingFont}>
          <Shield className="h-3 w-3" />Active Devices
        </span>
        {devices && devices.length > 1 && (
          <button
            onClick={handleSignOutAll}
            disabled={signingOutAll}
            className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-2.5 py-1.5 border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            style={headingFont}
          >
            {signingOutAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
            Sign Out All Other Devices
          </button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/70 mb-4" style={bodyFont}>
        These are the devices that have signed into your account. Remove any you don't recognize.
      </p>

      {!devices || devices.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4" style={bodyFont}>
          No device records found. Sign in again to start tracking.
        </p>
      ) : (
        <div className="space-y-2">
          {/* Current device first */}
          {devices
            .sort((a, b) => (a.is_current ? -1 : b.is_current ? 1 : 0))
            .map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                onRemove={() => removeMutation.mutate(device.id)}
                removing={removeMutation.isPending}
              />
            ))}
        </div>
      )}
    </div>
  );
}
