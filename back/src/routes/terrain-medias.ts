import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TranscriptStatus } from "@vennora/shared/enums";
import { NotFoundError, ValidationError } from "@vennora/shared/errors";
import { exigerFonctionnalite } from "@vennora/shared/plans";
import { objectId } from "@vennora/shared/schemas";
import { getTrade } from "@vennora/shared/verticals/registry";
import { requireContext } from "../context";
import { requireEditableIntervention } from "../data/field";
import { parse } from "../http";
import { readMultipart } from "../multipart";
import { getTranscriptionProvider } from "../services/ai";
import { deleteFile, fileUrl, storeFile } from "../services/storage";
import { audit } from "../tenant";

const idParams = z.object({ id: objectId });

/** Photo telle que l'écran d'intervention l'affiche. */
export interface PhotoDto {
  id: string;
  url: string;
  caption: string | null;
  sizeBytes: number;
  createdAt: Date;
}

/** Note vocale telle que l'écran d'intervention l'affiche. */
export interface VoiceNoteDto {
  id: string;
  url: string;
  durationSec: number | null;
  transcript: string | null;
  transcriptStatus: TranscriptStatus;
  transcriptEdited: boolean;
  createdAt: Date;
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Ajoute une photo à une intervention.
   *
   * L'image est déjà compressée par le navigateur ; le serveur revalide
   * malgré tout sa signature binaire et sa taille — un client peut poster ce
   * qu'il veut, la compression n'est qu'un service rendu au réseau.
   *
   * L'équipement est recopié depuis l'intervention, jamais lu dans la
   * requête : c'est ce qui permet d'afficher la galerie d'un équipement sans
   * traverser toutes ses interventions.
   */
  app.post("/api/interventions/:id/photos", async (request): Promise<PhotoDto> => {
    const context = await requireContext(request, "intervention.update");
    const { db, ctx } = context;
    const { id: interventionId } = parse(idParams, request.params);
    const intervention = await requireEditableIntervention(context, interventionId);

    const { fields, files } = await readMultipart(request);
    const file = files.find((f) => f.field === "file");
    if (!file) throw new ValidationError("Aucun fichier reçu.");
    const caption = fields.caption?.trim().slice(0, 300) || null;

    const stored = await storeFile(
      {
        orgId: ctx.orgId,
        scope: "interventions",
        ownerId: intervention.id,
        body: file.body,
        contentType: file.mimetype,
      },
      ["image"],
    );

    // Le fichier est écrit avant la ligne en base : si la création échoue,
    // on efface le fichier pour ne pas laisser d'orphelin.
    const createdAt = new Date();
    let id: string;
    try {
      ({ id } = await db.interventionPhoto.insert({
        orgId: ctx.orgId,
        interventionId: intervention.id,
        equipmentId: intervention.equipmentId,
        storageKey: stored.key,
        mimeType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        caption,
        takenAt: createdAt,
        uploadedById: ctx.userId,
        createdAt,
      }));
    } catch (e) {
      await deleteFile(stored.key);
      throw e;
    }

    return { id, url: await fileUrl(stored.key), caption, sizeBytes: stored.sizeBytes, createdAt };
  });

  app.patch("/api/photos/:id", async (request) => {
    const context = await requireContext(request, "intervention.update");
    const { id } = parse(idParams, request.params);
    const { caption } = parse(z.object({ caption: z.string().max(2000) }), request.body);

    const photo = await context.db.interventionPhoto.findOne({ id }, { fields: ["interventionId"] });
    if (!photo?.interventionId) throw new NotFoundError("Photo");
    await requireEditableIntervention(context, photo.interventionId);

    await context.db.interventionPhoto.update({ id }, { caption: caption.trim().slice(0, 300) || null });
    return { id };
  });

  /**
   * Supprime une photo, puis son fichier. Dans cet ordre : un fichier
   * orphelin est un coût de stockage, une ligne pointant vers un fichier
   * absent est une image cassée dans un rapport.
   */
  app.delete("/api/photos/:id", async (request) => {
    const context = await requireContext(request, "intervention.update");
    const { db, ctx } = context;
    const { id } = parse(idParams, request.params);

    const photo = await db.interventionPhoto.findOne(
      { id },
      { fields: ["storageKey", "interventionId"] },
    );
    if (!photo?.interventionId) throw new NotFoundError("Photo");
    await requireEditableIntervention(context, photo.interventionId);

    await db.interventionPhoto.deleteMany({ id });
    await deleteFile(photo.storageKey);
    await audit(ctx, {
      action: "photo.deleted",
      entity: "InterventionPhoto",
      entityId: id,
      metadata: { interventionId: photo.interventionId },
    });
    return { id };
  });

  /** Notes libres saisies au clavier sur le terrain. */
  app.put("/api/interventions/:id/notes", async (request) => {
    const context = await requireContext(request, "intervention.update");
    const { id } = parse(idParams, request.params);
    const { notes } = parse(z.object({ notes: z.string().max(20_000) }), request.body);
    await requireEditableIntervention(context, id);
    await context.db.intervention.update({ id }, { notes: notes.trim().slice(0, 8000) || null });
    return { id };
  });

