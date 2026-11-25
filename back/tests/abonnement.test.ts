import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Plan, SubscriptionStatus } from "@vennora/shared/enums";
import { utilisateursSupplementaires } from "@vennora/shared/plans";
import {
  accesOrganisation,
  appliquerAbonnement,
  CLE_UTILISATEUR,
  CLES_PRIX,
  conditionsEssai,
  lireAbonnement,
  lireEvenement,
  planApres,
  planDuPrix,
  traiterEvenement,
  type Grille,
} from "../src/services/billing";
import { createTestOrg, destroyTestOrg, rootDb, type TestOrg } from "./fixtures";

/**
 * Paiement en ligne.
 *
 * Aucun appel réseau : les abonnements sont fabriqués à la main, au format
 * que rend Stripe, et la signature du webhook est produite par le SDK
 * lui-même. Ce qui compte ici, c'est ce que Vennora en déduit — l'offre
 * ouverte ou fermée, la lecture seule — et c'est la base, réelle, qui le dit.
 */

const stripe = new Stripe("sk_test_vennora_tests_sans_reseau");

function abonnement(options: {
  id: string;
  customer: string;
  orgId?: string;
  status: Stripe.Subscription.Status;
  plan: Plan;
  trial?: boolean;
  cancelAtPeriodEnd?: boolean;
  grille?: Grille;
  /** Utilisateurs facturés en plus du forfait. */
  enPlus?: number;
}): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: options.id,
    object: "subscription",
    customer: options.customer,
    status: options.status,
    metadata: options.orgId ? { orgId: options.orgId } : {},
    trial_start: options.trial ? now : null,
    trial_end: options.trial ? now + 14 * 86400 : null,
    cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
    cancel_at: null,
    items: {
      object: "list",
      data: [
        {
          id: `si_${options.id}`,
          quantity: 1,
          current_period_end: now + 30 * 86400,
          price: {
            id: `price_${options.plan}`,
            lookup_key: CLES_PRIX[options.grille ?? "public"][options.plan] ?? null,
            metadata: {},
          },
        },
        ...(options.enPlus
          ? [
              {
                id: `si_${options.id}_utilisateurs`,
                quantity: options.enPlus,
                current_period_end: now + 30 * 86400,
                price: { id: "price_utilisateur", lookup_key: CLE_UTILISATEUR, metadata: {} },
              },
            ]
          : []),
      ],
    },
  } as unknown as Stripe.Subscription;
}

async function etatOrg(orgId: string) {
  return rootDb.organization.findOne(
    { id: orgId },
    {
      fields: [
        "plan",
        "stripeCustomerId",
        "stripeSubscriptionId",
        "subscriptionStatus",
        "trialEndsAt",
        "trialUsedAt",
        "cancelAtPeriodEnd",
        "grilleTarifaire",
      ],
    },
  );
}

