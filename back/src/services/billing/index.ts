import Stripe from "stripe";
import { Plan, SubscriptionStatus } from "@vennora/shared/enums";
import { AppError, ConflictError } from "@vennora/shared/errors";
import {
  libelleOffre,
  OFFRES_EN_LIGNE,
  souscriptibleEnLigne,
  supplementUtilisateurs,
  utilisateursInclus,
  utilisateursSupplementaires,
} from "@vennora/shared/plans";
import { isObjectIdString } from "../../db";
import { env } from "../../env";
import { rootDb } from "../../mongo";
import { tenantDb } from "../../tenant";

/**
 * Paiement en ligne, par Stripe.
 *
 * Le principe : **Stripe décide, Vennora recopie.** Aucune route ne change
 * `Organization.plan` sur la foi du navigateur — pas même au retour de
 * Checkout, que n'importe qui peut ouvrir à la main. L'offre ne bouge que sur
 * un abonnement relu auprès de Stripe : à réception d'un événement signé du
 * webhook, ou dans la réponse de Stripe à un changement d'offre demandé ici.
 * Les événements arrivent parfois dans le désordre ; l'abonnement relu, lui,
 * est toujours le dernier état.
 *
 * Le parcours commercial :
 *
 * - une entreprise créée (`org:create`) démarre sur un **essai Pro** de
 *   quatorze jours, sans carte ni démarche — la meilleure offre d'abord,
 *   on choisit ensuite en connaissance de cause ;
 * - pendant l'essai, souscrire ne l'écourte pas : Stripe ne prélève qu'à
 *   la date de fin prévue ;
 * - essai fini ou abonnement résilié sans relève : **lecture seule**. Rien
 *   n'est perdu ni caché, mais plus rien ne s'écrit (voir `accesOrganisation`
 *   et la garde de `routes/abonnement.ts`) ;
 * - les nouveaux abonnés ont le **tarif de lancement** (`STRIPE_TARIF`), et
 *   le gardent : un changement d'offre reste dans leur grille ;
 * - au-delà des utilisateurs compris, Pro et Business facturent chaque
 *   utilisateur actif en plus (ligne « utilisateur supplémentaire »).
 *
 * Ce module accède à `Organization` par le client racine : le webhook n'a pas
 * de session, il retrouve l'entreprise par son client Stripe. C'est la même
 * situation que l'authentification — la signature tient lieu de session.
 *
 * Les prix vivent chez Stripe, retrouvés par leur `lookup_key` : changer un
 * tarif ne demande aucun déploiement, seulement `npm run stripe:setup`.
 */

export type Grille = "public" | "lancement";

/** Clé de recherche du prix mensuel de chaque offre, par grille. */
export const CLES_PRIX: Record<Grille, Partial<Record<Plan, string>>> = {
  public: {
    [Plan.ESSENTIEL]: "vennora_essentiel_mensuel",
    [Plan.PRO]: "vennora_pro_mensuel",
    [Plan.BUSINESS]: "vennora_business_mensuel",
  },
  lancement: {
    [Plan.ESSENTIEL]: "vennora_essentiel_lancement_mensuel",
    [Plan.PRO]: "vennora_pro_lancement_mensuel",
    [Plan.BUSINESS]: "vennora_business_lancement_mensuel",
  },
};

/** Prix d'un utilisateur au-delà du forfait, le même pour les deux grilles. */
export const CLE_UTILISATEUR = "vennora_utilisateur_supplementaire_mensuel";

/** Statuts qui laissent l'accès à l'offre payée (impayé : le temps des relances). */
const DONNE_ACCES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
]);

/** Statuts définitifs : l'abonnement ne reviendra pas, un nouveau sera créé. */
const TERMINE: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.CANCELED,
  SubscriptionStatus.INCOMPLETE_EXPIRED,
]);

const JOUR_MS = 86_400_000;

