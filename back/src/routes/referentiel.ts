import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  equipmentSchema,
  listQuerySchema,
  objectId,
  siteSchema,
  type EquipmentInput,
  type SiteInput,
} from "@vennora/shared/schemas";
import { one } from "../db";
import { getEquipmentTypes } from "../data/catalog";
import type { AppContext } from "../context";
import { ConflictError } from "@vennora/shared/errors";
import { requireContext } from "../context";
import { withUrl } from "../data/documents";
import { getCustomer } from "../data/customers";
import { getEquipment, listEquipment } from "../data/equipment";
import { getSite, listSites } from "../data/sites";
import { parse } from "../http";
import { equipmentQrUrl, renderEquipmentQrSvg } from "../services/qrcode";
import { NotFoundError } from "@vennora/shared/errors";
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

  /** Champs écrits depuis le formulaire site. */
  function siteFields(input: SiteInput) {
    return {
      name: input.name,
      address: input.address,
      addressComplement: input.addressComplement,
      postalCode: input.postalCode,
      city: input.city,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      notes: input.notes,
      accessNotes: input.accessNotes,
    };
  }

  app.post("/api/sites", async (request) => {
    const { db, ctx } = await requireContext(request, "site.create");
    const input = parse(siteSchema, request.body);

    // Le client est fourni par le formulaire : on vérifie qu'il appartient
    // bien à l'organisation avant de rattacher quoi que ce soit.
    if (!(await db.customer.exists({ id: input.customerId }))) throw new NotFoundError("Client");

    const { id } = await db.site.insert({
      orgId: ctx.orgId,
      customerId: input.customerId,
      ...siteFields(input),
    });
    await audit(ctx, {
      action: "site.created",
      entity: "Site",
      entityId: id,
      metadata: { name: input.name, customerId: input.customerId },
    });
    return { id };
  });

  app.patch("/api/sites/:id", async (request) => {
    const { db, ctx } = await requireContext(request, "site.update");
    const { id } = parse(idParams, request.params);
    const input = parse(siteSchema, request.body);

    if (!(await db.customer.exists({ id: input.customerId }))) throw new NotFoundError("Client");
    const found = await db.site.update({ id }, { customerId: input.customerId, ...siteFields(input) });
    if (found === 0) throw new NotFoundError("Site");

    await audit(ctx, { action: "site.updated", entity: "Site", entityId: id });
    return { id };
  });

  /**
   * Suppression d'un site, avec ses équipements et ses interventions non
   * terminées. Un site qui porte des interventions terminées reste : leur
   * historique a une valeur probante.
   */
  app.delete("/api/sites/:id", async (request) => {
    const { db, ctx } = await requireContext(request, "site.delete");
    const { id } = parse(idParams, request.params);

    const site = await db.site.findOne({ id }, { fields: ["name", "customerId"] });
    if (!site) throw new NotFoundError("Site");

    const completed = await db.intervention.count({ siteId: id, status: "COMPLETED" });
    if (completed > 0) {
      const s = completed > 1 ? "s" : "";
      throw new ConflictError(
        `Ce site porte ${completed} intervention${s} terminée${s}. L'historique ne peut pas être supprimé.`,
      );
    }

    await db.intervention.deleteMany({ siteId: id });
    await db.equipment.deleteMany({ siteId: id });
    await db.site.deleteMany({ id });

    await audit(ctx, { action: "site.deleted", entity: "Site", entityId: id, metadata: { name: site.name } });
    return { id: site.customerId };
  });

  /**
   * Sites pour les listes déroulantes, triés par client puis par nom. Le tri
   * porte sur une relation : il est fait ici plutôt qu'en base.
   */
  app.get("/api/sites/options", async (request) => {
    const { db } = await requireContext(request, "site.view");
    const sites = await db.site.find(
      {},
      {
        fields: ["name", "city"],
        with: { customer: one("Customer", "customerId", { fields: ["name"] }) },
      },
    );
    return sites
      .map((s) => ({ id: s.id, name: s.name, city: s.city, customerName: s.customer.name }))
      .sort(
        (a, b) =>
          a.customerName.localeCompare(b.customerName, "fr") || a.name.localeCompare(b.name, "fr"),
      );
  });

  /**
   * Le type d'équipement vient d'un catalogue partagé entre organisations :
   * on contrôle qu'il relève bien du métier de l'entreprise, sinon un
   * formulaire trafiqué permettrait de rattacher un « brûleur de piscine » à
   * un ramoneur.
   */
  async function checkEquipmentRefs({ db, user }: AppContext, input: EquipmentInput) {
    const [siteExists, types] = await Promise.all([
      db.site.exists({ id: input.siteId }),
      getEquipmentTypes(user.org.tradeSlug),
    ]);
    if (!siteExists) throw new NotFoundError("Site");
    if (!types.some((t) => t.id === input.typeId)) throw new NotFoundError("Type d'équipement");
  }

  function equipmentFields(input: EquipmentInput) {
    return {
      siteId: input.siteId,
      typeId: input.typeId,
      label: input.label,
      brand: input.brand,
      model: input.model,
      serialNumber: input.serialNumber,
      location: input.location,
      installedAt: input.installedAt ?? null,
      description: input.description,
      notes: input.notes,
    };
  }

  app.post("/api/equipements", async (request) => {
    const context = await requireContext(request, "equipment.create");
    const input = parse(equipmentSchema, request.body);
    await checkEquipmentRefs(context, input);

    const { id } = await context.db.equipment.insert({
      orgId: context.ctx.orgId,
      ...equipmentFields(input),
      qrToken: randomUUID(),
    });
    await audit(context.ctx, {
      action: "equipment.created",
      entity: "Equipment",
      entityId: id,
      metadata: { siteId: input.siteId },
    });
    return { id };
  });

  app.patch("/api/equipements/:id", async (request) => {
    const context = await requireContext(request, "equipment.update");
    const { id } = parse(idParams, request.params);
    const input = parse(equipmentSchema, request.body);
    await checkEquipmentRefs(context, input);

    const found = await context.db.equipment.update({ id }, equipmentFields(input));
    if (found === 0) throw new NotFoundError("Équipement");
    await audit(context.ctx, { action: "equipment.updated", entity: "Equipment", entityId: id });
    return { id };
  });

  /**
   * Retire un équipement du parc.
   *
   * On désactive au lieu de supprimer dès qu'il existe un historique : les
   * rapports passés référencent cet appareil, et un certificat de ramonage
   * qui renvoie vers un équipement disparu perd sa valeur.
   */
  app.delete("/api/equipements/:id", async (request) => {
    const { db, ctx } = await requireContext(request, "equipment.delete");
    const { id } = parse(idParams, request.params);

    const equipment = await db.equipment.findOne({ id }, { fields: ["siteId"] });
    if (!equipment) throw new NotFoundError("Équipement");

    const interventions = await db.intervention.count({ equipmentId: id });
    if (interventions > 0) {
      await db.equipment.update({ id }, { active: false, nextDueAt: null });
      await audit(ctx, {
        action: "equipment.deactivated",
        entity: "Equipment",
        entityId: id,
        metadata: { interventions },
      });
    } else {
      await db.equipment.deleteMany({ id });
      await audit(ctx, { action: "equipment.deleted", entity: "Equipment", entityId: id });
    }
    return { id: equipment.siteId };
  });
}
