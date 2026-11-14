import { Link, useSearchParams } from "react-router";
import { MapPin } from "lucide-react";
import type { Catalogue } from "@vennora/back/types";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { objectId } from "@vennora/shared/schemas";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { EquipmentForm } from "./equipment-form";

export type SiteOption = { id: string; name: string; city: string; customerName: string };

export function NewEquipmentPage() {
  return (
    <RequirePermission permission="equipment.create">
      <NewEquipment />
    </RequirePermission>
  );
}

function NewEquipment() {
  useDocumentTitle("Nouvel équipement");
  const [searchParams] = useSearchParams();
  const sitesQuery = useApiQuery<SiteOption[]>("/api/sites/options");
  const catalogue = useApiQuery<Catalogue>("/api/catalogue");
  const skeleton = <><HeaderSkeleton withAction={false} /><DetailSkeleton panels={2} aside={false} /></>;
  const state = pageState(sitesQuery, skeleton) ?? pageState(catalogue, skeleton);
  if (state) return state;
  const sites = sitesQuery.data!;

  const breadcrumbs = [{ label: "Équipements", href: "/equipements" }, { label: "Nouveau" }];

  if (sites.length === 0) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Nouvel équipement" breadcrumbs={breadcrumbs} />
        <EmptyState
          icon={MapPin}
          title="Aucun site disponible"
          description="Un équipement est toujours rattaché à un site. Créez d'abord un client et son site."
          action={
            <Button asChild>
              <Link to="/clients/nouveau">Créer un client</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const requested = objectId.safeParse(searchParams.get("site"));
  const preset = requested.success && sites.some((s) => s.id === requested.data) ? requested.data : undefined;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Nouvel équipement" breadcrumbs={breadcrumbs} />
      <EquipmentForm
        sites={sites}
        types={catalogue.data!.equipmentTypes}
        cancelHref={preset ? `/sites/${preset}` : "/equipements"}
        lockSite={Boolean(preset)}
        initial={preset ? { siteId: preset } : undefined}
      />
    </div>
  );
}
