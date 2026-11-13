import { backOne, count, many, one, type Where } from "../db";
import { InterventionStatus } from "@vennora/core/enums";
import { NotFoundError } from "@vennora/core/errors";
import { contains } from "../db/search";
import { addMonths } from "@vennora/core/format";
import type { AppContext } from "../context";

const PAGE_SIZE = 30;

/**
 * Recherche : champs de l'équipement, puis de son site et du client du site.
 * Les relations sont résolues en amont (sites et clients qui correspondent),
 * l'équipement est ensuite filtré sur leurs identifiants.
 */
async function searchFilter(
  { db }: AppContext,
  q: string,
): Promise<Where<"Equipment">> {
  const like = contains(q);
  const customerIds = await db.customer.distinct("id", { name: like });
  const siteIds = await db.site.distinct("id", {
    $or: [
      { name: like },
      { city: like },
      { address: like },
      { customerId: { $in: customerIds } },
    ],
  });
  return {
    $or: [
      { label: like },
      { brand: like },
      { model: like },
      { serialNumber: like },
      { location: like },
      { siteId: { $in: siteIds } },
    ],
  };
}

export async function listEquipment(
  context: AppContext,
  options: {
    q?: string;
    page?: number;
    siteId?: string;
    typeId?: string;
    /** Uniquement les équipements dont l'échéance est passée. */
    overdue?: boolean;
  } = {},
) {
  const { db } = context;
  const page = options.page ?? 1;
  const where: Where<"Equipment"> = {
    active: true,
    ...(options.q ? await searchFilter(context, options.q) : {}),
    ...(options.siteId ? { siteId: options.siteId } : {}),
    ...(options.typeId ? { typeId: options.typeId } : {}),
    ...(options.overdue ? { nextDueAt: { $lt: new Date() } } : {}),
  };

  const [items, total] = await Promise.all([
    db.equipment.find(
      where,
      {
        fields: [
          "label",
          "brand",
          "model",
          "location",
          "serialNumber",
          "lastInterventionAt",
          "nextDueAt",
        ],
        with: {
          type: one("EquipmentType", "typeId", { fields: ["label", "icon"] }),
          site: one("Site", "siteId", {
            fields: ["name", "city"],
            with: {
              customer: one("Customer", "customerId", { fields: ["name"] }),
            },
          }),
        },
        count: { interventions: count("Intervention", "equipmentId") },
      },
      {
        sort: { nextDueAt: 1, createdAt: -1 },
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      },
    ),
    db.equipment.count(where),
  ]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export type EquipmentListItem = Awaited<
  ReturnType<typeof listEquipment>
>["items"][number];

/**
 * Fiche équipement, avec tout son historique.
 *
 * C'est l'écran qui fait la valeur de Vennora : on veut voir d'un coup d'œil
 * ce qui s'est passé sur cet appareil depuis son installation, année par
 * année, anomalies comprises. On charge donc l'historique complet, pas une
 * page de dix lignes.
 */
export async function getEquipment({ db }: AppContext, id: string) {
  const equipment = await db.equipment.findOne(
    { id },
    {
      fields: [
        "label",
        "brand",
        "model",
        "serialNumber",
        "location",
        "installedAt",
        "description",
        "notes",
        "qrToken",
        "active",
        "createdAt",
        "lastInterventionAt",
        "nextDueAt",
      ],
      with: {
        type: one("EquipmentType", "typeId", {
          fields: ["label", "icon", "defaultIntervalMonths"],
        }),
        site: one("Site", "siteId", {
          fields: [
            "name",
            "address",
            "addressComplement",
            "postalCode",
            "city",
            "accessNotes",
          ],
          with: {
            customer: one("Customer", "customerId", {
              fields: ["name", "phone", "email"],
            }),
          },
        }),
      },
    },
  );

  if (!equipment) throw new NotFoundError("Équipement");

  const [interventions, openAnomalies] = await Promise.all([
    db.intervention.find(
      { equipmentId: id },
      {
        fields: ["reference", "scheduledStart", "completedAt", "status", "notes"],
        with: {
          type: one("InterventionType", "typeId", { fields: ["label", "colorHex"] }),
          technician: one("User", "technicianId", {
            fields: ["firstName", "lastName", "colorHex"],
          }),
          anomalies: many(
            "Anomaly",
            "interventionId",
            { fields: ["title", "severity", "status", "recommendation"] },
            { sort: { severity: -1 } },
          ),
          report: backOne("Report", "interventionId", {
            fields: ["pdfKey", "validatedAt", "summary"],
          }),
        },
        count: { photos: count("InterventionPhoto", "interventionId") },
      },
      { sort: { scheduledStart: -1 } },
    ),
    db.anomaly.count({ equipmentId: id, status: "OPEN" }),
  ]);

  return { ...equipment, interventions, openAnomalies };
}

export type EquipmentDetail = Awaited<ReturnType<typeof getEquipment>>;

/** Résout un QR code vers l'équipement, dans le tenant courant seulement. */
export async function findEquipmentByQrToken(
  { db }: AppContext,
  token: string,
) {
  return db.equipment.findOne({ qrToken: token }, {});
}

/**
 * Recalcule dernière intervention et prochaine échéance.
 *
 * L'échéance suit la périodicité du type d'équipement (12 mois pour le
 * ramonage), sauf si la dernière intervention a fixé explicitement une date.
 */
export async function refreshEquipmentDates(
  { db }: AppContext,
  equipmentId: string,
): Promise<void> {
  const [equipment, last] = await Promise.all([
    db.equipment.findOne(
      { id: equipmentId },
      {
        with: {
          type: one("EquipmentType", "typeId", {
            fields: ["defaultIntervalMonths"],
          }),
        },
      },
    ),
    db.intervention.findOne(
      { equipmentId, status: InterventionStatus.COMPLETED },
      { fields: ["scheduledStart", "nextInterventionAt"] },
      { sort: { scheduledStart: -1 } },
    ),
  ]);
  if (!equipment) return;

  const interval = equipment.type.defaultIntervalMonths;
  const nextDueAt = last
    ? (last.nextInterventionAt ??
      (interval ? addMonths(last.scheduledStart, interval) : null))
    : null;

  await db.equipment.update(
    { id: equipmentId },
    {
      lastInterventionAt: last?.scheduledStart ?? null,
      nextDueAt,
    },
  );
}