export function paiementEnLigneActif(): boolean {
  return env.BILLING_DRIVER === "stripe";
}

let client: Stripe | null = null;

/** Client Stripe, ou refus explicite quand le paiement en ligne est coupé. */
export function stripe(): Stripe {
  if (!paiementEnLigneActif()) {
    throw new ConflictError(
      "Le paiement en ligne n'est pas activé. Pour changer d'offre, écrivez-nous.",
    );
  }
  client ??= new Stripe(env.STRIPE_SECRET_KEY!, {
    appInfo: { name: "Vennora" },
    maxNetworkRetries: 2,
  });
  return client;
}

// ─── Accès ──────────────────────────────────────────────────────────────────

export interface Acces {
  /** Essai fini ou abonnement arrêté : consultation seulement. */
  lectureSeule: boolean;
  /** Fin de l'essai en cours, s'il y en a un. */
  essaiJusquAu: Date | null;
  /** Un abonnement Stripe est en place (essai compris). */
  abonne: boolean;
}

/**
 * Ce qu'une entreprise peut faire, d'après son état de facturation.
 *
 * Sans paiement en ligne, tout reste ouvert, comme avant. Fondateur et
 * Entreprise se facturent hors ligne : jamais en lecture seule. Ailleurs, il
 * faut un abonnement en règle ou un essai en cours.
 */
export function accesOrganisation(
  org: {
    plan: Plan;
    subscriptionStatus: SubscriptionStatus | null;
    stripeSubscriptionId: string | null;
    trialEndsAt: Date | null;
  },
  maintenant: Date = new Date(),
  actif: boolean = paiementEnLigneActif(),
): Acces {
  const abonne = !!org.stripeSubscriptionId;
  if (!actif || !souscriptibleEnLigne(org.plan)) {
    return { lectureSeule: false, essaiJusquAu: null, abonne };
  }
  const essai = org.trialEndsAt && org.trialEndsAt > maintenant ? org.trialEndsAt : null;
  if (org.subscriptionStatus && DONNE_ACCES.has(org.subscriptionStatus)) {
    return { lectureSeule: false, essaiJusquAu: essai, abonne };
  }
  return { lectureSeule: !essai, essaiJusquAu: essai, abonne };
}

/**
 * Champs d'une entreprise qui démarre son essai : Pro, quatorze jours.
 * Vide quand le paiement en ligne est coupé — elle démarre alors au plus
 * bas, comme avant, et c'est `org:plan` qui ouvre.
 */
export function essaiInitial(maintenant: Date = new Date()): {
  plan?: Plan;
  trialEndsAt?: Date;
  trialUsedAt?: Date;
} {
  if (!paiementEnLigneActif() || env.STRIPE_TRIAL_DAYS === 0) return {};
  return {
    plan: Plan.PRO,
    trialEndsAt: new Date(maintenant.getTime() + env.STRIPE_TRIAL_DAYS * JOUR_MS),
    trialUsedAt: maintenant,
  };
}

// ─── Catalogue ──────────────────────────────────────────────────────────────

export interface PrixOffre {
  plan: Plan;
  grille: Grille;
  priceId: string;
  /** Montant en centimes, hors taxes. */
  montant: number;
  devise: string;
  /** `month`, `year`… tel que Stripe le donne. */
  intervalle: string;
}

export interface Catalogue {
  offres: PrixOffre[];
  utilisateur: { priceId: string; montant: number; devise: string } | null;
}

const CACHE_MS = 5 * 60 * 1000;
let catalogueEnCache: { lu: number; catalogue: Catalogue } | null = null;

