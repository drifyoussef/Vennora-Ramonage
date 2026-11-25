/**
 * Prépare le compte Stripe : produits, prix et portail client.
 *
 *   npm run stripe:setup
 *
 * Fait pour la phase de test : refuse une clé live, sauf `--live` explicite.
 * Le relancer ne crée rien en double — produits à identifiant fixe, prix
 * retrouvés par leur `lookup_key`. Un tarif modifié ci-dessous crée un
 * nouveau prix qui reprend la clé ; les abonnés en cours restent sur
 * l'ancien jusqu'à ce qu'on les migre.
 */
import Stripe from "stripe";
import { Plan } from "@vennora/shared/enums";
import {
  FONCTIONNALITE_LABEL,
  fonctionnalitesOffre,
  libelleOffre,
  OFFRES_EN_LIGNE,
  utilisateursInclus,
} from "@vennora/shared/plans";
import { env } from "../src/env";
import { CLE_UTILISATEUR, CLES_PRIX, type Grille } from "../src/services/billing";

/**
 * Tarifs mensuels hors taxes, en centimes.
 *
 * Recopiés de la grille du site vitrine (`vennora-landing`,
 * `src/components/tarifs.tsx`) : si elle change, changer les deux. Le tarif
 * de lancement est le public −20 %, arrondi à l'euro inférieur, comme sur
 * le site.
 */
const TARIFS: Record<Grille, Partial<Record<Plan, number>>> = {
  public: {
    [Plan.ESSENTIEL]: 3900,
    [Plan.PRO]: 9900,
    [Plan.BUSINESS]: 24900,
  },
  lancement: {
    [Plan.ESSENTIEL]: 3100,
    [Plan.PRO]: 7900,
    [Plan.BUSINESS]: 19900,
  },
};
/** Utilisateur au-delà du forfait (Pro, Business), dans les deux grilles. */
const TARIF_UTILISATEUR = 2000;
const DEVISE = "eur";

const PORTAIL_META = "vennora";

function description(plan: Plan): string {
  const n = utilisateursInclus(plan);
  const parts = [`${n} utilisateur${n > 1 ? "s" : ""}`];
  for (const f of fonctionnalitesOffre(plan)) parts.push(FONCTIONNALITE_LABEL[f]);
  return parts.join(" · ");
}

async function produit(
  stripe: Stripe,
  id: string,
  donnees: { name: string; description: string; metadata: Record<string, string> },
): Promise<Stripe.Product> {
  try {
    return await stripe.products.update(id, { ...donnees, active: true });
  } catch (e) {
    if ((e as { code?: string }).code !== "resource_missing") throw e;
    return stripe.products.create({ id, ...donnees });
  }
}

/** Prix mensuel de clé `lookupKey`, créé ou remplacé s'il a changé. */
async function prix(
  stripe: Stripe,
  product: Stripe.Product,
  lookupKey: string,
  montant: number,
  meta: { metadata: Record<string, string>; nickname: string; parDefaut: boolean },
): Promise<Stripe.Price> {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const actuel = data[0];

  if (
    actuel &&
    actuel.active &&
    actuel.unit_amount === montant &&
    actuel.currency === DEVISE &&
    actuel.recurring?.interval === "month" &&
    actuel.product === product.id
  ) {
    return actuel;
  }

  const nouveau = await stripe.prices.create({
    product: product.id,
    currency: DEVISE,
    unit_amount: montant,
    recurring: { interval: "month" },
    tax_behavior: "exclusive",
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: meta.metadata,
    nickname: meta.nickname,
  });
  if (meta.parDefaut) await stripe.products.update(product.id, { default_price: nouveau.id });
  // L'ancien prix ne se vend plus, mais ses abonnés le gardent.
  if (actuel?.active) await stripe.prices.update(actuel.id, { active: false });
  return nouveau;
}

