import type { UserRole } from "@vennora/shared/enums";
import { createRepos, type Json, type Repos } from "./db";
import { mongo } from "./mongo";

/**
 * Isolation multi-tenant.
 *
 * Le risque, dans une application où chaque requête porte un `orgId`, n'est
 * pas d'écrire le mauvais filtre : c'est d'en oublier un. Un `find` sans
 * `orgId` compile, passe les tests sur un jeu de données mono-entreprise, et
 * expose les clients d'une autre entreprise en production.
 *
 * On supprime la possibilité de l'oublier : `tenantDb(ctx)` renvoie un client
 * qui injecte `orgId` dans le filtre de chaque lecture et de chaque écriture,
 * dans chaque document créé, et dans chaque `$lookup` des lectures avec
 * relations, pour toutes les collections porteuses d'un tenant (voir
 * `TENANT_MODELS` dans `db/models.ts`). Le client racine `rootDb` reste
 * accessible, mais son usage est réservé à l'authentification, au seed et à
 * ce fichier.
 *
 * Une ressource appartenant à une autre organisation remonte donc comme
 * inexistante, en lecture comme en écriture.
 *
 * Sur les créations, le typage exige toujours `orgId` : on l'écrit donc
 * explicitement à l'appel. Le client l'écrase par celui du contexte, ce qui
 * neutralise toute tentative d'injection d'un `orgId` étranger depuis le
 * corps d'une requête.
 */

export interface TenantContext {
  orgId: string;
  userId: string;
  role: UserRole;
}

export type TenantClient = Repos;

// Un client cloisonné par organisation, réutilisé entre les requêtes : sa
// construction est peu coûteuse mais inutile à répéter, et le pool de
// connexions sous-jacent reste celui de la connexion partagée.
const clients = new Map<string, TenantClient>();

export function tenantDb(ctx: TenantContext | { orgId: string }): TenantClient {
  const existing = clients.get(ctx.orgId);
  if (existing) return existing;

  const created = createRepos(mongo.database, ctx.orgId);
  clients.set(ctx.orgId, created);
  return created;
}

/**
 * Journalise une action sensible. Volontairement « best effort » : un échec
 * d'écriture du journal ne doit jamais faire échouer l'action métier.
 */
export async function audit(
  ctx: TenantContext,
  entry: {
    action: string;
    entity: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  },
): Promise<void> {
  try {
    await tenantDb(ctx).auditLog.insert({
      orgId: ctx.orgId,
      userId: ctx.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      metadata: (entry.metadata ?? null) as Json,
      ipAddress: entry.ipAddress,
    });
  } catch (e) {
    console.error("[vennora] échec d'écriture du journal d'audit", e);
  }
}
