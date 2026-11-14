import { count, many, maybeOne, one, type Where } from "../db";
import { InterventionStatus } from "@vennora/shared/enums";
import { NotFoundError } from "@vennora/shared/errors";
import { escapeSearch } from "@vennora/shared/schemas";
import { contains } from "../db/search";
import type { AppContext } from "../context";

const PAGE_SIZE = 25;

/**
 * Recherche client : nom, téléphone, e-mail, ville et adresse des sites.
 *
 * Le ramoneur cherche presque toujours par téléphone (le client vient
 * d'appeler) ou par rue (il est devant la porte). Chercher uniquement par nom
 * rendrait la liste inutilisable sur le terrain.
 */
async function searchFilter(
  { db }: AppContext,
  q: string,
): Promise<Where<"Customer">> {
  const like = contains(q);
  const digits = q.replace(/\D/g, "");

  // Les adresses des sites vivent dans une autre collection : on cherche
  // d'abord les sites qui correspondent, puis leurs clients.
  const viaSites = await db.site.distinct("customerId", {
    $or: [{ address: like }, { city: like }],
  });

  const or: Where<"Customer">[] = [
    { name: like },
    { companyName: like },
    { firstName: like },
    { lastName: like },
    { email: like },
    { city: like },
    { address: like },
    { id: { $in: viaSites } },
  ];

  // Un numéro saisi « 0466521874 » doit trouver « 04 66 52 18 74 » : on
  // recherche sur les chiffres en insérant des séparateurs optionnels. Les
  // chiffres n'ont rien à échapper.
  if (digits.length >= 4) {
    or.push({
      phone: { $regex: digits.split("").join("[\\s.\\-]*"), $options: "i" },
    });
    or.push({ phone: { $regex: escapeSearch(q), $options: "i" } });
  }

  return { $or: or };
}

export async function listCustomers(
  context: AppContext,
  options: { q?: string; page?: number } = {},
) {
  const { db } = context;
  const page = options.page ?? 1;
  const where = options.q ? await searchFilter(context, options.q) : {};

  const [items, total] = await Promise.all([
    db.customer.find(
      where,
      {
        fields: [
          "name",
          "kind",
          "phone",
          "email",
          "city",
          "lastInterventionAt",
          "nextInterventionAt",
        ],
        count: { sites: count("Site", "customerId") },
      },
      { sort: { name: 1 }, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE },
    ),
    db.customer.count(where),
  ]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE,
  };
}

export type CustomerListItem = Awaited<
  ReturnType<typeof listCustomers>
>["items"][number];

/** Fiche client complète : contact, sites, équipements, interventions. */
export async function getCustomer({ db }: AppContext, id: string) {
  const customer = await db.customer.findOne(
    { id },
    {
      fields: [
        "kind",
        "name",
        "firstName",
        "lastName",
        "companyName",
        "email",
        "phone",
        "phoneSecondary",
        "address",
        "postalCode",
        "city",
        "notes",
        "createdAt",
        "lastInterventionAt",
        "nextInterventionAt",
      ],
      with: {
        sites: many(
          "Site",
          "customerId",
          {
            fields: [
              "name",
              "address",
              "addressComplement",
              "postalCode",
              "city",
              "accessNotes",
            ],
            with: {
              equipments: many(
                "Equipment",
                "siteId",
                {
                  fields: [
                    "label",
                    "brand",
                    "model",
                    "location",
                    "nextDueAt",
                    "lastInterventionAt",
                  ],
                  with: {
                    type: one("EquipmentType", "typeId", {
                      fields: ["label", "icon"],
                    }),
                  },
                },
                { where: { active: true }, sort: { createdAt: 1 } },
              ),
            },
            count: { equipments: count("Equipment", "siteId") },
          },
          { sort: { name: 1 } },
        ),
      },
    },
  );

  if (!customer) throw new NotFoundError("Client");

  const [interventions, documents, interventionIds] = await Promise.all([
    db.intervention.find(
      { customerId: id },
      {
        fields: ["reference", "scheduledStart", "status"],
        with: {
          type: one("InterventionType", "typeId", { fields: ["label", "colorHex"] }),
          site: one("Site", "siteId", { fields: ["name"] }),
          equipment: maybeOne("Equipment", "equipmentId", {
            fields: ["label"],
            with: { type: one("EquipmentType", "typeId", { fields: ["label"] }) },
          }),
          technician: one("User", "technicianId", {
            fields: ["firstName", "lastName", "colorHex"],
          }),
        },
        count: { anomalies: count("Anomaly", "interventionId") },
      },
      { sort: { scheduledStart: -1 }, limit: 30 },
    ),
    db.document.find(
      { customerId: id },
      {
        // `storageKey` est nécessaire pour signer le lien de téléchargement
        // côté serveur.
        fields: ["name", "category", "sizeBytes", "createdAt", "storageKey"],
      },
      { sort: { createdAt: -1 }, limit: 30 },
    ),
    db.intervention.distinct("id", { customerId: id }),
  ]);

  const openAnomalies = await db.anomaly.count({
    status: "OPEN",
    interventionId: { $in: interventionIds },
  });

  return { ...customer, interventions, documents, openAnomalies };
}

export type CustomerDetail = Awaited<ReturnType<typeof getCustomer>>;

/** Liste allégée pour les sélecteurs de formulaire. */
export async function listCustomerOptions({ db }: AppContext) {
  return db.customer.find(
    {},
    {
      fields: ["name"],
      with: {
        sites: many(
          "Site",
          "customerId",
          {
            fields: ["name", "address", "city"],
            with: {
              equipments: many(
                "Equipment",
                "siteId",
                {
                  fields: ["label", "brand", "location"],
                  with: {
                    type: one("EquipmentType", "typeId", { fields: ["label"] }),
                  },
                },
                { where: { active: true }, sort: { createdAt: 1 } },
              ),
            },
          },
          { sort: { name: 1 } },
        ),
      },
    },
    { sort: { name: 1 } },
  );
}

export type CustomerOption = Awaited<
  ReturnType<typeof listCustomerOptions>
>[number];

/**
 * Rafraîchit les dates dérivées d'un client.
 *
 * Ces deux champs sont dénormalisés pour que la liste clients tienne en deux
 * requêtes au lieu d'un agrégat par ligne. Ils doivent être recalculés à
 * chaque création, déplacement ou clôture d'intervention.
 */
export async function refreshCustomerDates(
  { db }: AppContext,
  customerId: string,
): Promise<void> {
  const now = new Date();

  const [last, next] = await Promise.all([
    db.intervention.findOne(
      { customerId, status: InterventionStatus.COMPLETED },
      { fields: ["scheduledStart"] },
      { sort: { scheduledStart: -1 } },
    ),
    db.intervention.findOne(
      {
        customerId,
        status: {
          $in: [InterventionStatus.PLANNED, InterventionStatus.IN_PROGRESS],
        },
        scheduledStart: { $gte: now },
      },
      { fields: ["scheduledStart"] },
      { sort: { scheduledStart: 1 } },
    ),
  ]);

  await db.customer.update(
    { id: customerId },
    {
      lastInterventionAt: last?.scheduledStart ?? null,
      nextInterventionAt: next?.scheduledStart ?? null,
    },
  );
}
