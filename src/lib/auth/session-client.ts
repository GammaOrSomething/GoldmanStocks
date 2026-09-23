import { supabase } from "@/lib/supabase/client";

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
  if (!error) return;
  // Don't reveal whether the email exists; do pass on "too many attempts".
  throw new Error(
    error.status === 429
      ? "Too many attempts. Wait a minute and try again."
      : "Wrong email or password.",
  );
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error)
    throw new Error("Couldn't sign out. Check your connection and try again.");
}
