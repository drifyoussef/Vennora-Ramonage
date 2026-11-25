import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CreditCard, ExternalLink, FlaskConical, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { act } from "@/lib/actions";
import { api } from "@/lib/api";
import { pageState, useApiQuery } from "@/lib/query";
import { useDocumentTitle } from "@/lib/title";
import { cn } from "@/lib/utils";
import type { Plan } from "@vennora/shared/enums";
import { formatDate } from "@vennora/shared/format";
import { SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_TONE } from "@vennora/shared/labels";
import {
  FONCTIONNALITE_LABEL,
  fonctionnalitesOffre,
  libelleOffre,
  supplementUtilisateurs,
  utilisateursInclus,
} from "@vennora/shared/plans";
import type { SubscriptionView } from "@vennora/back/types";

export function SubscriptionPage() {
  return (
    <RequirePermission permission="organization.manage">
      <Subscription />
    </RequirePermission>
  );
}

const INTERVALLE: Record<string, string> = { day: "jour", week: "semaine", month: "mois", year: "an" };

function formatPrix(centimes: number, devise: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise.toUpperCase(),
    minimumFractionDigits: centimes % 100 === 0 ? 0 : 2,
  }).format(centimes / 100);
}

function utilisateurs(n: number): string {
  return n === Infinity ? "Utilisateurs illimités" : `${n} utilisateur${n > 1 ? "s" : ""}`;
}

