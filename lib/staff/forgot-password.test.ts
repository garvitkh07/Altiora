import { describe, expect, it } from "vitest";

import {
  STAFF_PASSWORD_RESET_REDIRECT,
  validateStaffEmail,
} from "./forgot-password";

describe("staff forgot-password helpers", () => {
  it("accepts a valid email after trimming surrounding whitespace", () => {
    expect(validateStaffEmail("  staff@example.com  ")).toBeNull();
  });

  it("rejects an empty or malformed email", () => {
    expect(validateStaffEmail("   ")).toBe("Enter your email address.");
    expect(validateStaffEmail("staff@example")).toBe("Enter a valid email address.");
  });

  it("uses the staff reset route as the auth callback", () => {
    expect(STAFF_PASSWORD_RESET_REDIRECT).toBe(
      "http://localhost:3000/staff/reset-password",
    );
  });
});
