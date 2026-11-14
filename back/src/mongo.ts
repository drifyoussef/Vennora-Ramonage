import { connectMongo } from "./db";
import { env } from "./env";

/**
 * Connexion MongoDB de l'API, ouverte une fois au démarrage du processus.
 * Le pool de connexions est partagé par toutes les requêtes.
 */
export const mongo = connectMongo(env.DATABASE_URL);

/**
 * Client racine, **sans cloisonnement**. Réservé à l'authentification
 * (recherche par e-mail avant que l'organisation soit connue), aux
 * catalogues métier partagés et à `tenant.ts`. Une route métier passe par le
 * `db` de son contexte (`request.context()`).
 */
export const rootDb = mongo.root;
