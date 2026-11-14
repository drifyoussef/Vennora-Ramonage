import { useSearchParams } from "react-router";

import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { objectId } from "@vennora/shared/schemas";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { SiteForm } from "./site-form";

type CustomerName = { id: string; name: string };

export function NewSitePage() {
  return (
    <RequirePermission permission="site.create">
      <NewSite />
    </RequirePermission>
  );
}

function NewSite() {
  useDocumentTitle("Nouveau site");
  const [searchParams] = useSearchParams();
  const query = useApiQuery<CustomerName[]>("/api/clients/noms");
  const state = pageState(query, <><HeaderSkeleton withAction={false} /><DetailSkeleton panels={2} aside={false} /></>);
  if (state) return state;
  const customers = query.data!;

  // Arrivée depuis une fiche client : on présélectionne et on verrouille le
  // rattachement, pour éviter de recréer un site chez le mauvais client.
  const requested = objectId.safeParse(searchParams.get("client"));
  const preset =
    requested.success && customers.some((c) => c.id === requested.data) ? requested.data : undefined;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Nouveau site"
        breadcrumbs={[{ label: "Sites", href: "/sites" }, { label: "Nouveau" }]}
      />
      <SiteForm
        customers={customers}
        cancelHref={preset ? `/clients/${preset}` : "/sites"}
        lockCustomer={Boolean(preset)}
        initial={preset ? { customerId: preset } : undefined}
      />
    </div>
  );
}
