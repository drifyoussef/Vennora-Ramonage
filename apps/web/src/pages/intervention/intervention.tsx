import type { InterventionDossier } from "@vennora/api/types";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { useDocumentTitle } from "@/lib/title";
import { useUser } from "@/lib/user";
import { pageState, useApiQuery } from "@/lib/query";
import { Link, useParams } from "react-router";
import {
  KeyRound,
  Mail,
  MapPin,
  Navigation,
  Pencil,
  Phone,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge, TechnicianChip, TypeBadge } from "@/components/vennora/badges";
import { PanelBoundary } from "@/components/vennora/panel-boundary";
import { Field, FieldGrid, PageHeader } from "@/components/vennora/page";
import { ApercuFactice, ZoneVerrouillee } from "@/components/vennora/zone-verrouillee";
import { autorise } from "@vennora/core/plans";
import { can } from "@vennora/core/permissions";
import { InterventionStatus, UserRole } from "@vennora/core/enums";
import { getTrade } from "@vennora/core/verticals/registry";
import {
  formatAddress,
  formatDateLong,
  formatDateTime,
  formatDuration,
  formatPhone,
  formatTime,
} from "@vennora/core/format";
import { AnomalyPanel, type AnomalyItem } from "./anomaly-panel";
import { CompletePanel } from "./complete-panel";
import { DeleteIntervention } from "./delete-intervention";
import { NotesPanel } from "./notes-panel";
import { PhotoPanel } from "./photo-panel";
import { ReportPanel } from "./report-panel";
import { SignaturePad } from "./signature-pad";
import { StatusActions } from "./status-actions";
import { VoicePanel } from "./voice-panel";

