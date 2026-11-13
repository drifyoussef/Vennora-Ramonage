import { useDocumentTitle } from "@/lib/title";
import { useUser } from "@/lib/user";
import { pageState, useApiQuery } from "@/lib/query";
import { Link, useSearchParams } from "react-router";
import { BellRing, CalendarCheck } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/vennora/page";
import { ApercuFactice, ZoneVerrouillee } from "@/components/vennora/zone-verrouillee";
import { autorise } from "@vennora/core/plans";
import type { RemindersView } from "@vennora/api/types";
import { FiltersSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { query as toQuery } from "@/lib/api";
import { ReminderStatus } from "@vennora/core/enums";
import { plural } from "@vennora/core/labels";
import { formatAddress } from "@vennora/core/format";
import { cn } from "@/lib/utils";
import { ReminderRow, type ReminderRowData } from "./reminder-row";

const TABS = [
  { value: ReminderStatus.PENDING, label: "À replanifier" },
  { value: ReminderStatus.DONE, label: "Traités" },
  { value: ReminderStatus.DISMISSED, label: "Écartés" },
] as const;

export function RemindersPage() {
  useDocumentTitle("Rappels");
  const user = useUser();
  const [searchParams] = useSearchParams();
  const params: Record<string, string> = Object.fromEntries(searchParams);

  const status =
    TABS.find((t) => t.value === params.statut)?.value ?? ReminderStatus.PENDING;

  const result = useApiQuery<RemindersView>(`/api/rappels${toQuery({ statut: status })}`);
  const state = pageState(
    result,
    <>
      <HeaderSkeleton withAction={false} />
      <FiltersSkeleton chips={3} />
    </>,
  );
  if (state) return state;
  const { reminders } = result.data!;
  const overdue = reminders.filter((r) => r.overdue).length;

  const rows: ReminderRowData[] = reminders.map((r) => ({
    id: r.id,
    dueDate: r.dueDate.toISOString(),
    overdue: r.overdue,
    customerName: r.customer?.name ?? "Client inconnu",
    customerId: r.customer?.id ?? "",
    equipmentId: r.equipment?.id ?? null,
    equipmentLabel:
      r.equipment?.label ?? r.equipment?.type.label ?? null,
    siteLabel: r.equipment?.site
      ? `${r.equipment.site.name} — ${formatAddress(r.equipment.site)}`
      : null,
    sourceReference: r.sourceIntervention?.reference ?? null,
    sourceId: r.sourceIntervention?.id ?? null,
  }));

  if (!autorise(user.org.plan, "rappels")) {
    return (
      <>
        <PageHeader
          title="Rappels"
          description="Prochaines interventions conseillées, fixées à la clôture."
        />
        <ZoneVerrouillee
          fonctionnalite="rappels"
          titre="Suivi des échéances"
          description="La liste de ce qui arrive à terme, équipement par équipement, avant que le client n'appelle."
          apercu={<ApercuFactice lignes={5} />}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Rappels"
        description="Prochaines interventions conseillées, fixées à la clôture. Aucun client n'est relancé automatiquement."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            to={
              tab.value === ReminderStatus.PENDING
                ? "/rappels"
                : `/rappels?statut=${tab.value}`
            }
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              status === tab.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {overdue > 0 && status === ReminderStatus.PENDING && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-severity-high/25 bg-severity-high/8 px-3.5 py-3 text-sm text-severity-high">
          <BellRing className="size-4 shrink-0" />
          <span className="font-medium">
            {plural(overdue, "échéance dépassée", "échéances dépassées")}
          </span>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={
            status === ReminderStatus.PENDING
              ? "Aucun rappel en attente"
              : "Aucun rappel"
          }
          description={
            status === ReminderStatus.PENDING
              ? "Les prochaines interventions conseillées apparaîtront ici au fur et à mesure des clôtures."
              : "Rien dans cette catégorie."
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} />
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            {plural(rows.length, "rappel", "rappels")}
          </p>
        </>
      )}
    </>
  );
}
