import { ReminderStatus, UserRole } from "@vennora/shared/enums";
import { maybeOne, one, type Where } from "../db";
import type { AppContext } from "../context";

/**
 * Rappels de prochaine intervention (§23).
 *
 * Volontairement passifs : aucun envoi automatique au client, aucune relance
 * programmée. Un rappel est une ligne dans une liste « à replanifier » que
 * quelqu'un traite quand il prépare son planning. Le cahier des charges
 * demande explicitement de ne pas construire un moteur de relances.
 */

/** Un technicien ne voit que les rappels issus de ses interventions. */
async function scope({ db, user }: AppContext): Promise<Where<"Reminder">> {
  if (user.role !== UserRole.TECHNICIAN) return {};
  const mine = await db.intervention.distinct("id", { technicianId: user.id });
  return { sourceInterventionId: { $in: mine } };
}

export async function listReminders(
  context: AppContext,
  status: ReminderStatus = ReminderStatus.PENDING,
) {
  const rows = await context.db.reminder.find(
    { ...(await scope(context)), status },
    {
      fields: ["dueDate", "note", "status"],
      with: {
        customer: maybeOne("Customer", "customerId", {
          fields: ["name", "phone", "email"],
        }),
        equipment: maybeOne("Equipment", "equipmentId", {
          fields: ["label", "location"],
          with: {
            type: one("EquipmentType", "typeId", { fields: ["label"] }),
            site: one("Site", "siteId", { fields: ["name", "city", "postalCode"] }),
          },
        }),
        sourceIntervention: maybeOne("Intervention", "sourceInterventionId", {
          fields: ["reference", "scheduledStart"],
        }),
      },
    },
    { sort: { dueDate: 1 }, limit: 200 },
  );

  const now = new Date();
  return rows.map((r) => ({ ...r, overdue: r.dueDate < now }));
}

export type ReminderItem = Awaited<ReturnType<typeof listReminders>>[number];

/** Compteurs pour la navigation et le tableau de bord. */
export async function countDueReminders(context: AppContext) {
  const where = { ...(await scope(context)), status: ReminderStatus.PENDING };
  const [pending, overdue] = await Promise.all([
    context.db.reminder.count(where),
    context.db.reminder.count({ ...where, dueDate: { $lt: new Date() } }),
  ]);
  return { pending, overdue };
}
