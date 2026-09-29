import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Cloud, CloudRain, Sun } from "lucide-react";
import { useState } from "react";

import { CompanyAreaPicker } from "@/components/CompanyAreaPicker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/hooks/use-week-plan";
import type { DayWeather } from "@/lib/types";
import type { DashboardWeather } from "@/lib/weather.functions";

const weatherIcon = { rain: CloudRain, cloud: Cloud, sun: Sun } as const;

/**
 * The dashboard's "Care forecast": the week's weather as the plan applies it. It uses a site's
 * forecast, or, until the company has sites, the one for where it's based. With neither, it
 * asks where that is.
 */
export function WeatherCard({
  weather,
  strip,
  weekDates,
  today,
  areaCity,
  needsArea,
}: {
  weather: UseQueryResult<DashboardWeather>;
  strip: DayWeather[];
  weekDates: string[];
  today: number;
  /** the town the forecast is for, while it comes from the company's area */
  areaCity: string | null;
  /** no sites and nowhere set: ask instead of showing a week of "—" */
  needsArea: boolean;
}) {
  const [changingArea, setChangingArea] = useState(false);

  return (
    <Card className="mt-4 shadow-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 p-5 pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Care forecast
          </p>
          <CardTitle className="mt-2 text-base">
            This week's weather, applied to the plan
          </CardTitle>
          {areaCity ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Forecast for {areaCity}. Each site gets its own once you add it.{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => setChangingArea(true)}
              >
                Change
              </button>
            </p>
          ) : null}
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
            {weather.error.message}. The plan shows no weather changes until the
            forecast loads.
          </p>
        ) : needsArea ? (
          <AskForArea />
        ) : (
          strip.map((w, i) => (
            <DayTile
              key={w.day}
              day={w}
              date={weekDates[i] ?? ""}
              isToday={i === today}
            />
          ))
        )}
      </CardContent>

      <Dialog open={changingArea} onOpenChange={setChangingArea}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Where's your company based?</DialogTitle>
            <DialogDescription>
              The forecast uses this until you add sites, and the maps start
              here.
            </DialogDescription>
          </DialogHeader>
          <CompanyAreaPicker onSaved={() => setChangingArea(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AskForArea() {
  return (
    <div className="grid gap-3 sm:col-span-7 sm:max-w-xl">
      <div>
        <p className="text-sm font-medium">Where's your company based?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Forecasts are per site. Until you add one, the plan uses the weather
          where you're based.
        </p>
      </div>
      <CompanyAreaPicker />
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        Or add your first site <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function DayTile({
  day,
  date,
  isToday,
}: {
  day: DayWeather;
  date: string;
  isToday: boolean;
}) {
  const Icon = weatherIcon[day.icon];
  return (
    <div
      className={`rounded-md border bg-secondary/50 p-3 ${isToday ? "border-data-violet/40 bg-data-violet/5" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase">
          {day.day}{" "}
          <span className="font-normal text-muted-foreground">
            {formatDate(date)}
          </span>
        </span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <p className="mt-2 text-xl font-bold">
        {day.temp === null ? "—" : `${day.temp}°`}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{day.note}</p>
    </div>
  );
}
