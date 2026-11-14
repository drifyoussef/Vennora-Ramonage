import { useParams } from "react-router";
import type { CustomerDetailView } from "@vennora/back/types";

import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { CustomerForm } from "./customer-form";

export function EditCustomerPage() {
  return (
    <RequirePermission permission="customer.update">
      <EditCustomer />
    </RequirePermission>
  );
}

function EditCustomer() {
  useDocumentTitle("Modifier le client");
  const { id = "" } = useParams();
  const query = useApiQuery<CustomerDetailView>(`/api/clients/${id}`);
  const state = pageState(
    query,
    <>
      <HeaderSkeleton withAction={false} />
      <DetailSkeleton panels={2} aside={false} />
    </>,
  );
  if (state) return state;
  const customer = query.data!;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={customer.name}
        description="Modification de la fiche client."
        breadcrumbs={[
          { label: "Clients", href: "/clients" },
          { label: customer.name, href: `/clients/${customer.id}` },
          { label: "Modifier" },
        ]}
      />
      <CustomerForm initial={customer} cancelHref={`/clients/${customer.id}`} />
    </div>
  );
}
