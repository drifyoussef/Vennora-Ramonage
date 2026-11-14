import { randomBytes } from "node:crypto";
import type {
  AnomalySeverity,
  AnomalyStatus,
  CustomerKind,
  DocumentCategory,
  InterventionStatus,
  Plan,
  ReminderStatus,
  ReportOrigin,
  TranscriptStatus,
  UserRole,
} from "@vennora/shared/enums";

/**
 * Description des collections MongoDB.
 *
 * Ce fichier tient le rôle qu'avait `schema.prisma` : la forme des documents,
 * les champs qui sont des `ObjectId`, les valeurs par défaut et les
 * horodatages. Les noms de collection sont ceux qu'utilisait Prisma (le nom
 * du modèle), pour que les données déjà en base restent lisibles telles
 * quelles.
 *
 * Les types décrivent les documents **côté application** : identifiants en
 * chaînes, `id` à la place de `_id`, champs facultatifs à `null` quand ils
 * sont absents. La conversion depuis et vers la forme stockée (`ObjectId`,
 * `_id`) est faite par `convert.ts`, jamais à la main.
 *
 * Aucune contrainte d'intégrité côté base : les relations et les suppressions
 * en cascade sont portées par la couche `src/core`.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export interface Trade {
  id: string;
  name: string;
  slug: string;
  colorHex: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Catalogue des types d'équipement, propre à un métier. */
export interface EquipmentType {
  id: string;
  tradeId: string;
  code: string;
  label: string;
  /** Nom d'icône lucide. */
  icon: string | null;
  /** Périodicité réglementaire ou conseillée par défaut, en mois. */
  defaultIntervalMonths: number | null;
  sortOrder: number;
  active: boolean;
}