export function InterventionPage() {
  const user = useUser();
  const { id = "" } = useParams();
  // L'API répond « introuvable » à un technicien qui n'est pas assigné.
  const query = useApiQuery<InterventionDossier>(`/api/interventions/${id}`);
  useDocumentTitle(query.data?.reference ?? "Intervention");
  const state = pageState(
    query,
    <>
      <HeaderSkeleton />
      <DetailSkeleton />
    </>,
  );
  if (state) return state;
  const intervention = query.data!;

  const inProgress = intervention.status === InterventionStatus.IN_PROGRESS;
  const completed = intervention.status === InterventionStatus.COMPLETED;
  const cancelled = intervention.status === InterventionStatus.CANCELLED;

  /**
   * Le travail de terrain n'est ouvert qu'une fois l'intervention démarrée.
   * Avant, la fiche est une feuille de route ; après clôture, une archive.
   */
  const fieldOpen = inProgress && can(user.role, "intervention.update");
  const readOnly = !fieldOpen;

  const { photos, voiceNotes, report } = intervention;

  const trade = getTrade(user.org.tradeSlug);
  const durationMin = Math.round(
    (intervention.scheduledEnd.getTime() -
      intervention.scheduledStart.getTime()) /
      60_000,
  );
  const mapsQuery = encodeURIComponent(
    `${intervention.site.address}, ${intervention.site.postalCode} ${intervention.site.city}`,
  );

  const canEditSchedule =
    can(user.role, "intervention.update") && !completed;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Interventions", href: "/interventions" },
          { label: intervention.reference },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {intervention.customer.name}
            <StatusBadge status={intervention.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs">{intervention.reference}</span>
            <span aria-hidden="true">·</span>
            <span>
              {capitalize(formatDateLong(intervention.scheduledStart))}, de{" "}
              {formatTime(intervention.scheduledStart)} à{" "}
              {formatTime(intervention.scheduledEnd)} (
              {formatDuration(durationMin)})
            </span>
          </span>
        }
        actions={
          canEditSchedule && (
            <Button asChild variant="outline" className="gap-1.5">
              <Link to={`/interventions/${intervention.id}/modifier`}>
                <Pencil className="size-4" />
                Replanifier
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {can(user.role, "intervention.update") && (
            <StatusActions id={intervention.id} status={intervention.status} />
          )}

          {cancelled && (
            <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              Cette intervention est annulée. Réactivez-la pour reprendre le
              travail.
            </p>
          )}

          {intervention.notes && !fieldOpen && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-heading mb-2 text-base font-semibold">
                Consignes
              </h2>
              <p className="text-sm whitespace-pre-wrap">{intervention.notes}</p>
            </section>
          )}

          {intervention.internalNotes && user.role === UserRole.ADMIN && (
            <section className="rounded-xl border border-dashed border-border p-4">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Notes internes
              </p>
              <p className="mt-1.5 text-sm whitespace-pre-wrap">
                {intervention.internalNotes}
              </p>
            </section>
          )}

          {/* ── Travail de terrain ─────────────────────────────────────── */}
          {!cancelled && (
            <>
              <PanelBoundary title="Photos">
                <PhotoPanel
                  interventionId={intervention.id}
                  initial={photos}
                  readOnly={readOnly}
                />
              </PanelBoundary>

              {fieldOpen && (
                <PanelBoundary title="Notes">
                <NotesPanel
                    interventionId={intervention.id}
                    initial={intervention.notes ?? ""}
                    readOnly={false}
                  />
              </PanelBoundary>
              )}

              {/* Le panneau réel n'est pas rendu hors offre : ni les notes,
                  ni le composant d'enregistrement n'atteignent le navigateur. */}
              {autorise(user.org.plan, "redaction-assistee") ? (
                <PanelBoundary title="Dictée">
                  <VoicePanel
                    interventionId={intervention.id}
                    initial={voiceNotes}
                    readOnly={readOnly}
                    transcriptionLive={intervention.ai.transcription}
                  />
                </PanelBoundary>
              ) : (
                <ZoneVerrouillee
                  fonctionnalite="redaction-assistee"
                  titre="Dictée et compte-rendu assisté"
                  description="Le technicien dicte ses constats, Vennora en tire un brouillon structuré qu'il relit et corrige."
                  apercu={<ApercuFactice lignes={3} />}
                />
              )}

              <PanelBoundary title="Anomalies">
                <AnomalyPanel
                  interventionId={intervention.id}
                  initial={intervention.anomalies as AnomalyItem[]}
                  readOnly={readOnly}
                />
              </PanelBoundary>

              <PanelBoundary title="Compte-rendu">
                <ReportPanel
                  interventionId={intervention.id}
                  readOnly={readOnly}
                  aiLive={intervention.ai.redaction}
                  redactionAssistee={autorise(user.org.plan, "redaction-assistee")}
                  envoiAutorise={autorise(user.org.plan, "envoi-rapport")}
                  customerEmail={intervention.customer.email}
                  sections={trade.reportSections.map((s) => ({
                    key: s.key,
                    label: s.label,
                    hint: s.hint,
                    required: s.required,
                  }))}
                  initial={{
                    values: {
                      summary: report?.summary ?? "",
                      workDone: report?.workDone ?? "",
                      equipmentState: report?.equipmentState ?? "",
                      anomaliesSummary: report?.anomaliesSummary ?? "",
                      recommendations: report?.recommendations ?? "",
                      futureWork: report?.futureWork ?? "",
                    },
                    validatedAt: report?.validatedAt?.toISOString() ?? null,
                    sentAt: report?.sentAt?.toISOString() ?? null,
                    sentTo: report?.sentTo ?? [],
                    pdfUrl: report?.pdfUrl ?? null,
                    origin: report?.origin ?? "MANUAL",
                    regenerations: report?.regenerations ?? 0,
                  }}
                />
              </PanelBoundary>

              <PanelBoundary title="Signature du client">
                <SignaturePad
                  interventionId={intervention.id}
                  readOnly={readOnly}
                  existing={
                    intervention.signature
                      ? {
                          signerName: intervention.signature.signerName,
                          signedAt: intervention.signature.signedAt,
                        }
                      : null
                  }
                />
              </PanelBoundary>

              {fieldOpen && (
                <PanelBoundary title="Clôture">
                <CompletePanel
                    interventionId={intervention.id}
                    hasValidatedReport={Boolean(report?.validatedAt)}
                    hasSignature={Boolean(intervention.signature)}
                    recurrenceMonths={intervention.type.recurrenceMonths}
                    baseDate={intervention.scheduledStart}
                  />
              </PanelBoundary>
              )}
            </>
          )}
        </div>

        {/* ── Colonne de contexte ──────────────────────────────────────── */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-heading mb-4 text-base font-semibold">
              Intervention
            </h2>
            <FieldGrid className="grid-cols-1 lg:grid-cols-1">
              <Field label="Type">
                <TypeBadge
                  label={intervention.type.label}
                  colorHex={intervention.type.colorHex}
                />
              </Field>
              <Field label="Technicien">
                <TechnicianChip
                  firstName={intervention.technician.firstName}
                  lastName={intervention.technician.lastName}
                  colorHex={intervention.technician.colorHex}
                  showName
                />
              </Field>
              {intervention.startedAt && (
                <Field label="Démarrée à">
                  {formatDateTime(intervention.startedAt)}
                </Field>
              )}
              {intervention.completedAt && (
                <Field label="Terminée à">
                  {formatDateTime(intervention.completedAt)}
                </Field>
              )}
              {intervention.nextInterventionAt && (
                <Field label="Prochaine conseillée">
                  {formatDateTime(intervention.nextInterventionAt)}
                </Field>
              )}
            </FieldGrid>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-heading mb-4 text-base font-semibold">Client</h2>
            <Link
              to={`/clients/${intervention.customer.id}`}
              className="font-medium hover:underline"
            >
              {intervention.customer.name}
            </Link>

            <div className="mt-3 space-y-2 text-sm">
              {intervention.customer.phone && (
                <a
                  href={`tel:${intervention.customer.phone.replace(/\s/g, "")}`}
                  className="flex min-h-9 items-center gap-2 hover:underline"
                >
                  <Phone className="size-4 shrink-0 text-muted-foreground" />
                  <span className="tabular-nums">
                    {formatPhone(intervention.customer.phone)}
                  </span>
                </a>
              )}
              {intervention.customer.email && (
                <a
                  href={`mailto:${intervention.customer.email}`}
                  className="flex min-h-9 items-center gap-2 hover:underline"
                >
                  <Mail className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{intervention.customer.email}</span>
                </a>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-heading mb-4 text-base font-semibold">Site</h2>
            <Link
              to={`/sites/${intervention.site.id}`}
              className="font-medium hover:underline"
            >
              {intervention.site.name}
            </Link>
            <p className="mt-1.5 flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {formatAddress(intervention.site)}
            </p>

            <Button asChild variant="outline" className="mt-3 w-full gap-1.5">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${mapsQuery}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Navigation className="size-4" />
                Itinéraire
              </a>
            </Button>

            {intervention.site.accessNotes && (
              <div className="mt-4 flex gap-2.5 rounded-lg border border-brand/25 bg-brand-subtle p-3">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-brand" />
                <div>
                  <p className="text-xs font-medium tracking-wide text-brand uppercase">
                    Accès
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">
                    {intervention.site.accessNotes}
                  </p>
                </div>
              </div>
            )}
          </section>

          {intervention.equipment && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-heading mb-4 text-base font-semibold">
                Équipement
              </h2>
              <Link
                to={`/equipements/${intervention.equipment.id}`}
                className="flex items-start gap-2 font-medium hover:underline"
              >
                <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {intervention.equipment.label ??
                  intervention.equipment.type.label}
              </Link>
              <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <div>
                  {[intervention.equipment.brand, intervention.equipment.model]
                    .filter(Boolean)
                    .join(" ") || intervention.equipment.type.label}
                </div>
                {intervention.equipment.serialNumber && (
                  <div className="font-mono text-xs">
                    N° {intervention.equipment.serialNumber}
                  </div>
                )}
                {intervention.equipment.location && (
                  <div>{intervention.equipment.location}</div>
                )}
              </dl>
            </section>
          )}

          {can(user.role, "intervention.delete") && !completed && (
            <DeleteIntervention
              id={intervention.id}
              reference={intervention.reference}
            />
          )}
        </aside>
      </div>
    </>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
