import { AnomalyStatus, UserRole } from "@vennora/shared/enums";
import { maybeOne, one, type Where } from "../db";
import type { AppContext } from "../context";

/**
 * Anomalies relevées, par statut, éventuellement pour un client.
 *
 * Un technicien ne voit que les anomalies relevées sur ses propres
 * interventions. Le filtre porte sur l'intervention, qui vit dans une autre
 * collection : on résout d'abord les interventions concernées.
 */
export async function listAnomalies(
  { db, user }: AppContext,
  filters: { status: AnomalyStatus; customerId?: string },
) {
  const where: Where<"Anomaly"> = { status: filters.status };

  if (filters.customerId || user.role === UserRole.TECHNICIAN) {
    const interventionIds = await db.intervention.distinct("id", {
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(user.role === UserRole.TECHNICIAN ? { technicianId: user.id } : {}),
    });
    where.interventionId = { $in: interventionIds };
  }

  return db.anomaly.find(
    where,
    {
      fields: [
        "title",
        "description",
        "severity",
        "status",
        "recommendation",
        "createdAt",
      ],
      with: {
        intervention: one("Intervention", "interventionId", {
          fields: ["reference", "scheduledStart"],
          with: {
            customer: one("Customer", "customerId", { fields: ["name"] }),
            site: one("Site", "siteId", { fields: ["name", "city"] }),
          },
        }),
        equipment: maybeOne("Equipment", "equipmentId", {
          fields: ["label"],
          with: { type: one("EquipmentType", "typeId", { fields: ["label"] }) },
        }),
      },
    },
    { sort: { severity: -1, createdAt: -1 }, limit: 100 },
  );
}

export type AnomalyListItem = Awaited<ReturnType<typeof listAnomalies>>[number];

export const ANOMALY_STATUSES = [
  AnomalyStatus.OPEN,
  AnomalyStatus.RESOLVED,
  AnomalyStatus.IGNORED,
] as const;
