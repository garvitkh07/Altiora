"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icon";
import { sanitizeStaffNextPath } from "@/lib/staff/redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const SAFE_SIGN_IN_ERROR =
  "We could not sign you in. Check your email and password and try again.";

export function StaffLoginForm({
  initialError,
  nextPath,
}: {
  initialError?: string | null;
  nextPath?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const safeNextPath = sanitizeStaffNextPath(nextPath);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(SAFE_SIGN_IN_ERROR);
        return;
      }

      router.replace(safeNextPath);
      router.refresh();
    } catch {
      setError(SAFE_SIGN_IN_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      aria-describedby={error ? "staff-login-error" : undefined}
      className="mt-8 space-y-5"
      onSubmit={handleSubmit}
    >
      {error ? (
        <p
          aria-live="assertive"
          className="staff-login-error"
          id="staff-login-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div>
        <label className="text-sm font-semibold text-ink" htmlFor="staff-email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="staff-login-input mt-2"
          disabled={isSubmitting}
          id="staff-email"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <div>
        <label className="text-sm font-semibold text-ink" htmlFor="staff-password">
          Password
        </label>
        <input
          autoComplete="current-password"
          className="staff-login-input mt-2"
          disabled={isSubmitting}
          id="staff-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>

      <button
        aria-busy={isSubmitting}
        className="button-primary mt-2 w-full"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Signing in…" : "Sign in"}
        {!isSubmitting ? <Icon name="arrow-right" size={17} /> : null}
      </button>
    </form>
  );
}
