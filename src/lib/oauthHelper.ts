import { lovable } from "@/integrations/lovable/index";

export async function signInWithOAuth(
  provider: "google" | "apple"
): Promise<{ error?: Error | string | null }> {
  const result = await lovable.auth.signInWithOAuth(provider, {
    redirect_uri: window.location.origin,
  });

  return { error: result.error ?? null };
}
