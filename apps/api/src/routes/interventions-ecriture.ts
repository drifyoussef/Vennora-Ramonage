import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InterventionStatus } from "@vennora/core/enums";
import { ConflictError, NotFoundError, ValidationError } from "@vennora/core/errors";
import { fromDateTimeInput } from "@vennora/core/format";
import { assertOwnsIntervention } from "@vennora/core/permissions";
import {
  interventionSchema,
  interventionStatusSchema,
  objectId,
  type InterventionInput,
} from "@vennora/core/schemas";
import { requireContext, type AppContext } from "../context";
import { getInterventionTypes } from "../data/catalog";
import { refreshCustomerDates } from "../data/customers";
import { refreshEquipmentDates } from "../data/equipment";
import { nextReference } from "../data/interventions";
import { parse } from "../http";
import { audit } from "../tenant";

const idParams = z.object({ id: objectId });

/**
 * Transitions de statut autorisées, explicites : passer directement de
 * « planifiée » à « terminée » contournerait la prise de photos et la
 * signature, qui sont tout l'intérêt du produit.
 */
const ALLOWED_TRANSITIONS: Record<InterventionStatus, InterventionStatus[]> = {
  [InterventionStatus.PLANNED]: [InterventionStatus.IN_PROGRESS, InterventionStatus.CANCELLED],
  [InterventionStatus.IN_PROGRESS]: [
    InterventionStatus.COMPLETED,
    InterventionStatus.PLANNED,
    InterventionStatus.CANCELLED,
  ],
  [InterventionStatus.COMPLETED]: [],
  [InterventionStatus.CANCELLED]: [InterventionStatus.PLANNED],
};

/**
 * Créneau d'une intervention.
 *
 * Le formulaire envoie la date et les heures saisies, plus les instants
 * correspondants (`debut`, `fin`) calculés par le navigateur dans le fuseau
 * de l'utilisateur. Convertir « 9:00 » ici placerait l'intervention dans le
 * fuseau du serveur — décalée d'une ou deux heures sur un hébergement en
 * UTC. La conversion locale ne sert qu'en secours (scripts, appels directs).
 */
function parseSchedule(body: unknown) {
  const input = parse(interventionSchema, body);
  const instants = z.object({ debut: z.coerce.date(), fin: z.coerce.date() }).safeParse(body);
  const start = instants.success
    ? instants.data.debut
    : fromDateTimeInput(input.date, input.startTime);
  const end = instants.success ? instants.data.fin : fromDateTimeInput(input.date, input.endTime);
  if (end <= start) {
    throw new ValidationError("Vérifiez les champs en rouge.", {
      endTime: ["L'heure de fin doit suivre l'heure de début."],
    });
  }
  return { input, start, end };
}

/**
 * Contrôle que toutes les références pointent dans l'organisation, et que la
 * chaîne client → site → équipement est cohérente.
 *
 * Sans ce contrôle, une requête modifiée permettrait de rattacher le site
 * d'un client à l'intervention d'un autre : les deux appartiennent bien à
 * l'entreprise, l'isolation tenant ne suffit donc pas ici.
 */
async function checkRefs({ db, user }: AppContext, input: InterventionInput) {
  const [siteOk, technicianOk, types] = await Promise.all([
    db.site.exists({ id: input.siteId, customerId: input.customerId }),
    db.user.exists({ id: input.technicianId, active: true }),
    getInterventionTypes(user.org.tradeSlug),
  ]);
  if (!siteOk) throw new NotFoundError("Site du client");
  if (!technicianOk) throw new NotFoundError("Technicien");
  if (!types.some((t) => t.id === input.typeId)) throw new NotFoundError("Type d'intervention");

  let equipmentId: string | null = null;
  if (input.equipmentId) {
    if (!(await db.equipment.exists({ id: input.equipmentId, siteId: input.siteId }))) {
      throw new NotFoundError("Équipement du site");
    }
    equipmentId = input.equipmentId;
  }
  return { equipmentId };
}

