export const MIN_STAFF_PASSWORD_LENGTH = 8;

export type StaffRecoveryProblem = "expired" | "invalid" | "already-used";

export type StaffRecoveryState = "missing" | "ready" | StaffRecoveryProblem;

export type StaffRecoveryUrlInfo = {
  hasRecoveryCallback: boolean;
  hasPkceCallback: boolean;
  recoverySession: {
    accessToken: string;
    refreshToken: string;
  } | null;
  urlProblem: StaffRecoveryProblem | null;
};

function readStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return "";
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

/**
 * Converts auth failures into user-safe recovery states without exposing the
 * provider's raw message, which may contain implementation details.
 */
export function classifyStaffRecoveryError(
  error: unknown,
): StaffRecoveryProblem {
  const code = readStringProperty(error, "code").toLowerCase();
  const message = readStringProperty(error, "message").toLowerCase();
  const details = `${code} ${message}`;

  if (
    (details.includes("already") && details.includes("used")) ||
    details.includes("token_already_used") ||
    details.includes("otp_already_used")
  ) {
    return "already-used";
  }

  if (details.includes("expired") || details.includes("otp_expired")) {
    return "expired";
  }

  return "invalid";
}

/**
 * Reads only recovery metadata from the callback URL. Token values are kept
 * in memory for the browser client's setSession call and are never returned
 * as part of a UI state or included in a generated URL.
 */
export function inspectStaffRecoveryUrl(rawUrl: string): StaffRecoveryUrlInfo {
  try {
    const url = new URL(rawUrl);
    const hashParams = new URLSearchParams(
      url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
    );
    const queryParams = url.searchParams;
    const callbackParams = [hashParams, queryParams];
    const type = (
      hashParams.get("type") ?? queryParams.get("type") ?? ""
    ).toLowerCase();
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const hasCallbackError = callbackParams.some(
      (params) =>
        params.has("error") ||
        params.has("error_code") ||
        params.has("error_description"),
    );
    const hasTokenArtifact =
      hashParams.has("access_token") || hashParams.has("refresh_token");
    const errorCode =
      hashParams.get("error_code") ?? queryParams.get("error_code");
    const errorName = hashParams.get("error") ?? queryParams.get("error");
    const errorDescription =
      hashParams.get("error_description") ??
      queryParams.get("error_description");
    const hasRecoveryCallback =
      type === "recovery" ||
      queryParams.has("code") ||
      hasCallbackError ||
      hasTokenArtifact;
    const recoverySession =
      type === "recovery" && accessToken && refreshToken
        ? { accessToken, refreshToken }
        : null;
    const urlProblem =
      errorCode || errorName || errorDescription
        ? classifyStaffRecoveryError({
            code: errorCode ?? errorName ?? "",
            message: errorDescription ?? "",
          })
        : null;

    return {
      hasRecoveryCallback,
      hasPkceCallback: queryParams.has("code"),
      recoverySession,
      urlProblem,
    };
  } catch {
    return {
      hasRecoveryCallback: false,
      hasPkceCallback: false,
      recoverySession: null,
      urlProblem: "invalid",
    };
  }
}

export function resolveStaffRecoveryState({
  hasRecoveryCallback,
  hasRecoveryEvent,
  hasSession,
  urlProblem,
}: {
  hasRecoveryCallback: boolean;
  hasRecoveryEvent: boolean;
  hasSession: boolean;
  urlProblem?: StaffRecoveryProblem | null;
}): StaffRecoveryState {
  if (urlProblem) {
    return urlProblem;
  }

  if (hasSession && hasRecoveryEvent) {
    return "ready";
  }

  return hasRecoveryCallback ? "invalid" : "missing";
}

export function validateStaffNewPassword(value: string) {
  if (value.length < MIN_STAFF_PASSWORD_LENGTH) {
    return `Use at least ${MIN_STAFF_PASSWORD_LENGTH} characters.`;
  }

  return null;
}

export function validateStaffPasswordConfirmation(
  password: string,
  confirmation: string,
) {
  if (!confirmation) {
    return "Confirm your new password.";
  }

  if (password !== confirmation) {
    return "Passwords do not match.";
  }

  return null;
}
