import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeRedirect } from "@/lib/auth/access";
import { signIn } from "@/lib/auth/session-client";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirect(search["redirect"], "");
    return target ? { redirect: target } : {};
  },
  head: () => ({
    meta: [
      { title: "Sign in — Goldman Stocks" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Login,
});

function Login() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      // Drop everything cached before this sign-in (the "no viewer" answer the guard holds, and
      // any page data from a previous user on this browser), so the next page loads fresh.
      queryClient.clear();
      router.clearCache();
      await router.navigate({ href: safeRedirect(redirect), replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Office and worker app use the same account."
      footer={
        <>
          New to Goldman Stocks?{" "}
          <Link to="/signup" className="font-medium text-primary underline">
            Set up your company
          </Link>
        </>
      }
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
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <FormError message={error} />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || !email.trim() || !password}
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
