import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Plan } from "@vennora/shared/enums";
import { AppError } from "@vennora/shared/errors";
import { OFFRES_EN_LIGNE, souscriptibleEnLigne } from "@vennora/shared/plans";
import { currentUser, requireContext } from "../context";
import { env, stripeTestMode } from "../env";
import { parse, STRIPE_WEBHOOK_PATH } from "../http";
import {
  catalogue,
  changerOffre,
  conditionsEssai,
  creerSessionPortail,
  creerSouscription,
  grilleCourante,
  lireEvenement,
  lireOrgFacturation,
  paiementEnLigneActif,
  traiterEvenement,
  type Catalogue,
} from "../services/billing";
import { audit } from "../tenant";
import type { SubscriptionView } from "../types";

const offreSchema = z.object({
  plan: z.enum(OFFRES_EN_LIGNE as [Plan, ...Plan[]], { error: "Offre inconnue." }),
});

/**
 * Écritures permises en lecture seule : se connecter, souscrire, et faire de
 * la place dans l'équipe (désactiver un membre, changer un mot de passe).
 * Tout le reste attend un abonnement — le client voit ses données, il ne
 * travaille plus dessus.
 */
function permiseEnLectureSeule(request: FastifyRequest): boolean {
  const url = request.url.split("?")[0]!;
  if (url === STRIPE_WEBHOOK_PATH) return true;
  if (url.startsWith("/api/auth/") || url.startsWith("/api/abonnement/")) return true;
  if (url.startsWith("/api/profil/")) return true;
  if (/^\/api\/equipe\/[^/]+\/mot-de-passe$/.test(url)) return true;
  if (/^\/api\/equipe\/[^/]+\/actif$/.test(url)) {
    return (request.body as { active?: unknown } | undefined)?.active === false;
  }
  return false;
}

/**
 * Garde posée sur toute l'API, avant chaque route : une entreprise en lecture
 * seule ne peut rien écrire. Une garde globale plutôt qu'un appel par route :
 * une route oubliée serait une porte ouverte à l'usage gratuit.
 */
export function registerGardeLectureSeule(app: FastifyInstance): void {
  app.addHook("preHandler", async (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (!request.url.startsWith("/api/") || permiseEnLectureSeule(request)) return;
    const user = await currentUser(request);
    if (!user?.org.acces.lectureSeule) return;
    throw new AppError(
      user.role === "ADMIN"
        ? "Votre essai est terminé : vos données restent consultables. Choisissez une offre pour reprendre la main."
        : "L'abonnement de votre entreprise n'est plus actif : demandez à votre administrateur de choisir une offre.",
      "SUBSCRIPTION_REQUIRED",
      402,
    );
  });
}

export async function abonnementRoutes(app: FastifyInstance): Promise<void> {
  /** Page Abonnement : offre en cours, essai, prix. */
  app.get("/api/abonnement", async (request): Promise<SubscriptionView> => {
    const { user } = await requireContext(request, "organization.manage");
    const org = await lireOrgFacturation(user.orgId);
    const actif = paiementEnLigneActif();
    const enCours = !!org.stripeSubscriptionId;

    let cat: Catalogue = { offres: [], utilisateur: null };
    let catalogueIndisponible = false;
    if (actif && souscriptibleEnLigne(org.plan)) {
      try {
        cat = await catalogue();
      } catch (e) {
        request.log.error(e, "catalogue Stripe illisible");
        catalogueIndisponible = true;
      }
    }

    // Un abonné voit sa grille, un nouveau venu celle du moment.
    const grille = (enCours && org.grilleTarifaire) || grilleCourante();
    const { essaiOffert } = conditionsEssai(org);

    return {
      paiementEnLigne: actif,
      modeTest: actif && stripeTestMode,
      gereHorsLigne: !souscriptibleEnLigne(org.plan),
      plan: org.plan,
      status: org.subscriptionStatus,
      abonnementEnCours: enCours,
      portailDisponible: !!org.stripeCustomerId,
      lectureSeule: user.org.acces.lectureSeule,
      essaiJusquAu: user.org.acces.essaiJusquAu,
      trialEndsAt: org.trialEndsAt,
      currentPeriodEnd: org.currentPeriodEnd,
      cancelAtPeriodEnd: org.cancelAtPeriodEnd,
      essaiALaSouscription: essaiOffert,
      joursEssai: env.STRIPE_TRIAL_DAYS,
      grille,
      utilisateursActifs: org.utilisateursActifs,
      prixUtilisateur: cat.utilisateur
        ? { montant: cat.utilisateur.montant, devise: cat.utilisateur.devise }
        : null,
      catalogueIndisponible,
      offres: OFFRES_EN_LIGNE.flatMap((plan) => {
        const prix = cat.offres.find((o) => o.plan === plan && o.grille === grille);
        if (!prix) return [];
        const publicPrix = cat.offres.find((o) => o.plan === plan && o.grille === "public");
        return [
          {
            plan,
            montant: prix.montant,
            devise: prix.devise,
            intervalle: prix.intervalle,
            montantPublic: grille === "lancement" ? (publicPrix?.montant ?? null) : null,
          },
        ];
      }),
    };
  });

  /** Ouvre Stripe Checkout. L'offre ne change qu'à réception du webhook. */
  app.post("/api/abonnement/souscription", async (request) => {
    const { user, ctx } = await requireContext(request, "organization.manage");
    const { plan } = parse(offreSchema, request.body);
    const url = await creerSouscription(user.orgId, plan, user.email);
    await audit(ctx, {
      action: "subscription.checkout_started",
      entity: "Organization",
      entityId: user.orgId,
      metadata: { plan },
    });
    return { url };
  });

  /** Change l'offre d'un abonnement en cours, avec prorata. */
  app.post("/api/abonnement/changement", async (request) => {
    const { user, ctx } = await requireContext(request, "organization.manage");
    const { plan } = parse(offreSchema, request.body);
    const resultat = await changerOffre(user.orgId, plan);
    await audit(ctx, {
      action: "subscription.plan_change_requested",
      entity: "Organization",
      entityId: user.orgId,
      metadata: { plan },
    });
    return { plan: resultat.applique ? resultat.apres : plan };
  });

  /** Ouvre le portail client Stripe. */
  app.post("/api/abonnement/portail", async (request) => {
    const { user } = await requireContext(request, "organization.manage");
    return { url: await creerSessionPortail(user.orgId) };
  });

  /**
   * Webhook Stripe. Pas de session ni d'en-tête CSRF : c'est la signature,
   * vérifiée sur le corps brut, qui authentifie l'appel. D'où un analyseur
   * propre à cette route, qui garde les octets tels qu'ils sont arrivés —
   * un JSON relu puis réécrit ne correspond plus à la signature.
   */
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_r, body, done) =>
      done(null, body),
    );

    scope.post(STRIPE_WEBHOOK_PATH, async (request, reply) => {
      if (!paiementEnLigneActif()) return reply.status(404).send();
      const event = lireEvenement(request.body as Buffer, request.headers["stripe-signature"]);
      // Une erreur ici remonte en 500 : Stripe renverra l'événement plus tard.
      const resultat = await traiterEvenement(event);
      if (!resultat.applique) {
        request.log.info({ event: event.type, raison: resultat.raison }, "webhook Stripe ignoré");
      } else if (resultat.avant !== resultat.apres) {
        request.log.warn(
          { orgId: resultat.orgId, avant: resultat.avant, apres: resultat.apres },
          "offre modifiée par Stripe",
        );
      }
      return { received: true };
    });
  });
}
