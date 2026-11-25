import { MongoClient, type Db } from "mongodb";
import { createRepos, type Repos } from "./repo";
import type { ModelName } from "./models";

export { oid, isObjectIdString, isDuplicateKeyError } from "./convert";
export { one, maybeOne, backOne, many, count, spec } from "./query";
export type { Row, Spec } from "./query";
export { createRepos, Repo } from "./repo";
export type { Repos, Where, SortOf } from "./repo";
export type * from "./models";
export { opaqueToken } from "./models";

/**
 * Connexion à MongoDB.
 *
 * Ce module ne dépend pas de Next : le seed, les scripts et les tests
 * ouvrent leur propre connexion avec `connectMongo`. L'application, elle,
 * passe par le singleton de `@/lib/mongo`.
 */

export interface MongoConnection {
  client: MongoClient;
  database: Db;
  /** Client racine : aucun cloisonnement. */
  root: Repos;
  close(): Promise<void>;
}

/**
 * Le nom de la base est lu dans l'URL (`…mongodb.net/vennora`). Sans lui, le
 * driver écrirait silencieusement dans une base `test` vide : on refuse.
 */
export function databaseName(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name) {
    throw new Error(
      "DATABASE_URL doit se terminer par le nom de la base, par exemple « …mongodb.net/vennora ».",
    );
  }
  return decodeURIComponent(name);
}

export function connectMongo(url: string): MongoConnection {
  // La connexion est établie à la première requête, pas ici.
  const client = new MongoClient(url, { appName: "vennora" });
  const database = client.db(databaseName(url));
  return {
    client,
    database,
    root: createRepos(database, null),
    close: () => client.close(),
  };
}

interface IndexDef {
  fields: string[];
  unique?: boolean;
}

/**
 * Index de chaque collection. `orgId` en tête de chaque index composé : toute
 * requête métier commence par lui.
 *
 * Les noms reprennent la convention de Prisma (`Modèle_champs_key` pour un
 * index unique, `_idx` sinon), pour que les index déjà créés en base soient
 * reconnus au lieu d'être dupliqués.
 */
export const INDEXES: Record<ModelName, IndexDef[]> = {
  Trade: [{ fields: ["slug"], unique: true }],
  EquipmentType: [
    { fields: ["tradeId", "code"], unique: true },
    { fields: ["tradeId", "active", "sortOrder"] },
  ],
  InterventionType: [
    { fields: ["tradeId", "code"], unique: true },
    { fields: ["tradeId", "active", "sortOrder"] },
  ],
  Organization: [
    { fields: ["slug"], unique: true },
    // Le webhook Stripe retrouve l'entreprise par son client Stripe. Pas
    // unique : les entreprises sans abonnement ont toutes `null`.
    { fields: ["stripeCustomerId"] },
  ],
  User: [
    { fields: ["email"], unique: true },
    { fields: ["orgId", "active"] },
    { fields: ["orgId", "role"] },
  ],
  Customer: [
    { fields: ["orgId", "name"] },
    { fields: ["orgId", "city"] },
    { fields: ["orgId", "phone"] },
    { fields: ["orgId", "email"] },
  ],
  Site: [
    { fields: ["orgId", "customerId"] },
    { fields: ["orgId", "city"] },
    { fields: ["orgId", "name"] },
  ],
  Equipment: [
    { fields: ["qrToken"], unique: true },
    { fields: ["orgId", "siteId"] },
    { fields: ["orgId", "typeId"] },
    { fields: ["orgId", "nextDueAt"] },
    { fields: ["orgId", "serialNumber"] },
  ],
  Intervention: [
    { fields: ["orgId", "reference"], unique: true },
    { fields: ["orgId", "scheduledStart"] },
    { fields: ["orgId", "technicianId", "scheduledStart"] },
    { fields: ["orgId", "status", "scheduledStart"] },
    { fields: ["orgId", "customerId", "scheduledStart"] },
    { fields: ["orgId", "equipmentId", "scheduledStart"] },
    { fields: ["orgId", "siteId"] },
  ],
  InterventionPhoto: [
    { fields: ["orgId", "interventionId", "sortOrder"] },
    { fields: ["orgId", "equipmentId", "createdAt"] },
    { fields: ["orgId", "anomalyId"] },
  ],
  VoiceNote: [{ fields: ["orgId", "interventionId", "createdAt"] }],
  Anomaly: [
    { fields: ["orgId", "status", "severity"] },
    { fields: ["orgId", "interventionId"] },
    { fields: ["orgId", "equipmentId", "createdAt"] },
  ],
  Report: [
    { fields: ["interventionId"], unique: true },
    { fields: ["orgId", "createdAt"] },
  ],
  Signature: [
    { fields: ["interventionId"], unique: true },
    { fields: ["orgId", "signedAt"] },
  ],
  Document: [
    { fields: ["orgId", "customerId", "createdAt"] },
    { fields: ["orgId", "interventionId"] },
    { fields: ["orgId", "category", "createdAt"] },
  ],
  Reminder: [{ fields: ["orgId", "status", "dueDate"] }],
  AuditLog: [
    { fields: ["orgId", "createdAt"] },
    { fields: ["orgId", "entity", "entityId"] },
  ],
  Counter: [{ fields: ["orgId", "key"], unique: true }],
};

/** Crée les index manquants. Sans effet sur ceux qui existent déjà. */
export async function ensureIndexes(database: Db): Promise<number> {
  let created = 0;
  for (const [model, defs] of Object.entries(INDEXES)) {
    const collection = database.collection(model);
    for (const def of defs) {
      const name = `${model}_${def.fields.join("_")}_${def.unique ? "key" : "idx"}`;
      const keys = Object.fromEntries(def.fields.map((f) => [f, 1 as const]));
      await collection.createIndex(keys, { name, unique: def.unique ?? false });
      created++;
    }
  }
  return created;
}
