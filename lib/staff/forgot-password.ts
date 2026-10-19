export const STAFF_PASSWORD_RESET_REDIRECT =
  "http://localhost:3000/staff/reset-password";

export const STAFF_PASSWORD_RESET_SUCCESS_MESSAGE =
  "If an account exists for that email, we’ll send a password reset link shortly.";

export const STAFF_PASSWORD_RESET_ERROR_MESSAGE =
  "We couldn’t send a reset email right now. Please try again shortly.";

export function validateStaffEmail(value: string) {
  const email = value.trim();

  if (!email) {
    return "Enter your email address.";
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return "Enter a valid email address.";
  }

  return null;
}
