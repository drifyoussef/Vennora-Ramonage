import "server-only";
import type { Prisma } from "@/generated/prisma";
import { InterventionStatus, AnomalyStatus, UserRole } from "@/core/enums";
import { endOfDay, endOfWeek, startOfDay, startOfWeek } from "@/lib/format";
import type { AppContext } from "../context";

/**
 * Chiffres du tableau de bord.
 *
 * Un technicien voit sa propre journée, un administrateur voit celle de
 * l'entreprise : ce n'est pas une question de droits mais d'utilité — un
 * technicien qui voit « 27 interventions aujourd'hui » n'apprend rien.
 */
export async function getDashboard({ db, user }: AppContext) {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  const mine =
    user.role === UserRole.TECHNICIAN ? { technicianId: user.id } : {};

  const [
    todayPlanned,
    todayInProgress,
    todayCompleted,
    todayCancelled,
    weekCount,
    customerCount,
    equipmentCount,
    openAnomalies,
    criticalAnomalies,
    todayList,
    upcoming,
  ] = await Promise.all([
    db.intervention.count({
      where: {
        ...mine,
        scheduledStart: { gte: dayStart, lte: dayEnd },
        status: InterventionStatus.PLANNED,
      },
    }),
    db.intervention.count({
      where: {
        ...mine,
        scheduledStart: { gte: dayStart, lte: dayEnd },
        status: InterventionStatus.IN_PROGRESS,
      },
    }),
    db.intervention.count({
      where: {
        ...mine,
        scheduledStart: { gte: dayStart, lte: dayEnd },
        status: InterventionStatus.COMPLETED,
      },
    }),
    db.intervention.count({
      where: {
        ...mine,
        scheduledStart: { gte: dayStart, lte: dayEnd },
        status: InterventionStatus.CANCELLED,
      },
    }),
    db.intervention.count({
      where: {
        ...mine,
        scheduledStart: { gte: weekStart, lte: weekEnd },
        status: { not: InterventionStatus.CANCELLED },
      },
    }),
    db.customer.count(),
    db.equipment.count({ where: { active: true } }),
    db.anomaly.count({ where: { status: AnomalyStatus.OPEN } }),
    db.anomaly.count({
      where: { status: AnomalyStatus.OPEN, severity: { in: ["HIGH", "CRITICAL"] } },
    }),
    findInterventionCards(db, {
      where: {
        ...mine,
        scheduledStart: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { scheduledStart: "asc" },
    }),
    findInterventionCards(db, {
      where: {
        ...mine,
        scheduledStart: { gt: dayEnd },
        status: InterventionStatus.PLANNED,
      },
      orderBy: { scheduledStart: "asc" },
      take: 5,
    }),
  ]);

  return {
    today: {
      total: todayPlanned + todayInProgress + todayCompleted + todayCancelled,
      planned: todayPlanned,
      inProgress: todayInProgress,
      completed: todayCompleted,
      cancelled: todayCancelled,
      list: todayList,
    },
    weekCount,
    customerCount,
    equipmentCount,
    openAnomalies,
    criticalAnomalies,
    upcoming,
  };
}

/**
 * Champs propres à l'intervention sur une carte : assez pour l'afficher,
 * rien de plus. Aucun `include` complet, qui ramènerait notes internes et
 * champs de rapport sur une vue de liste. Les relations sont chargées à part,
 * voir `findInterventionCards`.
 */
const cardFieldsSelect = {
  id: true,
  reference: true,
  scheduledStart: true,
  scheduledEnd: true,
  status: true,
  customerId: true,
  siteId: true,
  equipmentId: true,
  technicianId: true,
  typeId: true,
  _count: { select: { anomalies: true, photos: true } },
} as const;

/**
 * Cartes d'intervention d'une liste, relations comprises.
 *
 * Sur MongoDB, Prisma ne fait pas de jointure : un `select` imbriqué charge
 * chaque relation par une requête distincte, et les enchaîne. Une carte en
 * compte six (client, site, équipement, son type, technicien, type
 * d'intervention), soit sept allers-retours successifs vers la base — plus de
 * 250 ms pour une liste de trente quand la base est à 35 ms.
 *
 * On lit donc la liste seule, puis toutes les relations en parallèle : trois
 * allers-retours au lieu de sept (l'équipement et son type restent chaînés).
 * Les lectures passent par le `db` cloisonné : `orgId` est injecté sur chacune,
 * comme avant.
 */
export async function findInterventionCards(
  db: AppContext["db"],
  args: {
    where: Prisma.InterventionWhereInput;
    orderBy: Prisma.InterventionOrderByWithRelationInput;
    skip?: number;
    take?: number;
  },
) {
  const rows = await db.intervention.findMany({
    ...args,
    select: cardFieldsSelect,
  });
  if (rows.length === 0) return [];

  const idsOf = (pick: (row: (typeof rows)[number]) => string | null) => [
    ...new Set(rows.map(pick).filter((id): id is string => id !== null)),
  ];
  const equipmentIds = idsOf((r) => r.equipmentId);

  const [customers, sites, equipments, technicians, types] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: idsOf((r) => r.customerId) } },
      select: { id: true, name: true, phone: true },
    }),
    db.site.findMany({
      where: { id: { in: idsOf((r) => r.siteId) } },
      select: { id: true, name: true, address: true, postalCode: true, city: true },
    }),
    equipmentIds.length === 0
      ? Promise.resolve([])
      : db.equipment.findMany({
          where: { id: { in: equipmentIds } },
          select: {
            id: true,
            label: true,
            brand: true,
            model: true,
            type: { select: { label: true } },
          },
        }),
    db.user.findMany({
      where: { id: { in: idsOf((r) => r.technicianId) } },
      select: { id: true, firstName: true, lastName: true, colorHex: true },
    }),
    db.interventionType.findMany({
      where: { id: { in: idsOf((r) => r.typeId) } },
      select: { id: true, label: true, colorHex: true },
    }),
  ]);

  const byId = <T extends { id: string }>(list: T[]) =>
    new Map(list.map((item) => [item.id, item]));
  const customerById = byId(customers);
  const siteById = byId(sites);
  const equipmentById = byId(equipments);
  const technicianById = byId(technicians);
  const typeById = byId(types);

  // Aucune contrainte d'intégrité côté base : une relation obligatoire
  // introuvable est une incohérence de données. On échoue comme le faisait le
  // `select` imbriqué de Prisma, plutôt que d'afficher une carte à trous.
  const required = <T>(value: T | undefined, relation: string, id: string): T => {
    if (value === undefined) {
      throw new Error(
        `Intervention ${id} : relation « ${relation} » introuvable.`,
      );
    }
    return value;
  };

  return rows.map((row) => {
    const customer = required(customerById.get(row.customerId), "client", row.id);
    const site = required(siteById.get(row.siteId), "site", row.id);
    const technician = required(technicianById.get(row.technicianId), "technicien", row.id);
    const type = required(typeById.get(row.typeId), "type", row.id);
    const equipment = row.equipmentId
      ? required(equipmentById.get(row.equipmentId), "équipement", row.id)
      : null;

    return {
      id: row.id,
      reference: row.reference,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      status: row.status,
      customer,
      site,
      equipment: equipment && {
        id: equipment.id,
        label: equipment.label,
        brand: equipment.brand,
        model: equipment.model,
        type: equipment.type,
      },
      technician,
      type: { label: type.label, colorHex: type.colorHex },
      _count: row._count,
    };
  });
}

export type InterventionCard = Awaited<
  ReturnType<typeof findInterventionCards>
>[number];
