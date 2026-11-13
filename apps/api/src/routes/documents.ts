import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError } from "@vennora/core/errors";
import { exigerFonctionnalite } from "@vennora/core/plans";
import { objectId } from "@vennora/core/schemas";
import { requireContext } from "../context";
import { maybeOne } from "../db";
import { parse } from "../http";
import { sendMail } from "../services/mail";
import { readFileBytes } from "../services/storage";
import { audit } from "../tenant";

const sendSchema = z.object({
  to: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  message: z.string().trim().max(2000).optional(),
});

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Envoi d'un document au client, depuis sa fiche.
   *
   * On cherche rarement « l'intervention du 14 octobre » : on cherche un
   * client qui redemande son certificat. D'où ce chemin, qui part de la
   * fiche client et vaut pour tout document rangé là.
   *
   * La pièce voyage en pièce jointe : le destinataire la garde, sans lien
   * qui expire ni compte à créer.
   */
  app.post("/api/documents/:id/envoi", async (request) => {
    const context = await requireContext(request, "document.view");
    exigerFonctionnalite(context, "envoi-rapport");
    const { db, ctx, user } = context;
    const { id } = parse(z.object({ id: objectId }), request.params);
    const input = parse(sendSchema, request.body);

    // Lecture cloisonnée : c'est elle qui autorise, pas la clé de stockage.
    const document = await db.document.findOne(
      { id },
      {
        fields: ["name", "storageKey", "mimeType"],
        with: { customer: maybeOne("Customer", "customerId", { fields: ["name"] }) },
      },
    );
    if (!document) throw new NotFoundError("Document");

    const fichier = await readFileBytes(document.storageKey);
    const intro = input.message?.trim();

    const result = await sendMail({
      to: [input.to],
      replyTo: user.email,
      subject: `${document.name} — ${user.org.name}`,
      text: [
        `Bonjour${document.customer ? ` ${document.customer.name}` : ""},`,
        "",
        intro || `Vous trouverez ci-joint le document « ${document.name} ».`,
        "",
        "Cordialement,",
        user.org.name,
      ].join("\n"),
      attachments: [
        { filename: document.name, content: fichier, contentType: document.mimeType },
      ],
    });

    await audit(ctx, {
      action: "document.sent",
      entity: "Document",
      entityId: document.id,
      metadata: { to: input.to, name: document.name },
    });

    return { sentTo: input.to, driver: result.driver };
  });
}
