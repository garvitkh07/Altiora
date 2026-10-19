export const DEFAULT_STAFF_NEXT_PATH = "/kitchen";

export type StaffAuthErrorCode =
  | "unauthenticated"
  | "unassigned"
  | "inactive"
  | "configuration"
  | "verification";

const MAX_NEXT_PATH_LENGTH = 2048;

function isSafeInternalPath(value: string) {
  if (
    !value ||
    value.length > MAX_NEXT_PATH_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, "http://staff.local");
    const decodedPath = decodeURIComponent(parsed.pathname);

    return (
      parsed.origin === "http://staff.local" &&
      decodedPath.startsWith("/") &&
      !decodedPath.startsWith("//") &&
      !decodedPath.includes("\\") &&
      isStaffPath(decodedPath)
    );
  } catch {
    return false;
  }
}

function isStaffPath(pathname: string) {
  return (
    pathname === "/kitchen" ||
    pathname.startsWith("/kitchen/") ||
    pathname === "/reception" ||
    pathname.startsWith("/reception/")
  );
}

/**
 * Keeps the post-login destination on this application. Query-string values
 * are untrusted because they can be supplied directly by a visitor.
 */
export function sanitizeStaffNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_STAFF_NEXT_PATH,
) {
  const safeFallback = isSafeInternalPath(fallback)
    ? fallback
    : DEFAULT_STAFF_NEXT_PATH;

  if (!value || !isSafeInternalPath(value)) {
    return safeFallback;
  }

  const parsed = new URL(value, "http://staff.local");
  return `${parsed.pathname}${parsed.search}`;
}

export function getStaffLoginPath(
  errorCode: StaffAuthErrorCode,
  nextPath?: string | null,
) {
  const params = new URLSearchParams({
    error: errorCode,
    next: sanitizeStaffNextPath(nextPath),
  });

  return `/staff/login?${params.toString()}`;
}
