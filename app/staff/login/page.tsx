import type { Metadata } from "next";

import { Icon } from "@/components/icon";
import { StaffLoginForm } from "@/components/staff-login-form";
import { sanitizeStaffNextPath } from "@/lib/staff/redirect";

type LoginSearchParams = {
  error?: string | string[];
  next?: string | string[];
};

const loginErrorMessages: Record<string, string> = {
  unauthenticated: "Sign in to continue to the staff dashboard.",
  unassigned:
    "This staff account is not assigned to an active restaurant. Contact an administrator.",
  inactive:
    "This staff account is not assigned to an active restaurant. Contact an administrator.",
  configuration: "Staff sign-in is temporarily unavailable. Please try again shortly.",
  verification: "We could not verify your staff access. Please try again.",
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata: Metadata = {
  title: "Staff sign in",
  description: "Sign in to the Altiora staff dashboard.",
};

export default function StaffLoginPage({
  searchParams,
}: {
  searchParams?: LoginSearchParams;
}) {
  const nextPath = sanitizeStaffNextPath(firstQueryValue(searchParams?.next));
  const errorCode = firstQueryValue(searchParams?.error);
  const initialError = errorCode ? loginErrorMessages[errorCode] ?? null : null;

  return (
    <main
      aria-labelledby="staff-login-title"
      className="relative flex min-h-screen items-center overflow-hidden px-4 py-10 sm:px-6"
    >
      <div aria-hidden="true" className="customer-ambient" />
      <section className="glass-panel animate-slide-up relative mx-auto w-full max-w-md px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-center gap-3">
          <div className="staff-mark" aria-hidden="true">
            <Icon name="lock" size={20} />
          </div>
          <div>
            <p className="eyebrow">Altiora staff</p>
            <h1 className="mt-1 font-display text-3xl text-ink" id="staff-login-title">
              Welcome back.
            </h1>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-muted">
          Sign in to keep service moving with a clear view of every table.
        </p>
        <StaffLoginForm initialError={initialError} nextPath={nextPath} />
      </section>
    </main>
  );
}
