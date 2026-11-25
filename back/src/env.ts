import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

// Le `.env` est dans back/ : seul le back lit la configuration.
// Les variables déjà définies (hébergeur, CI) l'emportent sur le fichier.
config({ path: resolve(import.meta.dirname, "../.env"), quiet: true });

/**
 * Variables d'environnement validées au démarrage.
 *
 * Une clé manquante doit faire échouer le boot, pas produire un `undefined`
 * qui remonte trois couches plus loin sous forme de 500 incompréhensible.
 * Aucune de ces valeurs n'est jamais transmise au navigateur.
 */
const serverSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),

  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET doit faire au moins 32 caractères (openssl rand -base64 32)"),
  AUTH_URL: z.string().url().optional(),

  /** Port d'écoute de l'API. */
  API_PORT: z.coerce.number().int().positive().default(4000),
  /**
   * Adresse publique de l'interface, pour les liens envoyés hors de l'app
   * (QR codes, e-mails). En développement, celle du serveur Vite.
   */
  APP_URL: z.string().url().default("http://localhost:5173"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("eu-west-3"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  AI_PROVIDER: z.enum(["mock", "anthropic", "groq"]).default("mock"),
  /** Modèle de rédaction servi par Groq, quand `AI_PROVIDER=groq`. */
  GROQ_MODEL: z.string().default("qwen/qwen3.8-27b"),
  ANTHROPIC_API_KEY: z.string().optional(),
  TRANSCRIPTION_PROVIDER: z.enum(["mock", "openai", "groq"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  /**
   * Modèle Whisper servi par Groq.
   *
   * `whisper-large-v3` et non la variante « turbo » : mesuré sur une note de
   * quinze secondes en français, turbo ne rend aucun texte exploitable là où
   * la version complète transcrit correctement — pour un écart de latence de
   * trente millisecondes, invisible à l'usage. Le gain de vitesse annoncé de
   * la variante distillée ne se voit pas sur des notes de cette durée, sa
   * perte de qualité hors anglais, si.
   */
  GROQ_TRANSCRIPTION_MODEL: z.string().default("whisper-large-v3"),

  MAIL_DRIVER: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().default("Vennora <ne-pas-repondre@vennora.app>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /**
   * TLS implicite. Laissé vide, il est déduit du port : 465 chiffré d'entrée
   * de jeu, STARTTLS ailleurs. Ne le forcer que face à un serveur exotique.
   */
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  /**
   * Paiement en ligne. `off` : les offres se changent à la main
   * (`npm run org:plan`) et la page Abonnement le dit. `stripe` : Checkout,
   * portail client et webhook.
   */
  BILLING_DRIVER: z.enum(["off", "stripe"]).default("off"),
  /** Clé secrète Stripe. `sk_test_…` hors production : voir plus bas. */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Secret de signature du webhook (`whsec_…`, donné par `stripe listen`). */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Durée de l'essai gratuit, en jours : ouvert à la création de l'entreprise
   * (offre Pro), ou à la première souscription pour une entreprise plus
   * ancienne qui n'en a jamais eu.
   */
  STRIPE_TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  /**
   * Grille proposée aux nouvelles souscriptions. `lancement` : −20 % sous le
   * tarif public, gardé ensuite par l'abonné (« prix garanti »). Passer à
   * `public` ferme le tarif de lancement aux nouveaux venus seulement.
   */
  STRIPE_TARIF: z.enum(["lancement", "public"]).default("lancement"),
  /**
   * Configuration du portail client (`bpc_…`) créée par
   * `npm run stripe:setup`. Vide : la configuration par défaut du compte.
   */
  STRIPE_PORTAL_CONFIGURATION: z.string().optional(),
});

function load() {
  // Une variable laissée vide dans un `.env` vaut « non renseignée ».
  // Sans ça, `SMTP_SECURE=""` — ce que produit naturellement un fichier
  // d'exemple recopié — n'est ni « true » ni « false » et fait échouer le
  // démarrage sur une valeur que personne n'a voulu donner.
  const brut = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== ""),
  );

  const parsed = serverSchema.safeParse(brut);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  · ${i.path.join(".")} — ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuration d'environnement invalide :\n${details}\n\nVoir .env.example.`,
    );
  }

  const env = parsed.data;

  // Cohérences inter-variables : mieux vaut échouer au boot qu'au premier
  // upload en production.
  if (env.STORAGE_DRIVER === "s3") {
    const missing = (
      ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(
        `STORAGE_DRIVER=s3 mais ${missing.join(", ")} manquant(e)(s).`,
      );
    }
  }
  if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("AI_PROVIDER=anthropic mais ANTHROPIC_API_KEY manquant.");
  }
  if (env.AI_PROVIDER === "groq" && !env.GROQ_API_KEY) {
    throw new Error("AI_PROVIDER=groq mais GROQ_API_KEY manquant.");
  }
  if (env.TRANSCRIPTION_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    throw new Error("TRANSCRIPTION_PROVIDER=openai mais OPENAI_API_KEY manquant.");
  }
  if (env.TRANSCRIPTION_PROVIDER === "groq" && !env.GROQ_API_KEY) {
    throw new Error("TRANSCRIPTION_PROVIDER=groq mais GROQ_API_KEY manquant.");
  }
  if (env.MAIL_DRIVER === "smtp" && !env.SMTP_HOST) {
    throw new Error("MAIL_DRIVER=smtp mais SMTP_HOST manquant.");
  }
  if (env.MAIL_DRIVER === "smtp" && env.SMTP_USER && !env.SMTP_PASSWORD) {
    throw new Error("SMTP_USER est renseigné mais SMTP_PASSWORD manque.");
  }
  if (env.BILLING_DRIVER === "stripe") {
    const missing = (["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const).filter(
      (k) => !env[k],
    );
    if (missing.length > 0) {
      throw new Error(`BILLING_DRIVER=stripe mais ${missing.join(", ")} manquant(e)(s).`);
    }
    const key = env.STRIPE_SECRET_KEY!;
    if (!/^(sk|rk)_(test|live)_/.test(key)) {
      throw new Error("STRIPE_SECRET_KEY ne ressemble pas à une clé Stripe (sk_test_… attendu).");
    }
    // Une clé live sur un poste de développement, c'est un vrai débit au
    // premier essai de carte. Elle n'est acceptée qu'en production.
    if (key.includes("_live_") && env.NODE_ENV !== "production") {
      throw new Error(
        "STRIPE_SECRET_KEY est une clé live : seules les clés de test (sk_test_…) sont acceptées hors production.",
      );
    }
  }
  // Gmail réécrit silencieusement l'expéditeur quand il ne correspond pas au
  // compte authentifié : le client reçoit alors un rapport signé d'une
  // adresse à laquelle personne ne s'attend. Un avertissement, pas une
  // erreur — un compte Workspace peut légitimement écrire au nom d'un alias.
  if (
    env.MAIL_DRIVER === "smtp" &&
    env.SMTP_USER &&
    !env.MAIL_FROM.includes(env.SMTP_USER)
  ) {
    console.warn(
      `[vennora] MAIL_FROM (${env.MAIL_FROM}) ne contient pas SMTP_USER (${env.SMTP_USER}).\n` +
        "          Gmail remplacera l'expéditeur par le compte authentifié.",
    );
  }

  return env;
}

export const env = load();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";

/** Stripe branché sur un compte de test : aucun paiement réel. */
export const stripeTestMode = !env.STRIPE_SECRET_KEY?.includes("_live_");
