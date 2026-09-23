import {
  isAuthRetryableFetchError,
  type AuthError,
} from "@supabase/supabase-js";

// What the auth forms say when Supabase refuses. Kept apart from the browser client so it can
// be tested without one.

export const OFFLINE =
  "Couldn't reach the server. Check your connection and try again.";

const TOO_MANY = "Too many attempts. Wait a minute and try again.";

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
  if (code === "weak_password")
    return "Choose a longer password: at least 10 characters, with letters and digits.";
  if (code === "email_address_invalid" || code === "validation_failed")
    return "That email address doesn't look right.";
  if (code === "signup_disabled") return "New sign-ups are closed right now.";
  return "Couldn't create the account. Try again.";
}
