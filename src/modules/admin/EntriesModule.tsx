/**
 * Entries Module — per-photo "One Image, One Reject" policy.
 * Rejecting a single photo no longer deletes the whole entry.
 */
import { useState } from "react";
import AdminEntriesSection from "@/components/admin/AdminEntriesSection";
import { useAdminEntries } from "@/hooks/admin/useAdminEntries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/hooks/core/use-toast";

const EntriesModule = () => {
  const { entries, error } = useAdminEntries();
  const queryClient = useQueryClient();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const togglePhotoRejected = async (
    entryId: string,
    photoIndex: number,
    rejected: boolean,
    reason?: string,
  ) => {
    const key = `${entryId}::${photoIndex}`;
    setPendingKey(key);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_set_photo_rejected", {
        _entry_id: entryId,
        _photo_index: photoIndex,
        _rejected: rejected,
        _reason: reason ?? null,
      });
      if (rpcErr) throw rpcErr;
      queryClient.invalidateQueries({ queryKey: queryKeys.adminEntries() });
      const result = data as { all_rejected?: boolean; new_status?: string } | null;
      toast({
        title: rejected ? "Photo rejected" : "Photo restored",
        description: result?.all_rejected
          ? "All photos rejected — entry status set to rejected."
          : `Entry status: ${result?.new_status ?? "updated"}.`,
      });
    } catch (err: unknown) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPendingKey(null);
    }
  };

  if (error) {
    return <p className="text-sm text-destructive py-8 text-center">Failed to load entries: {error.message}</p>;
  }

  return (
    <AdminEntriesSection
      entries={entries}
      onTogglePhotoRejected={togglePhotoRejected}
      pendingKey={pendingKey}
    />
  );
};

export default EntriesModule;
