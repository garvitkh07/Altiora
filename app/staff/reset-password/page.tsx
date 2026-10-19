import type { Metadata } from "next";

import { Icon } from "@/components/icon";
import { StaffResetPasswordForm } from "@/components/staff-reset-password-form";

export const metadata: Metadata = {
  title: "Reset staff password",
  description: "Choose a new password for your Altiora staff account.",
};

export default function StaffResetPasswordPage() {
  return (
    <main
      aria-labelledby="staff-reset-password-title"
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
            <h1
              className="mt-1 font-display text-3xl text-ink"
              id="staff-reset-password-title"
            >
              Choose a new password.
            </h1>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-muted">
          Use a fresh password for your Altiora staff account.
        </p>
        <StaffResetPasswordForm />
      </section>
    </main>
  );
}
