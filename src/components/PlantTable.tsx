import { CalendarDays, ChevronUp, Pencil } from "lucide-react";

import { PlantCalendar } from "@/components/PlantCalendar";
import { PlantPhoto } from "@/components/PlantPhoto";
import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Plant } from "@/lib/types";

/**
 * The plants & areas register for one site: a header card, the table, and a footer card.
 * Shared by the Plants page (one per site) and the project page, so both look the same.
 */
export function PlantTableSection({
  title,
  crew,
  rows,
  footerLabel,
  action,
  onOpenCalendar,
  onEdit,
}: {
  title: string;
  /** full names of the site's crew */
  crew: string[];
  rows: Plant[];
  /** right-hand side of the footer, e.g. the site name */
  footerLabel: string;
  /** right-hand side of the header, e.g. a "View map" link */
  action?: React.ReactNode;
  onOpenCalendar: (plant: Plant) => void;
  onEdit: (plant: Plant) => void;
}) {
  return (
    <section className="space-y-2">
      <Card className="relative z-20 shadow-card">
        <CardHeader className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {rows.length} items · crew{" "}
                {crew.map((name) => name.split(" ")[0]).join(", ")}
              </p>
            </div>
            {action}
          </div>
        </CardHeader>
      </Card>

      <Card className="relative z-10 overflow-hidden shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="bg-muted/45 hover:bg-muted/45">
                <TableHead className="sticky left-0 z-20 w-28 border-r bg-muted px-4">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase">
                    ID <ChevronUp className="size-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-48 text-[10px] font-semibold uppercase">
                  Plant / area
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase">
                  Type
                </TableHead>
                <TableHead className="min-w-40 text-[10px] font-semibold uppercase">
                  Zone
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase">
                  Status
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase">
                  Last care
                </TableHead>
                <TableHead className="min-w-40 text-[10px] font-semibold uppercase">
                  Next task
                </TableHead>
                <TableHead className="w-24 text-right text-[10px] font-semibold uppercase">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow
                  key={p.id}
                  className="group h-16 transition-colors hover:bg-data-violet/5"
                >
                  <TableCell className="sticky left-0 z-10 border-r bg-card px-4 font-mono text-xs font-medium text-muted-foreground group-hover:bg-[color-mix(in_oklab,var(--data-violet)_5%,var(--card))]">
                    {p.code}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{p.common}</p>
                    <p className="text-xs italic text-muted-foreground">
                      {p.species}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {p.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{p.site}</TableCell>
                  <TableCell>
                    <StatusDot status={p.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.lastCare}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{p.nextTask}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.nextCare}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenCalendar(p)}
                        aria-label={`Open care calendar for ${p.common}`}
                        title="Open care calendar"
                      >
                        <CalendarDays className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEdit(p)}
                        aria-label={`Edit ${p.common}`}
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="relative z-0 shadow-card">
        <CardContent className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
          <span>
            Showing {rows.length} of {rows.length} items
          </span>
          <span>{footerLabel}</span>
        </CardContent>
      </Card>
    </section>
  );
}

/** A plant's photo and care calendar, opened from the register's calendar button. */
export function PlantCalendarDialog({
  plant,
  onClose,
}: {
  plant: Plant | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(plant)} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {plant ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {plant.common}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {plant.code}
                </span>
              </DialogTitle>
              <DialogDescription>
                {plant.species} · {plant.client} · {plant.site}
              </DialogDescription>
            </DialogHeader>
            <PlantPhoto plantId={plant.id} />
            <PlantCalendar plant={plant} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
