"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const SAFE_SIGN_OUT_ERROR = "We could not sign you out. Please try again.";

export function StaffSignOut() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setError(null);
    setIsSigningOut(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setError(SAFE_SIGN_OUT_ERROR);
        return;
      }

      router.replace("/staff/login");
      router.refresh();
    } catch {
      setError(SAFE_SIGN_OUT_ERROR);
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        aria-busy={isSigningOut}
        aria-label="Sign out of the staff dashboard"
        className="button-secondary staff-sign-out"
        disabled={isSigningOut}
        onClick={() => void handleSignOut()}
        type="button"
      >
        {isSigningOut ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <p aria-live="assertive" className="staff-sign-out-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