/**
 * Portail client : carte, factures, coordonnées, résiliation. Le changement
 * d'offre se fait dans l'application — le portail ne sait pas modifier un
 * abonnement à plusieurs lignes (forfait + utilisateurs en plus).
 */
async function portail(stripe: Stripe): Promise<Stripe.BillingPortal.Configuration> {
  const params = {
    business_profile: { headline: "Vennora — gérez votre abonnement" },
    default_return_url: `${env.APP_URL}/parametres/abonnement`,
    features: {
      customer_update: { enabled: true, allowed_updates: ["name", "email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
      subscription_update: { enabled: false },
    },
    metadata: { [PORTAIL_META]: "1" },
  } satisfies Stripe.BillingPortal.ConfigurationCreateParams;

  const { data } = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const existant = data.find((c) => c.metadata?.[PORTAIL_META] === "1");
  return existant
    ? stripe.billingPortal.configurations.update(existant.id, params)
    : stripe.billingPortal.configurations.create(params);
}

const euros = (centimes: number) => `${(centimes / 100).toFixed(2).padStart(7)} €`;

async function main() {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("\n  STRIPE_SECRET_KEY manquant dans back/.env (clé sk_test_… du tableau de bord Stripe).\n");
    process.exitCode = 1;
    return;
  }
  if (key.includes("_live_") && !process.argv.includes("--live")) {
    console.error("\n  Clé live détectée : ce script prépare le compte de test. Relancer avec --live pour la production.\n");
    process.exitCode = 1;
    return;
  }

  const stripe = new Stripe(key, { appInfo: { name: "Vennora (configuration)" } });
  const mode = key.includes("_live_") ? "LIVE" : "test";
  console.log(`\n  Compte Stripe (${mode})          public    lancement\n`);

  for (const plan of OFFRES_EN_LIGNE) {
    const product = await produit(stripe, `vennora_${plan.toLowerCase()}`, {
      name: `Vennora ${libelleOffre(plan)}`,
      description: description(plan),
      metadata: { vennora_plan: plan },
    });
    const ligne: string[] = [];
    for (const grille of ["public", "lancement"] as const) {
      const p = await prix(stripe, product, CLES_PRIX[grille][plan]!, TARIFS[grille][plan]!, {
        metadata: { vennora_plan: plan, vennora_grille: grille },
        nickname: `${libelleOffre(plan)} mensuel${grille === "lancement" ? " (lancement)" : ""}`,
        parDefaut: grille === "public",
      });
      ligne.push(euros(p.unit_amount!));
    }
    console.log(`    ${libelleOffre(plan).padEnd(26)} ${ligne.join("   ")}  HT/mois`);
  }

  const utilisateur = await produit(stripe, "vennora_utilisateur", {
    name: "Vennora — utilisateur supplémentaire",
    description: "Utilisateur actif au-delà de ceux compris dans le forfait",
    metadata: { vennora_utilisateur: "1" },
  });
  const pu = await prix(stripe, utilisateur, CLE_UTILISATEUR, TARIF_UTILISATEUR, {
    metadata: { vennora_utilisateur: "1" },
    nickname: "Utilisateur supplémentaire mensuel",
    parDefaut: true,
  });
  console.log(`    ${"Utilisateur en plus".padEnd(26)} ${euros(pu.unit_amount!)}               HT/mois`);

  const configuration = await portail(stripe);
  console.log(`\n    Portail client               ${configuration.id}`);

  console.log(
    [
      "",
      "  Dans back/.env :",
      "",
      "    BILLING_DRIVER=stripe",
      `    STRIPE_PORTAL_CONFIGURATION=${configuration.id}`,
      "",
      "  Puis, dans un second terminal, relayer les webhooks vers l'API :",
      "",
      "    stripe listen --forward-to localhost:4000/api/stripe/webhook",
      "",
      "  et recopier le secret affiché (whsec_…) dans STRIPE_WEBHOOK_SECRET.",
      "",
    ].join("\n"),
  );
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
