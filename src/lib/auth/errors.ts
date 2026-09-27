import {
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type AuthError,
} from "@supabase/supabase-js";

// What the auth forms say when Supabase refuses. Kept apart from the browser client so it can
// be tested without one.

export const OFFLINE =
  "Couldn't reach the server. Check your connection and try again.";

const TOO_MANY = "Too many attempts. Wait a minute and try again.";

/** Signup and choosing a new password share it; Supabase also wants letters and digits. */
export const MIN_PASSWORD = 10;
const WEAK_PASSWORD = `Choose a longer password: at least ${MIN_PASSWORD} characters, with letters and digits.`;

type Refusal = Pick<AuthError, "status" | "code" | "message"> | Error;

/**
 * Never says whether an email has an account. Supabase only answers `email_not_confirmed` when
 * the password was right, so saying so reveals nothing to someone guessing.
 */
export function signInErrorMessage(error: Refusal): string {
  if (isAuthRetryableFetchError(error)) return OFFLINE;
  const { status, code } = error as Pick<AuthError, "status" | "code">;
  if (status === 429) return TOO_MANY;
  if (code === "email_not_confirmed")
    return "Confirm your email first: open the link we sent you.";
  return "Wrong email or password.";
}

export function signUpErrorMessage(error: Refusal): string {
  if (isAuthRetryableFetchError(error)) return OFFLINE;
  const { status, code } = error as Pick<AuthError, "status" | "code">;
  if (status === 429) return TOO_MANY;
  if (code === "weak_password") return WEAK_PASSWORD;
  if (code === "email_address_invalid" || code === "validation_failed")
    return "That email address doesn't look right.";
  if (code === "signup_disabled") return "New sign-ups are closed right now.";
  return "Couldn't create the account. Try again.";
}

/**
 * Asking for a reset link. Only an outage or a rate limit is reported; anything else reads as
 * "sent" (null), so the form never reveals whether an email has an account.
 */
export function resetPasswordErrorMessage(error: Refusal): string | null {
  if (isAuthRetryableFetchError(error)) return OFFLINE;
  const { status } = error as Pick<AuthError, "status">;
  return status === 429 ? TOO_MANY : null;
}

const LINK_EXPIRED = "This link has expired. Ask for a new one.";

/**
 * Saving a new password after an invite or reset link. The link's session is what allows it,
 * so a missing or stale one means asking for a new link.
 */
export function setPasswordErrorMessage(error: Refusal): string {
  if (isAuthRetryableFetchError(error)) return OFFLINE;
  if (isAuthSessionMissingError(error)) return LINK_EXPIRED;
  const { status, code } = error as Pick<AuthError, "status" | "code">;
  if (status === 429) return TOO_MANY;
  if (code === "weak_password") return WEAK_PASSWORD;
  if (code === "same_password")
    return "Choose a password different from your old one.";
  if (
    code === "reauthentication_needed" ||
    code === "session_not_found" ||
    code === "session_expired"
  )
    return LINK_EXPIRED;
  return "Couldn't save the password. Try again.";
}
