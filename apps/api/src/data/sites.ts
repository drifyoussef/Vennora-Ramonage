import { count, many, maybeOne, one, type Where } from "../db";
import { NotFoundError } from "@vennora/core/errors";
import { contains } from "../db/search";
import type { AppContext } from "../context";

const PAGE_SIZE = 25;

async function searchFilter(
  { db }: AppContext,
  q: string,
): Promise<Where<"Site">> {
  const like = contains(q);
  const customerIds = await db.customer.distinct("id", { name: like });
  return {
    $or: [
      { name: like },
      { address: like },
      { city: like },
      { postalCode: like },
      { customerId: { $in: customerIds } },
    ],
  };
}

export async function listSites(
  context: AppContext,
  options: { q?: string; page?: number; customerId?: string } = {},
) {
  const { db } = context;
  const page = options.page ?? 1;
  const where: Where<"Site"> = {
    ...(options.q ? await searchFilter(context, options.q) : {}),
    ...(options.customerId ? { customerId: options.customerId } : {}),
  };

  const [items, total] = await Promise.all([
    db.site.find(
      where,
      {
        fields: ["name", "address", "addressComplement", "postalCode", "city"],
        with: { customer: one("Customer", "customerId", { fields: ["name"] }) },
        count: {
          equipments: count("Equipment", "siteId"),
          interventions: count("Intervention", "siteId"),
        },
      },
      {
        sort: { city: 1, name: 1 },
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      },
    ),
    db.site.count(where),
  ]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getSite({ db }: AppContext, id: string) {
  const site = await db.site.findOne(
    { id },
    {
      fields: [
        "name",
        "address",
        "addressComplement",
        "postalCode",
        "city",
        "latitude",
        "longitude",
        "notes",
        "accessNotes",
        "createdAt",
      ],
      with: {
        customer: one("Customer", "customerId", {
          fields: ["name", "phone", "email"],
        }),
        equipments: many(
          "Equipment",
          "siteId",
          {
            fields: [
              "label",
              "brand",
              "model",
              "serialNumber",
              "location",
              "active",
              "installedAt",
              "lastInterventionAt",
              "nextDueAt",
            ],
            with: {
              type: one("EquipmentType", "typeId", { fields: ["label", "icon"] }),
            },
            count: { interventions: count("Intervention", "equipmentId") },
          },
          { sort: { active: -1, createdAt: 1 } },
        ),
      },
    },
  );

  if (!site) throw new NotFoundError("Site");

  const interventions = await db.intervention.find(
    { siteId: id },
    {
      fields: ["reference", "scheduledStart", "status"],
      with: {
        type: one("InterventionType", "typeId", { fields: ["label", "colorHex"] }),
        equipment: maybeOne("Equipment", "equipmentId", {
          fields: ["label"],
          with: { type: one("EquipmentType", "typeId", { fields: ["label"] }) },
        }),
        technician: one("User", "technicianId", {
          fields: ["firstName", "lastName", "colorHex"],
        }),
      },
    },
    { sort: { scheduledStart: -1 }, limit: 20 },
  );

  return { ...site, interventions };
}

export type SiteDetail = Awaited<ReturnType<typeof getSite>>;
