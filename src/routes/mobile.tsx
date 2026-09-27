import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  Leaf,
  MapPin,
  Settings,
} from "lucide-react";
import { useState } from "react";

// Bundled with the app so it loads on any host (Lovable, Vercel, local dev).
import logoUrl from "@/assets/goldman-stocks-logo.png";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useViewer } from "@/hooks/use-viewer";
import { requestCapture } from "@/lib/photo-store";

export const Route = createFileRoute("/mobile")({
  component: MobileLayout,
  head: () => ({
    meta: [
      { title: "Goldman Stocks worker app — today's jobs & photo proof" },
      {
        name: "description",
        content:
          "The worker's day on a phone: today's jobs, one tap to take a photo and mark the work done.",
      },
      { property: "og:title", content: "Goldman Stocks worker app" },
      {
        property: "og:description",
        content:
          "Today's jobs and photo proof, sized for a phone in a work glove.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
    ],
  }),
});

const tabs = [
  { to: "/mobile/locations", label: "Locations", icon: MapPin, exact: false },
  { to: "/mobile", label: "My day", icon: CalendarDays, exact: true },
  { to: "/mobile/plants", label: "Plants", icon: Leaf, exact: false },
  { to: "/mobile/settings", label: "Settings", icon: Settings, exact: false },
] as const;

function MobileLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  // A worker can't open the office pages anyway; the guard sends them back here.
  const isBoss = useViewer()?.member?.role === "boss";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-5 py-3.5 backdrop-blur-xl">
        <img
          src={logoUrl}
          alt="Goldman Stocks logo"
          className="size-9 rounded-lg object-cover shadow-sm"
        />
        <div className="min-w-0">
          <p className="font-display text-base font-bold leading-none text-primary">
            Goldman Stocks
          </p>
          <p className="mt-1 truncate text-[10px] font-medium text-muted-foreground">
            Worker app
          </p>
        </div>
        {isBoss ? (
          <Link to="/" className="ml-auto text-xs font-medium text-primary">
            Full site
          </Link>
        ) : null}
      </header>

      <main className="flex-1 px-5 pt-6 pb-28">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md items-end border-t bg-background/95 px-1 pb-[max(0px,env(safe-area-inset-bottom))] shadow-[0_-8px_28px_oklch(0.2_0.02_155/0.06)] backdrop-blur-xl">
        {[tabs[0], tabs[1]].map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.exact }}
            className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground data-[status=active]:font-semibold data-[status=active]:text-primary"
          >
            <tab.icon className="size-5" />
            {tab.label}
          </Link>
        ))}

        <Button
          type="button"
          size="icon"
          onClick={() => setMenuOpen(true)}
          aria-label="Open camera menu"
          className="-mt-7 mb-2 size-16 shrink-0 rounded-full bg-primary text-primary-foreground shadow-[0_12px_28px_oklch(0.32_0.095_158/0.28)] ring-4 ring-background hover:bg-primary/90"
        >
          <Camera className="size-7" />
        </Button>

        {[tabs[2], tabs[3]].map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.exact }}
            className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground data-[status=active]:font-semibold data-[status=active]:text-primary"
          >
            <tab.icon className="size-5" />
            {tab.label}
          </Link>
        ))}
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="bottom"
          className="mx-auto max-w-md rounded-t-lg border-border bg-background"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display">
              What are you photographing?
            </SheetTitle>
            <SheetDescription>
              Pick one — the camera opens next.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 grid gap-3 pb-2">
            <Button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                navigate({ to: "/mobile" }).then(() => requestCapture());
              }}
              className="h-auto justify-start rounded-lg p-4 text-left"
            >
              <CheckCircle2 className="size-6 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">
                  Validate work
                </span>
                <span className="block text-xs opacity-80">
                  Photo proof for your next unfinished job
                </span>
              </span>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMenuOpen(false);
                navigate({ to: "/mobile/new-plant" });
              }}
              className="h-auto justify-start rounded-lg p-4 text-left"
            >
              <MapPin className="size-6 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold">
                  Register new plant
                </span>
                <span className="block text-xs text-muted-foreground">
                  Photo, species and the spot it stands in
                </span>
              </span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
