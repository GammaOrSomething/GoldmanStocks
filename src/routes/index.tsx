import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CloudRain,
  Cloud,
  Sun,
  CheckCircle2,
  Leaf,
  Clock,
  TrendingUp,
  ArrowRight,
  AlertTriangle,
  CircleCheck,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { AnimatedGroup } from "@/components/motion/AnimatedGroup";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, partOfDay, useWeekPlan } from "@/hooks/use-week-plan";
import { findOpportunities } from "@/lib/outreach";
import type { DayPlan } from "@/lib/planner";
import { dataKeys, useClients } from "@/hooks/use-data";
import { decideOffer, draftOffers, listOffers } from "@/lib/outreach.functions";
import { explainPlan, type ExplainPlanInput } from "@/lib/plan.functions";
import { useTaskActions } from "@/hooks/use-tasks";
import type { Offer, OfferStatus, Plant, Task, Worker } from "@/lib/types";
import { overnightRainMm, primaryProject } from "@/lib/weather";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Goldman Stocks — plant-aware crew planning" },
      {
        name: "description",
        content:
          "Goldman Stocks plans every gardener's day around each plant's care schedule and the weather, with proof of work for every client.",
      },
      {
        property: "og:title",
        content: "Goldman Stocks — plant-aware crew planning",
      },
      {
        property: "og:description",
        content:
          "Daily AI plans for landscaping crews, built from plant care schedules and live weather.",
      },
    ],
  }),
  component: Dashboard,
});

const weatherIcon = { rain: CloudRain, cloud: Cloud, sun: Sun } as const;
const NO_OFFERS: Offer[] = [];

/** Next care date as YYYY-MM-DD, or null when none is planned. */
function nextCareDate(plant: Plant) {
  return plant.nextCareDate ?? null;
}

function toStop(t: Task) {
  return {
    start: t.start,
    duration: t.duration,
    title: t.title,
    client: t.client,
    site: t.site,
    ...(t.weatherNote ? { weatherNote: t.weatherNote } : {}),
  };
}

