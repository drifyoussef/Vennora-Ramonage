import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AnomalyStatus } from "@vennora/shared/enums";
import { NotFoundError } from "@vennora/shared/errors";
import { anomalySchema, objectId } from "@vennora/shared/schemas";
import { requireContext } from "../context";
import { requireEditableIntervention, requireVisibleIntervention } from "../data/field";
import { parse } from "../http";
import { audit } from "../tenant";

const idParams = z.object({ id: objectId });
const anomalyFields = {
  fields: ["title", "description", "severity", "status", "recommendation"],
} as const;

export async function anomalyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Crée une anomalie depuis l'écran d'intervention.
   *
   * `equipmentId` est recopié depuis l'intervention plutôt que lu dans la
   * requête : c'est ce qui alimente l'historique de l'équipement, et le
   * client n'a pas à pouvoir choisir sur quel appareil s'impute un constat.
   */
  app.post("/api/interventions/:id/anomalies", async (request) => {
    const context = await requireContext(request, "anomaly.create");
    const { db, ctx } = context;
    const { id: interventionId } = parse(idParams, request.params);
    const intervention = await requireEditableIntervention(context, interventionId);
    const input = parse(anomalySchema, { ...(request.body as object), interventionId });

    const { id } = await db.anomaly.insert({
      orgId: ctx.orgId,
      interventionId: intervention.id,
      equipmentId: intervention.equipmentId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      recommendation: input.recommendation,
      status: AnomalyStatus.OPEN,
    });
    await audit(ctx, {
      action: "anomaly.created",
      entity: "Anomaly",
      entityId: id,
      metadata: { interventionId: intervention.id, severity: input.severity },
    });
    return db.anomaly.findOne({ id }, anomalyFields);
  });

  app.patch("/api/anomalies/:id", async (request) => {
    const context = await requireContext(request, "anomaly.update");
    const { db } = context;
    const { id } = parse(idParams, request.params);

    const existing = await db.anomaly.findOne({ id }, { fields: ["interventionId"] });
    if (!existing) throw new NotFoundError("Anomalie");
    await requireEditableIntervention(context, existing.interventionId);
    const input = parse(anomalySchema, {
      ...(request.body as object),
      interventionId: existing.interventionId,
    });

    await db.anomaly.update(
      { id },
      {
        title: input.title,
        description: input.description,
        severity: input.severity,
        recommendation: input.recommendation,
      },
    );
    return db.anomaly.findOne({ id }, anomalyFields);
  });

  /**
   * Change le statut d'une anomalie.
   *
   * Utilisable même sur une intervention close : une anomalie relevée l'an
   * dernier se résout aujourd'hui, sans qu'on rouvre l'intervention
   * d'origine. Il faut en revanche voir l'intervention : un technicien ne
   * traite pas les constats d'un collègue.
   */
  app.post("/api/anomalies/:id/statut", async (request) => {
    const context = await requireContext(request, "anomaly.update");
    const { db, ctx, user } = context;
    const { id } = parse(idParams, request.params);
    const { status, resolutionNote } = parse(
      z.object({
        status: z.enum(AnomalyStatus),
        resolutionNote: z.string().max(2000).optional(),
      }),
      request.body,
    );

    const existing = await db.anomaly.findOne({ id }, { fields: ["interventionId"] });
    if (!existing) throw new NotFoundError("Anomalie");
    await requireVisibleIntervention(context, existing.interventionId);

    const resolved = status === AnomalyStatus.RESOLVED;
    await db.anomaly.update(
      { id },
      {
        status,
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? user.id : null,
        resolutionNote: resolved ? resolutionNote?.trim() || null : null,
      },
    );
    await audit(ctx, { action: `anomaly.${status.toLowerCase()}`, entity: "Anomaly", entityId: id });
    return { id, status };
  });

  app.delete("/api/anomalies/:id", async (request) => {
    const context = await requireContext(request, "anomaly.update");
    const { db, ctx } = context;
    const { id } = parse(idParams, request.params);

    const existing = await db.anomaly.findOne({ id }, { fields: ["interventionId"] });
    if (!existing) throw new NotFoundError("Anomalie");
    await requireEditableIntervention(context, existing.interventionId);

    // Les photos rattachées à l'anomalie restent attachées à l'intervention :
    // on ne détruit pas une preuve parce qu'un constat a été reformulé.
    await db.interventionPhoto.updateMany({ anomalyId: id }, { anomalyId: null });
    await db.anomaly.deleteMany({ id });
    await audit(ctx, { action: "anomaly.deleted", entity: "Anomaly", entityId: id });
    return { id };
  });
}
