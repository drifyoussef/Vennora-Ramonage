import type { AnomalyListItem } from "@vennora/api/types";
import { FiltersSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { query as toQuery } from "@/lib/api";
import { useDocumentTitle } from "@/lib/title";
import { useUser } from "@/lib/user";
import { pageState, useApiQuery } from "@/lib/query";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/vennora/badges";
import { EmptyState, PageHeader } from "@/components/vennora/page";
import { ANOMALY_STATUS_LABEL, plural } from "@vennora/core/labels";
import { objectId } from "@vennora/core/schemas";
import { AnomalySeverity, AnomalyStatus, UserRole } from "@vennora/core/enums";
import { formatDate } from "@vennora/core/format";
import { cn } from "@/lib/utils";

const STATUSES = [
  AnomalyStatus.OPEN,
  AnomalyStatus.RESOLVED,
  AnomalyStatus.IGNORED,
] as const;

export function AnomaliesPage() {
  useDocumentTitle("Anomalies");
  const user = useUser();
  const [searchParams] = useSearchParams();
  const params: Record<string, string> = Object.fromEntries(searchParams);

  const status =
    STATUSES.find((s) => s === params.statut) ?? AnomalyStatus.OPEN;
  const customerId =
    typeof params.client === "string" &&
    objectId.safeParse(params.client).success
      ? params.client
      : undefined;

  const result = useApiQuery<AnomalyListItem[]>(
    `/api/anomalies${toQuery({ statut: status, client: customerId })}`,
  );
  const state = pageState(
    result,
    <>
      <HeaderSkeleton withAction={false} />
      <FiltersSkeleton chips={3} />
    </>,
  );
  if (state) return state;
  const anomalies = result.data!;

  const bySeverity = new Map<AnomalySeverity, number>();
  for (const anomaly of anomalies) {
    bySeverity.set(anomaly.severity, (bySeverity.get(anomaly.severity) ?? 0) + 1);
  }

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
    return qs ? `/anomalies?${qs}` : "/anomalies";
  };

  return (
    <>
      <PageHeader
        title="Anomalies"
        description="Constats relevés sur le terrain, du plus grave au plus récent."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {STATUSES.map((value) => (
          <Link
            key={value}
            to={href({ statut: value })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              status === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {ANOMALY_STATUS_LABEL[value]}
          </Link>
        ))}
        {customerId && (
          <Link
            to={href({ client: undefined })}
            className="rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
          >
            Retirer le filtre client
          </Link>
        )}
      </div>

      {anomalies.length === 0 ? (
        <EmptyState
          icon={status === AnomalyStatus.OPEN ? CheckCircle2 : TriangleAlert}
          title={
            status === AnomalyStatus.OPEN
              ? "Aucune anomalie ouverte"
              : "Aucune anomalie"
          }
          description={
            status === AnomalyStatus.OPEN
              ? "Tout le parc suivi est conforme aux derniers passages."
              : "Aucune anomalie ne correspond à ce filtre."
          }
        />
      ) : (
        <>
          {status === AnomalyStatus.OPEN && bySeverity.size > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              {[...bySeverity.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([severity, count]) => (
                  <SeverityBadge key={severity} severity={severity} count={count} />
                ))}
            </div>
          )}

          <ul className="space-y-2">
            {anomalies.map((anomaly) => (
              <li
                key={anomaly.id}
                className={cn(
                  "rounded-lg border bg-card p-4",
                  anomaly.status === AnomalyStatus.OPEN &&
                    (anomaly.severity === "CRITICAL" ||
                      anomaly.severity === "HIGH")
                    ? "border-severity-high/30"
                    : "border-border",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TriangleAlert
                    className={cn(
                      "size-4 shrink-0",
                      anomaly.status === AnomalyStatus.OPEN
                        ? "text-severity-high"
                        : "text-muted-foreground",
                    )}
                  />
                  <span className="font-medium">{anomaly.title}</span>
                  <SeverityBadge severity={anomaly.severity} />
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {formatDate(anomaly.createdAt)}
                  </span>
                </div>

                {anomaly.description && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {anomaly.description}
                  </p>
                )}

                {anomaly.recommendation && (
                  <p className="mt-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-sm">
                    <span className="font-medium">Recommandation · </span>
                    {anomaly.recommendation}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-sm">
                  <Link
                    to={`/clients/${anomaly.intervention.customer.id}`}
                    className="font-medium hover:underline"
                  >
                    {anomaly.intervention.customer.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {anomaly.intervention.site.name} ·{" "}
                    {anomaly.intervention.site.city}
                  </span>
                  {anomaly.equipment && (
                    <Link
                      to={`/equipements/${anomaly.equipment.id}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {anomaly.equipment.label ?? anomaly.equipment.type.label}
                    </Link>
                  )}
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-8"
                  >
                    <Link to={`/interventions/${anomaly.intervention.id}`}>
                      {anomaly.intervention.reference}
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-muted-foreground">
            {plural(anomalies.length, "anomalie")}
            {anomalies.length === 100 && " (100 premières)"}
          </p>
        </>
      )}
    </>
  );
}
