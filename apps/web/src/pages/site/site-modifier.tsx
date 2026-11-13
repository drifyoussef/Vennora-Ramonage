import { useParams } from "react-router";
import type { SiteDetail } from "@vennora/api/types";

import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { SiteForm } from "./site-form";

type CustomerName = { id: string; name: string };

export function EditSitePage() {
  return (
    <RequirePermission permission="site.update">
      <EditSite />
    </RequirePermission>
  );
}

function EditSite() {
  useDocumentTitle("Modifier le site");
  const { id = "" } = useParams();
  const siteQuery = useApiQuery<SiteDetail>(`/api/sites/${id}`);
  const customersQuery = useApiQuery<CustomerName[]>("/api/clients/noms");
  const skeleton = <><HeaderSkeleton withAction={false} /><DetailSkeleton panels={2} aside={false} /></>;
  const state = pageState(siteQuery, skeleton) ?? pageState(customersQuery, skeleton);
  if (state) return state;
  const site = siteQuery.data!;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={site.name}
        description="Modification du site."
        breadcrumbs={[
          { label: "Sites", href: "/sites" },
          { label: site.name, href: `/sites/${site.id}` },
          { label: "Modifier" },
        ]}
      />
      <SiteForm
        initial={{ ...site, customerId: site.customer.id }}
        customers={customersQuery.data!}
        cancelHref={`/sites/${site.id}`}
      />
    </div>
  );
}
