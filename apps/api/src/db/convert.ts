import { ObjectId, type Document } from "mongodb";
import { OBJECT_ID_FIELDS, type ModelName } from "./models";

/**
 * Passage entre la forme stockée et la forme applicative.
 *
 * En base : `_id` et clés étrangères en `ObjectId`. Dans l'application :
 * `id` et clés étrangères en chaînes, comme dans les URL et les formulaires.
 * Tout le reste du code ne manipule que la forme applicative.
 */

const HEX_ID = /^[0-9a-f]{24}$/i;

/** Vrai pour une chaîne qui a la forme d'un ObjectId. */
export function isObjectIdString(value: unknown): value is string {
  return typeof value === "string" && HEX_ID.test(value);
}

/** ObjectId depuis une chaîne. Lève sur une valeur malformée. */
export function oid(value: string): ObjectId {
  if (!isObjectIdString(value)) {
    throw new Error(`Identifiant invalide : « ${value} ».`);
  }
  return new ObjectId(value);
}

/**
 * Convertit une valeur de filtre visant un champ ObjectId.
 *
 * Une chaîne malformée est laissée telle quelle plutôt que de lever : une
 * chaîne n'est jamais égale à un ObjectId, le filtre ne trouve donc rien.
 * Un identifiant fantaisiste dans une URL donne « introuvable », pas une 500.
 */
function idValue(value: unknown): unknown {
  if (isObjectIdString(value)) return new ObjectId(value);
  if (Array.isArray(value)) return value.map(idValue);
  if (value && typeof value === "object" && !(value instanceof ObjectId)) {
    const out: Document = {};
    for (const [op, operand] of Object.entries(value)) {
      out[op] = op.startsWith("$") ? idValue(operand) : operand;
    }
    return out;
  }
  return value;
}

/** Filtre applicatif → filtre MongoDB. */
export function toFilter(model: ModelName, filter: Document): Document {
  const idFields = OBJECT_ID_FIELDS[model];
  const out: Document = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (key === "$or" || key === "$and" || key === "$nor") {
      out[key] = (value as Document[]).map((f) => toFilter(model, f));
    } else if (key === "id" || key === "_id") {
      out._id = idValue(value);
    } else if (idFields.has(key)) {
      out[key] = idValue(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Tri applicatif → tri MongoDB (`id` devient `_id`). */
export function toSort(sort: Record<string, 1 | -1>): Record<string, 1 | -1> {
  const out: Record<string, 1 | -1> = {};
  for (const [key, dir] of Object.entries(sort)) {
    out[key === "id" ? "_id" : key] = dir;
  }
  return out;
}

/**
 * Données applicatives → document à écrire.
 *
 * Les `undefined` sont ignorés (« ne pas toucher »), les `null` sont écrits.
 * Un identifiant malformé lève : à l'écriture, c'est un bug, pas une saisie.
 */
export function toDocument(model: ModelName, data: Document): Document {
  const idFields = OBJECT_ID_FIELDS[model];
  const out: Document = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (key === "id") {
      out._id = oid(value as string);
    } else if (idFields.has(key) && value !== null) {
      out[key] = Array.isArray(value)
        ? value.map((v) => oid(v as string))
        : oid(value as string);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Document lu → forme applicative, en profondeur : `_id` devient `id`, tout
 * ObjectId devient une chaîne. Les dates restent des dates.
 */
export function fromDocument<T>(value: unknown): T {
  return convertOut(value) as T;
}

function convertOut(value: unknown): unknown {
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(convertOut);
  if (value instanceof Date || value === null || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key === "_id" ? "id" : key] = convertOut(inner);
  }
  return out;
}

/** Vrai pour une violation d'index unique (l'ancien P2002 de Prisma). */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}
