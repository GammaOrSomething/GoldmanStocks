/**
 * Shared domain types: what every screen, the planner and the AI features work with.
 * src/lib/api/mappers.ts turns database rows (supabase/migrations/) into these.
 */

export type PlantStatus = "healthy" | "attention" | "critical";

export type Project = {
  id: string;
  name: string;
  clientId: string;
  client: string;
  city: string;
  address: string;
  /** site coordinates, used for the weather lookup and route ordering between sites */
  lat: number;
  lng: number;
  zones: string[];
  leadWorkerId: string;
  workerIds: string[];
  visitsPerMonth: number;
  /** Boss-only: 0 and "" for workers, who can't read contract terms. */
  monthlyValue: number;
  contractUntil: string;
  status: PlantStatus;
};

export type Plant = {
  id: string;
  /** readable per-company label, e.g. "PL-0001" — show this, never `id` */
  code: string;
  projectId: string;
  species: string;
  common: string;
  kind: "Tree" | "Hedge" | "Lawn" | "Flower bed" | "Shrub";
  client: string;
  site: string;
  status: PlantStatus;
  lastCare: string;
  nextCare: string;
  nextTask: string;
  /** map position in percent of the site plan, 0–100 */
  x: number;
  y: number;
  /** real GPS position when registered with it; otherwise derived from x/y (see geo.ts) */
  lat?: number;
  lng?: number;
  /** ISO dates behind the "12 Sep" display strings above */
  lastCareDate?: string;
  nextCareDate?: string;
};

export type Client = {
  id: string;
  name: string;
  city: string;
  sites: number;
  plants: number;
  contact: string;
  hoursThisMonth: number;
  /** Boss-only: 0 and "" for workers, who can't read contract terms. */
  monthlyValue: number;
  contractUntil: string;
  health: "good" | "watch" | "at risk";
};

export type Worker = {
  id: string;
  name: string;
  /** job title, e.g. "Head gardener" (not the app role) */
  role: string;
  language: string;
  color: string;
  /** "" when none is on file */
  email: string;
  appRole: "boss" | "worker";
  /** a login is linked to this worker (set by an invitation) */
  hasLogin: boolean;
  /** ISO timestamp of the last invitation email */
  invitedAt?: string;
};

export type Task = {
  id: string;
  title: string;
  projectId: string;
  client: string;
  site: string;
  /** the plant or area the task is about — gives the planner a location within the site */
  plantId?: string;
  workerId: string;
  day: number; // 0 = Monday
  /**
   * Local calendar date, YYYY-MM-DD — set for a one-off task. Undefined means
   * the task is the recurring weekly template it has always been, repeating on `day`.
   * `day` always agrees with `date` when both are present.
   */
  date?: string;
  start: number; // hour, 24h
  duration: number; // hours
  kind:
    "Watering" | "Clipping" | "Mowing" | "Planting" | "Inspection" | "Feeding";
  weatherNote?: string;
  status: "planned" | "done" | "skipped";
  /** ISO timestamp — set when the boss approves the day's plan */
  approvedAt?: string;
};

export type WeatherIcon = "rain" | "cloud" | "sun";

/** one day in the weather strip on the dashboard and schedule */
export type DayWeather = {
  day: string;
  icon: WeatherIcon;
  /** max °C, or null when there's no forecast for the day */
  temp: number | null;
  note: string;
};

export type RevenueOpportunity = {
  client: string;
  what: string;
  value: number;
};

export type TaskPhoto = {
  id: string;
  taskId: string;
  /** object path in the private `task-photos` storage bucket */
  storagePath: string;
  takenAt: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
};

export type OfferStatus = "draft" | "approved" | "dismissed";

/** a drafted repeat-work offer — the boss approves before anything is sent */
export type Offer = {
  id: string;
  clientId: string;
  projectId: string;
  what: string;
  value: number;
  dueDate: string; // YYYY-MM-DD
  subject: string;
  body: string;
  status: OfferStatus;
  createdAt: string;
  approvedAt: string | null;
};
