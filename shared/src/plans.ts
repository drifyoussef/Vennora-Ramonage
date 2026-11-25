import { Plan } from "./enums";
import { ForbiddenError } from "./errors";

/**
 * Ce que donne chaque offre.
 *
 * Une seule matrice, lue par le serveur. L'interface s'en sert pour flouter
 * ce qui n'est pas souscrit, mais **le floutage n'est pas la protection** :
 * une zone verrouillée n'est pas rendue avec ses données, et l'action
 * correspondante est refusée côté serveur. Retirer un filtre CSS dans le
 * navigateur ne donne donc rien à voir, et forger la requête ne donne rien à
 * faire.
 *
 * Ajouter une fonctionnalité payante = ajouter une clé ici, puis la faire
 * exiger par l'action concernée. Rien d'autre ne décide.
 *
 * « Fondateur » est une offre de lancement, pas un palier : elle donne les
 * mêmes fonctionnalités que Pro à un prix tenu dans la durée. Elle est donc
 * absente de l'échelle commerciale plus bas — sans quoi l'application
 * proposerait de « passer à l'offre Fondateur » à des entreprises qui ne
 * peuvent plus y souscrire.
 */
export const FONCTIONNALITES = [
  /** Dictée vocale et brouillon de compte-rendu assisté. */
  "redaction-assistee",
  /** Envoi du rapport au client par e-mail. */
  "envoi-rapport",
  /** Suivi des échéances et rappels. */
  "rappels",
  /** Export complet des données depuis l'application. */
  "export",
] as const;

export type Fonctionnalite = (typeof FONCTIONNALITES)[number];

/** Libellé commercial de chaque fonctionnalité (page Abonnement). */
export const FONCTIONNALITE_LABEL: Record<Fonctionnalite, string> = {
  "redaction-assistee": "Dictée et compte-rendu assisté",
  "envoi-rapport": "Envoi du rapport par e-mail",
  rappels: "Suivi des échéances et rappels",
  export: "Export complet des données",
};

const OFFRES: Record<
  Plan,
  { libelle: string; utilisateurs: number; fonctionnalites: Fonctionnalite[] }
> = {
  [Plan.ESSENTIEL]: {
    libelle: "Essentiel",
    utilisateurs: 1,
    // Un artisan seul s'attend à pouvoir envoyer son rapport : sans l'envoi,
    // l'offre d'entrée paraît bridée et ne se vend pas (voir le site vitrine).
    fonctionnalites: ["envoi-rapport"],
  },
  [Plan.FONDATEUR]: {
    libelle: "Fondateur",
    utilisateurs: 3,
    fonctionnalites: ["redaction-assistee", "envoi-rapport", "rappels"],
  },
  [Plan.PRO]: {
    libelle: "Pro",
    utilisateurs: 3,
    fonctionnalites: ["redaction-assistee", "envoi-rapport", "rappels"],
  },
  [Plan.BUSINESS]: {
    libelle: "Business",
    utilisateurs: 10,
    fonctionnalites: ["redaction-assistee", "envoi-rapport", "rappels", "export"],
  },
  [Plan.ENTREPRISE]: {
    libelle: "Entreprise",
    // Négocié au contrat : l'application ne compte pas.
    utilisateurs: Number.POSITIVE_INFINITY,
    fonctionnalites: [...FONCTIONNALITES],
  },
};

/**
 * Échelle commerciale, dans l'ordre où on la vend. Sert à nommer l'offre à
 * atteindre dans les messages — d'où l'absence de « Fondateur », qui ne se
 * souscrit plus.
 */
const ORDRE: Plan[] = [Plan.ESSENTIEL, Plan.PRO, Plan.BUSINESS, Plan.ENTREPRISE];

/**
 * Offres qui se souscrivent en ligne (Stripe). Fondateur ne se souscrit plus,
 * Entreprise se négocie au contrat : ni l'une ni l'autre n'a de prix public,
 * et une entreprise qui en bénéficie ne doit pas pouvoir en sortir d'un clic.
 */
export const OFFRES_EN_LIGNE: readonly Plan[] = [Plan.ESSENTIEL, Plan.PRO, Plan.BUSINESS];

export function souscriptibleEnLigne(plan: Plan): boolean {
  return OFFRES_EN_LIGNE.includes(plan);
}

/**
 * Utilisateurs au-delà du forfait : facturés à l'unité sur Pro et Business.
 * Essentiel n'en accepte pas — c'est l'offre d'un artisan seul, et le
 * deuxième compte est le moment naturel de passer à Pro.
 */
export function supplementUtilisateurs(plan: Plan): boolean {
  return plan === Plan.PRO || plan === Plan.BUSINESS;
}

/** Utilisateurs actifs à facturer en plus du forfait. */
export function utilisateursSupplementaires(plan: Plan, actifs: number): number {
  if (!supplementUtilisateurs(plan)) return 0;
  return Math.max(0, actifs - utilisateursInclus(plan));
}

/** Ce que comprend une offre, pour la présenter (page Abonnement). */
export function fonctionnalitesOffre(plan: Plan): readonly Fonctionnalite[] {
  return OFFRES[plan].fonctionnalites;
}

export function libelleOffre(plan: Plan): string {
  return OFFRES[plan].libelle;
}

export function autorise(plan: Plan, fonctionnalite: Fonctionnalite): boolean {
  return OFFRES[plan].fonctionnalites.includes(fonctionnalite);
}

export function utilisateursInclus(plan: Plan): number {
  return OFFRES[plan].utilisateurs;
}

export function offreRequise(fonctionnalite: Fonctionnalite): Plan {
  return ORDRE.find((p) => autorise(p, fonctionnalite)) ?? Plan.ENTREPRISE;
}

/** Phrase montrée à l'utilisateur devant une zone verrouillée. */
export function messageOffre(fonctionnalite: Fonctionnalite): string {
  return `Disponible à partir de l'offre ${libelleOffre(offreRequise(fonctionnalite))}.`;
}

/**
 * Garde à poser en tête de toute action payante.
 *
 * Le refus est une erreur métier explicite, pas un `false` silencieux : une
 * action qui échoue sans le dire finit par produire un ticket de support.
 */
export function exigerFonctionnalite(
  contexte: { user: { org: { plan: Plan } } },
  fonctionnalite: Fonctionnalite,
): void {
  if (autorise(contexte.user.org.plan, fonctionnalite)) return;
  throw new ForbiddenError(
    `Cette fonctionnalité n'est pas comprise dans votre offre ${libelleOffre(
      contexte.user.org.plan,
    )}. ${messageOffre(fonctionnalite)}`,
  );
}
