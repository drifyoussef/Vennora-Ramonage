import type { Document, ObjectId } from "mongodb";
import { toFilter, toSort } from "./convert";
import {
  LIST_FIELDS,
  TENANT_MODELS,
  type ModelName,
  type Models,
} from "./models";

/**
 * Lectures avec relations, en une seule requête.
 *
 * On décrit ce qu'on veut lire — des champs, des documents liés, des
 * compteurs — et la description est traduite en un pipeline d'agrégation où
 * chaque relation devient un `$lookup`. Un seul aller-retour vers la base,
 * quelle que soit la profondeur, et un résultat typé d'après la description :
 * demander un champ qui n'existe pas, ou lire un champ qu'on n'a pas
 * demandé, ne compile pas.
 *
 * ```ts
 * db.intervention.find({ status: "PLANNED" }, {
 *   fields: ["reference", "scheduledStart"],
 *   with: {
 *     customer: one("Customer", "customerId", { fields: ["name"] }),
 *     anomalies: many("Anomaly", "interventionId", { fields: ["title"] }),
 *   },
 *   count: { photos: count("InterventionPhoto", "interventionId") },
 * })
 * ```
 *
 * Dans le client cloisonné, chaque `$lookup` vers une collection porteuse
 * d'`orgId` est lui aussi restreint à l'organisation courante.
 */

type FieldName<N extends ModelName> = Exclude<keyof Models[N], "id"> & string;

export interface Spec<N extends ModelName = ModelName> {
  /** Champs à lire. `id` est toujours inclus. */
  fields?: readonly FieldName<N>[];
  /** Documents liés, par nom de propriété dans le résultat. */
  with?: Readonly<Record<string, Relation>>;
  /** Nombre de documents liés, rendus sous `_count`. */
  count?: Readonly<Record<string, CountRelation>>;
}

interface RelationBase<N extends ModelName, S extends Spec<N>> {
  from: N;
  /** Champ du document courant comparé à `foreign`. */
  local: string;
  /** Champ du document lié. */
  foreign: string;
  spec: S;
}

export interface OneRelation<
  N extends ModelName = ModelName,
  S extends Spec<N> = Spec<N>,
  Required extends boolean = boolean,
> extends RelationBase<N, S> {
  kind: "one";
  /** Absent en base alors que requis : on lève, comme le faisait Prisma. */
  required: Required;
}

export interface ManyRelation<
  N extends ModelName = ModelName,
  S extends Spec<N> = Spec<N>,
