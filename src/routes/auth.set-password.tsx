import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useViewer } from "@/hooks/use-viewer";
import { MIN_PASSWORD } from "@/lib/auth/errors";
import {
  isEmailLinkSession,
  setPassword,
  signOut,
} from "@/lib/auth/session-client";

// Where an invitation or a password reset ends: /auth/confirm has verified the emailed link and
// started a session, and the person now chooses a password for it.
export const Route = createFileRoute("/auth/set-password")({
  head: () => ({
    meta: [
      { title: "Choose a password — Goldman Stocks" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SetPassword,
});

function SetPassword() {
  const viewer = useViewer();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [password, setPasswordValue] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Only a session an invite or reset link just started may choose a password here; anyone
  // else holding a signed-in phone would otherwise change it without knowing the old one.
  const [fromLink, setFromLink] = useState<boolean | null>(null);
  useEffect(() => {
    if (!viewer) return;
    isEmailLinkSession().then(setFromLink, () => setFromLink(false));
  }, [viewer]);

  async function resetInstead() {
    setBusy(true);
    try {
      await signOut();
      queryClient.clear();
      router.clearCache();
      await router.navigate({ href: "/forgot-password", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign out.");
      setBusy(false);
    }
  }

  // Opened directly, or the link's session has ended.
  if (!viewer)
    return (
      <AuthCard
        title="This link has expired"
        subtitle="Links from our emails work once. Ask for a new one to choose a password."
        footer={
          <Link to="/login" className="font-medium text-primary underline">
            Back to sign in
          </Link>
        }
      >
        <Button asChild size="lg" className="mt-5 w-full">
          <Link to="/forgot-password">Send me a new link</Link>
        </Button>
      </AuthCard>
    );

  if (fromLink === null) return <AuthCard title="One moment…" />;

  if (!fromLink)
    return (
      <AuthCard
        title="Change your password by email"
        subtitle={`To choose a new password for ${viewer.email}, we'll email you a link. You'll be signed out first.`}
      >
        <div className="mt-5 space-y-3">
          <FormError message={error} />
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => void resetInstead()}
          >
            {busy ? "Signing out…" : "Sign out and send me a link"}
          </Button>
        </div>
      </AuthCard>
    );

  const mismatch = again.length > 0 && again !== password;
  const ready = password.length >= MIN_PASSWORD && again === password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await setPassword(password);
      queryClient.clear();
      router.clearCache();
      // The guard sends each person on: a worker to the app, a boss to the office.
      await router.navigate({ href: "/", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the password.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={
        viewer.member
          ? `Welcome, ${viewer.member.name.split(" ")[0]}`
          : "Choose a password"
      }
      subtitle={`Choose the password you'll sign in with, as ${viewer.email}.`}
    >
      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        {/* Lets password managers save the new password against the right account. */}
        <input
          type="email"
          autoComplete="username"
          value={viewer.email}
          readOnly
          hidden
        />
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            aria-describedby="password-hint"
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD} characters, with letters and digits.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="again">Type it again</Label>
          <Input
            id="again"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={mismatch}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {mismatch ? (
            <p className="text-xs text-destructive">
              The two passwords don't match.
            </p>
          ) : null}
        </div>

        <FormError message={error} />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || !ready}
        >
          {busy ? "Saving…" : "Save password"}
        </Button>
      </form>
    </AuthCard>
  );
}
