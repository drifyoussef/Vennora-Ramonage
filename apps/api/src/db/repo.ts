import type { Collection, Db, Document, Filter, ObjectId } from "mongodb";
import { fromDocument, oid, toDocument, toFilter, toSort } from "./convert";
import {
  ACCESSORS,
  DEFAULTS,
  TENANT_MODELS,
  TIMESTAMPS,
  type Accessors,
  type Changes,
  type Insert,
  type ModelName,
  type Models,
} from "./models";
import { assertRequired, shapeStages, type Row, type Spec } from "./query";

/**
 * Accès à une collection.
 *
 * Toutes les lectures et écritures passent par ici, pour trois raisons :
 * la conversion des identifiants (`convert.ts`), les valeurs par défaut et
 * horodatages (`models.ts`), et le cloisonnement — quand `orgId` est fourni,
 * il est injecté dans le filtre de chaque lecture et de chaque écriture, et
 * dans chaque document créé, pour les collections porteuses d'un tenant.
 *
 * Le cloisonnement **écrase** un `orgId` fourni par l'appelant : une Server
 * Action ne doit jamais pouvoir viser une autre organisation en glissant un
 * `orgId` dans son payload.
 */

export type Where<N extends ModelName> = Filter<Models[N]>;
export type SortOf<N extends ModelName> = Partial<
  Record<keyof Models[N] & string, 1 | -1>
>;

export interface FindOptions<N extends ModelName> {
  sort?: SortOf<N>;
  skip?: number;
  limit?: number;
}

export interface UpdateOps<N extends ModelName> {
  /** Incrémente des champs numériques. */
  inc?: Partial<Record<keyof Models[N] & string, number>>;
  /** Ajoute en fin de champs tableau. */
  push?: Partial<Record<keyof Models[N] & string, unknown>>;
}

export class Repo<N extends ModelName> {
  readonly collection: Collection<Document>;
  private readonly scoped: boolean;

  constructor(
    db: Db,
    readonly model: N,
    private readonly orgId: ObjectId | null,
  ) {
    this.collection = db.collection(model);
    this.scoped = orgId !== null && TENANT_MODELS.has(model);
  }

  /** Filtre applicatif → filtre MongoDB, restreint à l'organisation. */
  private filter(where: Where<N> | Document): Document {
    const converted = toFilter(this.model, where as Document);
    return this.scoped ? { ...converted, orgId: this.orgId } : converted;
  }

  private changes(data: Document): Document {
    const set = toDocument(this.model, data);
    delete set._id;
    delete set.orgId;
    delete set.createdAt;
    if (TIMESTAMPS[this.model].updatedAt) set.updatedAt = new Date();
    return set;
  }

  /** Document complet à créer : défauts, horodatages, organisation. */
  private creation(data: Insert<N>): Document {
    const now = new Date();
    const full: Document = {};
    for (const [key, value] of Object.entries(DEFAULTS[this.model])) {
      full[key] = typeof value === "function" ? (value as () => unknown)() : value;
    }
    Object.assign(full, stripUndefined(data as Document));
    const ts = TIMESTAMPS[this.model];
    if (ts.createdAt) full.createdAt ??= now;
    if (ts.updatedAt) full.updatedAt ??= now;
    const doc = toDocument(this.model, full);
    if (this.scoped) doc.orgId = this.orgId;
    return doc;
  }

  /** Documents correspondant au filtre, avec relations selon `spec`. */
  async find<const S extends Spec<N>>(
    where: Where<N>,
    spec: S,
    options: FindOptions<N> = {},
  ): Promise<Row<N, S>[]> {
    const pipeline: Document[] = [{ $match: this.filter(where) }];
    if (options.sort) pipeline.push({ $sort: toSort(options.sort as Record<string, 1 | -1>) });
    if (options.skip) pipeline.push({ $skip: options.skip });
    if (options.limit) pipeline.push({ $limit: options.limit });
    // La description est typée finement pour le résultat ; à l'exécution,
    // seule sa structure compte.
    const shape = spec as unknown as Spec;
    pipeline.push(...shapeStages(this.model, shape, this.scoped ? this.orgId : null));

    const docs = await this.collection.aggregate(pipeline).toArray();
    const rows = fromDocument<Record<string, unknown>[]>(docs);
    assertRequired(this.model, shape, rows);
    return rows as Row<N, S>[];
  }

  /** Premier document correspondant, ou `null`. */
  async findOne<const S extends Spec<N>>(
    where: Where<N>,
    spec: S,
    options: Omit<FindOptions<N>, "limit"> = {},
  ): Promise<Row<N, S> | null> {
    const [row] = await this.find(where, spec, { ...options, limit: 1 });
    return row ?? null;
  }

  async count(where: Where<N> = {}): Promise<number> {
    return this.collection.countDocuments(this.filter(where));
  }

  async exists(where: Where<N>): Promise<boolean> {
    const doc = await this.collection.findOne(this.filter(where), {
      projection: { _id: 1 },
    });
    return doc !== null;
  }

