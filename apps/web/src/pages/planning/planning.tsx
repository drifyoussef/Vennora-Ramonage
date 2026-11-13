import { useDocumentTitle } from "@/lib/title";
import { useUser } from "@/lib/user";
import { pageState, useApiQuery } from "@/lib/query";
import { Link, useSearchParams } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/vennora/page";
import { InterventionCard } from "@/components/vennora/intervention-card";
import type { InterventionCard as Card, Technician } from "@vennora/api/types";
import { HeaderSkeleton, RowListSkeleton } from "@/components/vennora/skeletons";
import { query as toQuery } from "@/lib/api";
import { objectId } from "@vennora/core/schemas";
import { UserRole } from "@vennora/core/enums";
import {
  addDays,
  endOfDay,
  endOfWeek,
  formatDateLong,
  isSameDay,
  startOfDay,
  startOfWeek,
  toDateInput,
} from "@vennora/core/format";
import { cn } from "@/lib/utils";
import { WeekGrid } from "./week-grid";

export function PlanningPage() {
  useDocumentTitle("Planning");
  const user = useUser();
  const [searchParams] = useSearchParams();
  const params: Record<string, string> = Object.fromEntries(searchParams);

  const view = params.vue === "semaine" ? "semaine" : "jour";
  const anchor = parseDate(params.date) ?? new Date();
  const technicianId =
    typeof params.technicien === "string" &&
    objectId.safeParse(params.technicien).success
      ? params.technicien
      : undefined;

  const from = view === "semaine" ? startOfWeek(anchor) : startOfDay(anchor);
  const to = view === "semaine" ? endOfWeek(anchor) : endOfDay(anchor);

  // La plage est calculée ici, dans le fuseau horaire de l'utilisateur, et
  // transmise telle quelle à l'API.
  const planning = useApiQuery<Card[]>(
    `/api/planning${toQuery({ du: from.toISOString(), au: to.toISOString(), technicien: technicianId })}`,
  );
  const technicianList = useApiQuery<Technician[]>("/api/techniciens");
  const skeleton = (
    <>
      <HeaderSkeleton />
      <RowListSkeleton count={6} />
    </>
  );
  const state = pageState(planning, skeleton) ?? pageState(technicianList, skeleton);
  if (state) return state;
  const interventions = planning.data!;
  const technicians = technicianList.data!;

  const isAdmin = user.role === UserRole.ADMIN;
  const step = view === "semaine" ? 7 : 1;

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") next.set(key, value);
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    return qs ? `/planning?${qs}` : "/planning";
  };

  const title =
    view === "semaine"
      ? `Semaine du ${formatDateLong(from)}`
      : capitalize(formatDateLong(anchor));

  return (
    <>
      <PageHeader
        title="Planning"
        description={title}
        actions={
          <Button asChild className="gap-1.5">
            <Link to="/interventions/nouvelle">
              <Plus className="size-4" />
              Nouvelle intervention
            </Link>
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <Button asChild variant="ghost" size="icon" className="size-9">
            <Link
              to={href({ date: toDateInput(addDays(anchor, -step)) })}
              aria-label={view === "semaine" ? "Semaine précédente" : "Jour précédent"}
            >
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="px-3">
            <Link to={href({ date: undefined })}>Aujourd&apos;hui</Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-9">
            <Link
              to={href({ date: toDateInput(addDays(anchor, step)) })}
              aria-label={view === "semaine" ? "Semaine suivante" : "Jour suivant"}
            >
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className="flex rounded-lg border border-border bg-card p-1">
          {(["jour", "semaine"] as const).map((value) => (
            <Link
              key={value}
              to={href({ vue: value })}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                view === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </Link>
          ))}
        </div>

        {isAdmin && technicians.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to={href({ technicien: undefined })}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                !technicianId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              Toute l&apos;équipe
            </Link>
            {technicians.map((technician) => (
              <Link
                key={technician.id}
                to={href({ technicien: technician.id })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors",
                  technicianId === technician.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor:
                      technician.colorHex ?? "var(--muted-foreground)",
                  }}
                />
                {technician.firstName}
              </Link>
            ))}
          </div>
        )}
      </div>

      {interventions.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Aucune intervention"
          description={
            view === "semaine"
              ? "Rien de planifié cette semaine."
              : "Rien de planifié ce jour-là."
          }
          action={
            <Button asChild>
              <Link to="/interventions/nouvelle">Planifier une intervention</Link>
            </Button>
          }
        />
      ) : view === "semaine" ? (
        <WeekGrid from={from} interventions={interventions} showTechnician={isAdmin} />
      ) : (
        <div className="space-y-2">
          {interventions.map((intervention) => (
            <InterventionCard
              key={intervention.id}
              intervention={intervention}
              showTechnician={isAdmin}
            />
          ))}
        </div>
      )}

      {view === "jour" && interventions.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {interventions.length} intervention
          {interventions.length > 1 ? "s" : ""}
          {isSameDay(anchor, new Date()) && " aujourd'hui"}
        </p>
      )}
    </>
  );
}

/** `?date=2026-08-17`. Une date invalide retombe sur aujourd'hui. */
function parseDate(raw: string | string[] | undefined): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
