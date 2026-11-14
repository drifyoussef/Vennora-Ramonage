import { Link, Navigate, useParams } from "react-router";
import { Loader2, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/vennora/page";
import { useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";

/**
 * Résolution d'un QR code d'équipement.
 *
 * Sous la coquille authentifiée : un scan par un visiteur non connecté passe
 * d'abord par /connexion, qui le ramène ici grâce au paramètre `suite`. La
 * recherche se fait dans l'organisation de l'utilisateur, donc une étiquette
 * d'une autre entreprise ne remonte rien.
 */
export function QrResolvePage() {
  useDocumentTitle("Équipement");
  const { token = "" } = useParams();
  const query = useApiQuery<{ id: string }>(`/api/qr/${encodeURIComponent(token)}`);

  if (query.isPending) {
    return (
      <div className="grid place-items-center pt-16" aria-busy="true">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Recherche de l'équipement" />
      </div>
    );
  }
  if (query.data) return <Navigate to={`/equipements/${query.data.id}`} replace />;

  return (
    <div className="mx-auto max-w-md pt-10">
      <EmptyState
        icon={QrCode}
        title="Équipement introuvable"
        description="Ce QR code ne correspond à aucun équipement de votre entreprise. Il peut avoir été régénéré, ou appartenir à une autre société."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link to="/scanner">Scanner à nouveau</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/equipements">Voir les équipements</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