/** Prix des offres en ligne, relus chez Stripe toutes les cinq minutes au plus. */
export async function catalogue(): Promise<Catalogue> {
  if (catalogueEnCache && Date.now() - catalogueEnCache.lu < CACHE_MS) {
    return catalogueEnCache.catalogue;
  }
  const cles = [
    ...Object.values(CLES_PRIX.public),
    ...Object.values(CLES_PRIX.lancement),
    CLE_UTILISATEUR,
  ];
  const { data } = await stripe().prices.list({ lookup_keys: cles, active: true, limit: 10 });

  const offres: PrixOffre[] = [];
  for (const grille of ["public", "lancement"] as const) {
    for (const plan of OFFRES_EN_LIGNE) {
      const price = data.find((p) => p.lookup_key === CLES_PRIX[grille][plan]);
      if (!price || price.unit_amount === null || !price.recurring) continue;
      offres.push({
        plan,
        grille,
        priceId: price.id,
        montant: price.unit_amount,
        devise: price.currency,
        intervalle: price.recurring.interval,
      });
    }
  }
  const siege = data.find((p) => p.lookup_key === CLE_UTILISATEUR);
  const resultat: Catalogue = {
    offres,
    utilisateur:
      siege && siege.unit_amount !== null
        ? { priceId: siege.id, montant: siege.unit_amount, devise: siege.currency }
        : null,
  };
  catalogueEnCache = { lu: Date.now(), catalogue: resultat };
  return resultat;
}

function prixDe(cat: Catalogue, plan: Plan, grille: Grille): PrixOffre | undefined {
  return (
    cat.offres.find((o) => o.plan === plan && o.grille === grille) ??
    cat.offres.find((o) => o.plan === plan && o.grille === "public")
  );
}

type PrixLu = Pick<Stripe.Price, "lookup_key" | "metadata">;

/** Offre correspondant à un prix Stripe, ou `null` s'il n'est pas une offre Vennora. */
export function planDuPrix(price: PrixLu): Plan | null {
  for (const grille of ["public", "lancement"] as const) {
    for (const [plan, cle] of Object.entries(CLES_PRIX[grille])) {
      if (price.lookup_key === cle) return plan as Plan;
    }
  }
  // Un prix remplacé garde sa métadonnée après avoir cédé sa clé : un client
  // resté sur l'ancien tarif doit garder son offre.
  const meta = price.metadata?.vennora_plan;
  return meta && meta in Plan ? (meta as Plan) : null;
}

function grilleDuPrix(price: PrixLu): Grille {
  if (Object.values(CLES_PRIX.lancement).includes(price.lookup_key ?? "")) return "lancement";
  return price.metadata?.vennora_grille === "lancement" ? "lancement" : "public";
}

function estPrixUtilisateur(price: PrixLu): boolean {
  return price.lookup_key === CLE_UTILISATEUR || price.metadata?.vennora_utilisateur === "1";
}

// ─── Lecture d'une entreprise ───────────────────────────────────────────────

interface OrgFacturation {
  id: string;
  name: string;
  email: string | null;
  plan: Plan;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialUsedAt: Date | null;
  grilleTarifaire: Grille | null;
  utilisateursActifs: number;
}

export async function lireOrgFacturation(orgId: string): Promise<OrgFacturation> {
  const [org, utilisateursActifs] = await Promise.all([
    rootDb.organization.findOne(
      { id: orgId },
      {
        fields: [
          "name",
          "email",
          "plan",
          "stripeCustomerId",
          "stripeSubscriptionId",
          "subscriptionStatus",
          "trialEndsAt",
          "currentPeriodEnd",
          "cancelAtPeriodEnd",
          "trialUsedAt",
          "grilleTarifaire",
        ],
      },
    ),
    rootDb.user.count({ orgId, active: true }),
  ]);
  if (!org) throw new AppError("Entreprise introuvable.", "NOT_FOUND", 404);
  // Champs absents des entreprises créées avant le paiement en ligne.
  return {
    id: org.id,
    name: org.name,
    email: org.email ?? null,
    plan: org.plan,
    stripeCustomerId: org.stripeCustomerId ?? null,
    stripeSubscriptionId: org.stripeSubscriptionId ?? null,
    subscriptionStatus: org.subscriptionStatus ?? null,
    trialEndsAt: org.trialEndsAt ?? null,
    currentPeriodEnd: org.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: org.cancelAtPeriodEnd ?? false,
    trialUsedAt: org.trialUsedAt ?? null,
    grilleTarifaire: org.grilleTarifaire ?? null,
    utilisateursActifs,
  };
}

