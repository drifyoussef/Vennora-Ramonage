import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { useDocumentTitle } from "@/lib/title";
import { ImportForm } from "./import-form";

export function ImportCustomersPage() {
  useDocumentTitle("Reprendre un fichier clients");
  return (
    <RequirePermission permission="customer.create">
      <div className="max-w-3xl">
        <PageHeader
          title="Reprendre un fichier clients"
          description="Un export de tableur suffit. Rien n'est enregistré avant votre validation."
          breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: "Reprise" }]}
        />
        <ImportForm />
      </div>
    </RequirePermission>
  );
}
