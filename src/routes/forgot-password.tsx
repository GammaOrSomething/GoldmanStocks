import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth/session-client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — Goldman Stocks" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const address = email.trim();
      await requestPasswordReset(address);
      setSentTo(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the link.");
    } finally {
      setBusy(false);
    }
  }

  const backToSignIn = (
    <Link to="/login" className="font-medium text-primary underline">
      Back to sign in
    </Link>
  );

  // The same answer whether or not the email has an account, so the form reveals nothing.
  if (sentTo)
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If there's an account for ${sentTo}, we've sent it a link to choose a new password. It works once, for an hour.`}
        footer={backToSignIn}
      />
    );

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={backToSignIn}
    >
      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <FormError message={error} />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || !email.trim()}
        >
          {busy ? "Sending…" : "Send the link"}
        </Button>
      </form>
    </AuthCard>
  );
}
