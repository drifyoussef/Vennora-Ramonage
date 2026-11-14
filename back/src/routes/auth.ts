import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UnauthorizedError } from "@vennora/shared/errors";
import { verifyPasswordConstantTime } from "../auth/password";
import {
  loadCurrentUser,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "../auth/session";
import { currentUser } from "../context";
import { one } from "../db";
import { parse } from "../http";
import { rootDb } from "../mongo";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/** Message unique : ne jamais dire si c'est l'e-mail ou le mot de passe. */
const INVALID = "E-mail ou mot de passe incorrect.";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/auth/connexion",
    // Dix essais par minute et par adresse : assez pour une faute de frappe,
    // trop peu pour deviner un mot de passe.
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { email, password } = parse(credentialsSchema, request.body);

      const user = await rootDb.user.findOne(
        { email },
        {
          fields: ["passwordHash", "active", "orgId"],
          with: {
            org: one("Organization", "orgId", {
              with: { trade: one("Trade", "tradeId", { fields: ["slug"] }) },
            }),
          },
        },
      );

      // Toujours passer par la comparaison, même sans utilisateur trouvé :
      // sinon le temps de réponse indique quels e-mails existent.
      const valid = await verifyPasswordConstantTime(password, user?.passwordHash);
      if (!user || !valid || !user.active) throw new UnauthorizedError(INVALID);

      const claims = {
        uid: user.id,
        orgId: user.orgId,
        tradeSlug: user.org.trade.slug,
      };
      const token = await signSession(claims);
      const me = await loadCurrentUser({
        ...claims,
        iat: Math.floor(Date.now() / 1000),
      });
      if (!me) throw new UnauthorizedError(INVALID);

      // Non bloquant : un échec d'écriture ne doit pas empêcher la connexion.
      rootDb.user.update({ id: user.id }, { lastLoginAt: new Date() }).catch(() => {});

      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
      return { user: me };
    },
  );

  app.post("/api/auth/deconnexion", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/api/auth/moi", async (request) => {
    const user = await currentUser(request);
    if (!user) throw new UnauthorizedError();
    return { user };
  });
}
