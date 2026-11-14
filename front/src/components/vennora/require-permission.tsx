import type { ReactNode } from "react";
import { Link } from "react-router";
import { ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { can, type Permission } from "@vennora/shared/permissions";
import { useUser } from "@/lib/user";

/**
 * Garde d'affichage d'une page : sans la permission, un écran « accès
 * réservé » plutôt qu'un formulaire qui échouerait à l'envoi. Le contrôle
 * réel est fait par l'API, sur chaque route.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const user = useUser();
  if (can(user.role, permission)) return children;

  return (
    <div className="flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <ShieldOff className="size-5" />
        </div>
        <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">Accès réservé</h1>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          Cette page est réservée aux administrateurs de l&apos;entreprise. Si vous pensez devoir y
          accéder, demandez à votre responsable de modifier votre rôle.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/">Retour au tableau de bord</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/interventions">Mes interventions</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