/** Essai à la souscription : seulement pour qui n'en a jamais eu. */
export function essaiDisponible(org: Pick<OrgFacturation, "trialUsedAt">): boolean {
  return env.STRIPE_TRIAL_DAYS > 0 && !org.trialUsedAt;
}

/** Ce que Checkout fera de l'essai, pour une entreprise sans abonnement. */
export function conditionsEssai(
  org: Pick<OrgFacturation, "trialEndsAt" | "trialUsedAt">,
  maintenant: number = Date.now(),
): { essaiEnCours: Date | null; essaiOffert: boolean } {
  // Pendant l'essai : Stripe ne prélève qu'à sa fin prévue. Il exige
  // 48 heures d'écart au moins ; en deçà, l'abonnement démarre tout de suite.
  const essaiEnCours =
    org.trialEndsAt && org.trialEndsAt.getTime() - maintenant > 2 * JOUR_MS + 3_600_000
      ? org.trialEndsAt
      : null;
  // Entreprise plus ancienne que l'essai automatique : elle l'obtient ici,
  // sans carte, comme promis sur le site.
  return { essaiEnCours, essaiOffert: !essaiEnCours && essaiDisponible(org) };
}

/** Grille d'un nouvel abonné : celle du moment. */
export function grilleCourante(): Grille {
  return env.STRIPE_TARIF;
}

function abonnementVivant(org: OrgFacturation): boolean {
  return !!org.stripeSubscriptionId && !!org.subscriptionStatus && !TERMINE.has(org.subscriptionStatus);
}

function refusPlaces(plan: Plan, actifs: number): never {
  throw new ConflictError(
    `L'offre ${libelleOffre(plan)} comprend ${utilisateursInclus(plan)} utilisateur, pour ${actifs} actifs dans votre équipe. ` +
      "Choisissez Pro, ou désactivez d'abord des membres.",
  );
}

/**
 * Garde à poser avant d'ajouter ou de réactiver un membre : l'offre
 * Essentiel n'accepte pas d'utilisateur en plus. Pro et Business acceptent,
 * le supplément est facturé (`synchroniserUtilisateurs`).
 */
export function verifierPlace(plan: Plan, actifs: number): void {
  if (!paiementEnLigneActif() || !souscriptibleEnLigne(plan)) return;
  if (supplementUtilisateurs(plan)) return;
  if (actifs + 1 > utilisateursInclus(plan)) {
    throw new ConflictError(
      `L'offre ${libelleOffre(plan)} comprend ${utilisateursInclus(plan)} utilisateur. ` +
        `Passez à Pro pour travailler en équipe : ${utilisateursInclus(Plan.PRO)} utilisateurs compris.`,
    );
  }
}

// ─── Souscription, changement d'offre, portail ──────────────────────────────

/** Client Stripe de l'entreprise, créé à la première souscription. */
async function clientStripe(org: OrgFacturation, emailContact: string): Promise<string> {
  if (org.stripeCustomerId) return org.stripeCustomerId;

  const customer = await stripe().customers.create(
    { name: org.name, email: org.email ?? emailContact, metadata: { orgId: org.id } },
    // Deux clics rapprochés ne créent pas deux clients.
    { idempotencyKey: `vennora-customer-${org.id}` },
  );
  // Écrit seulement si personne ne l'a fait entre-temps.
  const written = await rootDb.organization.update(
    { id: org.id, stripeCustomerId: null },
    { stripeCustomerId: customer.id },
  );
  if (written === 0) {
    const fresh = await lireOrgFacturation(org.id);
    if (fresh.stripeCustomerId) return fresh.stripeCustomerId;
  }
  return customer.id;
}

