import { Navigate, useParams } from "react-router";
import type { Catalogue, CustomerOption, InterventionDetail, Technician } from "@vennora/back/types";

import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { InterventionStatus } from "@vennora/shared/enums";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { InterventionForm } from "./intervention-form";

export function EditInterventionPage() {
  return (
    <RequirePermission permission="intervention.update">
      <EditIntervention />
    </RequirePermission>
  );
}

function EditIntervention() {
  useDocumentTitle("Replanifier");
  const { id = "" } = useParams();
  // L'API répond « introuvable » à un technicien qui n'est pas assigné.
  const interventionQuery = useApiQuery<InterventionDetail>(`/api/interventions/${id}`);
  const customersQuery = useApiQuery<CustomerOption[]>("/api/clients/options");
  const techniciansQuery = useApiQuery<Technician[]>("/api/techniciens");
  const catalogue = useApiQuery<Catalogue>("/api/catalogue");
  const skeleton = <><HeaderSkeleton withAction={false} /><DetailSkeleton panels={3} aside={false} /></>;
  const state =
    pageState(interventionQuery, skeleton) ??
    pageState(customersQuery, skeleton) ??
    pageState(techniciansQuery, skeleton) ??
    pageState(catalogue, skeleton);
  if (state) return state;
  const intervention = interventionQuery.data!;

  // Une intervention terminée est signée : on ne la replanifie pas, on
  // renvoie vers la fiche plutôt que d'afficher un formulaire qui échouera.
  if (intervention.status === InterventionStatus.COMPLETED) {
    return <Navigate to={`/interventions/${intervention.id}`} replace />;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Replanifier l'intervention"
        description={intervention.reference}
        breadcrumbs={[
          { label: "Interventions", href: "/interventions" },
          { label: intervention.reference, href: `/interventions/${intervention.id}` },
          { label: "Replanifier" },
        ]}
      />
      <InterventionForm
        initial={{
          ...intervention,
          customerId: intervention.customer.id,
          siteId: intervention.site.id,
          equipmentId: intervention.equipment?.id ?? null,
          technicianId: intervention.technician.id,
          typeId: intervention.type.id,
        }}
        customers={customersQuery.data!}
        technicians={techniciansQuery.data!}
        types={catalogue.data!.interventionTypes}
        cancelHref={`/interventions/${intervention.id}`}
      />
    </div>
  );
}
