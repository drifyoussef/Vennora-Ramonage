import { count, maybeOne, one, spec, type Row, type SortOf, type Where } from "../db";
import { InterventionStatus, AnomalyStatus, UserRole } from "@vennora/core/enums";
import { endOfDay, endOfWeek, startOfDay, startOfWeek } from "@vennora/core/format";
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
  const today = { $gte: dayStart, $lte: dayEnd };

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
      ...mine,
      scheduledStart: today,
      status: InterventionStatus.PLANNED,
    }),
    db.intervention.count({
      ...mine,
      scheduledStart: today,
      status: InterventionStatus.IN_PROGRESS,
    }),
    db.intervention.count({
      ...mine,
      scheduledStart: today,
      status: InterventionStatus.COMPLETED,
    }),
    db.intervention.count({
      ...mine,
      scheduledStart: today,
      status: InterventionStatus.CANCELLED,
    }),
    db.intervention.count({
      ...mine,
      scheduledStart: { $gte: weekStart, $lte: weekEnd },
      status: { $ne: InterventionStatus.CANCELLED },
    }),
    db.customer.count(),
    db.equipment.count({ active: true }),
    db.anomaly.count({ status: AnomalyStatus.OPEN }),
    db.anomaly.count({
      status: AnomalyStatus.OPEN,
      severity: { $in: ["HIGH", "CRITICAL"] },
    }),
    findInterventionCards(db, {
      where: { ...mine, scheduledStart: today },
      sort: { scheduledStart: 1 },
    }),
    findInterventionCards(db, {
      where: {
        ...mine,
        scheduledStart: { $gt: dayEnd },
        status: InterventionStatus.PLANNED,
      },
      sort: { scheduledStart: 1 },
      limit: 5,
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
 * Projection commune à toutes les listes d'interventions : assez pour
 * afficher une carte complète, rien de plus — ni notes internes ni champs de
 * rapport sur une vue de liste. Les six relations et les deux compteurs sont
 * chargés dans la même requête (un `$lookup` chacun).
 */
const interventionCardSpec = spec("Intervention", {
  fields: ["reference", "scheduledStart", "scheduledEnd", "status"],
  with: {
    customer: one("Customer", "customerId", { fields: ["name", "phone"] }),
    site: one("Site", "siteId", {
      fields: ["name", "address", "postalCode", "city"],
    }),
    equipment: maybeOne("Equipment", "equipmentId", {
      fields: ["label", "brand", "model"],
      with: { type: one("EquipmentType", "typeId", { fields: ["label"] }) },
    }),
    technician: one("User", "technicianId", {
      fields: ["firstName", "lastName", "colorHex"],
    }),
    type: one("InterventionType", "typeId", { fields: ["label", "colorHex"] }),
  },
  count: {
    anomalies: count("Anomaly", "interventionId"),
    photos: count("InterventionPhoto", "interventionId"),
  },
});

export type InterventionCard = Row<"Intervention", typeof interventionCardSpec>;

/** Cartes d'intervention d'une liste, relations comprises, en une requête. */
export function findInterventionCards(
  db: AppContext["db"],
  args: {
    where: Where<"Intervention">;
    sort: SortOf<"Intervention">;
    skip?: number;
    limit?: number;
  },
): Promise<InterventionCard[]> {
  return db.intervention.find(args.where, interventionCardSpec, {
    sort: args.sort,
    skip: args.skip,
    limit: args.limit,
  });
}
