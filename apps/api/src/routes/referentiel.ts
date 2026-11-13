import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema, objectId } from "@vennora/core/schemas";
import { requireContext } from "../context";
import { withUrl } from "../data/documents";
import { getCustomer } from "../data/customers";
import { getEquipment, listEquipment } from "../data/equipment";
import { getSite, listSites } from "../data/sites";
import { parse } from "../http";
import { equipmentQrUrl, renderEquipmentQrSvg } from "../services/qrcode";
import { NotFoundError } from "@vennora/core/errors";
import { randomUUID } from "node:crypto";
import { audit } from "../tenant";

const idParams = z.object({ id: objectId });

/** Référentiel : clients, sites, équipements. */
export async function referentielRoutes(app: FastifyInstance): Promise<void> {
  // Fiche client : les documents arrivent avec un lien signé, jamais avec
  // leur clé de stockage.
  app.get("/api/clients/:id", async (request) => {
    const context = await requireContext(request, "customer.view");
    const { id } = parse(idParams, request.params);
    const customer = await getCustomer(context, id);
    return { ...customer, documents: await Promise.all(customer.documents.map(withUrl)) };
  });

  app.get("/api/sites", async (request) => {
    const context = await requireContext(request, "site.view");
    const q = parse(listQuerySchema.extend({ client: objectId.optional() }), request.query);
    return listSites(context, { q: q.q, page: q.page, customerId: q.client });
  });

  app.get("/api/sites/:id", async (request) => {
    const context = await requireContext(request, "site.view");
    const { id } = parse(idParams, request.params);
    return getSite(context, id);
  });

  app.get("/api/equipements", async (request) => {
    const context = await requireContext(request, "equipment.view");
    const q = parse(
      listQuerySchema.extend({
        echeance: z.enum(["depassee"]).optional(),
        site: objectId.optional(),
        type: objectId.optional(),
      }),
      request.query,
    );
    return listEquipment(context, {
      q: q.q,
      page: q.page,
      siteId: q.site,
      typeId: q.type,
      overdue: q.echeance === "depassee",
    });
  });

  app.get("/api/equipements/:id", async (request) => {
    const context = await requireContext(request, "equipment.view");
    const { id } = parse(idParams, request.params);
    const equipment = await getEquipment(context, id);
    return {
      ...equipment,
      qr: {
        svg: await renderEquipmentQrSvg(equipment.qrToken),
        url: equipmentQrUrl(equipment.qrToken),
      },
    };
  });

  /**
   * Nouveau jeton de QR code : l'ancienne étiquette (perdue, photographiée)
   * ne mène plus nulle part. Aucune donnée de l'équipement ne change.
   */
  app.post("/api/equipements/:id/qr", async (request) => {
    const { db, ctx } = await requireContext(request, "equipment.update");
    const { id } = parse(idParams, request.params);
    const found = await db.equipment.update({ id }, { qrToken: randomUUID() });
    if (found === 0) throw new NotFoundError("Équipement");
    await audit(ctx, { action: "equipment.qrRegenerated", entity: "Equipment", entityId: id });
    return { id };
  });
}
