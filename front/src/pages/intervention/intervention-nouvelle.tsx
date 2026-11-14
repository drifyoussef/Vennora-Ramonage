import { Link, useSearchParams } from "react-router";
import { Users } from "lucide-react";
import type { Catalogue, CustomerOption, Technician } from "@vennora/back/types";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { UserRole } from "@vennora/shared/enums";
import { objectId } from "@vennora/shared/schemas";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { useUser } from "@/lib/user";
import { InterventionForm } from "./intervention-form";

export function NewInterventionPage() {
  return (
    <RequirePermission permission="intervention.create">
      <NewIntervention />
    </RequirePermission>
  );
}

function NewIntervention() {
  useDocumentTitle("Nouvelle intervention");
  const user = useUser();
  const [searchParams] = useSearchParams();
  const customersQuery = useApiQuery<CustomerOption[]>("/api/clients/options");
  const techniciansQuery = useApiQuery<Technician[]>("/api/techniciens");
  const catalogue = useApiQuery<Catalogue>("/api/catalogue");
  const skeleton = <><HeaderSkeleton withAction={false} /><DetailSkeleton panels={3} aside={false} /></>;
  const state =
    pageState(customersQuery, skeleton) ??
    pageState(techniciansQuery, skeleton) ??
    pageState(catalogue, skeleton);
  if (state) return state;
  const customers = customersQuery.data!;

  const breadcrumbs = [
    { label: "Interventions", href: "/interventions" },
    { label: "Nouvelle" },
  ];

  if (customers.length === 0) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Nouvelle intervention" breadcrumbs={breadcrumbs} />
        <EmptyState
          icon={Users}
          title="Aucun client"
          description="Une intervention se planifie chez un client, sur un de ses sites. Créez d'abord un client."
          action={
            <Button asChild>
              <Link to="/clients/nouveau">Créer un client</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Préremplissage depuis une fiche client, site ou équipement.
  const initial = resolvePreset(customers, searchParams);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Nouvelle intervention" breadcrumbs={breadcrumbs} />
      <InterventionForm
        customers={customers}
        technicians={techniciansQuery.data!}
        types={catalogue.data!.interventionTypes}
        cancelHref="/interventions"
        initial={{
          ...initial,
          technicianId: user.role === UserRole.TECHNICIAN ? user.id : undefined,
        }}
      />
    </div>
  );
}

/**
 * Déduit client / site / équipement des paramètres d'URL.
 *
 * On remonte toujours la chaîne complète : arriver depuis un équipement doit
 * présélectionner son site et son client, sinon les sélecteurs dépendants
 * restent vides et le préremplissage ne sert à rien.
 */
function resolvePreset(customers: CustomerOption[], params: URLSearchParams) {
  const read = (key: string) => {
    const parsed = objectId.safeParse(params.get(key));
    return parsed.success ? parsed.data : null;
  };

  const equipmentId = read("equipement");
  if (equipmentId) {
    for (const customer of customers) {
      for (const site of customer.sites) {
        if (site.equipments.some((e) => e.id === equipmentId)) {
          return { customerId: customer.id, siteId: site.id, equipmentId };
        }
      }
    }
  }

  const siteId = read("site");
  if (siteId) {
    const customer = customers.find((c) => c.sites.some((s) => s.id === siteId));
    if (customer) return { customerId: customer.id, siteId };
  }

  const customerId = read("client");
  if (customerId && customers.some((c) => c.id === customerId)) {
    return { customerId };
  }

  return {};
}
