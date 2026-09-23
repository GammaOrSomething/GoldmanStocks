import {
  isAuthRetryableFetchError,
  type EmailOtpType,
} from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";

import { OFFLINE, signInErrorMessage, signUpErrorMessage } from "./errors";

/**
 * Sign-in and sign-out run in the browser, not in a server function.
 *
 * Supabase rate-limits sign-ins per IP address. Signing in from a server function would put
 * every user behind the server's one address, so a handful of typos across a company could
 * lock everyone out. The browser client writes the same session cookies the server reads, so
 * the next server call is already signed in.
 */

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(signInErrorMessage(error));
}

/**
 * Create an account. With email confirmation on (production), there's no session yet: the
 * person confirms through the emailed link, which lands on /auth/confirm and then onboarding.
 * Supabase answers an already-registered email the same way, so this never reveals one.
 *
 * `name` and `company` only prefill the onboarding form; the database never trusts them.
 */
export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  company: string;
}): Promise<{ confirmEmail: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/confirm`,
      data: { full_name: input.name, company_name: input.company },
    },
  });
  if (error) throw new Error(signUpErrorMessage(error));
  return { confirmEmail: !data.session };
}

/**
 * Finish what an emailed link started (confirm the address, accept an invitation, reset a
 * password). Called when the person presses the button on /auth/confirm, never on page load:
 * mail scanners open links, and verifying then would use up the one-time token.
 */
export async function verifyEmailLink(
  tokenHash: string,
  type: EmailOtpType,
): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (!error) return;
  if (isAuthRetryableFetchError(error)) throw new Error(OFFLINE);
  throw new Error(
    "This link has expired or was already used. Ask for a new one.",
  );
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error)
    throw new Error("Couldn't sign out. Check your connection and try again.");
}
