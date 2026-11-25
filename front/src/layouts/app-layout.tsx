import { Navigate, Outlet, useLocation } from "react-router";
import { Loader2 } from "lucide-react";

import { BandeauAbonnement } from "@/components/shell/bandeau-abonnement";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { QueryError } from "@/components/vennora/query-error";
import { useMe } from "@/lib/session";
import { UserContext } from "@/lib/user";

/**
 * Coquille de l'application authentifiée.
 *
 * Sans session, retour à la connexion en gardant la destination — un
 * technicien qui ouvre un QR code doit atterrir sur l'équipement scanné.
 * Ce n'est qu'un confort d'affichage : l'API refuse de toute façon chaque
 * requête sans session valide.
 */
export function AppLayout() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Chargement" />
      </div>
    );
  }
  if (me.isError) return <QueryError error={me.error} onRetry={() => me.refetch()} />;

  const user = me.data;
  if (!user) {
    const suite = location.pathname + location.search;
    return (
      <Navigate
        to={suite === "/" ? "/connexion" : `/connexion?suite=${encodeURIComponent(suite)}`}
        replace
      />
    );
  }

  return (
    <UserContext.Provider value={user}>
      <div className="flex min-h-dvh">
        <Sidebar role={user.role} orgName={user.org.name} plan={user.org.plan} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            orgName={user.org.name}
            user={{
              fullName: user.fullName,
              email: user.email,
              role: user.role,
              colorHex: user.colorHex,
            }}
          />
          <BandeauAbonnement user={user} />

          {/* pb-24 : dégage la barre de navigation basse sur téléphone. */}
          <main className="flex-1 px-4 pt-5 pb-24 sm:px-6 lg:px-8 lg:pb-10">
            <div className="mx-auto w-full max-w-7xl">
              <Outlet />
            </div>
          </main>
        </div>

        <MobileNav role={user.role} />
      </div>
    </UserContext.Provider>
  );
}
