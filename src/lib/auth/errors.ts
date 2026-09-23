import {
  isAuthRetryableFetchError,
  type AuthError,
} from "@supabase/supabase-js";

// What the auth forms say when Supabase refuses. Kept apart from the browser client so it can
// be tested without one.

export const OFFLINE =
  "Couldn't reach the server. Check your connection and try again.";

export function signUpErrorMessage(
  error: Pick<AuthError, "status" | "code" | "message"> | Error,
): string {
  if (isAuthRetryableFetchError(error)) return OFFLINE;
  const { status, code } = error as Pick<AuthError, "status" | "code">;
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  if (code === "weak_password")
    return "Choose a longer password: at least 10 characters, with letters and digits.";
  if (code === "email_address_invalid" || code === "validation_failed")
    return "That email address doesn't look right.";
  if (code === "signup_disabled") return "New sign-ups are closed right now.";
  return "Couldn't create the account. Try again.";
}