/** Lignes d'un abonnement : le forfait, et les utilisateurs en plus s'il y en a. */
function lignes(cat: Catalogue, prix: PrixOffre, plan: Plan, actifs: number) {
  const enPlus = utilisateursSupplementaires(plan, actifs);
  if (enPlus > 0 && !cat.utilisateur) erreurCatalogue("utilisateur supplémentaire");
  return [
    { price: prix.priceId, quantity: 1 },
    ...(enPlus > 0 ? [{ price: cat.utilisateur!.priceId, quantity: enPlus }] : []),
  ];
}

function erreurCatalogue(quoi: string): never {
  throw new AppError(
    `Aucun prix Stripe pour « ${quoi} ». Lancez npm run stripe:setup.`,
    "BILLING_CATALOG",
    503,
  );
}

/** Ouvre une page Stripe Checkout pour souscrire `plan`. Rend son adresse. */
export async function creerSouscription(
  orgId: string,
  plan: Plan,
  emailContact: string,
): Promise<string> {
  const org = await lireOrgFacturation(orgId);

  if (!souscriptibleEnLigne(org.plan)) {
    throw new ConflictError(
      `Votre offre ${libelleOffre(org.plan)} est gérée directement avec nous : écrivez-nous pour la modifier.`,
    );
  }
  if (!souscriptibleEnLigne(plan)) {
    throw new ConflictError(`L'offre ${libelleOffre(plan)} ne se souscrit pas en ligne.`);
  }
  if (abonnementVivant(org)) {
    throw new ConflictError("Vous avez déjà un abonnement : changez d'offre depuis cette page.");
  }
  if (!supplementUtilisateurs(plan) && org.utilisateursActifs > utilisateursInclus(plan)) {
    refusPlaces(plan, org.utilisateursActifs);
  }

  const cat = await catalogue();
  const prix = prixDe(cat, plan, grilleCourante());
  if (!prix) erreurCatalogue(`offre ${libelleOffre(plan)}`);

  const customer = await clientStripe(org, emailContact);
  const retour = `${env.APP_URL}/parametres/abonnement`;

  const { essaiEnCours, essaiOffert } = conditionsEssai(org);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: org.id,
    line_items: lignes(cat, prix, plan, org.utilisateursActifs),
    subscription_data: {
      metadata: { orgId: org.id },
      ...(essaiEnCours ? { trial_end: Math.floor(essaiEnCours.getTime() / 1000) } : {}),
      ...(essaiOffert
        ? {
            trial_period_days: env.STRIPE_TRIAL_DAYS,
            // Essai sans carte : faute de moyen de paiement à l'échéance,
            // l'abonnement s'arrête au lieu de passer en impayé.
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          }
        : {}),
    },
    payment_method_collection: essaiOffert ? "if_required" : "always",
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    locale: "fr",
    metadata: { orgId: org.id, plan },
    success_url: `${retour}?retour=succes`,
    cancel_url: `${retour}?retour=annule`,
  });
  if (!session.url) throw new Error("Stripe n'a pas rendu d'adresse de paiement.");
  return session.url;
}

/**
 * Change l'offre d'un abonnement en cours, sans quitter l'application.
 *
 * La grille de l'abonné est conservée : un client entré au tarif de
 * lancement y reste en changeant d'offre. Le prorata est calculé par Stripe
 * et porté sur la prochaine facture.
 */
