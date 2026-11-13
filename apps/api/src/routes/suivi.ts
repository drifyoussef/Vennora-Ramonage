import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AnomalyStatus, ReminderStatus, UserRole } from "@vennora/core/enums";
import { NotFoundError } from "@vennora/core/errors";
import { audit } from "../tenant";
import { objectId } from "@vennora/core/schemas";
import { requireContext } from "../context";
import { listAnomalies } from "../data/anomalies";
import { listDocuments } from "../data/documents";
import { countDueReminders, listReminders } from "../data/reminders";
import { parse } from "../http";

const enumOf = <T extends Record<string, string>>(e: T) =>
  z.enum(Object.values(e) as [T[keyof T], ...T[keyof T][]]);

/** Suivi : rappels, anomalies, documents. */
export async function suiviRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/rappels", async (request) => {
    const context = await requireContext(request, "intervention.view");
    const q = parse(z.object({ statut: enumOf(ReminderStatus).optional() }), request.query);
    const [reminders, counts] = await Promise.all([
      listReminders(context, q.statut ?? ReminderStatus.PENDING),
      countDueReminders(context),
    ]);
    return { reminders, ...counts };
  });

  app.get("/api/anomalies", async (request) => {
    const context = await requireContext(request, "anomaly.view");
    const q = parse(
      z.object({ statut: enumOf(AnomalyStatus).optional(), client: objectId.optional() }),
      request.query,
    );
    return listAnomalies(context, {
      status: q.statut ?? AnomalyStatus.OPEN,
      customerId: q.client,
    });
  });

  app.get("/api/documents", async (request) => {
    const context = await requireContext(request, "document.view");
    return listDocuments(context);
  });

  /**
   * Change le statut d'un rappel.
   *
   * Quatre états seulement : en attente, planifié, traité, écarté. Un rappel
   * écarté n'est pas supprimé — savoir qu'on a délibérément renoncé à
   * replanifier un équipement vaut mieux qu'une ligne disparue sans trace.
   *
   * Un technicien ne modifie que les rappels qu'il voit : ceux issus de ses
   * propres interventions.
   */
  app.patch("/api/rappels/:id", async (request) => {
    const context = await requireContext(request, "intervention.view");
    const { db, ctx, user } = context;
    const { id } = parse(z.object({ id: objectId }), request.params);
    const { status } = parse(z.object({ status: enumOf(ReminderStatus) }), request.body);

    const reminder = await db.reminder.findOne({ id }, { fields: ["sourceInterventionId"] });
    if (!reminder) throw new NotFoundError("Rappel");
    if (user.role === UserRole.TECHNICIAN) {
      const mine =
        reminder.sourceInterventionId !== null &&
        (await db.intervention.exists({ id: reminder.sourceInterventionId, technicianId: user.id }));
      if (!mine) throw new NotFoundError("Rappel");
    }

    await db.reminder.update({ id }, { status });
    await audit(ctx, { action: `reminder.${status.toLowerCase()}`, entity: "Reminder", entityId: id });
    return { id, status };
  });
}
