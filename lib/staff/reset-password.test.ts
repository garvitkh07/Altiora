import { describe, expect, it } from "vitest";

import {
  classifyStaffRecoveryError,
  inspectStaffRecoveryUrl,
  resolveStaffRecoveryState,
  validateStaffNewPassword,
  validateStaffPasswordConfirmation,
} from "./reset-password";

describe("staff reset-password helpers", () => {
  it("requires an eight-character password and matching confirmation", () => {
    expect(validateStaffNewPassword("short")).toBe("Use at least 8 characters.");
    expect(validateStaffNewPassword("long-enough")).toBeNull();
    expect(validateStaffPasswordConfirmation("long-enough", "")).toBe(
      "Confirm your new password.",
    );
    expect(validateStaffPasswordConfirmation("long-enough", "different")).toBe(
      "Passwords do not match.",
    );
    expect(validateStaffPasswordConfirmation("long-enough", "long-enough")).toBeNull();
  });

  it("keeps a session without a recovery callback from becoming a reset session", () => {
    expect(
      resolveStaffRecoveryState({
        hasRecoveryCallback: false,
        hasRecoveryEvent: false,
        hasSession: true,
      }),
    ).toBe("missing");
  });

  it("recognizes recovery, expired, and already-used callback states", () => {
    expect(
      resolveStaffRecoveryState({
        hasRecoveryCallback: true,
        hasRecoveryEvent: true,
        hasSession: true,
      }),
    ).toBe("ready");
    expect(
      resolveStaffRecoveryState({
        hasRecoveryCallback: true,
        hasRecoveryEvent: false,
        hasSession: false,
        urlProblem: "expired",
      }),
    ).toBe("expired");
    expect(
      resolveStaffRecoveryState({
        hasRecoveryCallback: true,
        hasRecoveryEvent: false,
        hasSession: false,
        urlProblem: "already-used",
      }),
    ).toBe("already-used");
    expect(classifyStaffRecoveryError({ code: "otp_expired" })).toBe("expired");
    expect(classifyStaffRecoveryError({ code: "token_already_used" })).toBe(
      "already-used",
    );
  });

  it("recognizes callback errors without returning their URL contents", () => {
    const info = inspectStaffRecoveryUrl(
      "http://localhost:3000/staff/reset-password#type=recovery&error_code=otp_expired",
    );

    expect(info.hasRecoveryCallback).toBe(true);
    expect(info.recoverySession).toBeNull();
    expect(info.urlProblem).toBe("expired");
  });
});
