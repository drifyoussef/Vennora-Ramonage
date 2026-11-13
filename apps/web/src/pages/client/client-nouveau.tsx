import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { useDocumentTitle } from "@/lib/title";
import { CustomerForm } from "./customer-form";

export function NewCustomerPage() {
  useDocumentTitle("Nouveau client");
  return (
    <RequirePermission permission="customer.create">
      <div className="max-w-3xl">
        <PageHeader
          title="Nouveau client"
          breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: "Nouveau" }]}
        />
        <CustomerForm cancelHref="/clients" />
      </div>
    </RequirePermission>
  );
}
