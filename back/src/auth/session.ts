import { jwtVerify, SignJWT } from "jose";
import type { Plan, UserRole } from "@vennora/shared/enums";
import { env, isProduction } from "../env";
import { rootDb } from "../mongo";
import { accesOrganisation, type Acces } from "../services/billing";

/**
 * Session : un jeton signé dans un cookie `httpOnly`.
 *
 * Le jeton ne porte que des identifiants — utilisateur, organisation,
 * métier — et sa date d'émission. Il ne décide de rien : à chaque requête,
 * l'utilisateur est relu en base (`loadCurrentUser`). Un compte désactivé ou
 * rétrogradé perd donc ses droits immédiatement, pas à l'expiration du jeton.
 *
 * `httpOnly` : le JavaScript de la page ne peut pas lire le jeton, une faille
 * XSS ne permet donc pas de le voler. `SameSite=Lax` : il n'accompagne pas
 * les requêtes envoyées depuis un autre site (voir aussi la garde CSRF dans
 * `http.ts`).
 */

export const SESSION_COOKIE = "vennora_session";

/** Un technicien reste connecté toute la semaine entre deux chantiers. */
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

const key = new TextEncoder().encode(env.AUTH_SECRET);

interface SessionClaims {
  uid: string;
  orgId: string;
  tradeSlug: string;
  /** Date d'émission, en secondes. */
  iat: number;
}

export async function signSession(claims: Omit<SessionClaims, "iat">): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(key);
}

export async function readSession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (
      typeof payload.uid !== "string" ||
      typeof payload.orgId !== "string" ||
      typeof payload.tradeSlug !== "string" ||
      typeof payload.iat !== "number"
    ) {
      return null;
    }
    return payload as unknown as SessionClaims;
  } catch {
    // Signature invalide, jeton expiré ou malformé : pas de session.
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
  path: "/",
  maxAge: SESSION_MAX_AGE_S,
} as const;

export interface CurrentUser {
  id: string;
  orgId: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  colorHex: string | null;
  org: {
    id: string;
    name: string;
    logoKey: string | null;
    tradeSlug: string;
    tradeName: string;
    /** Offre souscrite : c'est elle qui ouvre ou ferme les fonctionnalités. */
    plan: Plan;
    /** Essai, abonnement, lecture seule (voir `accesOrganisation`). */
    acces: Acces;
  };
}

/**
 * Utilisateur courant, relu en base.
 *
 * Utilisateur, organisation et métier sont lus en parallèle à partir des
 * identifiants du jeton. Le jeton ne sert qu'à lancer les lectures plus tôt :
 * ce qui fait foi reste la base. Si l'utilisateur a changé d'organisation, ou
 * l'organisation de métier, on relit à partir de la valeur en base.
 */
export async function loadCurrentUser(
  claims: SessionClaims,
): Promise<CurrentUser | null> {
  const orgFields = {
    fields: [
      "name",
      "logoKey",
      "plan",
      "tradeId",
      "subscriptionStatus",
      "stripeSubscriptionId",
      "trialEndsAt",
    ],
  } as const;
  const tradeFields = { fields: ["slug", "name"] } as const;

  const [user, orgFromToken, tradeFromToken] = await Promise.all([
    rootDb.user.findOne(
      { id: claims.uid },
      {
        fields: [
          "orgId",
          "role",
          "firstName",
          "lastName",
          "email",
          "active",
          "colorHex",
          "passwordChangedAt",
        ],
      },
    ),
    rootDb.organization.findOne({ id: claims.orgId }, orgFields),
    rootDb.trade.findOne({ slug: claims.tradeSlug }, tradeFields),
  ]);

  if (!user || !user.active) return null;

  // Un jeton émis avant le dernier changement de mot de passe est périmé,
  // même s'il n'a pas encore expiré : changer son mot de passe déconnecte
  // réellement les autres appareils. Marge d'une seconde : `iat` est en
  // secondes, `passwordChangedAt` en millisecondes.
  if (
    user.passwordChangedAt &&
    claims.iat * 1000 < user.passwordChangedAt.getTime() - 1000
  ) {
    return null;
  }

  const org =
    orgFromToken?.id === user.orgId
      ? orgFromToken
      : await rootDb.organization.findOne({ id: user.orgId }, orgFields);
  if (!org) return null;

  const trade =
    tradeFromToken?.id === org.tradeId
      ? tradeFromToken
      : await rootDb.trade.findOne({ id: org.tradeId }, tradeFields);
  if (!trade) return null;

  return {
    id: user.id,
    orgId: user.orgId,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    email: user.email,
    colorHex: user.colorHex,
    org: {
      id: org.id,
      name: org.name,
      logoKey: org.logoKey,
      tradeSlug: trade.slug,
      tradeName: trade.name,
      plan: org.plan,
      acces: accesOrganisation({
        plan: org.plan,
        subscriptionStatus: org.subscriptionStatus ?? null,
        stripeSubscriptionId: org.stripeSubscriptionId ?? null,
        trialEndsAt: org.trialEndsAt ?? null,
      }),
    },
  };
}
