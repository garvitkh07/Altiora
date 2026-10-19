"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { Icon } from "@/components/icon";
import {
  STAFF_PASSWORD_RESET_ERROR_MESSAGE,
  STAFF_PASSWORD_RESET_REDIRECT,
  STAFF_PASSWORD_RESET_SUCCESS_MESSAGE,
  validateStaffEmail,
} from "@/lib/staff/forgot-password";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RequestStatus = "idle" | "submitting" | "success";

export function StaffForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<RequestStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (status === "submitting") {
      return;
    }

    const normalizedEmail = email.trim();
    const validationError = validateStaffEmail(normalizedEmail);

    setError(validationError);

    if (validationError) {
      setStatus("idle");
      return;
    }

    setStatus("submitting");

    try {
      const supabase = createSupabaseBrowserClient();

      const { error: resetError } =
        await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: STAFF_PASSWORD_RESET_REDIRECT,
        });

      if (resetError) {
        // Development-only diagnostics.
        // Never log the email, password, or recovery token.
        if (process.env.NODE_ENV !== "production") {
          console.error(
            "[staff-recovery] Reset email request failed",
            {
              name: resetError.name,
              status: resetError.status,
              code: resetError.code,
              message: resetError.message,
            },
          );
        }

        setError(STAFF_PASSWORD_RESET_ERROR_MESSAGE);
        setStatus("idle");
        return;
      }

      setError(null);
      setStatus("success");
    } catch (error) {
      // Log unexpected errors only during local development.
      if (process.env.NODE_ENV !== "production") {
        console.error(
          "[staff-recovery] Unexpected error",
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
              }
            : String(error),
        );
      }

      setError(STAFF_PASSWORD_RESET_ERROR_MESSAGE);
      setStatus("idle");
    }
  }

  const messageId = error
    ? "staff-forgot-password-error"
    : status === "success"
      ? "staff-forgot-password-success"
      : undefined;

  return (
    <form
      aria-describedby={messageId}
      className="mt-8 space-y-5"
      onSubmit={handleSubmit}
    >
      {error ? (
        <p
          aria-live="assertive"
          className="staff-login-error"
          id="staff-forgot-password-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {status === "success" ? (
        <p
          aria-live="polite"
          className="staff-forgot-password-success"
          id="staff-forgot-password-success"
          role="status"
        >
          {STAFF_PASSWORD_RESET_SUCCESS_MESSAGE}
        </p>
      ) : null}

      <div>
        <label
          className="text-sm font-semibold text-ink"
          htmlFor="staff-forgot-email"
        >
          Email address
        </label>

        <input
          autoComplete="email"
          className="staff-login-input mt-2"
          disabled={status === "submitting"}
          id="staff-forgot-email"
          inputMode="email"
          name="email"
          onChange={(event) => {
            setEmail(event.target.value);

            if (error) {
              setError(null);
            }

            if (status === "success") {
              setStatus("idle");
            }
          }}
          required
          type="email"
          value={email}
        />
      </div>

      <button
        aria-busy={status === "submitting"}
        className="button-primary mt-2 w-full"
        disabled={status === "submitting"}
        type="submit"
      >
        {status === "submitting" ? "Sending..." : "Send reset link"}

        {status !== "submitting" ? (
          <Icon name="arrow-right" size={17} />
        ) : null}
      </button>

      <p className="text-center text-sm text-muted">
        Remembered your password?{" "}
        <Link className="staff-auth-link" href="/staff/login">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
