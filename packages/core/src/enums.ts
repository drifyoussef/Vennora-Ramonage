/**
 * Énumérations métier, utilisables côté serveur comme côté navigateur.
 *
 * C'est la source de vérité : les valeurs stockées en base sont ces chaînes,
 * et les types des documents (`core/db/models.ts`) s'appuient sur elles.
 * Ajouter une valeur ici suffit côté code ; s'il s'agit d'un champ requis,
 * penser aux libellés (`core/labels.ts`, dont le typage exige une entrée par
 * valeur) et aux documents déjà en base.
 */

type ValueOf<T> = T[keyof T];

export const UserRole = {
  ADMIN: "ADMIN",
  TECHNICIAN: "TECHNICIAN",
} as const;
export type UserRole = ValueOf<typeof UserRole>;

export const CustomerKind = {
  INDIVIDUAL: "INDIVIDUAL",
  COMPANY: "COMPANY",
} as const;
export type CustomerKind = ValueOf<typeof CustomerKind>;

export const InterventionStatus = {
  PLANNED: "PLANNED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type InterventionStatus = ValueOf<typeof InterventionStatus>;

export const AnomalySeverity = {
  INFO: "INFO",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type AnomalySeverity = ValueOf<typeof AnomalySeverity>;

export const AnomalyStatus = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  IGNORED: "IGNORED",
} as const;
export type AnomalyStatus = ValueOf<typeof AnomalyStatus>;

export const TranscriptStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;
export type TranscriptStatus = ValueOf<typeof TranscriptStatus>;

export const ReportOrigin = {
  MANUAL: "MANUAL",
  AI: "AI",
} as const;
export type ReportOrigin = ValueOf<typeof ReportOrigin>;

/**
 * Offre souscrite par l'entreprise. Détermine les fonctionnalités servies :
 * la matrice vit dans `core/plans.ts`, et c'est le serveur qui l'applique.
 *
 * FONDATEUR : offre de lancement, les fonctionnalités de Pro à prix tenu dans
 * la durée. Elle ne se vend plus une fois la période close, mais celles qui
 * l'ont gardent leurs droits.
 */
export const Plan = {
  ESSENTIEL: "ESSENTIEL",
  FONDATEUR: "FONDATEUR",
  PRO: "PRO",
  BUSINESS: "BUSINESS",
  ENTREPRISE: "ENTREPRISE",
} as const;
export type Plan = ValueOf<typeof Plan>;

export const DocumentCategory = {
  REPORT: "REPORT",
  INVOICE: "INVOICE",
  QUOTE: "QUOTE",
  CERTIFICATE: "CERTIFICATE",
  PHOTO: "PHOTO",
  OTHER: "OTHER",
} as const;
export type DocumentCategory = ValueOf<typeof DocumentCategory>;

export const ReminderStatus = {
  PENDING: "PENDING",
  SCHEDULED: "SCHEDULED",
  DONE: "DONE",
  DISMISSED: "DISMISSED",
} as const;
export type ReminderStatus = ValueOf<typeof ReminderStatus>;
