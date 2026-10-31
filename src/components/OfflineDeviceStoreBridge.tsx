/**
 * OFF-1 · connects the device store to the app. Renders nothing.
 *
 * - Once: starts writing allow-listed queries to the device (queryPersistence).
 * - Whenever the signed-in member changes: points the writer at that member and
 *   restores their stored data into the empty query cache, so the feed,
 *   profiles, own posts and notifications render at once and then refresh.
 *
 * Sign-out is handled in useAuth's SIGNED_OUT branch, synchronously, so no
 * pending write can put a departed member's data back after the wipe.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { hydrateFromDevice, setPersistenceUser, startQueryPersistence } from "@/lib/offline/queryPersistence";

let started = false;

export default function OfflineDeviceStoreBridge() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (started) return;
    started = true;
    startQueryPersistence(qc);
  }, [qc]);

  useEffect(() => {
    setPersistenceUser(userId);
    if (userId) void hydrateFromDevice(qc, userId);
  }, [qc, userId]);

  return null;
}

/** Test seam: lets a test mount the bridge more than once. */
export function resetOfflineBridgeForTests() {
  started = false;
}