  /**
   * Enregistre une note vocale et lance sa transcription.
   *
   * Transcription synchrone : une dictée de chantier fait une à deux
   * minutes, la transcription prend quelques secondes, et le technicien
   * attend de toute façon le résultat pour le relire.
   *
   * Un échec de transcription ne perd jamais l'audio : la note est créée
   * d'abord, le statut passe à FAILED, et le technicien peut réécouter.
   */
  app.post("/api/interventions/:id/notes-vocales", async (request): Promise<VoiceNoteDto> => {
    const context = await requireContext(request, "intervention.update");
    // La note vocale n'a d'intérêt que transcrite : la garde est à l'entrée,
    // plutôt qu'après avoir stocké un fichier audio inexploitable.
    exigerFonctionnalite(context, "redaction-assistee");
    const { db, ctx, user } = context;
    const { id: interventionId } = parse(idParams, request.params);
    await requireEditableIntervention(context, interventionId);

    const { fields, files } = await readMultipart(request);
    const file = files.find((f) => f.field === "file");
    if (!file) throw new ValidationError("Aucun enregistrement reçu.");
    const rawDuration = Number(fields.durationSec);
    const durationSec =
      Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : null;

    const stored = await storeFile(
      {
        orgId: ctx.orgId,
        scope: "notes-vocales",
        ownerId: interventionId,
        body: file.body,
        contentType: file.mimetype,
      },
      ["audio"],
    );

    const createdAt = new Date();
    let id: string;
    try {
      ({ id } = await db.voiceNote.insert({
        orgId: ctx.orgId,
        interventionId,
        storageKey: stored.key,
        mimeType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        durationSec,
        transcriptStatus: TranscriptStatus.PROCESSING,
        createdById: user.id,
        createdAt,
      }));
    } catch (e) {
      await deleteFile(stored.key);
      throw e;
    }

    // Vocabulaire métier transmis au service : « débistrage » et
    // « boisseau » ne sont pas dans le vocabulaire courant d'un modèle
    // généraliste.
    const trade = getTrade(user.org.tradeSlug);
    const vocabulary = [
      ...trade.equipmentTypes.map((t) => t.label),
      ...trade.interventionTypes.map((t) => t.label),
      "conduit",
      "boisseau",
      "débistrage",
      "tubage",
      "tirage",
      "chapeau",
      "trappe de ramonage",
    ];

    let transcript: string | null = null;
    let transcriptStatus: TranscriptStatus = TranscriptStatus.DONE;
    let transcriptError: string | null = null;
    try {
      const provider = await getTranscriptionProvider();
      const result = await provider.transcribe({
        audio: file.body,
        mimeType: stored.contentType,
        language: "fr",
        vocabulary,
      });
      transcript = result.text;
    } catch (e) {
      transcriptStatus = TranscriptStatus.FAILED;
      transcriptError = e instanceof Error ? e.message : "Transcription impossible.";
    }

    await db.voiceNote.update({ id }, { transcript, transcriptStatus, transcriptError });
    await audit(ctx, {
      action: "voiceNote.added",
      entity: "VoiceNote",
      entityId: id,
      metadata: { interventionId, status: transcriptStatus },
    });

    return {
      id,
      url: await fileUrl(stored.key),
      durationSec,
      transcript,
      transcriptStatus,
      transcriptEdited: false,
      createdAt,
    };
  });

  /**
   * Corrige la transcription. Le technicien doit pouvoir modifier le texte ;
   * la note est marquée comme éditée, pour qu'on sache qu'un humain est passé.
   */
  app.patch("/api/notes-vocales/:id", async (request) => {
    const context = await requireContext(request, "intervention.update");
    const { id } = parse(idParams, request.params);
    const { transcript } = parse(z.object({ transcript: z.string().max(20_000) }), request.body);

    const note = await context.db.voiceNote.findOne({ id }, { fields: ["interventionId"] });
    if (!note) throw new NotFoundError("Note vocale");
    await requireEditableIntervention(context, note.interventionId);

    await context.db.voiceNote.update(
      { id },
      {
        transcript: transcript.trim().slice(0, 8000) || null,
        transcriptStatus: TranscriptStatus.DONE,
        transcriptEdited: true,
        transcriptError: null,
      },
    );
    return { id };
  });

  app.delete("/api/notes-vocales/:id", async (request) => {
    const context = await requireContext(request, "intervention.update");
    const { id } = parse(idParams, request.params);

    const note = await context.db.voiceNote.findOne(
      { id },
      { fields: ["interventionId", "storageKey"] },
    );
    if (!note) throw new NotFoundError("Note vocale");
    await requireEditableIntervention(context, note.interventionId);

    await context.db.voiceNote.deleteMany({ id });
    await deleteFile(note.storageKey);
    return { id };
  });
}
