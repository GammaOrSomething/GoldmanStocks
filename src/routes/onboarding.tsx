import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSignOut } from "@/hooks/use-sign-out";
import { useViewer } from "@/hooks/use-viewer";
import { createCompany } from "@/lib/api/company";
import { supabase } from "@/lib/supabase/client";

// Signed in, but not part of a company yet: the access rules send such a person here, and
// send them on once they are a member.
export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your company — Goldman Stocks" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Onboarding,
});

const text = (value: unknown) => (typeof value === "string" ? value : "");

function Onboarding() {
  const viewer = useViewer();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut, pending: signingOut } = useSignOut();
  const [form, setForm] = useState({ fullName: "", companyName: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill with what was typed at signup. Convenience only: whatever is submitted is checked.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const meta = data.session?.user.user_metadata ?? {};
      setForm((current) => ({
        fullName: current.fullName || text(meta["full_name"]),
        companyName: current.companyName || text(meta["company_name"]),
      }));
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createCompany({
        data: {
          fullName: form.fullName.trim(),
          companyName: form.companyName.trim(),
        },
      });
      // The cached viewer still says "no company"; drop it so the guard reads the new one.
      queryClient.clear();
      router.clearCache();
      await router.navigate({ href: "/", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set up the company.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Set up your company"
      subtitle={
        viewer ? (
          <>
            Signed in as <strong>{viewer.email}</strong>.
          </>
        ) : undefined
      }
      footer={
        <>
          Waiting for an invitation from your boss instead?{" "}
          <button
            type="button"
            className="font-medium text-primary underline"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </>
      }
    >
      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Your name</Label>
          <Input
            id="fullName"
            autoComplete="name"
            required
            maxLength={200}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="companyName">Company name</Label>
          <Input
            id="companyName"
            autoComplete="organization"
            required
            maxLength={200}
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
        </div>

        <FormError message={error} />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || !form.fullName.trim() || !form.companyName.trim()}
        >
          {busy ? "Setting up…" : "Create company"}
        </Button>
      </form>
    </AuthCard>
  );
}