describe("lecture d'un abonnement", () => {
  it("reconnaît l'offre par la clé du prix, puis par sa métadonnée", () => {
    expect(planDuPrix({ lookup_key: "vennora_pro_mensuel", metadata: {} })).toBe(Plan.PRO);
    expect(planDuPrix({ lookup_key: "vennora_pro_lancement_mensuel", metadata: {} })).toBe(Plan.PRO);
    expect(planDuPrix({ lookup_key: null, metadata: { vennora_plan: "BUSINESS" } })).toBe(Plan.BUSINESS);
    expect(planDuPrix({ lookup_key: CLE_UTILISATEUR, metadata: {} })).toBeNull();
    expect(planDuPrix({ lookup_key: "autre_produit", metadata: {} })).toBeNull();
  });

  it("recopie statut, essai et échéance", () => {
    const etat = lireAbonnement(
      abonnement({ id: "sub_1", customer: "cus_1", status: "trialing", plan: Plan.PRO, trial: true }),
    );
    expect(etat.status).toBe(SubscriptionStatus.TRIALING);
    expect(etat.plan).toBe(Plan.PRO);
    expect(etat.trialEndsAt).toBeInstanceOf(Date);
    expect(etat.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it("distingue le forfait des utilisateurs en plus, et retient la grille", () => {
    const etat = lireAbonnement(
      abonnement({
        id: "sub_4",
        customer: "cus_4",
        status: "active",
        plan: Plan.PRO,
        grille: "lancement",
        enPlus: 2,
      }),
    );
    expect(etat.plan).toBe(Plan.PRO);
    expect(etat.grille).toBe("lancement");
    expect(etat.ligneForfait).toBe("si_sub_4");
    expect(etat.ligneUtilisateurs).toBe("si_sub_4_utilisateurs");
    expect(etat.utilisateursFactures).toBe(2);
  });

  it("donne l'offre tant que l'abonnement est en règle, Essentiel sinon", () => {
    const etat = (status: Stripe.Subscription.Status) =>
      lireAbonnement(abonnement({ id: "sub_2", customer: "cus_2", status, plan: Plan.BUSINESS }));
    expect(planApres(Plan.ESSENTIEL, etat("active"))).toBe(Plan.BUSINESS);
    expect(planApres(Plan.ESSENTIEL, etat("trialing"))).toBe(Plan.BUSINESS);
    // Impayé : l'accès reste ouvert pendant les relances de Stripe.
    expect(planApres(Plan.BUSINESS, etat("past_due"))).toBe(Plan.BUSINESS);
    expect(planApres(Plan.BUSINESS, etat("unpaid"))).toBe(Plan.ESSENTIEL);
    expect(planApres(Plan.BUSINESS, etat("canceled"))).toBe(Plan.ESSENTIEL);
  });

  it("ne touche jamais à Fondateur ni à Entreprise", () => {
    const fin = lireAbonnement(
      abonnement({ id: "sub_3", customer: "cus_3", status: "canceled", plan: Plan.PRO }),
    );
    expect(planApres(Plan.FONDATEUR, fin)).toBe(Plan.FONDATEUR);
    expect(planApres(Plan.ENTREPRISE, fin)).toBe(Plan.ENTREPRISE);
  });
});

describe("utilisateurs en plus du forfait", () => {
  it("facture au-delà des utilisateurs compris, sur Pro et Business", () => {
    expect(utilisateursSupplementaires(Plan.PRO, 3)).toBe(0);
    expect(utilisateursSupplementaires(Plan.PRO, 5)).toBe(2);
    expect(utilisateursSupplementaires(Plan.BUSINESS, 12)).toBe(2);
  });

  it("ne facture rien en plus sur Essentiel : il faut passer à Pro", () => {
    expect(utilisateursSupplementaires(Plan.ESSENTIEL, 3)).toBe(0);
  });
});

describe("accès et essai", () => {
  const jour = 86_400_000;
  const maintenant = new Date("2026-06-15T10:00:00Z");
  const dans = (jours: number) => new Date(maintenant.getTime() + jours * jour);
  const org = (o: Partial<Parameters<typeof accesOrganisation>[0]>) => ({
    plan: Plan.PRO as Plan,
    subscriptionStatus: null,
    stripeSubscriptionId: null,
    trialEndsAt: null,
    ...o,
  });

  it("laisse tout ouvert tant que le paiement en ligne est coupé", () => {
    expect(accesOrganisation(org({}), maintenant, false).lectureSeule).toBe(false);
  });

  it("ouvre tout pendant l'essai, et donne sa fin", () => {
    const acces = accesOrganisation(org({ trialEndsAt: dans(5) }), maintenant, true);
    expect(acces).toMatchObject({ lectureSeule: false, abonne: false });
    expect(acces.essaiJusquAu).toEqual(dans(5));
  });

  it("passe en lecture seule à la fin de l'essai sans abonnement", () => {
    expect(accesOrganisation(org({ trialEndsAt: dans(-1) }), maintenant, true).lectureSeule).toBe(true);
    expect(accesOrganisation(org({ plan: Plan.ESSENTIEL }), maintenant, true).lectureSeule).toBe(true);
  });

  it("rouvre avec un abonnement en règle, referme à la résiliation", () => {
    const actif = org({ subscriptionStatus: SubscriptionStatus.ACTIVE, stripeSubscriptionId: "sub_1" });
    expect(accesOrganisation(actif, maintenant, true)).toMatchObject({ lectureSeule: false, abonne: true });
    const impaye = org({ subscriptionStatus: SubscriptionStatus.PAST_DUE, stripeSubscriptionId: "sub_1" });
    expect(accesOrganisation(impaye, maintenant, true).lectureSeule).toBe(false);
    const resilie = org({ plan: Plan.ESSENTIEL, subscriptionStatus: SubscriptionStatus.CANCELED });
    expect(accesOrganisation(resilie, maintenant, true).lectureSeule).toBe(true);
  });

  it("ne bride jamais Fondateur ni Entreprise", () => {
    expect(accesOrganisation(org({ plan: Plan.FONDATEUR }), maintenant, true).lectureSeule).toBe(false);
    expect(accesOrganisation(org({ plan: Plan.ENTREPRISE }), maintenant, true).lectureSeule).toBe(false);
  });

  it("garde l'essai en cours à la souscription, s'il reste assez de temps", () => {
    const t = maintenant.getTime();
    expect(conditionsEssai({ trialEndsAt: dans(10), trialUsedAt: maintenant }, t)).toEqual({
      essaiEnCours: dans(10),
      essaiOffert: false,
    });
    // Moins de 48 h : Stripe refuserait la date, l'abonnement démarre aussitôt.
    expect(conditionsEssai({ trialEndsAt: dans(1), trialUsedAt: maintenant }, t)).toEqual({
      essaiEnCours: null,
      essaiOffert: false,
    });
  });

  it("offre l'essai à la souscription à qui n'en a jamais eu", () => {
    expect(conditionsEssai({ trialEndsAt: null, trialUsedAt: null }).essaiOffert).toBe(true);
  });
});

describe("synchronisation d'une entreprise", () => {
  let org: TestOrg;
  let contrat: TestOrg;
  let customer: string;

  beforeAll(async () => {
    org = await createTestOrg("abonnement", Plan.ESSENTIEL);
    contrat = await createTestOrg("abonnement-contrat", Plan.ENTREPRISE);
    customer = `cus_test_${org.id}`;
  });

  afterAll(async () => {
    if (org) await destroyTestOrg(org);
    if (contrat) await destroyTestOrg(contrat);
  });

  it("ouvre l'offre à l'essai et retient que l'essai est consommé", async () => {
    const r = await appliquerAbonnement(
      abonnement({ id: "sub_a", customer, orgId: org.id, status: "trialing", plan: Plan.PRO, trial: true }),
    );
    expect(r).toMatchObject({ applique: true, avant: Plan.ESSENTIEL, apres: Plan.PRO });

    const etat = await etatOrg(org.id);
    expect(etat?.plan).toBe(Plan.PRO);
    expect(etat?.stripeCustomerId).toBe(customer);
    expect(etat?.stripeSubscriptionId).toBe("sub_a");
    expect(etat?.subscriptionStatus).toBe(SubscriptionStatus.TRIALING);
    expect(etat?.trialUsedAt).toBeInstanceOf(Date);

    const journal = await rootDb.auditLog.findOne(
      { orgId: org.id, action: "organization.plan_changed" },
      { fields: ["metadata"] },
    );
    expect(journal?.metadata).toMatchObject({ avant: Plan.ESSENTIEL, apres: Plan.PRO });
  });

  it("retrouve l'entreprise par son client Stripe, et retient la grille", async () => {
    const r = await appliquerAbonnement(
      abonnement({ id: "sub_a", customer, status: "active", plan: Plan.BUSINESS, grille: "lancement" }),
    );
    expect(r).toMatchObject({ applique: true, apres: Plan.BUSINESS });
    // Un changement d'offre restera au tarif de lancement.
    expect((await etatOrg(org.id))?.grilleTarifaire).toBe("lancement");
  });

  it("écarte une métadonnée contredite par le client Stripe", async () => {
    const r = await appliquerAbonnement(
      abonnement({ id: "sub_x", customer: "cus_autre", orgId: org.id, status: "canceled", plan: Plan.PRO }),
    );
    expect(r.applique).toBe(false);
    expect((await etatOrg(org.id))?.plan).toBe(Plan.BUSINESS);
  });

  it("ne fait pas retomber une entreprise sous contrat", async () => {
    const r = await appliquerAbonnement(
      abonnement({
        id: "sub_c",
        customer: `cus_test_${contrat.id}`,
        orgId: contrat.id,
        status: "canceled",
        plan: Plan.PRO,
      }),
    );
    expect(r).toMatchObject({ applique: true, avant: Plan.ENTREPRISE, apres: Plan.ENTREPRISE });
  });

  it("n'écoute pas la fin d'un ancien abonnement remplacé", async () => {
    const r = await appliquerAbonnement(
      abonnement({ id: "sub_ancien", customer, status: "canceled", plan: Plan.PRO }),
    );
    expect(r.applique).toBe(false);
    expect((await etatOrg(org.id))?.plan).toBe(Plan.BUSINESS);
  });

  it("note une résiliation programmée sans fermer l'offre", async () => {
    await appliquerAbonnement(
      abonnement({ id: "sub_a", customer, status: "active", plan: Plan.BUSINESS, cancelAtPeriodEnd: true }),
    );
    const etat = await etatOrg(org.id);
    expect(etat?.plan).toBe(Plan.BUSINESS);
    expect(etat?.cancelAtPeriodEnd).toBe(true);
  });

  it("ramène à Essentiel à la résiliation et libère l'abonnement", async () => {
    const r = await appliquerAbonnement(
      abonnement({ id: "sub_a", customer, status: "canceled", plan: Plan.BUSINESS }),
    );
    expect(r).toMatchObject({ applique: true, apres: Plan.ESSENTIEL });
    const etat = await etatOrg(org.id);
    expect(etat?.stripeSubscriptionId).toBeNull();
    expect(etat?.subscriptionStatus).toBe(SubscriptionStatus.CANCELED);
    // L'essai reste consommé.
    expect(etat?.trialUsedAt).toBeInstanceOf(Date);
  });

  it("relit l'abonnement chez Stripe plutôt que de croire l'événement", async () => {
    const aJour = abonnement({ id: "sub_b", customer, status: "active", plan: Plan.PRO });
    const faux = {
      subscriptions: { retrieve: async (id: string) => (id === "sub_b" ? aJour : null) },
    } as unknown as Stripe;
    const event = {
      type: "customer.subscription.updated",
      // État périmé dans l'événement : c'est la relecture qui fait foi.
      data: { object: { ...aJour, status: "incomplete" } },
    } as unknown as Stripe.Event;

    const r = await traiterEvenement(event, faux);
    expect(r).toMatchObject({ applique: true, apres: Plan.PRO, status: SubscriptionStatus.ACTIVE });
  });

  it("ignore les événements sans rapport avec un abonnement", async () => {
    const r = await traiterEvenement(
      { type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event,
      stripe,
    );
    expect(r.applique).toBe(false);
  });
});

describe("signature du webhook", () => {
  const secret = "whsec_vennora_tests";
  const corps = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });

  it("accepte un appel signé par Stripe", () => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload: corps, secret });
    const event = lireEvenement(Buffer.from(corps), signature, secret, stripe);
    expect(event.id).toBe("evt_1");
  });

  it("refuse un corps modifié", () => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload: corps, secret });
    const falsifie = corps.replace("invoice.paid", "customer.subscription.updated");
    expect(() => lireEvenement(Buffer.from(falsifie), signature, secret, stripe)).toThrow(/invalide/);
  });

  it("refuse un appel sans signature", () => {
    expect(() => lireEvenement(Buffer.from(corps), undefined, secret, stripe)).toThrow(/absente/);
  });
});
