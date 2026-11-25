import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { env, isProduction } from "./env";
import { registerHttpConventions } from "./http";
import { mongo } from "./mongo";
import { abonnementRoutes, registerGardeLectureSeule } from "./routes/abonnement";
import { authRoutes } from "./routes/auth";
import { clientRoutes } from "./routes/clients";
import { documentRoutes } from "./routes/documents";
import { equipeRoutes } from "./routes/equipe";
import { businessFileRoutes } from "./routes/fichiers-metier";
import { fileRoutes } from "./routes/files";
import { interventionRoutes } from "./routes/interventions";
import { interventionWriteRoutes } from "./routes/interventions-ecriture";
import { referentielRoutes } from "./routes/referentiel";
import { suiviRoutes } from "./routes/suivi";
import { anomalyRoutes } from "./routes/terrain-anomalies";
import { mediaRoutes } from "./routes/terrain-medias";
import { reportRoutes } from "./routes/terrain-rapport";

/**
 * Serveur de l'API.
 *
 * En développement, l'interface (Vite, port 5173) relaie `/api` vers ce
 * serveur. En production, c'est ce serveur qui sert l'interface construite
 * (`npm run build` → front/dist). Dans les deux cas, navigateur et API
 * partagent la même origine : le cookie de session n'a besoin d'aucune
 * exception CORS.
 */

/** Interface construite par Vite, servie si elle existe. */
const WEB_DIST = path.resolve(import.meta.dirname, "../../front/dist");
export async function buildServer() {
  const app = Fastify({
    // En développement, seulement les avertissements et erreurs : une ligne
    // JSON par requête noie le terminal sans rien apprendre.
    logger: isProduction ? true : { level: "warn" },
    // Derrière un hébergeur, l'adresse du client arrive dans X-Forwarded-For.
    trustProxy: isProduction,
    // Corps JSON jusqu'à 3 Mo : une signature arrive en image PNG encodée
    // (jusqu'à 2 Mo de texte). Les fichiers, eux, passent en multipart, avec
    // leur propre limite (voir multipart.ts).
    bodyLimit: 3 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // Les limites de taille sont fixées à la lecture (voir multipart.ts).
  await app.register(multipart);
  const spa = existsSync(path.join(WEB_DIST, "index.html"));
  registerHttpConventions(app, { spa });
  if (spa) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      index: false,
      wildcard: false,
      // Fichiers de assets/ : nom haché par Vite, donc immuables.
      setHeaders: (reply, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
    app.get("/", (_request, reply) => reply.header("Cache-Control", "no-cache").sendFile("index.html"));
  }

  // Avant toute route : une entreprise en lecture seule n'écrit plus rien.
  registerGardeLectureSeule(app);
  app.get("/api/sante", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(clientRoutes);
  await app.register(referentielRoutes);
  await app.register(interventionRoutes);
  await app.register(interventionWriteRoutes);
  await app.register(suiviRoutes);
  await app.register(documentRoutes);
  await app.register(equipeRoutes);
  await app.register(businessFileRoutes);
  await app.register(anomalyRoutes);
  await app.register(mediaRoutes);
  await app.register(reportRoutes);
  await app.register(fileRoutes);
  await app.register(abonnementRoutes);

  app.addHook("onClose", async () => {
    await mongo.close();
  });

  return app;
}

const app = await buildServer();
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
console.log(`[vennora] API prête sur http://localhost:${env.API_PORT}`);
