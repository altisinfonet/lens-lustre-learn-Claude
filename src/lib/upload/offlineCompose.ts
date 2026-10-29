/**
 * S7b-5b · what the composer does when the member taps Post with no network
 * and the post cannot be kept on the phone (the resumable job is switched off,
 * a text-only or scheduled post, photo tags): say so plainly and keep what
 * they wrote — never start uploads that can only fail, never lose the post.
 */
import { onlineManager } from "@tanstack/react-query";
import { getNetState } from "@/lib/offline/networkQuality";

export const OFFLINE_NOT_SENT = {
  title: "No internet — your post wasn't sent",
  description: "It's still here. Post it again when you're back online.",
} as const;

export function noNetworkForPost(): boolean {
  return !onlineManager.isOnline() || !getNetState().online;
}
