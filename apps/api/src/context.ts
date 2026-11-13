import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "@vennora/core/errors";
import { assertCan, type Permission } from "@vennora/core/permissions";
import { loadCurrentUser, readSession, SESSION_COOKIE, type CurrentUser } from "./auth/session";
import type {} from "@fastify/cookie";
import { tenantDb, type TenantClient, type TenantContext } from "./tenant";

/**
 * Point d'entrée unique de toute lecture ou écriture métier.
 *
 * Une route commence par `await requireContext(request, "permission")`, puis
 * n'utilise que le `db` retourné. Elle n'a ainsi aucun moyen d'atteindre les
 * données d'une autre organisation, même en oubliant un filtre.
 */
export interface AppContext {
  user: CurrentUser;
  ctx: TenantContext;
  db: TenantClient;
}

const resolved = new WeakMap<FastifyRequest, Promise<CurrentUser | null>>();

/**
 * Utilisateur de la requête, ou `null`. Mémoïsé par requête : une route qui
 * l'interroge plusieurs fois ne relit la base qu'une fois.
 */
export function currentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  let pending = resolved.get(request);
  if (!pending) {
    pending = readSession(request.cookies[SESSION_COOKIE]).then((claims) =>
      claims ? loadCurrentUser(claims) : null,
    );
    resolved.set(request, pending);
  }
  return pending;
}

/** Contexte authentifié. Lève 401 sans session, 403 sans la permission. */
export async function requireContext(
  request: FastifyRequest,
  permission?: Permission,
): Promise<AppContext> {
  const user = await currentUser(request);
  if (!user) throw new UnauthorizedError();
  if (permission) assertCan(user.role, permission);

  const ctx: TenantContext = { orgId: user.orgId, userId: user.id, role: user.role };
  return { user, ctx, db: tenantDb(ctx) };
}
