import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InterventionStatus, UserRole } from "@vennora/core/enums";
import { NotFoundError } from "@vennora/core/errors";
import { listQuerySchema, objectId } from "@vennora/core/schemas";
import { requireContext } from "../context";
import { getEquipmentTypes, getInterventionTypes } from "../data/catalog";
import { getDashboard } from "../data/dashboard";
import {
  getIntervention,
  listInterventions,
  listPlanning,
  listTechnicians,
} from "../data/interventions";
import { parse } from "../http";

const statusSchema = z.enum(Object.values(InterventionStatus) as [InterventionStatus, ...InterventionStatus[]]);

const listSchema = listQuerySchema.extend({
  statut: statusSchema.optional(),
  technicien: objectId.optional(),
  type: objectId.optional(),
});

/**
 * Plage du planning, calculée par le navigateur dans le fuseau horaire de
 * l'utilisateur : « aujourd'hui » n'a pas le même début à Paris et sur un
 * serveur réglé en UTC.
 */
const planningSchema = z
  .object({
    du: z.coerce.date(),
    au: z.coerce.date(),
    technicien: objectId.optional(),
  })
  .refine((v) => v.au > v.du && v.au.getTime() - v.du.getTime() <= 42 * 86_400_000, {
    message: "Plage de dates invalide.",
  });

export async function interventionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tableau-de-bord", async (request) => {
    const context = await requireContext(request, "dashboard.view");
    return getDashboard(context);
  });

  app.get("/api/interventions", async (request) => {
    const context = await requireContext(request, "intervention.view");
    const q = parse(listSchema, request.query);
    return listInterventions(context, {
      q: q.q,
      page: q.page,
      status: q.statut,
      technicianId: q.technicien,
      typeId: q.type,
    });
  });

  app.get("/api/interventions/:id", async (request) => {
    const context = await requireContext(request, "intervention.view");
    const { id } = parse(z.object({ id: objectId }), request.params);
    const intervention = await getIntervention(context, id);
    // Un technicien n'ouvre que ses interventions ; l'admin voit tout.
    // « Introuvable » plutôt qu'« interdit » : confirmer l'existence d'une
    // intervention assignée à un collègue n'apporte rien et renseigne.
    if (
      context.user.role === UserRole.TECHNICIAN &&
      intervention.technician.id !== context.user.id
    ) {
      throw new NotFoundError("Intervention");
    }
    return intervention;
  });

  app.get("/api/planning", async (request) => {
    const context = await requireContext(request, "intervention.view");
    const q = parse(planningSchema, request.query);
    return listPlanning(context, q.du, q.au, q.technicien);
  });

  app.get("/api/techniciens", async (request) => {
    const context = await requireContext(request, "intervention.view");
    return listTechnicians(context);
  });

  app.get("/api/catalogue", async (request) => {
    const { user } = await requireContext(request);
    const [interventionTypes, equipmentTypes] = await Promise.all([
      getInterventionTypes(user.org.tradeSlug),
      getEquipmentTypes(user.org.tradeSlug),
    ]);
    return { interventionTypes, equipmentTypes };
  });
}
