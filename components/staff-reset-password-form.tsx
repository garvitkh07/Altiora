"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  classifyStaffRecoveryError,
  inspectStaffRecoveryUrl,
  resolveStaffRecoveryState,
  validateStaffNewPassword,
  validateStaffPasswordConfirmation,
  type StaffRecoveryState,
} from "@/lib/staff/reset-password";

const SAFE_PASSWORD_UPDATE_ERROR =
  "We could not update your password. This reset link may be invalid, expired, or already used. Request a new link and try again.";

type RecoveryUnavailableState = Exclude<StaffRecoveryState, "ready">;

const recoveryStateCopy: Record<
  RecoveryUnavailableState,
  { title: string; description: string }
> = {
  missing: {
    title: "Reset link required",
    description:
      "Open the password reset link from your email to choose a new password.",
  },
  expired: {
    title: "Reset link expired or already used",
    description:
      "This password reset link has expired or has already been used. Return to staff sign in and request a new link.",
  },
  invalid: {
    title: "Reset link invalid",
    description:
      "This password reset link is invalid. Return to staff sign in and request a new link.",
  },
  "already-used": {
    title: "Reset link already used",
    description:
      "This password reset link has already been used. Return to staff sign in and request a new link.",
  },
};

function clearRecoveryUrlArtifacts() {
  window.history.replaceState(
    window.history.state,
    document.title,
    window.location.pathname,
  );
}

function RecoveryUnavailable({ state }: { state: RecoveryUnavailableState }) {
  const copy = recoveryStateCopy[state];

  return (
    <div aria-live="polite" className="mt-8" role="status">
      <div className="staff-forgot-password-success">
        <h2 className="font-semibold text-ink">{copy.title}</h2>
        <p className="mt-2">{copy.description}</p>
      </div>
      <Link className="button-primary mt-6 w-full" href="/staff/login">
        Return to staff sign in
      </Link>
    </div>
  );
}