function Subscription() {
  useDocumentTitle("Abonnement");
  const query = useApiQuery<SubscriptionView>("/api/abonnement");
  // Relit tout, session comprise : c'est elle qui porte l'offre et l'état
  // d'essai affichés dans le reste de l'application.
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const retour = searchParams.get("retour");
  const [pending, startTransition] = useTransition();
  const [cible, setCible] = useState<string | null>(null);
  /** Offre dont le changement attend une confirmation. */
  const [aConfirmer, setAConfirmer] = useState<Plan | null>(null);

  // Retour de Checkout : l'abonnement n'existe qu'à réception du webhook, qui
  // arrive en général dans la seconde. On relit quelques fois, puis on
  // laisse l'utilisateur recharger.
  const [attente, setAttente] = useState(retour === "succes");
  const essais = useRef(0);
  const enCours = query.data?.abonnementEnCours ?? false;
  useEffect(() => {
    if (!attente) return;
    if (enCours) {
      setAttente(false);
      toast.success("Abonnement activé. Merci de votre confiance !");
      return;
    }
    const timer = setInterval(() => {
      essais.current += 1;
      void queryClient.invalidateQueries();
      if (essais.current >= 10) setAttente(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [attente, enCours, queryClient]);

  useEffect(() => {
    if (retour === "annule") toast("Souscription interrompue : rien n'a été débité.");
    if (retour) {
      const next = new URLSearchParams(searchParams);
      next.delete("retour");
      setSearchParams(next, { replace: true });
    }
    // Une seule fois, au retour de Stripe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = pageState(
    query,
    <>
      <HeaderSkeleton withAction={false} />
      <DetailSkeleton panels={2} aside={false} />
    </>,
  );
  if (state) return state;
  const view = query.data!;

  /** Va chez Stripe (Checkout ou portail) : l'adresse est donnée par l'API. */
  function rediriger(cle: string, appel: () => Promise<{ url: string }>) {
    setCible(cle);
    startTransition(async () => {
      const result = await act(appel);
      if (result.ok) {
        window.location.assign(result.data.url);
      } else {
        toast.error(result.error);
        setCible(null);
      }
    });
  }

  const souscrire = (plan: Plan) =>
    rediriger(plan, () => api.post<{ url: string }>("/api/abonnement/souscription", { plan }));
  const portail = () =>
    rediriger("portail", () => api.post<{ url: string }>("/api/abonnement/portail"));

  function changer(plan: Plan) {
    setCible(plan);
    startTransition(async () => {
      const result = await act(() => api.post<{ plan: Plan }>("/api/abonnement/changement", { plan }));
      setCible(null);
      setAConfirmer(null);
      if (result.ok) {
        toast.success(`Vous êtes passé à l'offre ${libelleOffre(result.data.plan)}.`);
        await queryClient.invalidateQueries();
      } else {
        toast.error(result.error);
      }
    });
  }

  const lancement = view.grille === "lancement";
  const prixUtilisateur = view.prixUtilisateur
    ? formatPrix(view.prixUtilisateur.montant, view.prixUtilisateur.devise)
    : null;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Abonnement"
        description="Votre offre, votre moyen de paiement et vos factures."
        breadcrumbs={[{ label: "Paramètres", href: "/parametres" }, { label: "Abonnement" }]}
      />

      {view.modeTest && (
        <section className="mb-6 rounded-xl border border-severity-medium/40 bg-severity-medium/8 p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="size-4 text-severity-medium" />
            Mode test Stripe : aucun paiement réel
          </p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            <li>
              <code className="text-foreground">4242 4242 4242 4242</code> : paiement accepté
            </li>
            <li>
              <code className="text-foreground">4000 0025 0000 3155</code> : authentification 3-D Secure
            </li>
            <li>
              <code className="text-foreground">4000 0000 0000 9995</code> : refusé (fonds insuffisants)
            </li>
            <li>
              <code className="text-foreground">4000 0000 0000 0341</code> : enregistrée, puis refusée au
              premier prélèvement (fin d&apos;essai en impayé)
            </li>
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            Date d&apos;expiration future, CVC et code postal quelconques.
          </p>
        </section>
      )}

      {attente && (
        <p className="mb-6 flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm">
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          Stripe confirme la souscription, votre offre s&apos;active dans un instant…
        </p>
      )}

      <section
        className={cn(
          "mb-6 rounded-xl border bg-card p-5",
          view.lectureSeule ? "border-severity-high/40" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Offre actuelle
            </p>
            <p className="font-heading mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold">
              {libelleOffre(view.plan)}
              {view.status && view.abonnementEnCours && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    SUBSCRIPTION_STATUS_TONE[view.status],
                  )}
                >
                  {SUBSCRIPTION_STATUS_LABEL[view.status]}
                </span>
              )}
              {view.lectureSeule && (
                <span className="inline-flex items-center gap-1 rounded-full border border-severity-high/30 bg-severity-high/10 px-2 py-0.5 text-xs font-medium text-severity-high">
                  <Lock className="size-3" />
                  Lecture seule
                </span>
              )}
            </p>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              <Resume view={view} />
            </p>
          </div>
          {view.paiementEnLigne && view.portailDisponible && (
            <Button variant="outline" className="h-11 gap-1.5" onClick={portail} disabled={pending}>
              {pending && cible === "portail" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              Carte, factures, résiliation
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </section>

      {!view.paiementEnLigne ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Le paiement en ligne n&apos;est pas encore ouvert. Pour changer d&apos;offre, écrivez-nous.
        </p>
      ) : view.gereHorsLigne ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Votre offre {libelleOffre(view.plan)} est gérée directement avec nous : écrivez-nous pour
          la faire évoluer.
        </p>
      ) : view.catalogueIndisponible || view.offres.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Les tarifs ne sont pas disponibles pour le moment. Réessayez dans un instant.
        </p>
      ) : (
        <section>
          <h2 className="font-heading mb-1 text-base font-semibold">
            {view.abonnementEnCours ? "Changer d'offre" : "Choisir une offre"}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground text-pretty">
            {view.abonnementEnCours
              ? "Le changement est immédiat ; la différence est calculée au prorata sur votre prochaine facture."
              : view.essaiJusquAu
                ? `Votre essai court jusqu'au ${formatDate(view.essaiJusquAu)} : choisir maintenant ne l'écourte pas, le premier prélèvement n'aura lieu qu'à sa fin.`
                : view.essaiALaSouscription
                  ? `${view.joursEssai} jours d'essai gratuit sur l'offre choisie, sans carte bancaire.`
                  : "Sans engagement : résiliable à tout moment, effet à la fin du mois payé."}
          </p>

          {lancement && (
            <p className="mb-4 rounded-xl border border-dashed border-brand/40 bg-brand-subtle p-3 text-sm text-pretty">
              <span className="font-semibold text-brand">Tarif de lancement</span> : 20 % sous le
              tarif public, pour les premières entreprises qui nous rejoignent. Il reste le vôtre
              tant que l&apos;abonnement court, même en changeant d&apos;offre.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            {view.offres.map((offre) => {
              const actuelle = view.abonnementEnCours && offre.plan === view.plan;
              const conseillee = offre.plan === "PRO" && !view.abonnementEnCours;
              const inclus = utilisateursInclus(offre.plan);
              const tropDeMonde =
                !supplementUtilisateurs(offre.plan) && view.utilisateursActifs > inclus;
              const enPlus = supplementUtilisateurs(offre.plan)
                ? Math.max(0, view.utilisateursActifs - inclus)
                : 0;
              const occupe = pending && cible === offre.plan;
              return (
                <div
                  key={offre.plan}
                  className={cn(
                    "relative flex flex-col rounded-xl border bg-card p-5",
                    actuelle || conseillee ? "border-brand" : "border-border",
                  )}
                >
                  {conseillee && (
                    <span className="absolute -top-2.5 left-5 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground">
                      Le plus choisi
                    </span>
                  )}
                  <p className="font-heading text-base font-semibold">{libelleOffre(offre.plan)}</p>
                  <p className="mt-1">
                    <span className="text-2xl font-semibold">
                      {formatPrix(offre.montant, offre.devise)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {" "}HT / {INTERVALLE[offre.intervalle] ?? offre.intervalle}
                    </span>
                  </p>
                  {offre.montantPublic !== null && (
                    <p className="text-xs text-muted-foreground">
                      Tarif de lancement · tarif public {formatPrix(offre.montantPublic, offre.devise)}
                    </p>
                  )}
                  <ul className="mt-4 mb-5 flex-1 space-y-1.5 text-sm">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-status-done" />
                      <span>
                        {utilisateurs(inclus)}
                        {supplementUtilisateurs(offre.plan) && prixUtilisateur && (
                          <span className="block text-xs text-muted-foreground">
                            puis {prixUtilisateur} HT par utilisateur en plus
                            {enPlus > 0 && ` (${enPlus} pour votre équipe)`}
                          </span>
                        )}
                      </span>
                    </li>
                    {fonctionnalitesOffre(offre.plan).map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-status-done" />
                        {FONCTIONNALITE_LABEL[f]}
                      </li>
                    ))}
                  </ul>

                  {tropDeMonde && !actuelle && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      {view.utilisateursActifs} membres actifs : désactivez-en pour cette offre.
                    </p>
                  )}

                  {actuelle ? (
                    <Button variant="outline" className="h-11" disabled>
                      Votre offre
                    </Button>
                  ) : view.abonnementEnCours ? (
                    aConfirmer === offre.plan ? (
                      <div className="flex gap-2">
                        <Button
                          className="h-11 flex-1 gap-1.5"
                          onClick={() => changer(offre.plan)}
                          disabled={pending}
                        >
                          {occupe && <Loader2 className="size-4 animate-spin" />}
                          Confirmer
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11"
                          onClick={() => setAConfirmer(null)}
                          disabled={pending}
                        >
                          Annuler
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="h-11"
                        onClick={() => setAConfirmer(offre.plan)}
                        disabled={pending || tropDeMonde}
                      >
                        Passer à {libelleOffre(offre.plan)}
                      </Button>
                    )
                  ) : (
                    <Button
                      variant={conseillee ? "default" : "outline"}
                      className="h-11 gap-1.5"
                      onClick={() => souscrire(offre.plan)}
                      disabled={pending || tropDeMonde}
                    >
                      {occupe && <Loader2 className="size-4 animate-spin" />}
                      {view.essaiALaSouscription
                        ? `Essayer ${view.joursEssai} jours gratuits`
                        : `Choisir ${libelleOffre(offre.plan)}`}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Prix hors taxes. Paiement sécurisé par Stripe. Résiliable à tout moment, effet à la fin
            de la période payée.
          </p>
        </section>
      )}
    </div>
  );
}

function Resume({ view }: { view: SubscriptionView }) {
  const n = utilisateursInclus(view.plan);
  const compris = `${utilisateurs(n)}${n === Infinity ? "" : " compris"}`;

  if (view.lectureSeule) {
    return (
      <>
        Vos données restent consultables, mais plus rien ne s&apos;enregistre. Choisissez une offre
        pour reprendre là où vous en étiez.
      </>
    );
  }
  if (view.essaiJusquAu && !view.abonnementEnCours) {
    return <>Essai gratuit jusqu&apos;au {formatDate(view.essaiJusquAu)}, toutes les fonctionnalités Pro ouvertes.</>;
  }
  if (view.status === "TRIALING" && view.trialEndsAt) {
    return <>Essai gratuit jusqu&apos;au {formatDate(view.trialEndsAt)}, premier prélèvement ce jour-là · {compris}.</>;
  }
  if (view.abonnementEnCours && view.cancelAtPeriodEnd && view.currentPeriodEnd) {
    return <>Résiliation programmée : l&apos;offre prend fin le {formatDate(view.currentPeriodEnd)}.</>;
  }
  if (view.status === "PAST_DUE" || view.status === "UNPAID") {
    return <>Le dernier prélèvement a échoué : mettez à jour votre moyen de paiement.</>;
  }
  if (view.abonnementEnCours && view.currentPeriodEnd) {
    return <>Prochain renouvellement le {formatDate(view.currentPeriodEnd)} · {compris}.</>;
  }
  return <>{compris}.</>;
}