/** Catalogue des types d'intervention, propre à un métier. */
export interface InterventionType {
  id: string;
  tradeId: string;
  code: string;
  label: string;
  colorHex: string;
  defaultDurationMin: number;
  /** Délai conseillé avant la prochaine intervention du même type. */
  recurrenceMonths: number | null;
  sortOrder: number;
  active: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  /**
   * Offre souscrite. Toute nouvelle entreprise démarre au plus bas : ouvrir
   * des fonctionnalités est une décision commerciale, jamais un effet de bord
   * de la création d'un compte.
   */
  plan: Plan;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  siret: string | null;
  logoKey: string | null;
  tradeId: string;
  /** Réglages libres (mentions légales du rapport, expéditeur e-mail…). */
  settings: Json | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  orgId: string;
  firstName: string;
  lastName: string;
  /** Unique sur toute la plateforme. */
  email: string;
  phone: string | null;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  avatarKey: string | null;
  /** Couleur d'affichage du technicien dans le planning. */
  colorHex: string | null;
  lastLoginAt: Date | null;
  /**
   * Dernier changement de mot de passe. Tout jeton émis avant cette date est
   * refusé : changer son mot de passe déconnecte réellement les autres
   * appareils.
   */
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Customer {
  id: string;
  orgId: string;
  kind: CustomerKind;
  /** Nom d'affichage, toujours renseigné : sert à la recherche et au tri. */
  name: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  notes: string | null;
  /** Miroirs dénormalisés pour la liste clients. */
  lastInterventionAt: Date | null;
  nextInterventionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Site {
  id: string;
  orgId: string;
  customerId: string;
  name: string;
  address: string;
  addressComplement: string | null;
  postalCode: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  /** Digicode, chien, emplacement des clés… */
  accessNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Equipment {
  id: string;
  orgId: string;
  siteId: string;
  typeId: string;
  label: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  installedAt: Date | null;
  description: string | null;
  notes: string | null;
  /**
   * Jeton opaque du QR code, unique. Jamais l'id brut : le QR est collé sur
   * l'équipement et peut être photographié par n'importe qui.
   */
  qrToken: string;
  active: boolean;
  lastInterventionAt: Date | null;
  nextDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Intervention {
  id: string;
  orgId: string;
  /** Numéro lisible « INT-2026-0042 », unique dans l'organisation. */
  reference: string;
  customerId: string;
  siteId: string;
  equipmentId: string | null;
  technicianId: string;
  typeId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  status: InterventionStatus;
  /** Notes saisies par le technicien sur le terrain. */
  notes: string | null;
  /** Notes internes, jamais reprises dans le rapport client. */
  internalNotes: string | null;
  /** Prochaine intervention conseillée, fixée à la clôture. */
  nextInterventionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InterventionPhoto {
  id: string;
  orgId: string;
  interventionId: string | null;
  /** Dupliqué depuis l'intervention pour la galerie d'un équipement. */
  equipmentId: string | null;
  anomalyId: string | null;
  /** Clé de stockage. Jamais d'URL en base : elles sont signées à la demande. */
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  takenAt: Date | null;
  uploadedById: string | null;
  sortOrder: number;
  createdAt: Date;
}

export interface VoiceNote {
  id: string;
  orgId: string;
  interventionId: string;
  storageKey: string;
  mimeType: string;
  durationSec: number | null;
  sizeBytes: number | null;
  /** Texte issu de la transcription, puis corrigé par le technicien. */
  transcript: string | null;
  transcriptStatus: TranscriptStatus;
  transcriptError: string | null;
  /** Vrai dès que le technicien a modifié le texte à la main. */
  transcriptEdited: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Anomaly {
  id: string;
  orgId: string;
  interventionId: string;
  equipmentId: string | null;
  title: string;
  description: string | null;
  severity: AnomalySeverity;
  recommendation: string | null;
  status: AnomalyStatus;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Report {
  id: string;
  orgId: string;
  /** Unique : un rapport par intervention. */
  interventionId: string;
  summary: string | null;
  workDone: string | null;
  equipmentState: string | null;
  anomaliesSummary: string | null;
  recommendations: string | null;
  futureWork: string | null;
  origin: ReportOrigin;
  aiModel: string | null;
  /** Texte brut soumis au modèle, conservé pour audit et régénération. */
  aiSourceText: string | null;
  aiGeneratedAt: Date | null;
  regenerations: number;
  /** Un rapport n'est jamais envoyé sans validation humaine explicite. */
  validatedAt: Date | null;
  validatedById: string | null;
  pdfKey: string | null;
  pdfGeneratedAt: Date | null;
  sentAt: Date | null;
  sentTo: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Signature {
  id: string;
  orgId: string;
  /** Unique : une signature par intervention. */
  interventionId: string;
  signerName: string;
  storageKey: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface Document {
  id: string;
  orgId: string;
  customerId: string | null;
  siteId: string | null;
  equipmentId: string | null;
  interventionId: string | null;
  name: string;
  category: DocumentCategory;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: Date;
}

/** Rappel de prochaine intervention : une ligne « à replanifier ». */
export interface Reminder {
  id: string;
  orgId: string;
  customerId: string | null;
  equipmentId: string | null;
  /** Intervention à l'origine du rappel. */
  sourceInterventionId: string | null;
  dueDate: Date;
  note: string | null;
  status: ReminderStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Journal des actions sensibles. */
export interface AuditLog {
  id: string;
  orgId: string;
  userId: string | null;
  action: string;
  entity: string;
  /** Identifiant de l'entité visée, en texte : pas forcément un ObjectId. */
  entityId: string | null;
  metadata: Json | null;
  ipAddress: string | null;
  createdAt: Date;
}

/** Séquences par organisation (numérotation des interventions). */
export interface Counter {
  id: string;
  orgId: string;
  /** « intervention:2026 » */
  key: string;
  value: number;
}

export interface Models {
  Trade: Trade;
  EquipmentType: EquipmentType;
  InterventionType: InterventionType;
  Organization: Organization;
  User: User;
  Customer: Customer;
  Site: Site;
  Equipment: Equipment;
  Intervention: Intervention;
  InterventionPhoto: InterventionPhoto;
  VoiceNote: VoiceNote;
  Anomaly: Anomaly;
  Report: Report;
  Signature: Signature;
  Document: Document;
  Reminder: Reminder;
  AuditLog: AuditLog;
  Counter: Counter;
}

export type ModelName = keyof Models;

/** Nom de l'accesseur sur `db` : `db.interventionPhoto`, `db.auditLog`… */
export const ACCESSORS = {
  trade: "Trade",
  equipmentType: "EquipmentType",
  interventionType: "InterventionType",
  organization: "Organization",
  user: "User",
  customer: "Customer",
  site: "Site",
  equipment: "Equipment",
  intervention: "Intervention",
  interventionPhoto: "InterventionPhoto",
  voiceNote: "VoiceNote",
  anomaly: "Anomaly",
  report: "Report",
  signature: "Signature",
  document: "Document",
  reminder: "Reminder",
  auditLog: "AuditLog",
  counter: "Counter",
} as const satisfies Record<string, ModelName>;

export type Accessors = typeof ACCESSORS;

/**
 * Collections porteuses d'un `orgId`. Le client cloisonné (`tenantDb`)
 * restreint chacune de leurs lectures et écritures à l'organisation courante.
 * Les catalogues métier et l'organisation elle-même n'en ont pas.
 */
export const TENANT_MODELS: ReadonlySet<ModelName> = new Set<ModelName>([
  "User",
  "Customer",
  "Site",
  "Equipment",
  "Intervention",
  "InterventionPhoto",
  "VoiceNote",
  "Anomaly",
  "Report",
  "Signature",
  "Document",
  "Reminder",
  "AuditLog",
  "Counter",
]);

/** Champs stockés en `ObjectId` (en plus de `_id`), par collection. */
export const OBJECT_ID_FIELDS: Record<ModelName, ReadonlySet<string>> = {
  Trade: new Set(),
  EquipmentType: new Set(["tradeId"]),
  InterventionType: new Set(["tradeId"]),
  Organization: new Set(["tradeId"]),
  User: new Set(["orgId"]),
  Customer: new Set(["orgId"]),
  Site: new Set(["orgId", "customerId"]),
  Equipment: new Set(["orgId", "siteId", "typeId"]),
  Intervention: new Set([
    "orgId",
    "customerId",
    "siteId",
    "equipmentId",
    "technicianId",
    "typeId",
  ]),
  InterventionPhoto: new Set([
    "orgId",
    "interventionId",
    "equipmentId",
    "anomalyId",
    "uploadedById",
  ]),
  VoiceNote: new Set(["orgId", "interventionId", "createdById"]),
  Anomaly: new Set(["orgId", "interventionId", "equipmentId", "resolvedById"]),
  Report: new Set(["orgId", "interventionId", "validatedById"]),
  Signature: new Set(["orgId", "interventionId"]),
  Document: new Set([
    "orgId",
    "customerId",
    "siteId",
    "equipmentId",
    "interventionId",
    "uploadedById",
  ]),
  Reminder: new Set([
    "orgId",
    "customerId",
    "equipmentId",
    "sourceInterventionId",
  ]),
  AuditLog: new Set(["orgId", "userId"]),
  Counter: new Set(["orgId"]),
};

/** Champs tableau : lus comme `[]` quand ils sont absents. */
export const LIST_FIELDS: Partial<Record<ModelName, ReadonlySet<string>>> = {
  Report: new Set(["sentTo"]),
};

/** Horodatages gérés automatiquement à l'écriture. */
export const TIMESTAMPS: Record<
  ModelName,
  { createdAt: boolean; updatedAt: boolean }
> = {
  Trade: { createdAt: true, updatedAt: true },
  EquipmentType: { createdAt: false, updatedAt: false },
  InterventionType: { createdAt: false, updatedAt: false },
  Organization: { createdAt: true, updatedAt: true },
  User: { createdAt: true, updatedAt: true },
  Customer: { createdAt: true, updatedAt: true },
  Site: { createdAt: true, updatedAt: true },
  Equipment: { createdAt: true, updatedAt: true },
  Intervention: { createdAt: true, updatedAt: true },
  InterventionPhoto: { createdAt: true, updatedAt: false },
  VoiceNote: { createdAt: true, updatedAt: true },
  Anomaly: { createdAt: true, updatedAt: true },
  Report: { createdAt: true, updatedAt: true },
  Signature: { createdAt: true, updatedAt: false },
  Document: { createdAt: true, updatedAt: false },
  Reminder: { createdAt: true, updatedAt: true },
  AuditLog: { createdAt: true, updatedAt: false },
  Counter: { createdAt: false, updatedAt: false },
};

/** Jeton opaque, imprévisible, sûr dans une URL. */
export function opaqueToken(): string {
  return randomBytes(18).toString("base64url");
}

type DefaultValue = unknown | (() => unknown);

/**
 * Valeurs par défaut appliquées à la création, quand le champ n'est pas
 * fourni. Une fonction est appelée à chaque création.
 */
export const DEFAULTS = {
  Trade: { colorHex: "#0F3D4C", active: true },
  EquipmentType: { defaultIntervalMonths: 12, sortOrder: 0, active: true },
  InterventionType: {
    colorHex: "#0F3D4C",
    defaultDurationMin: 60,
    sortOrder: 0,
    active: true,
  },
  Organization: { plan: "ESSENTIEL", country: "FR" },
  User: { role: "TECHNICIAN", active: true },
  Customer: { kind: "INDIVIDUAL" },
  Site: {},
  Equipment: { qrToken: opaqueToken, active: true },
  Intervention: { status: "PLANNED" },
  InterventionPhoto: { sortOrder: 0 },
  VoiceNote: { transcriptStatus: "PENDING", transcriptEdited: false },
  Anomaly: { severity: "MEDIUM", status: "OPEN" },
  Report: { origin: "MANUAL", regenerations: 0, sentTo: () => [] },
  Signature: { signedAt: () => new Date() },
  Document: { category: "OTHER" },
  Reminder: { status: "PENDING" },
  AuditLog: {},
  Counter: { value: 0 },
} as const satisfies {
  [N in ModelName]: Partial<Record<keyof Models[N], DefaultValue>>;
};

/** Champs dont la valeur est automatique : jamais fournis par l'appelant. */
type AutoFields = "id" | "createdAt" | "updatedAt";

type NullableKeys<T> = {
  [K in keyof T]-?: null extends T[K] ? K : never;
}[keyof T];

type DefaultedKeys<N extends ModelName> = keyof (typeof DEFAULTS)[N] &
  keyof Models[N];

/**
 * Données d'une création : les champs requis sans valeur par défaut sont
 * obligatoires, les champs facultatifs ou à valeur par défaut peuvent être
 * omis. Les horodatages peuvent être forcés (seed, reprise de données).
 */
export type Insert<N extends ModelName> = Omit<
  Models[N],
  AutoFields | NullableKeys<Models[N]> | DefaultedKeys<N>
> &
  Partial<
    Pick<
      Models[N],
      Exclude<NullableKeys<Models[N]> | DefaultedKeys<N>, AutoFields>
    >
  > & {
    id?: string;
    createdAt?: Date;
    updatedAt?: Date;
  };

/** Modifications d'une mise à jour : jamais l'identifiant ni l'organisation. */
export type Changes<N extends ModelName> = Partial<
  Omit<Models[N], "id" | "orgId" | "createdAt">
>;