export function StaffResetPasswordForm() {
  const [viewState, setViewState] = useState<StaffRecoveryState | "checking" | "success">(
    "checking",
  );
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isActive = true;
    let recoveryEventReceived = false;
    const urlInfo = inspectStaffRecoveryUrl(window.location.href);

    // createBrowserClient uses the PKCE flow by default. A recovery email can
    // still contain an implicit-flow hash, so consume that hash through the
    // existing browser client's session API after capturing it in memory.
    if (urlInfo.recoverySession) {
      clearRecoveryUrlArtifacts();
    }

    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      if (isActive) {
        if (urlInfo.hasRecoveryCallback) {
          clearRecoveryUrlArtifacts();
        }
        setViewState("invalid");
      }

      return () => {
        isActive = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isActive || !session) {
        return;
      }

      const isRecoveryEvent =
        event === "PASSWORD_RECOVERY" ||
        (event === "SIGNED_IN" && urlInfo.hasPkceCallback);

      if (isRecoveryEvent) {
        recoveryEventReceived = true;
        setViewState("ready");
      }
    });

    async function loadRecoverySession() {
      try {
        let session = null;

        if (urlInfo.recoverySession) {
          const { data, error: sessionError } = await supabase.auth.setSession(
            {
              access_token: urlInfo.recoverySession.accessToken,
              refresh_token: urlInfo.recoverySession.refreshToken,
            },
          );

          if (sessionError || !data.session) {
            if (isActive) {
              clearRecoveryUrlArtifacts();
              setViewState(
                sessionError
                  ? classifyStaffRecoveryError(sessionError)
                  : "invalid",
              );
            }
            return;
          }

          session = data.session;
          recoveryEventReceived = true;
        } else {
          const {
            data: { session: currentSession },
            error: sessionError,
          } = await supabase.auth.getSession();

          if (sessionError && urlInfo.hasRecoveryCallback) {
            if (isActive) {
              clearRecoveryUrlArtifacts();
              setViewState(classifyStaffRecoveryError(sessionError));
            }
            return;
          }

          session = currentSession;
        }

        if (!isActive) {
          return;
        }

        if (urlInfo.hasRecoveryCallback) {
          clearRecoveryUrlArtifacts();
        }

        setViewState(
          resolveStaffRecoveryState({
            hasRecoveryCallback: urlInfo.hasRecoveryCallback,
            hasRecoveryEvent: recoveryEventReceived,
            hasSession: Boolean(session),
            urlProblem: urlInfo.urlProblem,
          }),
        );
      } catch (sessionError) {
        if (!isActive) {
          return;
        }

        if (urlInfo.hasRecoveryCallback) {
          clearRecoveryUrlArtifacts();
        }
        setViewState(classifyStaffRecoveryError(sessionError));
      }
    }

    void loadRecoverySession();

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (viewState !== "ready" || isSubmitting) {
      return;
    }

    const passwordError = validateStaffNewPassword(newPassword);
    const confirmationError = validateStaffPasswordConfirmation(
      newPassword,
      passwordConfirmation,
    );

    if (passwordError || confirmationError) {
      setError(passwordError ?? confirmationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        const recoveryProblem = classifyStaffRecoveryError(updateError);

        if (recoveryProblem === "expired" || recoveryProblem === "already-used") {
          setViewState(recoveryProblem);
          setError(null);
        } else {
          setError(SAFE_PASSWORD_UPDATE_ERROR);
        }
        return;
      }

      let signedOut = false;
      try {
        const { error: signOutError } = await supabase.auth.signOut();
        signedOut = !signOutError;
      } catch {
        signedOut = false;
      }

      setNewPassword("");
      setPasswordConfirmation("");
      setSuccessMessage(
        signedOut
          ? "Your password was updated and this recovery session has ended."
          : "Your password was updated. Return to staff sign in before continuing.",
      );
      setViewState("success");
    } catch {
      setError(SAFE_PASSWORD_UPDATE_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (viewState === "checking") {
    return (
      <div aria-live="polite" className="mt-8 text-sm text-muted" role="status">
        Checking your password reset link…
      </div>
    );
  }

  if (viewState === "success") {
    return (
      <div aria-live="polite" className="mt-8" role="status">
        <div className="staff-forgot-password-success">
          <h2 className="font-semibold text-ink">Password updated</h2>
          <p className="mt-2">{successMessage}</p>
        </div>
        <Link className="button-primary mt-6 w-full" href="/staff/login">
          Return to staff sign in
        </Link>
      </div>
    );
  }

  if (viewState !== "ready") {
    return <RecoveryUnavailable state={viewState} />;
  }

  return (
    <form
      aria-describedby={error ? "staff-reset-password-error" : undefined}
      className="mt-8 space-y-5"
      noValidate
      onSubmit={handleSubmit}
    >
      {error ? (
        <p
          aria-live="assertive"
          className="staff-login-error"
          id="staff-reset-password-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div>
        <label className="text-sm font-semibold text-ink" htmlFor="staff-new-password">
          New password
        </label>
        <p className="mt-2 text-xs leading-5 text-muted" id="staff-password-hint">
          Use at least 8 characters. Your password is never shown in the URL.
        </p>
        <input
          aria-describedby={
            error
              ? "staff-password-hint staff-reset-password-error"
              : "staff-password-hint"
          }
          aria-invalid={Boolean(error)}
          autoComplete="new-password"
          className="staff-login-input mt-2"
          disabled={isSubmitting}
          id="staff-new-password"
          minLength={8}
          name="new-password"
          onChange={(event) => {
            setNewPassword(event.target.value);
            setError(null);
          }}
          required
          type="password"
          value={newPassword}
        />
      </div>

      <div>
        <label
          className="text-sm font-semibold text-ink"
          htmlFor="staff-password-confirmation"
        >
          Confirm new password
        </label>
        <input
          aria-describedby={error ? "staff-reset-password-error" : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="new-password"
          className="staff-login-input mt-2"
          disabled={isSubmitting}
          id="staff-password-confirmation"
          minLength={8}
          name="password-confirmation"
          onChange={(event) => {
            setPasswordConfirmation(event.target.value);
            setError(null);
          }}
          required
          type="password"
          value={passwordConfirmation}
        />
      </div>

      <button
        aria-busy={isSubmitting}
        className="button-primary mt-2 w-full"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Updating password…" : "Update password"}
      </button>
    </form>
  );
}
