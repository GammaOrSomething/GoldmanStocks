import { intervalByKind } from "./care-intervals";
import type { Client, Plant, Project, RevenueOpportunity } from "./types";
import { addDays, localDate, type ForecastByProject } from "./weather";

/** Plant kinds whose regrowth creates repeat work, and the job that sells. */
const REPEAT_JOBS: Partial<
  Record<Plant["kind"], { job: string; size: number }>
> = {
  // size = the job as a multiple of one regular contract visit
  Hedge: { job: "hedge clipping", size: 2.5 },
  Lawn: { job: "lawn mowing", size: 1.5 },
};

/** Look this many days ahead for work coming due. */
export const HORIZON_DAYS = 14;
/** Average max temperature over the coming week above which growth speeds up. */
const WARM_GROWTH_C = 16;
/** …and below which it slows down. */
const COOL_GROWTH_C = 10;

export type Opportunity = RevenueOpportunity & {
  clientId: string;
  projectId: string;
  /** client contact person, for the offer's greeting */
  contact: string;
  /** earliest predicted due date among the plants, YYYY-MM-DD */
  dueDate: string;
  /** one line per plant, e.g. "White cedar hedge (Parking edge) — hedge clipping due 2026-09-21" */
  items: string[];
};

/**
 * When a plant's repeat job falls due: its last care plus the care interval (shortened in warm
 * weather), else its scheduled next care. A plant with neither date has no history to predict
 * from, so it's left out rather than guessed.
 */
function predictDue(plant: Plant, factor: number): string | undefined {
  if (plant.lastCareDate)
    return addDays(
      plant.lastCareDate,
      Math.round(intervalByKind[plant.kind] * factor),
    );
  return plant.nextCareDate;
}

/** Growth speed from the coming week's forecast: warm weeks bring work forward. */
export function growthFactor(
  forecast: ForecastByProject[string],
  today: string,
) {
  const week = forecast?.daily.filter(
    (d) => d.date >= today && d.date < addDays(today, 7),
  );
  if (!week?.length) return 1; // no forecast → the regular interval
  const avg = week.reduce((sum, d) => sum + d.tempMaxC, 0) / week.length;
  if (avg >= WARM_GROWTH_C) return 0.8;
  if (avg < COOL_GROWTH_C) return 1.25;
  return 1;
}

/** Price of a repeat job: a multiple of the value of one regular visit, rounded to €10. */
export function estimateValue(project: Project, size: number) {
  const visit = project.monthlyValue / Math.max(project.visitsPerMonth, 1);
  return Math.round((visit * size) / 10) * 10;
}

/**
 * Repeat work to offer: hedges and lawns whose next clipping or mowing is predicted
 * within the horizon (see `predictDue`). One opportunity per client site, biggest first.
 */
export function findOpportunities(
  input: {
    plants: Plant[];
    projects: Project[];
    clients: Client[];
    forecasts: ForecastByProject;
  },
  now: Date,
): Opportunity[] {
  const today = localDate(now);
  const horizon = addDays(today, HORIZON_DAYS);

  return input.projects
    .flatMap((project): Opportunity[] => {
      const client = input.clients.find((c) => c.id === project.clientId);
      const factor = growthFactor(input.forecasts[project.id], today);
      const due = input.plants
        .filter((p) => p.projectId === project.id)
        .flatMap((plant) => {
          const repeat = REPEAT_JOBS[plant.kind];
          if (!repeat) return [];
          const dueDate = predictDue(plant, factor);
          return dueDate && dueDate <= horizon
            ? [{ plant, repeat, dueDate }]
            : [];
        });
      if (!client || !due.length) return [];

      const jobs = [...new Set(due.map((d) => d.repeat.job))];
      const dueDate = due.map((d) => d.dueDate).sort()[0]!;
      return [
        {
          clientId: client.id,
          projectId: project.id,
          client: client.name,
          contact: client.contact,
          what: `${jobs.join(" + ")} due ${dueDate <= today ? "now" : `by ${dueDate}`}`,
          value: due.reduce(
            (sum, d) => sum + estimateValue(project, d.repeat.size),
            0,
          ),
          dueDate,
          items: due.map(
            (d) =>
              `${d.plant.common} (${d.plant.site}) — ${d.repeat.job} due ${d.dueDate}`,
          ),
        },
      ];
    })
    .sort((a, b) => b.value - a.value);
}
