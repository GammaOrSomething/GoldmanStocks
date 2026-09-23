import type { EmailOtpType } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { safeRedirect } from "@/lib/auth/access";
import { verifyEmailLink } from "@/lib/auth/session-client";

// Where the emailed links land (supabase/templates/): confirming a new account now; accepting
// an invitation and resetting a password in D2.
const LINK_TYPES = ["email", "signup", "invite", "recovery", "email_change"];

type ConfirmSearch = { token_hash?: string; type?: EmailOtpType; next: string };

export const Route = createFileRoute("/auth/confirm")({
  validateSearch: (search: Record<string, unknown>): ConfirmSearch => {
    const token = search["token_hash"];
    const type = search["type"];
    return {
      ...(typeof token === "string" && /^[\w-]{10,200}$/.test(token)
        ? { token_hash: token }
        : {}),
      ...(typeof type === "string" && LINK_TYPES.includes(type)
        ? { type: type as EmailOtpType }
        : {}),
      next: safeRedirect(search["next"]),
    };
  },
  head: () => ({
    meta: [
      { title: "Confirm — Goldman Stocks" },
      { name: "robots", content: "noindex" },
      // The one-time token is in this page's URL; don't pass it on to anyone.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: Confirm,
});

const TITLES: Partial<Record<EmailOtpType, string>> = {
  invite: "Accept your invitation",
  recovery: "Reset your password",
  email_change: "Confirm your new email",
};

function Confirm() {
  const { token_hash: tokenHash, type, next } = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!tokenHash || !type)
    return (
      <AuthCard
        title="This link doesn't work"
        subtitle="It may have been cut short by your email app. Try opening it again, or ask for a new one."
        footer={
          <Link to="/login" className="font-medium text-primary underline">
            Back to sign in
          </Link>
        }
      />
    );

  // Verified only on a press, never on load: email scanners open links, and verifying then
  // would use up the one-time token before the person gets here.
  async function confirm() {
    if (!tokenHash || !type) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailLink(tokenHash, type);
      queryClient.clear();
      router.clearCache();
      await router.navigate({ href: next, replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't confirm.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={TITLES[type] ?? "Confirm your email"}
      subtitle="Press the button to continue."
    >
      <div className="mt-5 space-y-4">
        <FormError message={error} />
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? "Confirming…" : "Continue"}
        </Button>
      </div>
    </AuthCard>
  );
}
