/**
 * Crée les index de la base (remplace `prisma db push`).
 *
 * Idempotent : les index existants, créés par Prisma ou par une exécution
 * précédente, sont reconnus à leur nom et laissés tels quels.
 *
 *   npm run db:indexes
 */
import { connectMongo, ensureIndexes } from "../src/db";
import { env } from "../src/env";

const mongo = connectMongo(env.DATABASE_URL);
try {
  const total = await ensureIndexes(mongo.database);
  console.log(`✔ ${total} index vérifiés sur la base « ${mongo.database.databaseName} ».`);
} catch (e) {
  console.error("✖ Échec de la création des index\n", e);
  process.exitCode = 1;
} finally {
  await mongo.close();
}
