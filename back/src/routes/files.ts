import type { FastifyInstance } from "fastify";
import { currentUser } from "../context";
import { getStorage, keyBelongsToOrg } from "../services/storage";
import { verifyKey } from "../services/storage/signing";

/**
 * Service des fichiers stockés.
 *
 * Trois contrôles successifs, dans cet ordre :
 *
 *   1. la signature HMAC — l'URL a bien été émise par l'application ;
 *   2. l'expiration — elle n'a pas été mise en favori il y a trois semaines ;
 *   3. l'audience — pour une URL « tenant », une session de la bonne
 *      organisation est exigée en plus de la signature.
 *
 * Le troisième contrôle est ce qui distingue ce mécanisme d'une URL présignée
 * S3 classique : une capture d'écran de l'URL, ou une fuite par l'en-tête
 * `Referer`, ne suffit pas à ouvrir la photo d'un chantier.
 */
export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { "*": string }; Querystring: Record<string, string | undefined> }>(
    "/api/fichiers/*",
    async (request, reply) => {
      const key = request.params["*"].split("/").map(decodeURIComponent).join("/");
      const verified = verifyKey(key, {
        exp: request.query.exp ?? null,
        aud: request.query.aud ?? null,
        sig: request.query.sig ?? null,
      });

      if (!verified.ok) {
        // Même réponse pour une signature forgée et pour un lien périmé : la
        // distinction renseignerait un attaquant sur la validité de sa forge.
        return reply.status(403).type("text/plain").send("Lien invalide ou expiré.");
      }

      if (verified.audience === "tenant") {
        const user = await currentUser(request);
        if (!user) {
          return reply.status(401).type("text/plain").send("Authentification requise.");
        }
        if (!keyBelongsToOrg(key, user.orgId)) {
          return reply.status(404).type("text/plain").send("Fichier introuvable.");
        }
      }

      let body: Buffer;
      try {
        body = await (await getStorage()).get(key);
      } catch {
        return reply.status(404).type("text/plain").send("Fichier introuvable.");
      }

      return reply
        .headers({
          "Content-Type": contentTypeFor(key),
          "Content-Length": String(body.length),
          // `private` : ni un proxy d'entreprise ni un CDN ne doit conserver
          // la photo d'un chantier. `max-age` court, aligné sur le lien.
          "Cache-Control": "private, max-age=300, must-revalidate",
          // Un fichier téléversé ne doit jamais être interprété par le
          // navigateur, même si sa signature binaire a été acceptée.
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
        })
        .send(body);
    },
  );
}

/** Le type est déduit de l'extension, elle-même issue de la détection binaire. */
function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "pdf":
      return "application/pdf";
    case "webm":
      return "audio/webm";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}
