import type { FastifyInstance } from "fastify";
import JSZip from "jszip";
import { z } from "zod";
import { DocumentCategory } from "@vennora/core/enums";
import { ConflictError, NotFoundError, ValidationError } from "@vennora/core/errors";
import { decoderTexte, lireCsv } from "@vennora/core/csv";
import { exigerFonctionnalite } from "@vennora/core/plans";
import { objectId } from "@vennora/core/schemas";
import { requireContext } from "../context";
import { construireExport } from "../data/export";
import { analyserImport, reprendreClients } from "../data/import-clients";
import { parse } from "../http";
import { readMultipart } from "../multipart";
import { deleteFile, storeFile } from "../services/storage";
import { audit } from "../tenant";

/**
 * Fichiers métier : dépôt et suppression de documents, reprise d'un fichier
 * clients, export complet de l'organisation.
 */

const documentSchema = z.object({
  name: z.string().trim().max(200).optional(),
  category: z.enum(DocumentCategory).default(DocumentCategory.OTHER),
  customerId: objectId.optional().or(z.literal("")),
  siteId: objectId.optional().or(z.literal("")),
  equipmentId: objectId.optional().or(z.literal("")),
  interventionId: objectId.optional().or(z.literal("")),
});

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const IMPORT_MAX_LIGNES = 5000;

/**
 * Lit et analyse le fichier clients envoyé.
 *
 * Le fichier est relu à l'import plutôt que de faire l'aller-retour avec les
 * lignes analysées : ce qui revient du navigateur ne se croit pas sur parole.
 */
async function analyserEnvoi(request: Parameters<typeof readMultipart>[0]) {
  const { files } = await readMultipart(request);
  const fichier = files.find((f) => f.field === "fichier");
  if (!fichier) throw new ValidationError("Aucun fichier reçu.");
  if (fichier.body.length > IMPORT_MAX_BYTES) {
    throw new ValidationError("Fichier trop volumineux (5 Mo maximum).");
  }
  const { entetes, lignes } = lireCsv(decoderTexte(new Uint8Array(fichier.body)));
  if (entetes.length === 0) throw new ValidationError("Fichier vide ou illisible.");
  if (lignes.length > IMPORT_MAX_LIGNES) {
    throw new ValidationError(
      `Fichier trop long : ${lignes.length} lignes pour un maximum de ${IMPORT_MAX_LIGNES}. Découpez-le.`,
    );
  }
  return analyserImport(lignes, entetes);
}

export async function businessFileRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/documents", async (request) => {
    const { db, ctx, user } = await requireContext(request, "document.upload");
    const { fields, files } = await readMultipart(request);
    const file = files.find((f) => f.field === "file");
    if (!file) throw new ValidationError("Aucun fichier reçu.");

    const input = parse(documentSchema, fields);
    const empty = (v?: string) => (v && v.length > 0 ? v : null);
    const customerId = empty(input.customerId);
    const siteId = empty(input.siteId);
    const equipmentId = empty(input.equipmentId);
    const interventionId = empty(input.interventionId);
    if (!customerId && !siteId && !equipmentId && !interventionId) {
      throw new ValidationError("Rattachez le document à un client, un site ou un équipement.");
    }

    // Chaque référence est relue dans l'organisation : sinon un identifiant
    // recopié depuis une autre entreprise créerait un document orphelin
    // pointant chez le voisin.
    const checks = [
      ["Client", customerId, () => db.customer.exists({ id: customerId! })],
      ["Site", siteId, () => db.site.exists({ id: siteId! })],
      ["Équipement", equipmentId, () => db.equipment.exists({ id: equipmentId! })],
      ["Intervention", interventionId, () => db.intervention.exists({ id: interventionId! })],
    ] as const;
    for (const [label, id, exists] of checks) {
      if (id && !(await exists())) throw new NotFoundError(label);
    }

    const stored = await storeFile(
      {
        orgId: ctx.orgId,
        scope: "documents",
        ownerId: customerId ?? siteId ?? equipmentId ?? interventionId!,
        body: file.body,
        contentType: file.mimetype,
      },
      ["document", "image"],
    );
    const displayName =
      input.name?.trim() || file.filename.split(/[\\/]/).pop()?.slice(0, 200) || "Document";

    let id: string;
    try {
      ({ id } = await db.document.insert({
        orgId: ctx.orgId,
        customerId,
        siteId,
        equipmentId,
        interventionId,
        name: displayName,
        category: input.category,
        storageKey: stored.key,
        mimeType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        uploadedById: user.id,
      }));
    } catch (e) {
      // Pas de ligne en base : le fichier écrit n'a plus de raison d'être.
      await deleteFile(stored.key);
      throw e;
    }

    await audit(ctx, {
      action: "document.uploaded",
      entity: "Document",
      entityId: id,
      metadata: { name: displayName, category: input.category },
    });
    return { id };
  });

  app.delete("/api/documents/:id", async (request) => {
    const { db, ctx } = await requireContext(request, "document.delete");
    const { id } = parse(z.object({ id: objectId }), request.params);

    const document = await db.document.findOne(
      { id },
      { fields: ["name", "storageKey", "category", "interventionId"] },
    );
    if (!document) throw new NotFoundError("Document");
    if (document.category === DocumentCategory.REPORT && document.interventionId) {
      throw new ConflictError(
        "Ce rapport fait partie du dossier de l'intervention. Il ne se supprime pas depuis les documents.",
      );
    }

    await db.document.deleteMany({ id });
    await deleteFile(document.storageKey);
    await audit(ctx, {
      action: "document.deleted",
      entity: "Document",
      entityId: id,
      metadata: { name: document.name },
    });
    return { id };
  });

  /**
   * Reprise du fichier clients, en deux temps volontairement séparés :
   * l'analyse ne touche à rien et rend compte de ce qui a été compris ;
   * l'import écrit. Entre les deux, c'est l'utilisateur qui décide.
   */
  app.post("/api/clients/import/analyse", async (request) => {
    await requireContext(request, "customer.create");
    return analyserEnvoi(request);
  });

  app.post("/api/clients/import", async (request) => {
    const context = await requireContext(request, "customer.create");
    const analyse = await analyserEnvoi(request);
    const resultat = await reprendreClients(context, analyse);
    await audit(context.ctx, {
      action: "customers.imported",
      entity: "Customer",
      metadata: { ...resultat },
    });
    return resultat;
  });

  /** Export complet : CSV et PDF signés, dans une archive. */
  app.get("/api/export", async (request, reply) => {
    const context = await requireContext(request, "organization.manage");
    exigerFonctionnalite(context, "export");

    const fichiers = await construireExport(context);
    const zip = new JSZip();
    for (const f of fichiers) zip.file(f.chemin, f.contenu);
    const archive = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const jour = new Date().toISOString().slice(0, 10);
    const slug = context.user.org.name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return reply
      .headers({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="vennora-export-${slug}-${jour}.zip"`,
        "Cache-Control": "no-store",
      })
      .send(archive);
  });
}