function Dashboard() {
  const taskActions = useTaskActions();
  const week = useWeekPlan();
  const {
    today,
    weekDates,
    weather,
    forecasts,
    strip,
    propose,
    plants,
    projects,
    workers,
  } = week;
  const clients = useClients();
  const todayDate = weekDates[today] ?? weekDates[0]!;

  const proposal = useMemo(() => propose(today), [propose, today]);
  const todayTasks = proposal.tasks.filter((t) => t.day === today);
  const approved = todayTasks.some((t) => t.approvedAt);
  const onShift = proposal.byWorker.filter((p) => p.stops.length > 0);
  const plannedHours = proposal.byWorker.reduce((sum, p) => sum + p.hours, 0);
  const weatherSkips = todayTasks.filter(
    (t) => t.status === "skipped" && t.weatherNote,
  ).length;

  const primary = primaryProject(projects);
  const primaryForecast = primary ? forecasts[primary.id] : undefined;
  const rainOvernight = primaryForecast
    ? Math.round(overnightRainMm(primaryForecast, todayDate))
    : null;

  const due = plants.filter((p) => {
    const next = nextCareDate(p);
    return next !== null && next <= todayDate;
  });
  const overdue = due.filter((p) => (nextCareDate(p) ?? "") < todayDate);
  const critical = plants.filter((p) => p.status === "critical");
  const plantsUnderCare = plants.length;

  const opportunities = useMemo(
    () => findOpportunities({ plants, projects, clients, forecasts }, week.now),
    [plants, projects, clients, forecasts, week.now],
  );
  const pipeline = opportunities.reduce((sum, o) => sum + o.value, 0);

  // ─── Plan approval ───────────────────────────────────────────────────────
  const [reviewing, setReviewing] = useState(false);
  const explanation = useMutation({
    mutationFn: (plan: ExplainPlanInput) => explainPlan({ data: plan }),
  });

  function openReview() {
    setReviewing(true);
    explanation.mutate({
      date: todayDate,
      weather: {
        tempC: strip[today]?.temp ?? null,
        note: strip[today]?.note ?? "",
      },
      workers: proposal.byWorker.map((p) => {
        const w = workers.find((x) => x.id === p.workerId);
        return {
          name: w?.name ?? p.workerId,
          role: w?.role ?? "",
          hours: p.hours,
          km: p.km,
          stops: p.stops.map(toStop),
          skipped: p.skipped.map(toStop),
        };
      }),
    });
  }

  function approvePlan() {
    const approvedAt = new Date().toISOString();
    taskActions.replace(todayTasks.map((t) => ({ ...t, approvedAt })));
    setReviewing(false);
    toast.success(`Today's plan approved for ${onShift.length} workers`);
  }

  // ─── Repeat-work offers (saved in the offers table) ─────────────────────
  const queryClient = useQueryClient();
  const recentOffers = useQuery({
    queryKey: dataKeys.offers,
    queryFn: () => listOffers(),
  });
  const recent = recentOffers.data ?? NO_OFFERS;
  const pending = recent.filter((o) => o.status === "draft");
  // Sites with a waiting or recent (30-day) offer aren't offered again yet.
  const undrafted = opportunities.filter(
    (o) => !recent.some((r) => r.projectId === o.projectId),
  );
  // The dialog keeps showing offers decided while it's open, with their outcome.
  const [shown, setShown] = useState<Offer[]>([]);
  const [decisions, setDecisions] = useState<Record<string, OfferStatus>>({});
  const [offersOpen, setOffersOpen] = useState(false);
  function openOffers(list: Offer[]) {
    setShown(list);
    setDecisions({});
    setOffersOpen(true);
  }

  const drafting = useMutation({
    mutationFn: () => draftOffers({ data: { opportunities: undrafted } }),
    onSuccess: async ({ drafted }) => {
      const { data } = await recentOffers.refetch();
      toast.success(
        `${drafted} new ${drafted === 1 ? "draft" : "drafts"} saved — nothing is sent until you do`,
      );
      openOffers((data ?? []).filter((o) => o.status === "draft"));
    },
    onError: (error) => toast.error(error.message),
  });

  const deciding = useMutation({
    mutationFn: ({ offer, status }: { offer: Offer; status: OfferStatus }) =>
      decideOffer({
        data: { id: offer.id, status: status as "approved" | "dismissed" },
      }),
    onError: (error, { offer }) => {
      setDecisions(({ [offer.id]: _, ...rest }) => rest);
      toast.error(error.message);
    },
  });

  async function decide(offer: Offer, status: OfferStatus) {
    setDecisions((d) => ({ ...d, [offer.id]: status }));
    deciding.mutate({ offer, status });
    if (status !== "approved") return;
    try {
      await navigator.clipboard.writeText(`${offer.subject}\n\n${offer.body}`);
      toast.success("Offer approved and copied — paste it into your email");
    } catch {
      toast.success("Offer approved — nothing is sent automatically");
    }
  }

  return (
    <AppShell
      title={`${formatDate(todayDate, { weekday: "long" })} ${partOfDay(week.now)}`}
      subtitle={`${formatDate(todayDate, { day: "numeric", month: "long" })} · ${onShift.length} workers on shift · ${plantsUnderCare} plants under care`}
      actions={
        <Button size="lg" disabled={approved} onClick={openReview}>
          {approved ? "Plan approved" : "Approve today's plan"}
        </Button>
      }
    >
      <AnimatedGroup
        className="grid gap-4 xl:grid-cols-[1.55fr_0.85fr]"
        delay={0.04}
      >
        <Card className="overflow-hidden shadow-card">
          <CardHeader className="flex-row items-start justify-between space-y-0 border-b p-5">
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Today at a glance
              </p>
              <CardTitle className="mt-2 text-2xl">
                {due.length} {due.length === 1 ? "plant needs" : "plants need"}{" "}
                care
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {overdue.length === 0
                  ? "Nothing overdue — the day's plan is current"
                  : `${overdue.length} overdue ${overdue.length === 1 ? "task requires" : "tasks require"} a decision before crews leave`}
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Colour band: one segment above each metric below, in its colour. */}
            <div className="flex h-1 w-full">
              <span className="flex-1 bg-data-violet" />
              <span className="flex-1 bg-data-cyan" />
              <span className="flex-1 bg-data-gold" />
              <span className="flex-1 bg-data-coral" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4">
              <TopMetric
                icon={Leaf}
                label="Care today"
                value={String(due.length)}
                note={`${overdue.length} overdue`}
                color="violet"
              />
              <TopMetric
                icon={CloudRain}
                label="Weather held"
                value={String(weatherSkips)}
                note={
                  rainOvernight === null
                    ? weather.isPending
                      ? "Loading forecast…"
                      : "No forecast"
                    : `${rainOvernight} mm overnight`
                }
                color="cyan"
              />
              <TopMetric
                icon={Clock}
                label="Crew hours"
                value={String(plannedHours)}
                note={`${onShift.length} ${onShift.length === 1 ? "worker" : "workers"}`}
                color="gold"
              />
              <TopMetric
                icon={approved ? CircleCheck : Sparkles}
                label="AI plan"
                value={approved ? "Ready" : "Review"}
                note={approved ? "Approved" : "Awaiting approval"}
                color="coral"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden shadow-card">
          <CardHeader className="flex-row items-center justify-between space-y-0 p-5 pb-2">
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Repeat work ready
              </p>
              <CardTitle className="mt-2 text-2xl">
                €{pipeline.toLocaleString("en-GB")}
              </CardTitle>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-data-cyan/12 text-data-cyan">
              <TrendingUp className="size-5" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <p className="text-xs text-muted-foreground">
              Coming due across {opportunities.length}{" "}
              {opportunities.length === 1 ? "client" : "clients"}
            </p>
            {opportunities.length > 0 ? (
              <div
                className="mt-5 flex h-12 items-end gap-1"
                aria-label="Opportunity value by client"
              >
                {opportunities.map((o) => {
                  const max = Math.max(...opportunities.map((x) => x.value));
                  return (
                    <span
                      key={o.projectId}
                      title={`${o.client} · €${o.value}`}
                      className="flex-1 rounded-t-sm bg-data-violet/20"
                      style={{
                        height: `${Math.max(12, (o.value / max) * 100)}%`,
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 flex h-12 items-center text-xs text-muted-foreground">
                Nothing coming due in the next two weeks.
              </div>
            )}
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
              <span className="text-muted-foreground">Drafts waiting</span>
              <span className="font-semibold text-primary">
                {pending.length}
              </span>
            </div>
          </CardContent>
        </Card>
      </AnimatedGroup>

      <Card className="mt-4 shadow-card">
        <CardHeader className="flex-row items-center justify-between space-y-0 p-5 pb-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Care forecast
            </p>
            <CardTitle className="mt-2 text-base">
              This week's weather, applied to the plan
            </CardTitle>
          </div>
          {weather.data?.stale ? (
            <Badge variant="outline" className="text-status-attention">
              offline — forecast from{" "}
              {new Date(weather.data.fetchedAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2 px-5 pb-5 sm:grid-cols-7">
          {weather.isPending ? (
            weekDates.map((d) => (
              <Skeleton key={d} className="h-[104px] rounded-md" />
            ))
          ) : weather.isError ? (
            <p className="text-sm text-muted-foreground sm:col-span-5">
              {weather.error.message}. The plan shows no weather changes until
              the forecast loads.
            </p>
          ) : (
            strip.map((w, i) => {
              const Icon = weatherIcon[w.icon];
              return (
                <div
                  key={w.day}
                  className={`rounded-md border bg-secondary/50 p-3 ${i === today ? "border-data-violet/40 bg-data-violet/5" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase">
                      {w.day}{" "}
                      <span className="font-normal text-muted-foreground">
                        {formatDate(weekDates[i] ?? "")}
                      </span>
                    </span>
                    <Icon className="size-3.5 text-muted-foreground" />
                  </div>
                  <p className="mt-2 text-xl font-bold">
                    {w.temp === null ? "—" : `${w.temp}°`}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {w.note}
                  </p>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card
          className="animate-rise shadow-card lg:col-span-8"
          style={{ animationDelay: "0.12s" }}
        >
          <CardHeader className="flex-row items-center justify-between space-y-0 p-5 pb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Crew operations
              </p>
              <CardTitle className="mt-2 text-base">
                Today's plan by worker
              </CardTitle>
            </div>
            <Link
              to="/schedule"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Open calendar <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
            {proposal.byWorker.map((plan, i) => (
              <WorkerPlan
                key={plan.workerId}
                plan={plan}
                worker={workers.find((w) => w.id === plan.workerId)}
                accent={workerAccents[i % workerAccents.length]!}
              />
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-4">
          <Card
            className="animate-rise shadow-card"
            style={{ animationDelay: "0.18s" }}
          >
            <CardHeader className="flex-row items-center justify-between space-y-0 p-5 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Needs attention
                </p>
                <CardTitle className="mt-2 text-base">Plants at risk</CardTitle>
              </div>
              <AlertTriangle className="size-4 text-data-coral" />
            </CardHeader>
            <CardContent className="space-y-2 px-5 pb-5">
              {critical.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No plants are in a critical state.
                </p>
              ) : null}
              {critical.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <StatusDot status={p.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.common}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {p.client} · {p.site}
                    </p>
                  </div>
                  <span className="text-[10px] whitespace-nowrap text-muted-foreground">
                    {p.nextTask}
                  </span>
                </div>
              ))}
              <Link
                to="/plants"
                className="inline-flex items-center gap-1 pt-2 text-xs font-semibold text-primary hover:underline"
              >
                See all plants <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>

          <Card
            className="animate-rise shadow-card"
            style={{ animationDelay: "0.24s" }}
          >
            <CardHeader className="flex-row items-start justify-between space-y-0 p-5 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Commercial
                </p>
                <CardTitle className="mt-2 text-base">
                  Repeat work to offer
                </CardTitle>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold">
                  €{pipeline.toLocaleString("en-GB")}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  ready pipeline
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-5">
              {opportunities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing coming due in the next two weeks.
                </p>
              ) : (
                opportunities.map((o) => (
                  <div
                    key={o.projectId}
                    className="flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-semibold">{o.client}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {o.what}
                      </p>
                    </div>
                    <span className="text-xs font-semibold whitespace-nowrap">
                      €{o.value}
                    </span>
                  </div>
                ))
              )}
              {undrafted.length > 0 ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={drafting.isPending}
                  onClick={() => drafting.mutate()}
                >
                  {drafting.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Drafting
                      offers…
                    </>
                  ) : (
                    `Draft ${undrafted.length === 1 ? "an offer" : `${undrafted.length} offers`}`
                  )}
                </Button>
              ) : null}
              {pending.length > 0 ? (
                <Button
                  variant={undrafted.length > 0 ? "ghost" : "secondary"}
                  className="w-full"
                  onClick={() => openOffers(pending)}
                >
                  Review {pending.length}{" "}
                  {pending.length === 1 ? "draft" : "drafts"} waiting
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card
            className="animate-rise shadow-card"
            style={{ animationDelay: "0.3s" }}
          >
            <CardHeader className="p-5 pb-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Portfolio
              </p>
              <CardTitle className="mt-2 text-base">Client activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5 pb-5">
              {clients.slice(0, 4).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between border-b pb-2 text-xs last:border-0"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 font-semibold text-muted-foreground">
                    {c.hoursThisMonth} h
                  </span>
                </div>
              ))}
              <Link
                to="/clients"
                className="inline-flex items-center gap-1 pt-2 text-xs font-semibold text-primary hover:underline"
              >
                Client list <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Today's plan</DialogTitle>
            <DialogDescription>
              {onShift.length} workers · {plannedHours} h planned ·{" "}
              {weatherSkips} skipped by weather
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" /> Why this plan
            </p>
            {explanation.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : explanation.isError ? (
              <p className="text-muted-foreground">
                No explanation available: {explanation.error.message}
              </p>
            ) : (
              <p className="leading-relaxed">{explanation.data}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewing(false)}>
              Not yet
            </Button>
            <Button onClick={approvePlan}>Approve plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={offersOpen}
        onOpenChange={(open) => {
          setOffersOpen(open);
          if (!open)
            void queryClient.invalidateQueries({ queryKey: dataKeys.offers });
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Offers to review</DialogTitle>
            <DialogDescription>
              Drafted by AI from each client's plants and this week's weather.
              Nothing is sent — approve the ones you want and send them from
              your email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No drafts waiting.
              </p>
            ) : null}
            {shown.map((offer) => {
              const decision = decisions[offer.id] ?? offer.status;
              const client = clients.find((c) => c.id === offer.clientId);
              return (
                <div key={offer.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{offer.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {client?.name} · {client?.contact} · €{offer.value}
                      </p>
                    </div>
                    {decision !== "draft" ? (
                      <Badge
                        variant="outline"
                        className={
                          decision === "approved"
                            ? "text-status-healthy"
                            : "text-muted-foreground"
                        }
                      >
                        {decision}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm whitespace-pre-line text-muted-foreground">
                    {offer.body}
                  </p>
                  {decision === "draft" ? (
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => decide(offer, "dismissed")}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => decide(offer, "approved")}
                      >
                        Approve
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/** One dot colour per worker card, so the crew grid reads at a glance. */
const workerAccents = [
  "bg-data-violet",
  "bg-data-cyan",
  "bg-data-gold",
  "bg-data-coral",
  "bg-data-lime",
] as const;

function WorkerPlan({
  plan,
  worker,
  accent,
}: {
  plan: DayPlan;
  worker: Worker | undefined;
  accent: string;
}) {
  return (
    <div className="rounded-md border p-3 transition-colors hover:bg-secondary/45">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${accent}`} />
          <p className="truncate text-sm font-semibold">
            {worker?.name ?? plan.workerId}
          </p>
        </div>
        <span className="text-[11px] whitespace-nowrap text-muted-foreground">
          {plan.hours} h · {plan.stops.length} stops
          {plan.km > 0 ? ` · ${plan.km} km` : ""}
        </span>
      </div>
      <ul className="mt-3 space-y-2 border-t pt-3">
        {plan.stops.length === 0 && plan.skipped.length === 0 ? (
          <li className="text-xs text-muted-foreground">
            No tasks — available
          </li>
        ) : null}
        {plan.stops.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium tabular-nums text-muted-foreground">
              {String(t.start).padStart(2, "0")}:00
            </span>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.weatherNote ? (
              <Badge
                variant="outline"
                className="border-data-gold/30 text-status-attention"
              >
                {t.weatherNote}
              </Badge>
            ) : null}
            {t.status === "done" ? (
              <CheckCircle2 className="size-3.5 text-status-healthy" />
            ) : null}
          </li>
        ))}
        {plan.skipped.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate line-through">
              {t.title}
            </span>
            <Badge
              variant="outline"
              className="border-data-gold/30 text-status-attention"
            >
              {t.weatherNote ?? "skipped"}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopMetric({
  icon: Icon,
  label,
  value,
  note,
  color,
}: {
  icon: typeof Leaf;
  label: string;
  value: string;
  note: string;
  color: "violet" | "cyan" | "gold" | "coral";
}) {
  const colors = {
    violet: "bg-data-violet/12 text-data-violet",
    cyan: "bg-data-cyan/12 text-data-cyan",
    gold: "bg-data-gold/15 text-status-attention",
    coral: "bg-data-coral/12 text-data-coral",
  };
  return (
    <div className="border-b p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-child(3)]:border-b-0 sm:[&:nth-child(4)]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">
          {label}
        </p>
        <span
          className={`flex size-7 items-center justify-center rounded-md ${colors[color]}`}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="mt-3 text-xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}
