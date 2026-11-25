import { Link, useLocation } from "react-router";
import { Lock, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { can } from "@vennora/shared/permissions";
import { formatDate } from "@vennora/shared/format";
import type { CurrentUser } from "@vennora/back/types";

const JOUR_MS = 86_400_000;

/**
 * Bandeau d'essai et de lecture seule, en tête de chaque écran.
 *
 * Pendant l'essai : le compte à rebours, et le chemin vers l'offre — tant
 * qu'on n'a pas souscrit. Après : ce qui reste possible (tout voir) et ce
 * qu'il faut faire pour reprendre. Le refus réel est côté API ; ce bandeau
 * évite seulement que l'utilisateur le découvre au premier enregistrement.
 */
export function BandeauAbonnement({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation();
  const { lectureSeule, essaiJusquAu, abonne } = user.org.acces;
  const admin = can(user.role, "organization.manage");
  const surLaPage = pathname.startsWith("/parametres/abonnement");

  if (!lectureSeule && (!essaiJusquAu || abonne)) return null;

  // Jours restants, comptés dans le fuseau du navigateur.
  const jours = essaiJusquAu
    ? Math.max(0, Math.ceil((essaiJusquAu.getTime() - Date.now()) / JOUR_MS))
    : 0;
  const urgent = lectureSeule || jours <= 3;

  return (
    <div
      role={lectureSeule ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm sm:px-6 lg:px-8",
        urgent
          ? "border-severity-high/30 bg-severity-high/10"
          : "border-brand/25 bg-brand-subtle",
      )}
    >
      <p className="flex min-w-0 flex-1 items-center gap-2">
        {lectureSeule ? (
          <Lock className="size-4 shrink-0 text-severity-high" />
        ) : (
          <Sparkles className="size-4 shrink-0 text-brand" />
        )}
        <span className="text-pretty">
          {lectureSeule ? (
            admin ? (
              <>
                <strong>Votre essai est terminé.</strong> Vos données restent consultables ;
                choisissez une offre pour continuer à travailler.
              </>
            ) : (
              <>
                <strong>Lecture seule.</strong> L&apos;abonnement de votre entreprise n&apos;est
                plus actif : prévenez votre administrateur.
              </>
            )
          ) : (
            <>
              <strong>
                Essai gratuit : {jours === 0 ? "dernier jour" : `encore ${jours} jour${jours > 1 ? "s" : ""}`}
              </strong>{" "}
              (jusqu&apos;au {formatDate(essaiJusquAu)}).{" "}
              {admin
                ? "Choisissez votre offre dès maintenant : rien ne sera prélevé avant la fin de l'essai."
                : "Toutes les fonctionnalités Pro sont ouvertes."}
            </>
          )}
        </span>
      </p>
      {admin && !surLaPage && (
        <Button asChild size="sm" variant={urgent ? "default" : "outline"} className="shrink-0">
          <Link to="/parametres/abonnement">Choisir mon offre</Link>
        </Button>
      )}
    </div>
  );
}
