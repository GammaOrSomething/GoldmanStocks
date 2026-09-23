import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ClientDialog } from "@/components/forms/ClientDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { listClients } from "@/lib/api/clients";
import { currentMonth } from "@/lib/month";
import type { Client } from "@/lib/types";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Clients — Goldman Stocks" },
      {
        name: "description",
        content:
          "Client list with sites, plants under care, hours spent this month and contract renewals.",
      },
      { property: "og:title", content: "Clients — Goldman Stocks" },
      {
        property: "og:description",
        content:
          "See which clients are profitable and which eat hours, site by site.",
      },
    ],
  }),
  loader: () => listClients(),
  component: Clients,
});

const healthStyles = {
  good: "text-status-healthy",
  watch: "text-status-attention",
  "at risk": "text-status-critical",
} as const;

function Clients() {
  const clients = Route.useLoaderData();
  // undefined = closed, null = new client, a client = editing it
  const [editing, setEditing] = useState<Client | null | undefined>();
  // At least 1, so a month with no proven hours yet doesn't divide by zero.
  const maxHours = Math.max(1, ...clients.map((c) => c.hoursThisMonth));
  const revenue = clients.reduce((s, c) => s + c.monthlyValue, 0);

  return (
    <AppShell
      title="Clients"
      subtitle={`${clients.length} maintenance contracts · €${revenue.toLocaleString("en-GB")} per month`}
      actions={
        <Button onClick={() => setEditing(null)}>
          <Plus className="size-4" /> New client
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {clients.map((c) => (
          <Card key={c.id} className="shadow-card">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{c.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {c.city} · {c.sites} sites · {c.plants} plants
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className={healthStyles[c.health]}>
                  {c.health}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditing(c)}
                  aria-label={`Edit ${c.name}`}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Field label="Contact" value={c.contact} />
                <Field label="Monthly value" value={`€${c.monthlyValue}`} />
                <Field label="Contract until" value={c.contractUntil} />
              </div>

              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Hours this month
                  </span>
                  <span className="font-medium">{c.hoursThisMonth} h</span>
                </div>
                <Progress
                  value={(c.hoursThisMonth / maxHours) * 100}
                  className="mt-2"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.hoursThisMonth > 0
                    ? `€${Math.round(c.monthlyValue / c.hoursThisMonth)} per hour worked`
                    : "No hours logged this month yet"}
                </p>
              </div>

              <Button asChild variant="secondary" className="w-full">
                <Link
                  to="/clients/$clientId/report"
                  params={{ clientId: c.id }}
                  search={{ month: currentMonth() }}
                >
                  <FileText className="size-4" /> Monthly report with photos
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <ClientDialog
        client={editing ?? undefined}
        open={editing !== undefined}
        onOpenChange={(open) => (open ? null : setEditing(undefined))}
      />
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
