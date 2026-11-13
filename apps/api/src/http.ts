import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, ForbiddenError, ValidationError } from "@vennora/core/errors";

/**
 * Conventions HTTP communes à toutes les routes.
 *
 * Réponse d'erreur : `{ error, code, fieldErrors? }`, avec le statut de
 * l'`AppError` levée — la même forme que les résultats d'action de
 * l'ancienne application, pour que les formulaires l'affichent tels quels.
 */

export interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

/** Valide une entrée avec un schéma zod, ou lève une `ValidationError`. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      "Vérifiez les champs en rouge.",
      z.flattenError(result.error).fieldErrors as Record<string, string[]>,
    );
  }
  return result.data;
}

export function registerHttpConventions(app: FastifyInstance): void {
  // Un corps JSON vide (DELETE, ou POST sans contenu envoyé avec l'en-tête
  // `application/json`) vaut « pas de corps », pas une erreur 400.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const error = new Error("Corps JSON illisible.") as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  /**
   * Garde CSRF. Le cookie de session est `SameSite=Lax`, ce qui bloque déjà
   * l'essentiel ; on exige en plus un en-tête maison sur toute écriture. Un
   * site tiers ne peut pas l'ajouter : le navigateur refuserait la requête
   * faute d'autorisation CORS, que l'API n'accorde à personne.
   */
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (request.headers["x-vennora"] !== "1") {
      throw new ForbiddenError("Requête refusée.");
    }
  });

  app.setErrorHandler((error, request, reply: FastifyReply) => {
    if (error instanceof AppError) {
      const body: ErrorBody = { error: error.message, code: error.code };
      if (error instanceof ValidationError) body.fieldErrors = error.fieldErrors;
      return reply.status(error.status).send(body);
    }

    // Erreurs de Fastify lui-même : corps illisible, fichier trop gros…
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: "Requête invalide.",
        code: (error as { code?: string }).code ?? "BAD_REQUEST",
      } satisfies ErrorBody);
    }

    // Les erreurs inattendues ne remontent jamais telles quelles : elles
    // peuvent contenir des fragments de requête ou d'URI de connexion.
    request.log.error(error, "erreur non gérée");
    return reply.status(500).send({
      error: "Une erreur est survenue. Réessayez dans un instant.",
      code: "INTERNAL",
    } satisfies ErrorBody);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: "Introuvable.", code: "NOT_FOUND" } satisfies ErrorBody),
  );
}
