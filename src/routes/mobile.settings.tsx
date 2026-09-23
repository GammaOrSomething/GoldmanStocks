import { createFileRoute } from "@tanstack/react-router";
import { Bell, Camera, Languages, LogOut, MapPin, User } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useRefreshData, useWorkers } from "@/hooks/use-data";
import { useSignOut } from "@/hooks/use-sign-out";
import { useViewer } from "@/hooks/use-viewer";
import { saveWorker } from "@/lib/api/workers";
import { setPref, usePref } from "@/lib/phone-prefs";
import {
  setActiveWorker,
  useActiveWorker,
  useWorkerProjects,
} from "@/lib/worker-store";

export const Route = createFileRoute("/mobile/settings")({
  component: MobileSettings,
  head: () => ({
    meta: [
      { title: "Settings — Goldman Stocks worker app" },
      {
        name: "description",
        content:
          "Your account, whose jobs to show, app language and photo & location options.",
      },
      { property: "og:title", content: "Settings — Goldman Stocks worker app" },
      {
        property: "og:description",
        content:
          "Your account, whose jobs to show, app language and photo & location options.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

/** English names for the toast; the buttons show each language's own name. */
const LANGUAGE_NAMES: Record<string, string> = {
  ET: "Estonian",
  LV: "Latvian",
  EN: "English",
};

const languages = [
  { code: "ET", label: "Eesti" },
  { code: "EN", label: "English" },
  { code: "LV", label: "Latviešu" },
];

function MobileSettings() {
  const activeWorker = useActiveWorker();
  const workerId = activeWorker?.id;
  const workers = useWorkers();
  const mySites = useWorkerProjects(workerId);
  const refresh = useRefreshData();
  const geoTag = usePref("geotag");
  const viewer = useViewer();
  const { signOut, pending: signingOut } = useSignOut();
  // The language a worker speaks lives on their record: the planner uses it to match them
  // with sites (Latvian speakers to Riga, …).
  const language = activeWorker?.language ?? "ET";
  const setLanguage = useMutation({
    mutationFn: (code: string) =>
      activeWorker
        ? saveWorker({
            data: {
              id: activeWorker.id,
              name: activeWorker.name,
              role: activeWorker.role,
              language: code as "ET" | "LV" | "EN",
            },
          })
        : Promise.reject(new Error("No worker selected")),
    onSuccess: async (_, code) => {
      await refresh();
      toast.success(
        `Saved — the planner now treats ${activeWorker?.name.split(" ")[0]} as speaking ${LANGUAGE_NAMES[code] ?? code}`,
      );
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-accent-foreground">
          Worker preferences
        </p>
        <h1 className="font-display text-3xl font-bold text-primary">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Saved on this phone.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-4 shadow-card">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <User className="size-4 text-primary" /> Whose jobs to show
        </h2>
        <div className="flex flex-wrap gap-2">
          {workers.map((w) => (
            <Button
              key={w.id}
              type="button"
              variant="outline"
              onClick={() => {
                setActiveWorker(w.id);
                toast(`Showing ${w.name}'s jobs`);
              }}
              className={`h-10 rounded-lg px-3 ${
                w.id === workerId
                  ? "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "bg-background text-muted-foreground shadow-none"
              }`}
            >
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: w.color }}
              />
              {w.name}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          The app only shows {activeWorker?.name.split(" ")[0]}'s sites, jobs
          and plants — {mySites.length} site(s) right now.
        </p>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-4 shadow-card">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Languages className="size-4 text-primary" /> Language you speak
        </h2>
        <p className="-mt-2 text-xs text-muted-foreground">
          Saved to your worker profile — the planner prefers sites where it's
          spoken.
        </p>
        <div className="flex gap-2">
          {languages.map((l) => (
            <Button
              key={l.code}
              type="button"
              variant="outline"
              disabled={setLanguage.isPending}
              onClick={() => {
                if (l.code !== language) setLanguage.mutate(l.code);
              }}
              className={`h-10 flex-1 rounded-lg ${
                l.code === language
                  ? "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "bg-background text-muted-foreground shadow-none"
              }`}
            >
              {l.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="divide-y rounded-lg border bg-card shadow-card">
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Stamp photos with location</p>
              <p className="text-xs text-muted-foreground">
                Proof photos record where they were taken. Saved on this phone.
              </p>
            </div>
          </div>
          <Switch
            checked={geoTag}
            onCheckedChange={(on) => setPref("geotag", on)}
            aria-label="Stamp photos with location"
          />
        </div>
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Morning job reminders</p>
              <p className="text-xs text-muted-foreground">
                Not available yet — needs push notifications, which aren't set
                up.
              </p>
            </div>
          </div>
          <Switch
            checked={false}
            disabled
            aria-label="Morning job reminders (not available yet)"
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4 shadow-card">
        <div>
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="truncate text-sm font-medium">{viewer?.email}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-muted-foreground">
        <Camera className="size-3" /> Goldman Stocks worker app
      </p>
    </div>
  );
}
