import { Link } from "react-router";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/vennora/page";
import { useDocumentTitle } from "@/lib/title";

/** Adresse inconnue de l'application. */
export function NotFoundPage() {
  useDocumentTitle("Page introuvable");
  return (
    <div className="mx-auto max-w-md pt-10">
      <EmptyState
        icon={SearchX}
        title="Page introuvable"
        description="Cette adresse ne correspond à aucune page. Le lien est peut-être incomplet ou a changé."
        action={
          <Button asChild>
            <Link to="/">Retour au tableau de bord</Link>
          </Button>
        }
      />
    </div>
  );
}
