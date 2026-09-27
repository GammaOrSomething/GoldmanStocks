import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD } from "@/lib/auth/errors";
import { signUp } from "@/lib/auth/session-client";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Set up your company — Goldman Stocks" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Signup,
});

function Signup() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const field =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value });

  const ready =
    form.name.trim() &&
    form.company.trim() &&
    form.email.trim() &&
    form.password.length >= MIN_PASSWORD;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const email = form.email.trim();
      const { confirmEmail } = await signUp({
        email,
        password: form.password,
        name: form.name.trim(),
        company: form.company.trim(),
      });
      if (confirmEmail) {
        setSentTo(email);
        return;
      }
      // Email confirmation is off (local development): already signed in.
      queryClient.clear();
      router.clearCache();
      await router.navigate({ href: "/onboarding", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-up failed.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo)
    return (
      <AuthCard
        title="Check your email"
        subtitle={
          <>
            We sent a link to <strong>{sentTo}</strong>. Open it on this device
            to confirm your address and finish setting up your company.
          </>
        }
        footer={
          <Link to="/login" className="font-medium text-primary underline">
            Back to sign in
          </Link>
        }
      >
        <p className="mt-4 text-sm text-muted-foreground">
          No email after a few minutes? Check your spam folder, or sign up
          again.
        </p>
      </AuthCard>
    );

  return (
    <AuthCard
      title="Set up your company"
      subtitle="You'll be its boss, and can invite your crew afterwards."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            maxLength={200}
            value={form.name}
            onChange={field("name")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company">Company name</Label>
          <Input
            id="company"
            autoComplete="organization"
            required
            maxLength={200}
            value={form.company}
            onChange={field("company")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={form.email}
            onChange={field("email")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            aria-describedby="password-hint"
            value={form.password}
            onChange={field("password")}
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD} characters, with letters and digits.
          </p>
        </div>

        <FormError message={error} />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || !ready}
        >
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
