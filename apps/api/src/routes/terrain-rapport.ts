import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InterventionStatus, ReportOrigin, UserRole } from "@vennora/core/enums";
import { AppError, ConflictError, NotFoundError } from "@vennora/core/errors";
import { formatDate } from "@vennora/core/format";
import { exigerFonctionnalite } from "@vennora/core/plans";
import { objectId } from "@vennora/core/schemas";
import { currentUser, requireContext } from "../context";
import { refreshCustomerDates } from "../data/customers";
import { refreshEquipmentDates } from "../data/equipment";
import { requireEditableIntervention, requireVisibleIntervention } from "../data/field";
import { buildPdfData, buildReportContext, loadReportData } from "../data/report";
import { publishReportPdf, withdrawReportPdf } from "../data/report-pdf";
import { parse } from "../http";
import { getReportGenerator } from "../services/ai";
import { sendMail } from "../services/mail";
import { renderReportPdf } from "../services/pdf";
import { deleteFile, fileUrl, readFileBytes, storeFile } from "../services/storage";
import { audit, tenantDb } from "../tenant";

const idParams = z.object({ id: objectId });

const SECTION_KEYS = [
  "summary",
  "workDone",
  "equipmentState",
  "anomaliesSummary",
  "recommendations",
  "futureWork",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type ReportSectionValues = Record<SectionKey, string>;

const sectionsSchema = z.object(
  Object.fromEntries(SECTION_KEYS.map((k) => [k, z.string().max(8000).default("")])) as Record<
    SectionKey,
    z.ZodDefault<z.ZodString>
  >,
);

const signatureSchema = z.object({
  signerName: z.string().trim().min(2, "Renseignez le nom du signataire.").max(120),
  /** PNG produit par le canvas, en data URI. */
  image: z
    .string()
    .startsWith("data:image/png;base64,", "Signature invalide.")
    .max(2_000_000, "Signature trop volumineuse."),
});

const sendSchema = z.object({
  to: z.string().trim().email("Adresse e-mail invalide."),
  message: z.string().trim().max(2000).optional(),
});

const completeSchema = z.object({
  nextInterventionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  /**
   * La même date, en instant calculé par le navigateur (9 h dans le fuseau
   * de l'utilisateur). Sans lui, « 9 h » serait celle du serveur.
   */
  prochaine: z.coerce.date().optional(),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Génère un brouillon de compte-rendu.
   *
   * Le résultat est **toujours** un brouillon : `validatedAt` reste nul, et
   * aucun envoi n'est possible tant qu'un humain n'a pas validé. C'est la
   * règle la plus importante du produit — un texte produit par un modèle ne
   * part jamais seul chez un client.
   */
  app.post("/api/interventions/:id/rapport/brouillon", async (request) => {
    const context = await requireContext(request, "report.edit");
    exigerFonctionnalite(context, "redaction-assistee");
    const { db, ctx } = context;
    const { id } = parse(idParams, request.params);
    await requireEditableIntervention(context, id);

    const data = await loadReportData(context, id);
    const promptContext = await buildReportContext(context, data);
    const generated = await (await getReportGenerator()).generate(promptContext);

    const sections: ReportSectionValues = {
      summary: generated.summary,
      workDone: generated.workDone,
      equipmentState: generated.equipmentState,
      anomaliesSummary: generated.anomaliesSummary,
      recommendations: generated.recommendations,
      futureWork: generated.futureWork,
    };
    const generation = {
      ...sections,
      origin: generated.provider === "mock" ? ReportOrigin.MANUAL : ReportOrigin.AI,
      aiModel: generated.model,
      aiGeneratedAt: new Date(),
      // Le texte soumis au modèle est conservé : sans lui, impossible de
      // comprendre après coup pourquoi une phrase a été écrite.
      aiSourceText: promptContext.rawNotes.join("\n"),
    };

    // Création ou régénération, sans `upsert` : MongoDB appliquerait
    // l'incrément dès la création, et un premier brouillon compterait pour
    // une régénération.
    const updated = await db.report.update(
      { interventionId: id },
      // Toute régénération invalide la validation précédente.
      { ...generation, validatedAt: null, validatedById: null },
      { inc: { regenerations: 1 } },
    );
    if (updated === 0) {
      await db.report.insert({ orgId: ctx.orgId, interventionId: id, ...generation });
    }

    await audit(ctx, {
      action: "report.generated",
      entity: "Report",
      entityId: id,
      metadata: { provider: generated.provider, model: generated.model },
    });
    return { ...sections, provider: generated.provider };
  });

  /** Enregistre les sections telles que le technicien les a corrigées. */
  app.put("/api/interventions/:id/rapport", async (request) => {
    const context = await requireContext(request, "report.edit");
    const { id } = parse(idParams, request.params);
    await requireEditableIntervention(context, id);
    const sections = parse(sectionsSchema, request.body);

    await context.db.report.upsert(
      { interventionId: id },
      {
        create: { orgId: context.ctx.orgId, interventionId: id, ...sections },
        // Une modification manuelle annule la validation : le texte validé et
        // le texte enregistré doivent toujours être le même.
        update: { ...sections, validatedAt: null, validatedById: null },
      },
      {},
    );
    return { id };
  });

  /**
   * Validation humaine, puis génération du PDF. C'est la seule porte par
   * laquelle un compte-rendu devient envoyable.
   */
  app.post("/api/interventions/:id/rapport/validation", async (request) => {
    const context = await requireContext(request, "report.edit");
    const { ctx, user } = context;
    const { id } = parse(idParams, request.params);
    await requireEditableIntervention(context, id);
    const sections = parse(sectionsSchema, request.body);

    if (!sections.summary.trim() || !sections.workDone.trim()) {
      throw new ConflictError(
        "Le résumé et les travaux réalisés doivent être renseignés avant validation.",
      );
    }

    const validation = { ...sections, validatedAt: new Date(), validatedById: user.id };
    await context.db.report.upsert(
      { interventionId: id },
      { create: { orgId: ctx.orgId, interventionId: id, ...validation }, update: validation },
      {},
    );

    const stored = await publishReportPdf(context, id);
    const data = await loadReportData(context, id);
    await audit(ctx, {
      action: "report.validated",
      entity: "Report",
      entityId: id,
      metadata: { reference: data.reference },
    });
    return { pdfUrl: await fileUrl(stored.key) };
  });

  /**
   * Régénère le PDF d'un compte-rendu déjà validé.
   *
   * Gardée par `requireVisibleIntervention` et non par
   * `requireEditableIntervention` : régénérer ne touche pas au contenu,
   * seulement au fichier qui l'imprime. Sans elle, une intervention close
   * dont le PDF a disparu serait une impasse.
   */
  app.post("/api/interventions/:id/rapport/pdf", async (request) => {
    const context = await requireContext(request, "report.edit");
    const { id } = parse(idParams, request.params);
    await requireVisibleIntervention(context, id);

    const report = await context.db.report.findOne({ interventionId: id }, { fields: ["validatedAt"] });
    if (!report?.validatedAt) {
      throw new ConflictError(
        "Le compte-rendu doit avoir été validé pour qu'un PDF puisse être régénéré.",
      );
    }

    const stored = await publishReportPdf(context, id);
    await audit(context.ctx, { action: "report.pdf_regenerated", entity: "Report", entityId: id });
    return { pdfUrl: await fileUrl(stored.key) };
  });

  /**
   * Envoie le rapport au client. Refusé tant que le rapport n'est pas
   * validé : c'est là que la règle cesse d'être une intention et devient
   * une contrainte technique.
   */
  app.post("/api/interventions/:id/rapport/envoi", async (request) => {
    const context = await requireContext(request, "report.send");
    exigerFonctionnalite(context, "envoi-rapport");
    const { db, ctx } = context;
    const { id } = parse(idParams, request.params);
    await requireVisibleIntervention(context, id);
    const input = parse(sendSchema, request.body);

    const data = await loadReportData(context, id);
    if (!data.report?.validatedAt) {
      request.log.warn(`envoi refusé pour ${data.reference} : compte-rendu non validé`);
      throw new ConflictError(
        "Le compte-rendu doit être relu et validé avant d'être envoyé au client.",
      );
    }
    if (!data.report.pdfKey) {
      request.log.warn(`envoi refusé pour ${data.reference} : aucun PDF associé`);
      throw new AppError("Le PDF n'a pas été généré.", "NO_PDF", 409);
    }

    const pdf = await readFileBytes(data.report.pdfKey);
    const intro = input.message?.trim();
    const result = await sendMail({
      to: [input.to],
      replyTo: data.org.email ?? undefined,
      subject: `Rapport d'intervention du ${formatDate(data.scheduledStart)} — ${data.org.name}`,
      text: [
        `Bonjour ${data.customer.name},`,
        "",
        intro ||
          `Vous trouverez ci-joint le rapport de l'intervention réalisée le ${formatDate(data.scheduledStart)} sur le site ${data.site.name}.`,
        "",
        data.nextInterventionAt
          ? `Prochaine intervention conseillée : ${formatDate(data.nextInterventionAt)}.`
          : null,
        "",
        "Cordialement,",
        data.org.name,
        [data.org.phone, data.org.email].filter(Boolean).join(" · "),
      ]
        .filter((l) => l !== null)
        .join("\n"),
      attachments: [
        { filename: `Rapport ${data.reference}.pdf`, content: pdf, contentType: "application/pdf" },
      ],
    });

    await db.report.updateMany(
      { interventionId: id },
      { sentAt: new Date() },
      { push: { sentTo: input.to } },
    );
    await audit(ctx, {
      action: "report.sent",
      entity: "Report",
      entityId: id,
      metadata: { to: input.to, driver: result.driver },
    });
    return { sentTo: input.to, driver: result.driver };
  });

  /**
   * Aperçu du rapport, généré à la volée : le technicien voit exactement ce
   * que le client recevra, sans avoir à valider pour le découvrir. Le PDF
   * officiel, lui, est celui figé à la validation et stocké.
   *
   * `?telecharger=1` force le téléchargement plutôt que l'affichage.
   */
  app.get("/api/interventions/:id/rapport/apercu", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.status(401).type("text/plain").send("Authentification requise.");
    const parsed = objectId.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) return reply.status(404).type("text/plain").send("Intervention introuvable.");

    const db = tenantDb({ orgId: user.orgId });
    // Le client cloisonné borne déjà à l'organisation ; on ajoute la règle
    // métier : un technicien ne voit que ses propres interventions.
    const scope = await db.intervention.findOne({ id: parsed.data }, { fields: ["technicianId"] });
    if (!scope || (user.role === UserRole.TECHNICIAN && scope.technicianId !== user.id)) {
      return reply.status(404).type("text/plain").send("Intervention introuvable.");
    }

    const context = { user, ctx: { orgId: user.orgId, userId: user.id, role: user.role }, db };
    const data = await loadReportData(context, parsed.data);
    const pdf = await renderReportPdf(await buildPdfData(data));
    const download = "telecharger" in (request.query as object);

    return reply
      .headers({
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="Rapport ${data.reference}.pdf"`,
        // Un aperçu reflète l'état courant : jamais servi depuis un cache.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(pdf);
  });

  /**
   * Enregistre la signature du client.
   *
   * Une seule signature par intervention : re-signer remplace la précédente,
   * fichier compris. L'adresse IP est une trace, pas une preuve — Fastify ne
   * lit `X-Forwarded-For` que derrière l'hébergeur (voir `trustProxy`).
   */
  app.post("/api/interventions/:id/signature", async (request) => {
    const context = await requireContext(request, "intervention.complete");
    const { db, ctx } = context;
    const { id } = parse(idParams, request.params);
    await requireEditableIntervention(context, id);
    const input = parse(signatureSchema, request.body);

    const body = Buffer.from(input.image.split(",", 2)[1] ?? "", "base64");
    const stored = await storeFile(
      { orgId: ctx.orgId, scope: "signatures", ownerId: id, body, contentType: "image/png" },
      ["image"],
    );

    const existing = await db.signature.findOne({ interventionId: id }, { fields: ["storageKey"] });
    const signedAt = new Date();
    const ipAddress = request.ip?.slice(0, 64) ?? null;
    const userAgent = request.headers["user-agent"]?.slice(0, 300) ?? null;

    if (existing) {
      await db.signature.update(
        { interventionId: id },
        { signerName: input.signerName, storageKey: stored.key, signedAt, ipAddress, userAgent },
      );
      await deleteFile(existing.storageKey);
    } else {
      await db.signature.insert({
        orgId: ctx.orgId,
        interventionId: id,
        signerName: input.signerName,
        storageKey: stored.key,
        signedAt,
        ipAddress,
        userAgent,
      });
    }

    // Le PDF imprimé avant la signature ne la montre pas : il est caduc. On
    // le reconstruit aussitôt à partir du compte-rendu validé — la
    // validation reste acquise, seule la signature s'y ajoute.
    const report = await db.report.findOne(
      { interventionId: id },
      { fields: ["pdfKey", "validatedAt"] },
    );
    if (report?.validatedAt) {
      await publishReportPdf(context, id);
    } else if (report?.pdfKey) {
      // Compte-rendu retombé en brouillon : rien à publier, on retire le
      // fichier et la ligne de document qui l'annonçait.
      await withdrawReportPdf(context, id, report.pdfKey);
    }

    await audit(ctx, {
      action: "signature.captured",
      entity: "Signature",
      entityId: id,
      metadata: { signerName: input.signerName },
      ipAddress: ipAddress ?? undefined,
    });
    return { signedAt, signerName: input.signerName };
  });

  /**
   * Clôture l'intervention.
   *
   * Exige la signature du client et un rapport validé — l'ordre n'est pas
   * décoratif. Fixe au passage la prochaine échéance de l'équipement et crée
   * le rappel correspondant.
   */
  app.post("/api/interventions/:id/cloture", async (request) => {
    const context = await requireContext(request, "intervention.complete");
    const { db, ctx } = context;
    const { id } = parse(idParams, request.params);
    const intervention = await requireEditableIntervention(context, id);

    const [report, signed] = await Promise.all([
      db.report.findOne({ interventionId: id }, { fields: ["validatedAt"] }),
      db.signature.exists({ interventionId: id }),
    ]);
    if (!report?.validatedAt) {
      throw new ConflictError("Validez le compte-rendu avant de terminer l'intervention.");
    }
    if (!signed) throw new ConflictError("La signature du client est requise pour terminer.");

    const input = completeSchema.safeParse(request.body ?? {});
    const raw = input.success ? input.data.nextInterventionAt : undefined;
    const nextInterventionAt =
      raw && raw.length > 0
        ? (input.success && input.data.prochaine) || new Date(`${raw}T09:00:00`)
        : null;

    await db.intervention.update(
      { id },
      { status: InterventionStatus.COMPLETED, completedAt: new Date(), nextInterventionAt },
    );

    if (nextInterventionAt) {
      await db.reminder.insert({
        orgId: ctx.orgId,
        customerId: intervention.customerId,
        equipmentId: intervention.equipmentId,
        sourceInterventionId: id,
        dueDate: nextInterventionAt,
        status: "PENDING",
      });
    }

    await refreshCustomerDates(context, intervention.customerId);
    if (intervention.equipmentId) await refreshEquipmentDates(context, intervention.equipmentId);

    await audit(ctx, {
      action: "intervention.completed",
      entity: "Intervention",
      entityId: id,
      metadata: { reference: intervention.reference },
    });
    return { id };
  });

  /** Résolution d'un QR code d'équipement, dans l'organisation de l'utilisateur seulement. */
  app.get("/api/qr/:token", async (request) => {
    const { db } = await requireContext(request, "equipment.view");
    const { token } = parse(z.object({ token: z.string().min(8).max(100) }), request.params);
    const equipment = await db.equipment.findOne({ qrToken: token }, {});
    if (!equipment) throw new NotFoundError("Équipement");
    return { id: equipment.id };
  });
}
