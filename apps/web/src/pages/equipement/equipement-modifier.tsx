import { useParams } from "react-router";
import type { Catalogue, EquipmentDetailView } from "@vennora/api/types";

import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { EquipmentForm } from "./equipment-form";
import type { SiteOption } from "./equipement-nouveau";

export function EditEquipmentPage() {
  return (
    <RequirePermission permission="equipment.update">
      <EditEquipment />
    </RequirePermission>
  );
}

function EditEquipment() {
  useDocumentTitle("Modifier l'équipement");
  const { id = "" } = useParams();
  const equipmentQuery = useApiQuery<EquipmentDetailView>(`/api/equipements/${id}`);
  const sitesQuery = useApiQuery<SiteOption[]>("/api/sites/options");
  const catalogue = useApiQuery<Catalogue>("/api/catalogue");
  const skeleton = <><HeaderSkeleton withAction={false} /><DetailSkeleton panels={2} aside={false} /></>;
  const state =
    pageState(equipmentQuery, skeleton) ?? pageState(sitesQuery, skeleton) ?? pageState(catalogue, skeleton);
  if (state) return state;
  const equipment = equipmentQuery.data!;
  const name = equipment.label ?? equipment.type.label;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={name}
        description="Modification de l'équipement."
        breadcrumbs={[
          { label: "Équipements", href: "/equipements" },
          { label: name, href: `/equipements/${equipment.id}` },
          { label: "Modifier" },
        ]}
      />
      <EquipmentForm
        initial={{ ...equipment, siteId: equipment.site.id, typeId: equipment.type.id }}
        sites={sitesQuery.data!}
        types={catalogue.data!.equipmentTypes}
        cancelHref={`/equipements/${equipment.id}`}
      />
    </div>
  );
}