export async function interventionWriteRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/interventions", async (request) => {
    const context = await requireContext(request, "intervention.create");
    const { db, ctx } = context;
    const { input, start, end } = parseSchedule(request.body);
    const { equipmentId } = await checkRefs(context, input);

    const reference = await nextReference(context, start);
    const { id } = await db.intervention.insert({
      orgId: ctx.orgId,
      reference,
      customerId: input.customerId,
      siteId: input.siteId,
      equipmentId,
      technicianId: input.technicianId,
      typeId: input.typeId,
      scheduledStart: start,
      scheduledEnd: end,
      status: InterventionStatus.PLANNED,
      notes: input.notes,
      internalNotes: input.internalNotes,
    });

    await refreshCustomerDates(context, input.customerId);
    // Un rappel dont l'équipement vient d'être replanifié n'a plus lieu
    // d'être en attente : sinon la liste « à replanifier » redemande
    // éternellement ce qui est déjà au planning.
    if (equipmentId) {
      await db.reminder.updateMany(
        { equipmentId, status: "PENDING" },
        { status: "SCHEDULED" },
      );
    }
    await audit(ctx, {
      action: "intervention.created",
      entity: "Intervention",
      entityId: id,
      metadata: { reference },
    });
    return { id };
  });

  app.patch("/api/interventions/:id", async (request) => {
    const context = await requireContext(request, "intervention.update");
    const { db, ctx, user } = context;
    const { id } = parse(idParams, request.params);

    const existing = await db.intervention.findOne(
      { id },
      { fields: ["technicianId", "status", "customerId", "equipmentId"] },
    );
    if (!existing) throw new NotFoundError("Intervention");
    assertOwnsIntervention(user, existing);
    if (existing.status === InterventionStatus.COMPLETED) {
      throw new ConflictError(
        "Cette intervention est terminée et signée. Elle ne peut plus être replanifiée.",
      );
    }

    const { input, start, end } = parseSchedule(request.body);
    const { equipmentId } = await checkRefs(context, input);
    await db.intervention.update(
      { id },
      {
        customerId: input.customerId,
        siteId: input.siteId,
        equipmentId,
        technicianId: input.technicianId,
        typeId: input.typeId,
        scheduledStart: start,
        scheduledEnd: end,
        notes: input.notes,
        internalNotes: input.internalNotes,
      },
    );

    await refreshCustomerDates(context, input.customerId);
    if (existing.customerId !== input.customerId) {
      await refreshCustomerDates(context, existing.customerId);
    }
    await audit(ctx, { action: "intervention.updated", entity: "Intervention", entityId: id });
    return { id };
  });

  app.post("/api/interventions/:id/statut", async (request) => {
    const context = await requireContext(request, "intervention.update");
    const { db, ctx, user } = context;
    const { id, status } = parse(interventionStatusSchema, {
      id: (request.params as { id?: string }).id,
      status: (request.body as { status?: string } | undefined)?.status,
    });

    const existing = await db.intervention.findOne(
      { id },
      { fields: ["status", "technicianId", "customerId", "equipmentId", "startedAt"] },
    );
    if (!existing) throw new NotFoundError("Intervention");
    assertOwnsIntervention(user, existing);
    if (!ALLOWED_TRANSITIONS[existing.status].includes(status)) {
      throw new ConflictError("Ce changement de statut n'est pas autorisé.");
    }

    const now = new Date();
    await db.intervention.update(
      { id },
      {
        status,
        startedAt:
          status === InterventionStatus.IN_PROGRESS && !existing.startedAt ? now : undefined,
        completedAt: status === InterventionStatus.COMPLETED ? now : undefined,
      },
    );

    await refreshCustomerDates(context, existing.customerId);
    if (existing.equipmentId) await refreshEquipmentDates(context, existing.equipmentId);
    await audit(ctx, {
      action: `intervention.${status.toLowerCase()}`,
      entity: "Intervention",
      entityId: id,
      metadata: { from: existing.status, to: status },
    });
    return { id, status };
  });

  app.delete("/api/interventions/:id", async (request) => {
    const context = await requireContext(request, "intervention.delete");
    const { db, ctx } = context;
    const { id } = parse(idParams, request.params);

    const existing = await db.intervention.findOne(
      { id },
      { fields: ["reference", "status", "customerId", "equipmentId"] },
    );
    if (!existing) throw new NotFoundError("Intervention");
    if (existing.status === InterventionStatus.COMPLETED) {
      throw new ConflictError(
        "Une intervention terminée fait partie de l'historique de l'équipement et ne peut pas être supprimée. Vous pouvez l'annuler.",
      );
    }

    // Pas de cascade en base : la descendance d'abord, l'intervention ensuite.
    await db.anomaly.deleteMany({ interventionId: id });
    await db.interventionPhoto.deleteMany({ interventionId: id });
    await db.voiceNote.deleteMany({ interventionId: id });
    await db.report.deleteMany({ interventionId: id });
    await db.signature.deleteMany({ interventionId: id });
    await db.intervention.deleteMany({ id });

    await refreshCustomerDates(context, existing.customerId);
    if (existing.equipmentId) await refreshEquipmentDates(context, existing.equipmentId);
    await audit(ctx, {
      action: "intervention.deleted",
      entity: "Intervention",
      entityId: id,
      metadata: { reference: existing.reference },
    });
    return { id };
  });
}