> extends RelationBase<N, S> {
  kind: "many";
  where?: Document;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

// Type « n'importe quelle relation » : la précision vit dans chaque relation
// construite par `one`, `many`… ; ici, il ne s'agit que de les accepter
// toutes dans `with`. Un `Spec<ModelName>` exact y serait trop étroit (ses
// champs seraient l'intersection de ceux de toutes les collections).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Relation = OneRelation<any, any, boolean> | ManyRelation<any, any>;

export interface CountRelation {
  kind: "count";
  from: ModelName;
  local: string;
  foreign: string;
  where?: Document;
}

/**
 * Document lié obligatoire, désigné par une clé étrangère du document
 * courant : `one("Customer", "customerId", …)`.
 */
export function one<const N extends ModelName, const S extends Spec<N>>(
  from: N,
  localKey: string,
  spec: S,
): OneRelation<N, S, true> {
  return { kind: "one", from, local: localKey, foreign: "_id", spec, required: true };
}

/** Document lié facultatif (clé étrangère qui peut être nulle). */
export function maybeOne<const N extends ModelName, const S extends Spec<N>>(
  from: N,
  localKey: string,
  spec: S,
): OneRelation<N, S, false> {
  return { kind: "one", from, local: localKey, foreign: "_id", spec, required: false };
}

/**
 * Document lié qui pointe vers le document courant, au plus un :
 * `backOne("Report", "interventionId", …)`.
 */
export function backOne<const N extends ModelName, const S extends Spec<N>>(
  from: N,
  foreignKey: string,
  spec: S,
): OneRelation<N, S, false> {
  return { kind: "one", from, local: "_id", foreign: foreignKey, spec, required: false };
}

/**
 * Documents liés qui pointent vers le document courant :
 * `many("Anomaly", "interventionId", …)`. `where` s'écrit comme un filtre
 * applicatif (identifiants en chaînes).
 */
export function many<const N extends ModelName, const S extends Spec<N>>(
  from: N,
  foreignKey: string,
  spec: S,
  options: {
    where?: Document;
    sort?: Partial<Record<keyof Models[N] & string, 1 | -1>>;
    limit?: number;
  } = {},
): ManyRelation<N, S> {
  return {
    kind: "many",
    from,
    local: "_id",
    foreign: foreignKey,
    spec,
    where: options.where,
    sort: options.sort as Record<string, 1 | -1> | undefined,
    limit: options.limit,
  };
}

/** Nombre de documents qui pointent vers le document courant. */
export function count(
  from: ModelName,
  foreignKey: string,
  where?: Document,
): CountRelation {
  return { kind: "count", from, local: "_id", foreign: foreignKey, where };
}

/** Fige une description réutilisable en gardant son type exact. */
export function spec<const N extends ModelName, const S extends Spec<N>>(
  _model: N,
  value: S,
): S {
  return value;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type FieldsOf<N extends ModelName, S> = S extends {
  fields: readonly (infer F)[];
}
  ? F & keyof Models[N]
  : never;

type RelationRow<R> =
  R extends OneRelation<infer N, infer S, infer Required>
    ? Required extends true
      ? Row<N, S>
      : Row<N, S> | null
    : R extends ManyRelation<infer N, infer S>
      ? Row<N, S>[]
      : never;

/** Forme d'un résultat, déduite de sa description. */
export type Row<N extends ModelName, S extends Spec<N>> = Simplify<
  { id: string } & { [K in FieldsOf<N, S>]: Models[N][K] } & (S extends {
      with: infer W;
    }
      ? { [K in keyof W]: RelationRow<W[K]> }
      : unknown) &
    (S extends { count: infer C } ? { _count: { [K in keyof C]: number } } : unknown)
>;

/** Projection finale : champs absents rendus à `null` (ou `[]`). */
function projection(model: ModelName, s: Spec): Document {
  const out: Document = { _id: 1 };
  const lists = LIST_FIELDS[model];
  for (const field of s.fields ?? []) {
    out[field] = { $ifNull: [`$${field}`, lists?.has(field) ? [] : null] };
  }
  for (const key of Object.keys(s.with ?? {})) out[key] = 1;
  if (s.count) out._count = 1;
  return out;
}

function tenantMatch(model: ModelName, orgId: ObjectId | null): Document[] {
  return orgId && TENANT_MODELS.has(model) ? [{ $match: { orgId } }] : [];
}

/** Étapes qui chargent relations et compteurs, puis projettent. */
export function shapeStages(
  model: ModelName,
  s: Spec,
  orgId: ObjectId | null,
): Document[] {
  const stages: Document[] = [];

  for (const [as, rel] of Object.entries(s.with ?? {})) {
    const inner: Document[] = [...tenantMatch(rel.from, orgId)];
    if (rel.kind === "many") {
      if (rel.where) inner.push({ $match: toFilter(rel.from, rel.where) });
      if (rel.sort) inner.push({ $sort: toSort(rel.sort) });
      if (rel.limit) inner.push({ $limit: rel.limit });
    } else {
      inner.push({ $limit: 1 });
    }
    inner.push(...shapeStages(rel.from, rel.spec, orgId));

    stages.push({
      $lookup: {
        from: rel.from,
        localField: rel.local,
        foreignField: rel.foreign,
        pipeline: inner,
        as,
      },
    });
    if (rel.kind === "one") {
      stages.push({ $set: { [as]: { $ifNull: [{ $first: `$${as}` }, null] } } });
    }
  }

  for (const [as, rel] of Object.entries(s.count ?? {})) {
    const tmp = `__count_${as}`;
    stages.push({
      $lookup: {
        from: rel.from,
        localField: rel.local,
        foreignField: rel.foreign,
        pipeline: [
          ...tenantMatch(rel.from, orgId),
          ...(rel.where ? [{ $match: toFilter(rel.from, rel.where) }] : []),
          { $count: "n" },
        ],
        as: tmp,
      },
    });
    stages.push({
      $set: { [`_count.${as}`]: { $ifNull: [{ $first: `$${tmp}.n` }, 0] } },
    });
  }

  stages.push({ $project: projection(model, s) });
  return stages;
}

/**
 * Vérifie les relations obligatoires. Aucune contrainte d'intégrité en base :
 * une relation requise introuvable est une incohérence qu'on refuse de
 * masquer, plutôt que d'afficher une carte à trous.
 */
export function assertRequired(
  model: ModelName,
  s: Spec,
  rows: Record<string, unknown>[],
): void {
  for (const [as, rel] of Object.entries(s.with ?? {})) {
    for (const row of rows) {
      const value = row[as];
      if (rel.kind === "one") {
        if (value === null) {
          if (rel.required) {
            throw new Error(
              `${model} ${String(row.id)} : relation obligatoire « ${as} » (${rel.from}) introuvable.`,
            );
          }
          continue;
        }
        assertRequired(rel.from, rel.spec, [value as Record<string, unknown>]);
      } else {
        assertRequired(rel.from, rel.spec, value as Record<string, unknown>[]);
      }
    }
  }
}