export async function changerOffre(orgId: string, plan: Plan): Promise<ResultatSynchro> {
  const org = await lireOrgFacturation(orgId);
  if (!abonnementVivant(org)) {
    throw new ConflictError("Aucun abonnement en cours : souscrivez d'abord une offre.");
  }
  if (!souscriptibleEnLigne(plan)) {
    throw new ConflictError(`L'offre ${libelleOffre(plan)} ne se souscrit pas en ligne.`);
  }
  if (!supplementUtilisateurs(plan) && org.utilisateursActifs > utilisateursInclus(plan)) {
    refusPlaces(plan, org.utilisateursActifs);
  }

  const sub = await stripe().subscriptions.retrieve(org.stripeSubscriptionId!);
  const etat = lireAbonnement(sub);
  if (etat.plan === plan) throw new ConflictError(`Vous êtes déjà à l'offre ${libelleOffre(plan)}.`);
  if (!etat.ligneForfait) throw new Error(`Abonnement ${sub.id} sans ligne de forfait.`);

  const cat = await catalogue();
  const prix = prixDe(cat, plan, etat.grille);
  if (!prix) erreurCatalogue(`offre ${libelleOffre(plan)}`);

  const items: Stripe.SubscriptionUpdateParams.Item[] = [
    { id: etat.ligneForfait, price: prix.priceId },
    ...lignesUtilisateurs(cat, etat, utilisateursSupplementaires(plan, org.utilisateursActifs)),
  ];
  const misAJour = await stripe().subscriptions.update(sub.id, {
    items,
    proration_behavior: "create_prorations",
  });
  // L'abonnement rendu par Stripe fait foi : l'offre s'ouvre sans attendre
  // le webhook, qui confirmera.
  return appliquerAbonnement(misAJour);
}

/** Modifications de la ligne « utilisateur supplémentaire » pour en facturer `voulu`. */
function lignesUtilisateurs(
  cat: Catalogue,
  etat: EtatAbonnement,
  voulu: number,
): Stripe.SubscriptionUpdateParams.Item[] {
  if (voulu === etat.utilisateursFactures) return [];
  if (etat.ligneUtilisateurs) {
    return voulu > 0
      ? [{ id: etat.ligneUtilisateurs, quantity: voulu }]
      : [{ id: etat.ligneUtilisateurs, deleted: true }];
  }
  if (!cat.utilisateur) erreurCatalogue("utilisateur supplémentaire");
  return [{ price: cat.utilisateur.priceId, quantity: voulu }];
}

/**
 * Recale le nombre d'utilisateurs facturés en plus du forfait sur l'équipe
 * active. À appeler après un ajout, une désactivation ou une réactivation, et
 * après un changement d'offre (le forfait n'en comprend plus autant).
 * Sans effet hors abonnement ; un échec est journalisé, pas propagé : un
 * membre ajouté ne doit pas disparaître parce que Stripe ne répond pas.
 */
export async function synchroniserUtilisateurs(
  orgId: string,
  stripeClient?: Stripe,
): Promise<void> {
  if (!paiementEnLigneActif()) return;
  try {
    const org = await lireOrgFacturation(orgId);
    if (!abonnementVivant(org)) return;
    const s = stripeClient ?? stripe();
    const sub = await s.subscriptions.retrieve(org.stripeSubscriptionId!);
    const etat = lireAbonnement(sub);
    if (!etat.plan || TERMINE.has(etat.status)) return;

    const items = lignesUtilisateurs(
      await catalogue(),
      etat,
      utilisateursSupplementaires(etat.plan, org.utilisateursActifs),
    );
    if (items.length === 0) return;
    await s.subscriptions.update(sub.id, { items, proration_behavior: "create_prorations" });
  } catch (e) {
    console.error(`[vennora] utilisateurs facturés non recalés pour ${orgId}`, e);
  }
}

