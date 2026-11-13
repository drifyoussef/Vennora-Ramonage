import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { env, isProduction } from "./env";
import { registerHttpConventions } from "./http";
import { mongo } from "./mongo";
import { authRoutes } from "./routes/auth";
import { clientRoutes } from "./routes/clients";
import { documentRoutes } from "./routes/documents";
import { fileRoutes } from "./routes/files";
import { interventionRoutes } from "./routes/interventions";
import { referentielRoutes } from "./routes/referentiel";
import { suiviRoutes } from "./routes/suivi";

/**
 * Serveur de l'API.
 *
 * En développement, l'interface (Vite, port 5173) relaie `/api` vers ce
 * serveur : navigateur et API partagent donc la même origine, et le cookie de
 * session n'a besoin d'aucune exception CORS.
 */
export async function buildServer() {
  const app = Fastify({
    // En développement, seulement les avertissements et erreurs : une ligne
    // JSON par requête noie le terminal sans rien apprendre.
    logger: isProduction ? true : { level: "warn" },
    // Derrière un hébergeur, l'adresse du client arrive dans X-Forwarded-For.
    trustProxy: isProduction,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerHttpConventions(app);

  app.get("/api/sante", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(clientRoutes);
  await app.register(referentielRoutes);
  await app.register(interventionRoutes);
  await app.register(suiviRoutes);
  await app.register(documentRoutes);
  await app.register(fileRoutes);

  app.addHook("onClose", async () => {
    await mongo.close();
  });

  return app;
}

const app = await buildServer();
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
console.log(`[vennora] API prête sur http://localhost:${env.API_PORT}`);
