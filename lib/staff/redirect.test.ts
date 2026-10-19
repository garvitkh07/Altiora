import { describe, expect, it } from "vitest";

import { getStaffLoginPath, sanitizeStaffNextPath } from "./redirect";

describe("staff login redirect paths", () => {
  it("keeps an internal path and its query string", () => {
    expect(sanitizeStaffNextPath("/reception?filter=ready")).toBe(
      "/reception?filter=ready",
    );
  });

  it("rejects external, protocol-relative, and backslash paths", () => {
    expect(sanitizeStaffNextPath("https://example.com/steal")).toBe(
      "/kitchen",
    );
    expect(sanitizeStaffNextPath("//example.com/steal")).toBe("/kitchen");
    expect(sanitizeStaffNextPath("/\\\\example.com/steal")).toBe("/kitchen");
  });

  it("keeps redirects on authorized staff pages", () => {
    expect(sanitizeStaffNextPath("/")).toBe("/kitchen");
    expect(sanitizeStaffNextPath("/api/kitchen/dashboard")).toBe("/kitchen");
  });

  it("uses an allowlisted error code in the login URL", () => {
    expect(getStaffLoginPath("unauthenticated", "/reception")).toBe(
      "/staff/login?error=unauthenticated&next=%2Freception",
    );
  });
});