/** Ouvre le portail client Stripe (carte, factures, coordonnées, résiliation). */
export async function creerSessionPortail(orgId: string): Promise<string> {
  const org = await lireOrgFacturation(orgId);
  if (!org.stripeCustomerId) {
    throw new ConflictError("Aucun abonnement en ligne : souscrivez d'abord une offre.");
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${env.APP_URL}/parametres/abonnement`,
    locale: "fr",
    ...(env.STRIPE_PORTAL_CONFIGURATION
      ? { configuration: env.STRIPE_PORTAL_CONFIGURATION }
      : {}),
  });
  return session.url;
}

// ─── Webhook ────────────────────────────────────────────────────────────────

/** Vérifie la signature d'un appel du webhook et rend l'événement. */
export function lireEvenement(
  corps: Buffer | string,
  signature: string | string[] | undefined,
  secret: string = env.STRIPE_WEBHOOK_SECRET ?? "",
  stripeClient: Stripe = stripe(),
): Stripe.Event {
  if (!signature || Array.isArray(signature) || !secret) {
    throw new AppError("Signature Stripe absente.", "BAD_SIGNATURE", 400);
  }
  try {
    return stripeClient.webhooks.constructEvent(corps, signature, secret);
  } catch {
    throw new AppError("Signature Stripe invalide.", "BAD_SIGNATURE", 400);
  }
}

export interface EtatAbonnement {
  subscriptionId: string;
  customerId: string;
  orgIdDeclare: string | null;
  status: SubscriptionStatus;
  /** Offre du forfait souscrit, `null` si le prix n'est pas reconnu. */
  plan: Plan | null;
  grille: Grille;
  ligneForfait: string | null;
  ligneUtilisateurs: string | null;
  utilisateursFactures: number;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const date = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);

/** Ce que Vennora retient d'un abonnement Stripe. */
export function lireAbonnement(sub: Stripe.Subscription): EtatAbonnement {
  const items = sub.items.data;
  const utilisateurs = items.find((i) => estPrixUtilisateur(i.price));
  const forfait = items.find((i) => i !== utilisateurs && planDuPrix(i.price)) ?? null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const status = sub.status.toUpperCase() as SubscriptionStatus;
  const orgId = sub.metadata?.orgId;
  return {
    subscriptionId: sub.id,
    customerId: customer,
    orgIdDeclare: orgId && isObjectIdString(orgId) ? orgId : null,
    status: status in SubscriptionStatus ? status : SubscriptionStatus.INCOMPLETE,
    plan: forfait ? planDuPrix(forfait.price) : null,
    grille: forfait ? grilleDuPrix(forfait.price) : "public",
    ligneForfait: forfait?.id ?? null,
    ligneUtilisateurs: utilisateurs?.id ?? null,
    utilisateursFactures: utilisateurs?.quantity ?? 0,
    trialStartedAt: date(sub.trial_start),
    trialEndsAt: sub.status === "trialing" ? date(sub.trial_end) : null,
    currentPeriodEnd: date((forfait ?? items[0])?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
  };
}

/**
 * Offre qui découle d'un abonnement.
 *
 * Fondateur et Entreprise ne bougent jamais par ce chemin : elles se
 * négocient hors ligne, et un vieil abonnement résilié ne doit pas faire
 * retomber un client sous contrat. Hors de ces deux-là, un abonnement en
 * règle donne son offre, tout autre état ramène à Essentiel (et la lecture
 * seule, voir `accesOrganisation`).
 */
export function planApres(planActuel: Plan, etat: EtatAbonnement): Plan {
  if (!souscriptibleEnLigne(planActuel)) return planActuel;
  if (DONNE_ACCES.has(etat.status)) return etat.plan ?? planActuel;
  return Plan.ESSENTIEL;
}

export type ResultatSynchro =
  | { applique: true; orgId: string; avant: Plan; apres: Plan; status: SubscriptionStatus }
  | { applique: false; raison: string };

/** Recopie un abonnement Stripe sur l'entreprise concernée. */
export async function appliquerAbonnement(sub: Stripe.Subscription): Promise<ResultatSynchro> {
  const etat = lireAbonnement(sub);
  const champs = {
    fields: ["plan", "stripeCustomerId", "stripeSubscriptionId", "trialEndsAt", "trialUsedAt"],
  } as const;

  // Par la métadonnée posée à Checkout, à condition que le client concorde ;
  // sinon par le client Stripe.
  let org = etat.orgIdDeclare
    ? await rootDb.organization.findOne({ id: etat.orgIdDeclare }, champs)
    : null;
  if (org?.stripeCustomerId && org.stripeCustomerId !== etat.customerId) org = null;
  org ??= await rootDb.organization.findOne({ stripeCustomerId: etat.customerId }, champs);
  if (!org) return { applique: false, raison: `aucune entreprise pour ${etat.customerId}` };

  // Un ancien abonnement qui se termine après qu'un nouveau a pris le relais
  // ne doit pas faire retomber l'entreprise.
  const courant = org.stripeSubscriptionId ?? null;
  if (courant && courant !== etat.subscriptionId && !DONNE_ACCES.has(etat.status)) {
    return { applique: false, raison: `abonnement ${etat.subscriptionId} remplacé par ${courant}` };
  }

  const avant = org.plan;
  const apres = planApres(avant, etat);
  const termine = TERMINE.has(etat.status);

  // Premier paiement en attente (3-D Secure…) : l'essai de l'application,
  // s'il court encore, n'est pas interrompu pour autant.
  const trialEndsAt =
    etat.trialEndsAt ??
    (etat.status === SubscriptionStatus.INCOMPLETE ? (org.trialEndsAt ?? null) : null);

  await rootDb.organization.update(
    { id: org.id },
    {
      plan: apres,
      stripeCustomerId: etat.customerId,
      stripeSubscriptionId: termine ? null : etat.subscriptionId,
      subscriptionStatus: etat.status,
      trialEndsAt,
      currentPeriodEnd: etat.currentPeriodEnd,
      cancelAtPeriodEnd: termine ? false : etat.cancelAtPeriodEnd,
      grilleTarifaire: etat.plan ? etat.grille : null,
      ...(org.trialUsedAt || !etat.trialStartedAt ? {} : { trialUsedAt: etat.trialStartedAt }),
    },
  );

  if (avant !== apres) {
    // Journal « best effort », comme `audit` : pas d'utilisateur derrière un
    // webhook, d'où `userId: null`.
    try {
      await tenantDb({ orgId: org.id }).auditLog.insert({
        orgId: org.id,
        userId: null,
        action: "organization.plan_changed",
        entity: "Organization",
        entityId: org.id,
        metadata: { avant, apres, status: etat.status, subscriptionId: etat.subscriptionId },
      });
    } catch (e) {
      console.error("[vennora] échec d'écriture du journal d'audit", e);
    }
  }

  return { applique: true, orgId: org.id, avant, apres, status: etat.status };
}

const EVENEMENTS_ABONNEMENT = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
]);

/** Traite un événement vérifié. Les types sans intérêt sont ignorés. */
export async function traiterEvenement(
  event: Stripe.Event,
  stripeClient: Stripe = stripe(),
): Promise<ResultatSynchro> {
  let subscriptionId: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode === "subscription" && session.subscription) {
      subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    }
  } else if (EVENEMENTS_ABONNEMENT.has(event.type)) {
    subscriptionId = (event.data.object as Stripe.Subscription).id;
  }

  if (!subscriptionId) return { applique: false, raison: `${event.type} ignoré` };

  // L'état relu, pas celui de l'événement : il peut être déjà dépassé.
  const sub = await stripeClient.subscriptions.retrieve(subscriptionId);
  const resultat = await appliquerAbonnement(sub);
  // Offre changée depuis le portail ou le tableau de bord, équipe modifiée
  // pendant une panne : les utilisateurs facturés se recalent ici. Sans
  // changement, aucun appel d'écriture — pas de boucle d'événements.
  if (resultat.applique) await synchroniserUtilisateurs(resultat.orgId, stripeClient);
  return resultat;
}