  /** Valeurs distinctes d'un champ. Les ObjectId reviennent en chaînes. */
  async distinct<K extends keyof Models[N] & string>(
    field: K,
    where: Where<N> = {},
  ): Promise<NonNullable<Models[N][K]>[]> {
    const values = await this.collection.distinct(
      field === "id" ? "_id" : field,
      this.filter(where),
    );
    return fromDocument<unknown[]>(values).filter(
      (v) => v !== null,
    ) as NonNullable<Models[N][K]>[];
  }

  /** Crée un document. Rend son identifiant. */
  async insert(data: Insert<N>): Promise<{ id: string }> {
    const doc = this.creation(data);
    const result = await this.collection.insertOne(doc);
    return { id: result.insertedId.toHexString() };
  }

  async insertMany(data: Insert<N>[]): Promise<string[]> {
    if (data.length === 0) return [];
    const docs = data.map((d) => this.creation(d));
    const result = await this.collection.insertMany(docs);
    return Object.values(result.insertedIds).map((id) => id.toHexString());
  }

  /** Modifie le premier document correspondant. Rend le nombre trouvé (0 ou 1). */
  async update(
    where: Where<N>,
    changes: Changes<N>,
    ops: UpdateOps<N> = {},
  ): Promise<number> {
    const result = await this.collection.updateOne(
      this.filter(where),
      this.updateDocument(changes, ops),
    );
    return result.matchedCount;
  }

  async updateMany(
    where: Where<N>,
    changes: Changes<N>,
    ops: UpdateOps<N> = {},
  ): Promise<number> {
    const result = await this.collection.updateMany(
      this.filter(where),
      this.updateDocument(changes, ops),
    );
    return result.matchedCount;
  }

  /**
   * Met à jour ou crée. `create` porte le document complet à créer ; les
   * champs que `update` modifie en sont retirés à la création, MongoDB
   * refusant de toucher deux fois au même champ. Rend le document après
   * écriture, lu selon `spec`.
   */
  async upsert<const S extends Spec<N>>(
    where: Where<N>,
    args: { create: Insert<N>; update?: Changes<N> } & UpdateOps<N>,
    spec: S,
  ): Promise<Row<N, S>> {
    const update = this.updateDocument(args.update ?? {}, args);
    const touched = new Set([
      ...Object.keys(update.$set ?? {}),
      ...Object.keys(update.$inc ?? {}),
      ...Object.keys(update.$push ?? {}),
    ]);
    const onInsert = this.creation(args.create);
    for (const key of touched) delete onInsert[key];
    delete onInsert._id;

    const filter = this.filter(where);
    await this.collection.updateOne(
      filter,
      { ...update, $setOnInsert: onInsert },
      { upsert: true },
    );
    const row = await this.findOne(where, spec);
    if (!row) throw new Error(`${this.model} : document introuvable après upsert.`);
    return row;
  }

  /** Supprime le premier document correspondant. Rend 0 ou 1. */
  async delete(where: Where<N>): Promise<number> {
    const result = await this.collection.deleteOne(this.filter(where));
    return result.deletedCount;
  }

  async deleteMany(where: Where<N>): Promise<number> {
    const result = await this.collection.deleteMany(this.filter(where));
    return result.deletedCount;
  }

  /**
   * Pipeline d'agrégation libre, précédé du filtre d'organisation. Les
   * identifiants des `$match` doivent être des ObjectId (voir `oid`) ; le
   * résultat est rendu en forme applicative.
   */
  async aggregate<R>(pipeline: Document[]): Promise<R[]> {
    const head = this.scoped ? [{ $match: { orgId: this.orgId } }] : [];
    const docs = await this.collection.aggregate([...head, ...pipeline]).toArray();
    return fromDocument<R[]>(docs);
  }

  private updateDocument(changes: Changes<N>, ops: UpdateOps<N>): Document {
    const update: Document = {};
    const set = this.changes(changes as Document);
    if (Object.keys(set).length > 0) update.$set = set;
    if (ops.inc && Object.keys(ops.inc).length > 0) update.$inc = ops.inc;
    if (ops.push && Object.keys(ops.push).length > 0) update.$push = ops.push;
    return update;
  }
}

function stripUndefined(data: Document): Document {
  const out: Document = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export type Repos = { [A in keyof Accessors]: Repo<Accessors[A]> } & {
  /** Organisation visée, ou `null` pour le client racine. */
  readonly orgId: string | null;
};

/**
 * Un accesseur par collection. Avec `orgId`, client cloisonné à cette
 * organisation ; sans, client racine (authentification, seed, scripts).
 */
export function createRepos(db: Db, orgId: string | null): Repos {
  const scope = orgId === null ? null : oid(orgId);
  const repos: Record<string, unknown> = { orgId };
  for (const [accessor, model] of Object.entries(ACCESSORS)) {
    repos[accessor] = new Repo(db, model, scope);
  }
  return repos as Repos;
}
