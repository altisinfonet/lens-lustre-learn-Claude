import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/deviceFingerprint";

export interface UserDevice {
  id: string;
  device_id: string;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  last_active_at: string;
  created_at: string;
  ip_address: string | null;
  is_current: boolean;
}

export function useUserDevices(userId: string | undefined) {
  return useQuery({
    queryKey: ["user-devices", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("user_devices" as any)
        .select("*")
        .eq("user_id", userId!)
        .order("last_active_at", { ascending: false }) as any);
      if (error) throw error;

      // Mark the current device
      const currentDeviceId = getDeviceInfo().deviceId;
      return ((data as any[]) || []).map((d: any) => ({
        ...d,
        is_current: d.device_id === currentDeviceId,
      })) as UserDevice[];
    },
  });
}

export function useRemoveDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: string) => {
      const { error } = await (supabase
        .from("user_devices" as any)
        .delete()
        .eq("id", deviceId) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-devices"] });
    },
  });
}

/**
 * Log/upsert current device on sign-in.
 */
export async function logDeviceSignIn(userId: string): Promise<void> {
  try {
    const info = getDeviceInfo();
    await (supabase.from("user_devices" as any).upsert(
      {
        user_id: userId,
        device_id: info.deviceId,
        browser: info.browser,
        os: info.os,
        device_type: info.deviceType,
        last_active_at: new Date().toISOString(),
      } as any,
      { onConflict: "user_id,device_id" }
    ) as any);
  } catch {
    // Non-critical — fail silently
  }
}
