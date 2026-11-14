import { api } from "@/lib/api";
import { ConfirmDelete } from "@/components/vennora/confirm-delete";

export function DeleteIntervention({
  id,
  reference,
}: {
  id: string;
  reference: string;
}) {
  return (
    <ConfirmDelete
      action={() => api.delete(`/api/interventions/${id}`)}
      entityName={reference}
      title="Supprimer cette intervention ?"
      description="L'intervention, ses photos, ses notes et ses anomalies seront supprimées. Cette action est irréversible."
      redirectTo="/interventions"
      triggerVariant="ghost"
    />
  );
}
