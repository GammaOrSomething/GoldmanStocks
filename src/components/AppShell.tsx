import { Link, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  Leaf,
  LayoutDashboard,
  Map,
  Users,
  HardHat,
  Smartphone,
} from "lucide-react";
import type { ReactNode } from "react";

// Bundled with the app so it loads on any host (Lovable, Vercel, local dev).
import logoUrl from "@/assets/goldman-stocks-logo.png";
import { UserMenu } from "@/components/UserMenu";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/projects", label: "Projects", icon: Map },
  { to: "/plants", label: "Plants & areas", icon: Leaf },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/workers", label: "Workers", icon: HardHat },
] as const;

/** Current path without a trailing slash, so "/" is never mistaken for a child route. */
function useCurrentPath() {
  return useRouterState({
    select: (router) => {
      const path = router.location.pathname.replace(/\/+$/, "");
      return path === "" ? "/" : path;
    },
  });
}

/**
 * Matched on the path, not on `data-[status=active]`: the detail pages are siblings of their
 * list route (`projects_.$projectId`, `clients_.$clientId.report`), so the router would not
 * mark "Projects" active while you are on /projects/p1.
 */
function isItemActive(path: string, to: string) {
  if (to === "/") return path === "/";
  return path === to || path.startsWith(`${to}/`);
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const currentPath = useCurrentPath();

  return (
    <div className="flex min-h-screen bg-background print:block print:min-h-0">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 text-sidebar-foreground md:flex print:hidden">
        <div className="flex items-center gap-3 rounded-lg border border-sidebar-border px-3 py-3">
          <img
            src={logoUrl}
            alt="Goldman Stocks logo"
            className="size-9 rounded-lg object-cover shadow-sm"
          />
          <div>
            <p className="font-display text-sm font-bold leading-none text-primary">
              Goldman Stocks
            </p>
            <p className="mt-1 text-[10px] font-medium text-muted-foreground">
              Management suite
            </p>
          </div>
        </div>

        <nav className="mt-5 flex flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => {
            const isActive = isItemActive(currentPath, to);
            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                  isActive
                    ? "bg-data-violet/10 font-semibold text-primary before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-data-violet"
                    : ""
                }`}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <Link
            to="/mobile"
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-primary"
          >
            <Smartphone className="size-4" />
            Worker app
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-xl print:static print:border-0 print:bg-transparent print:backdrop-blur-none">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
            <div>
              <h1 className="text-xl font-bold text-foreground">{title}</h1>
              {subtitle ? (
                <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <UserMenu />
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden print:hidden">
            {nav.map(({ to, label }) => {
              const isActive = isItemActive(currentPath, to);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : ""
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="flex-1 px-5 py-5 lg:px-8 lg:py-6 print:px-0 print:py-0">
          {children}
        </main>
      </div>
    </div>
  );
}
