import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type Status = "loading" | "valid" | "already" | "invalid" | "success" | "error";

const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${token}`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.valid === false && d.reason === "already_unsubscribed") setStatus("already");
        else if (d.valid) setStatus("valid");
        else setStatus("invalid");
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleUnsubscribe = async () => {
    const { data } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    if (data?.success) setStatus("success");
    else if (data?.reason === "already_unsubscribed") setStatus("already");
    else setStatus("error");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Email Preferences</h1>
        {status === "loading" && <p className="text-muted-foreground">Verifying...</p>}
        {status === "valid" && (
          <>
            <p className="text-muted-foreground">Click below to unsubscribe from notification emails.</p>
            <button onClick={handleUnsubscribe} className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition">
              Confirm Unsubscribe
            </button>
          </>
        )}
        {status === "success" && <p className="text-primary font-medium">You've been unsubscribed successfully.</p>}
        {status === "already" && <p className="text-muted-foreground">You're already unsubscribed.</p>}
        {status === "invalid" && <p className="text-destructive">Invalid or expired link.</p>}
        {status === "error" && <p className="text-destructive">Something went wrong. Please try again.</p>}
      </div>
    </div>
  );
};

export default Unsubscribe;
