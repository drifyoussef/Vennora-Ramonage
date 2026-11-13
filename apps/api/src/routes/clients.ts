import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@vennora/core/errors";
import {
  customerDisplayName,
  customerSchema,
  listQuerySchema,
  objectId,
  type CustomerInput,
} from "@vennora/core/schemas";
import { requireContext } from "../context";
import { listCustomers, listCustomerOptions } from "../data/customers";
import { parse } from "../http";
import { audit } from "../tenant";

const idParams = z.object({ id: objectId });

/** Champs écrits depuis le formulaire client, identiques à la création et à la modification. */
function customerFields(input: CustomerInput) {
  return {
    kind: input.kind,
    name: customerDisplayName(input),
    firstName: input.firstName,
    lastName: input.lastName,
    companyName: input.companyName,
    email: input.email,
    phone: input.phone,
    phoneSecondary: input.phoneSecondary,
    address: input.address,
    postalCode: input.postalCode,
    city: input.city,
    notes: input.notes,
  };
}

/**
 * Clients.
 *
 * Chaque écriture recommence à zéro : contexte (donc session, rôle,
 * organisation), validation, puis écriture via le client cloisonné. Aucune
 * ne reçoit d'`orgId` depuis la requête.
 */
export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/clients", async (request) => {
    const context = await requireContext(request, "customer.view");
    const query = parse(listQuerySchema, request.query);
    return listCustomers(context, query);
  });

  /** Noms seuls, pour les listes déroulantes des formulaires. */
  app.get("/api/clients/noms", async (request) => {
    const { db } = await requireContext(request, "customer.view");
    return db.customer.find({}, { fields: ["name"] }, { sort: { name: 1 } });
  });

  app.get("/api/clients/options", async (request) => {
    const context = await requireContext(request, "customer.view");
    return listCustomerOptions(context);
  });

  app.post("/api/clients", async (request) => {
    const { db, ctx } = await requireContext(request, "customer.create");
    const input = parse(customerSchema, request.body);
    const fields = customerFields(input);

    const { id } = await db.customer.insert({ orgId: ctx.orgId, ...fields });
    await audit(ctx, {
      action: "customer.created",
      entity: "Customer",
      entityId: id,
      metadata: { name: fields.name },
    });
    return { id };
  });

  app.patch("/api/clients/:id", async (request) => {
    const { db, ctx } = await requireContext(request, "customer.update");
    const { id } = parse(idParams, request.params);
    const input = parse(customerSchema, request.body);

    // 0 quand le client appartient à une autre organisation : on répond
    // « introuvable » sans distinguer les deux cas.
    const found = await db.customer.update({ id }, customerFields(input));
    if (found === 0) throw new NotFoundError("Client");

    await audit(ctx, { action: "customer.updated", entity: "Customer", entityId: id });
    return { id };
  });

  /**
   * Suppression d'un client.
   *
   * MongoDB n'a pas de cascade : on efface explicitement toute la
   * descendance, dans l'ordre inverse des dépendances. Un client ayant des
   * interventions terminées n'est pas supprimable — l'historique et les
   * rapports signés ont une valeur probante, on ne les efface pas d'un clic.
   */
  app.delete("/api/clients/:id", async (request) => {
    const { db, ctx } = await requireContext(request, "customer.delete");
    const { id } = parse(idParams, request.params);

    const customer = await db.customer.findOne({ id }, { fields: ["name"] });
    if (!customer) throw new NotFoundError("Client");

    const completed = await db.intervention.count({ customerId: id, status: "COMPLETED" });
    if (completed > 0) {
      const s = completed > 1 ? "s" : "";
      throw new ConflictError(
        `Ce client a ${completed} intervention${s} terminée${s}. L'historique ne peut pas être supprimé.`,
      );
    }

    const siteIds = await db.site.distinct("id", { customerId: id });

    await db.reminder.deleteMany({ customerId: id });
    await db.document.deleteMany({ customerId: id });
    await db.intervention.deleteMany({ customerId: id });
    if (siteIds.length > 0) await db.equipment.deleteMany({ siteId: { $in: siteIds } });
    await db.site.deleteMany({ customerId: id });
    await db.customer.deleteMany({ id });

    await audit(ctx, {
      action: "customer.deleted",
      entity: "Customer",
      entityId: id,
      metadata: { name: customer.name, sites: siteIds.length },
    });
    return { id };
  });
}
