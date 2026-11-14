import { InterventionStatus, UserRole } from "@vennora/shared/enums";
import { ForbiddenError, NotFoundError } from "@vennora/shared/errors";
import type { AppContext } from "../context";

const guardFields = {
  fields: ["reference", "status", "technicianId", "customerId", "siteId", "equipmentId"],
} as const;

/**
 * Garde commune à toutes les actions du terrain.
 *
 * Photos, notes, anomalies, signature et clôture partagent exactement les
 * mêmes conditions : l'intervention existe dans l'organisation, elle est
 * assignée à celui qui agit (sauf pour un administrateur), et elle n'est pas
 * déjà close. Écrire ce contrôle une fois évite qu'une des huit actions
 * l'oublie.
 */
export async function requireEditableIntervention(context: AppContext, interventionId: string) {
  const intervention = await requireVisibleIntervention(context, interventionId);

  if (intervention.status === InterventionStatus.COMPLETED) {
    throw new ForbiddenError(
      "Cette intervention est terminée et signée. Elle ne peut plus être modifiée.",
    );
  }
  if (intervention.status === InterventionStatus.CANCELLED) {
    throw new ForbiddenError("Cette intervention est annulée.");
  }
  return intervention;
}

/** Même garde, sans exiger que l'intervention soit encore ouverte. */
export async function requireVisibleIntervention(
  { db, user }: AppContext,
  interventionId: string,
) {
  const intervention = await db.intervention.findOne({ id: interventionId }, guardFields);
  if (!intervention) throw new NotFoundError("Intervention");

  // Volontairement « introuvable » : confirmer l'existence d'une
  // intervention assignée à un collègue n'apporte rien et renseigne.
  if (user.role === UserRole.TECHNICIAN && intervention.technicianId !== user.id) {
    throw new NotFoundError("Intervention");
  }
  return intervention;
}
